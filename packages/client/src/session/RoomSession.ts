import {
  ACK_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  type ChatSendAck,
  type JoinAck,
  type ServerErrorCode,
} from '@vcr/shared';
import type { Dispatch } from 'react';
import { createSocket as defaultCreateSocket, type AppClientSocket } from '../net/createSocket';
import type { AppAction, ChatSendFailure, JoinFailure } from '../state/actions';

/** Сколько ждём ack на room:leave, прежде чем просто закрыть соединение. */
export const LEAVE_ACK_TIMEOUT_MS = 2_000;

export interface RoomSessionDeps {
  dispatch: Dispatch<AppAction>;
  createSocket?: () => AppClientSocket;
}

type Status = 'idle' | 'joining' | 'joined';

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
 */
export class RoomSession {
  private readonly dispatch: Dispatch<AppAction>;
  private readonly createSocket: () => AppClientSocket;
  private socket: AppClientSocket | null = null;
  private status: Status = 'idle';
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private currentRoomId: string | null = null;

  constructor(deps: RoomSessionDeps) {
    this.dispatch = deps.dispatch;
    this.createSocket = deps.createSocket ?? defaultCreateSocket;
  }

  /** Комната последней попытки входа (в том числе неудачной); null после выхода. */
  get roomId(): string | null {
    return this.currentRoomId;
  }

  /** No-op, если вход уже идёт или выполнен (двойной клик, повторный submit). */
  join(roomId: string, name: string): void {
    if (this.status !== 'idle') return;

    this.status = 'joining';
    this.currentRoomId = roomId;
    this.dispatch({ type: 'JOIN_REQUESTED', roomId, name });

    const socket = this.createSocket();
    this.socket = socket;
    const isCurrent = () => this.socket === socket;

    // Все слушатели — до connect(), чтобы не пропустить ни одного события.
    socket.on('participant:joined', ({ participant }) => {
      if (isCurrent()) this.dispatch({ type: 'PARTICIPANT_JOINED', participant });
    });
    socket.on('participant:left', ({ participantId }) => {
      if (isCurrent()) this.dispatch({ type: 'PARTICIPANT_LEFT', participantId });
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
    this.connectTimer = setTimeout(() => {
      if (isCurrent() && this.status === 'joining' && !socket.connected) {
        this.fail('SERVER_UNAVAILABLE');
      }
    }, CONNECT_TIMEOUT_MS);

    socket.connect();
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

  /** Освобождает ресурсы без изменения state. Сессию можно использовать снова. */
  dispose(): void {
    this.teardown();
  }

  private sendJoin(socket: AppClientSocket, roomId: string, name: string): void {
    // Только callback-ack, не emitWithAck: продолжение после await выполнилось бы уже после
    // событий из той же пачки пакетов, и в списке появились бы «призраки» (TDD §4.3).
    socket
      .timeout(ACK_TIMEOUT_MS)
      .emit('room:join', { roomId, name }, (err: Error | null, res: JoinAck) => {
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
      });
  }

  private fail(reason: JoinFailure): void {
    this.teardown();
    this.dispatch({ type: 'JOIN_FAILED', reason });
  }

  /** Отвязывает текущий сокет до disconnect(), чтобы его события уже не считались текущими. */
  private teardown({ disconnect = true } = {}): void {
    clearTimeout(this.connectTimer);
    const socket = this.socket;
    this.socket = null;
    this.status = 'idle';
    if (disconnect) socket?.disconnect();
  }
}
