import {
  ACK_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  type ChatSendAck,
  type JoinAck,
  type MediaState,
  type ServerErrorCode,
  type SignalData,
} from '@vcr/shared';
import type { Dispatch } from 'react';
import { PeerManager, type PeerManagerDeps } from '../call/PeerManager';
import { getPeerConnectTimeoutMs, getRtcConfiguration } from '../call/rtcConfig';
import { MediaController, type MediaControllerDeps } from '../media/MediaController';
import { createSocket as defaultCreateSocket, type AppClientSocket } from '../net/createSocket';
import type { AppAction, ChatSendFailure, JoinFailure } from '../state/actions';

/** Сколько ждём ack на room:leave, прежде чем просто закрыть соединение. */
export const LEAVE_ACK_TIMEOUT_MS = 2_000;

/** Колбэки, которыми RoomSession связывает MediaController с reducer'ом и сокетом. */
export type MediaCallbacks = Pick<MediaControllerDeps, 'onStatus' | 'onNotice'>;

export interface RoomSessionDeps {
  dispatch: Dispatch<AppAction>;
  createSocket?: () => AppClientSocket;
  /** Подмена MediaController (тесты); по умолчанию — настоящие navigator.mediaDevices. */
  createMedia?: (callbacks: MediaCallbacks) => MediaController;
  /** Подмена PeerManager (тесты: в jsdom нет RTCPeerConnection). */
  createPeers?: (deps: PeerManagerDeps) => PeerManager;
}

type Status = 'idle' | 'joining' | 'joined';

const defaultCreateMedia = (callbacks: MediaCallbacks) =>
  new MediaController({
    // Наличие mediaDevices гарантирует гейт окружения (TDD этапа 1).
    mediaDevices: navigator.mediaDevices,
    permissions: 'permissions' in navigator ? navigator.permissions : undefined,
    ...callbacks,
  });

function sameMedia(a: MediaState, b: MediaState): boolean {
  return a.audio === b.audio && a.video === b.video;
}

/** Реакция клиента на коды ошибок сервера (TDD §6.3). */
export function mapJoinError(code: ServerErrorCode): JoinFailure {
  switch (code) {
    case 'ROOM_FULL':
      return 'ROOM_FULL';
    case 'INVALID_NAME':
      return 'INVALID_NAME';
    case 'INVALID_PAYLOAD':
    case 'INVALID_ROOM_ID':
    case 'ALREADY_JOINED':
    case 'INVALID_MESSAGE':
    case 'RATE_LIMITED':
      // Клиент такие запросы не отправляет — это признак бага клиента.
      console.error(`room:join rejected with ${code}`);
      return 'INTERNAL';
    case 'NOT_IN_ROOM':
    case 'INTERNAL':
      return 'INTERNAL';
  }
}

/** Реакция клиента на отказ chat:send (TDD §6.4). */
export function mapChatSendError(code: ServerErrorCode): ChatSendFailure {
  switch (code) {
    case 'INVALID_MESSAGE':
      return 'INVALID_MESSAGE';
    case 'RATE_LIMITED':
      return 'RATE_LIMITED';
    case 'NOT_IN_ROOM':
      return 'NOT_IN_ROOM';
    case 'INVALID_PAYLOAD':
    case 'INVALID_NAME':
    case 'INVALID_ROOM_ID':
    case 'ALREADY_JOINED':
    case 'ROOM_FULL':
      // Клиент такие запросы не отправляет — это признак бага клиента.
      console.error(`chat:send rejected with ${code}`);
      return 'INTERNAL';
    case 'INTERNAL':
      return 'INTERNAL';
  }
}

/**
 * Владелец side effects сессии в комнате: создаёт сокет, входит, выходит и переводит
 * события сети в действия reducer'а. Сам сокет в state не попадает.
 *
 * Создаётся один раз на вкладку (в AppStateProvider). Каждый вход — новый сокет, поэтому
 * повторный вход сервер видит как нового участника (FR-28, FR-31). События от сокета,
 * который уже не текущий (после выхода или ошибки), игнорируются.
 *
 * Этап 3: владеет MediaController. Медиа захватывается до room:join, изменения mic/cam уходят
 * через media:update, а на любом пути выхода устройства освобождаются (TDD этапа 3 §4.4).
 *
 * Этап 4: владеет PeerManager. participant:* и signal маршрутизируются в него только в фазе
 * joined; на любом пути выхода соединения закрываются раньше, чем гаснут устройства.
 */
export class RoomSession {
  readonly media: MediaController;
  readonly peers: PeerManager;

  private readonly dispatch: Dispatch<AppAction>;
  private readonly createSocket: () => AppClientSocket;
  private socket: AppClientSocket | null = null;
  private status: Status = 'idle';
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private currentRoomId: string | null = null;
  /** Вход, ожидающий захвата медиа; null, когда подключение уже начато или входа нет. */
  private pendingJoin: { roomId: string; name: string } | null = null;
  /** Последнее отправленное серверу состояние mic/cam (в room:join или media:update). */
  private lastSentMedia: MediaState | null = null;
  /** Наблюдатели исходящих сигналов (E2E-хук считает offer/answer/candidate). */
  private readonly signalListeners = new Set<(to: string, data: SignalData) => void>();

  constructor(deps: RoomSessionDeps) {
    this.dispatch = deps.dispatch;
    this.createSocket = deps.createSocket ?? defaultCreateSocket;
    this.media = (deps.createMedia ?? defaultCreateMedia)({
      // Прямо из колбэка, без useEffect: состояние уходит серверу сразу за reducer'ом.
      onStatus: (kind, status) => {
        this.dispatch({ type: 'LOCAL_MEDIA_STATUS_CHANGED', kind, status });
        this.publishMediaState(this.media.getPublicState());
      },
      onNotice: (text, tone) => this.dispatch({ type: 'NOTICE_SHOWN', text, tone }),
    });
    this.media.onTrackChange((kind) => {
      if (kind === 'video') this.dispatch({ type: 'LOCAL_VIDEO_TRACK_CHANGED' });
    });
    this.peers = (deps.createPeers ?? ((peerDeps) => new PeerManager(peerDeps)))({
      media: this.media,
      rtcConfig: getRtcConfiguration(),
      connectTimeoutMs: getPeerConnectTimeoutMs(),
      sendSignal: (to, data) => {
        const socket = this.socket;
        if (this.status !== 'joined' || !socket) return;
        socket.emit('signal', { to, data });
        for (const listener of this.signalListeners) listener(to, data);
      },
      onPeerStatus: (participantId, status) =>
        this.dispatch({ type: 'PEER_STATUS_CHANGED', participantId, status }),
      onNotice: (text) => this.dispatch({ type: 'NOTICE_SHOWN', text, tone: 'error' }),
    });
  }

  /** Подписка на отправленные сигналы; возвращает отписку. */
  onSignalSent(listener: (to: string, data: SignalData) => void): () => void {
    this.signalListeners.add(listener);
    return () => {
      this.signalListeners.delete(listener);
    };
  }

  /** Комната последней попытки входа (в том числе неудачной); null после выхода. */
  get roomId(): string | null {
    return this.currentRoomId;
  }

  /**
   * Вход: захват медиа → connect → room:join { media }. Захват идёт в обработчике клика
   * («Войти» — жест пользователя), поэтому в StrictMode двойного getUserMedia нет.
   * No-op, если вход уже идёт или выполнен (двойной клик, повторный submit).
   */
  join(roomId: string, name: string): void {
    if (this.status !== 'idle') return;

    this.status = 'joining';
    this.currentRoomId = roomId;
    const pending = { roomId, name };
    this.pendingJoin = pending;
    this.dispatch({ type: 'JOIN_REQUESTED', roomId, name });

    void this.media.acquireInitial().then(() => {
      // За время захвата пользователь мог уйти, войти заново или пропустить медиа.
      if (this.pendingJoin === pending) this.connect(roomId, name);
    });
  }

  /**
   * «Войти без камеры и микрофона» на время ожидания ответа на запрос разрешения (TBD-3):
   * статусы off, поздно пришедшие треки сразу останавливаются, вход продолжается.
   */
  joinWithoutMedia(): void {
    const pending = this.pendingJoin;
    if (!pending || this.status !== 'joining') return;
    this.media.stopAll();
    this.connect(pending.roomId, pending.name);
  }

  /** Выход по кнопке «Выйти», «Назад» или «На главную». Работает из любой фазы. */
  leave(): void {
    const socket = this.socket;
    const wasJoined = this.status === 'joined';
    this.teardown({ disconnect: false });
    this.currentRoomId = null;
    this.dispatch({ type: 'LEFT_ROOM' });

    if (!socket) return;
    if (wasJoined && socket.connected) {
      // Даём серверу штатно обработать выход, но не ждём дольше LEAVE_ACK_TIMEOUT_MS.
      socket.timeout(LEAVE_ACK_TIMEOUT_MS).emit('room:leave', () => socket.disconnect());
    } else {
      socket.disconnect();
    }
  }

  /**
   * pagehide: закрываем соединение сразу, чтобы остальные быстрее увидели уход.
   * Если страницу вернут из bfcache, пользователь увидит «Соединение прервано».
   */
  handlePageHide(): void {
    const status = this.status;
    if (status === 'idle') return;
    this.teardown();
    if (status === 'joined') this.dispatch({ type: 'CONNECTION_LOST' });
    else this.dispatch({ type: 'JOIN_FAILED', reason: 'SERVER_UNAVAILABLE' });
  }

  /** Тумблер микрофона: из выключенного или ошибочного статуса — включить. */
  toggleAudio(): void {
    if (this.status !== 'joined') return;
    void this.media.setAudioEnabled(!this.media.getPublicState().audio);
  }

  /** Тумблер камеры: выключение гасит лампочку, включение — новый getUserMedia. */
  toggleVideo(): void {
    if (this.status !== 'joined') return;
    void this.media.setVideoEnabled(!this.media.getPublicState().video);
  }

  /** Дедупликация по lastSentMedia; отправляет только в фазе joined. */
  publishMediaState(state: MediaState): void {
    const socket = this.socket;
    if (!socket || this.status !== 'joined') return;
    if (this.lastSentMedia && sameMedia(this.lastSentMedia, state)) return;
    this.lastSentMedia = { ...state };
    socket.emit('media:update', { ...state });
  }

  /**
   * Отправляет сообщение в чат. Promise<boolean> нужен только полю ввода — вернуть текст при
   * ошибке; само сообщение попадёт в state через broadcast chat:message, как и у остальных.
   * Ошибки показываются тостом через CHAT_SEND_FAILED; NOT_IN_ROOM — молча (идёт выход).
   */
  sendChatMessage(text: string): Promise<boolean> {
    const socket = this.socket;
    if (!socket || this.status !== 'joined') return Promise.resolve(false);

    return new Promise((resolve) => {
      const fail = (code: ChatSendFailure) => {
        resolve(false);
        // После выхода или обрыва тост об отправке уже не нужен.
        if (this.socket === socket) this.dispatch({ type: 'CHAT_SEND_FAILED', code });
      };

      // Callback-ack, как и room:join: без лишнего микротаска между ack и событиями.
      socket
        .timeout(ACK_TIMEOUT_MS)
        .emit('chat:send', { text }, (err: Error | null, res: ChatSendAck) => {
          if (err) return fail('TIMEOUT');
          if (!res.ok) return fail(mapChatSendError(res.error.code));
          resolve(true);
        });
    });
  }

  /** Освобождает сокет и устройства. Сессию можно использовать снова. */
  dispose(): void {
    this.teardown();
  }

  private connect(roomId: string, name: string): void {
    this.pendingJoin = null;
    this.dispatch({ type: 'JOIN_CONNECTING' });

    const socket = this.createSocket();
    this.socket = socket;
    const isCurrent = () => this.socket === socket;

    // Все слушатели — до connect(), чтобы не пропустить ни одного события.
    // Медиасоединения — только в joined: «хвосты» после выхода не должны создавать сессии.
    const isJoined = () => isCurrent() && this.status === 'joined';
    socket.on('participant:joined', ({ participant }) => {
      if (!isCurrent()) return;
      this.dispatch({ type: 'PARTICIPANT_JOINED', participant });
      if (!isJoined()) return;
      // Новичок вошёл позже — я offerer (I1). connecting до создания сессии: если PC не
      // создастся, failed из PeerManager придёт следом и победит.
      this.dispatch({
        type: 'PEER_STATUS_CHANGED',
        participantId: participant.id,
        status: 'connecting',
      });
      this.peers.handleParticipantJoined(participant.id);
    });
    socket.on('participant:left', ({ participantId }) => {
      if (!isCurrent()) return;
      if (isJoined()) this.peers.handleParticipantLeft(participantId);
      this.dispatch({ type: 'PARTICIPANT_LEFT', participantId });
    });
    socket.on('signal', ({ from, data }) => {
      if (isJoined()) this.peers.handleSignal(from, data);
    });
    socket.on('participant:media', ({ participantId, media }) => {
      if (isCurrent()) this.dispatch({ type: 'PARTICIPANT_MEDIA_CHANGED', participantId, media });
    });
    socket.on('chat:message', ({ message }) => {
      if (isCurrent()) this.dispatch({ type: 'CHAT_MESSAGE_RECEIVED', message });
    });
    socket.on('connect_error', () => {
      if (isCurrent() && this.status === 'joining') this.fail('SERVER_UNAVAILABLE');
    });
    socket.on('disconnect', (reason) => {
      if (!isCurrent()) return;
      if (this.status === 'joining') {
        this.fail('SERVER_UNAVAILABLE');
      } else if (this.status === 'joined' && reason !== 'io client disconnect') {
        this.teardown();
        this.dispatch({ type: 'CONNECTION_LOST' });
      }
    });
    socket.once('connect', () => {
      clearTimeout(this.connectTimer);
      if (isCurrent() && this.status === 'joining') this.sendJoin(socket, roomId, name);
    });

    // Таймаут io() покрывает только транспорт; этот — ещё и подключение к namespace.
    // Отсчёт начинается после захвата медиа: время на ответ о разрешении сюда не входит.
    this.connectTimer = setTimeout(() => {
      if (isCurrent() && this.status === 'joining' && !socket.connected) {
        this.fail('SERVER_UNAVAILABLE');
      }
    }, CONNECT_TIMEOUT_MS);

    socket.connect();
  }

  private sendJoin(socket: AppClientSocket, roomId: string, name: string): void {
    const media = this.media.getPublicState();
    this.lastSentMedia = media;
    // Только callback-ack, не emitWithAck: продолжение после await выполнилось бы уже после
    // событий из той же пачки пакетов, и в списке появились бы «призраки» (TDD §4.3).
    socket
      .timeout(ACK_TIMEOUT_MS)
      .emit('room:join', { roomId, name, media }, (err: Error | null, res: JoinAck) => {
        if (this.socket !== socket || this.status !== 'joining') return;
        if (err) return this.fail('SERVER_UNAVAILABLE');
        if (!res.ok) return this.fail(mapJoinError(res.error.code));

        this.status = 'joined';
        this.dispatch({
          type: 'JOIN_SUCCEEDED',
          self: res.self,
          participants: res.participants,
          messages: res.messages,
        });
        // Старожилы пришлют offer сами (I1); answerer-сессии создаются лениво, по offer.
        for (const participant of res.participants) {
          if (participant.id === res.self.id) continue;
          this.dispatch({
            type: 'PEER_STATUS_CHANGED',
            participantId: participant.id,
            status: 'connecting',
          });
        }
        // Статус мог измениться между room:join и ack (например, устройство пропало).
        this.publishMediaState(this.media.getPublicState());
      });
  }

  private fail(reason: JoinFailure): void {
    this.teardown();
    this.dispatch({ type: 'JOIN_FAILED', reason });
  }

  /**
   * Отвязывает текущий сокет до disconnect(), чтобы его события уже не считались текущими,
   * закрывает медиасоединения и освобождает устройства: лампочка камеры гаснет на любом пути
   * выхода. Соединения — раньше устройств, чтобы stopAll() не ждал replaceTrack закрытых пар.
   */
  private teardown({ disconnect = true } = {}): void {
    clearTimeout(this.connectTimer);
    const socket = this.socket;
    this.socket = null;
    this.status = 'idle';
    this.pendingJoin = null;
    this.lastSentMedia = null;
    if (disconnect) socket?.disconnect();
    this.peers.closeAll();
    this.media.stopAll();
  }
}
