import type {
  ClientToServerEvents,
  JoinAck,
  ServerErrorCode,
  ServerToClientEvents,
} from '@vcr/shared';
import { io, type Socket } from 'socket.io-client';
import { PeerManager } from '../../../client/src/call/PeerManager';
import { FakePeerSession } from './FakePeerSession';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type ClientStatus = 'idle' | 'joining' | 'joined';

const NO_TRACKS = { audio: null, video: null };

/**
 * Тестовый участник: socket.io-client + настоящий PeerManager с FakePeerSession.
 * Жизненный цикл и маршрутизация событий повторяют RoomSession (без медиа и UI):
 * новый сокет на каждый вход, callback-ack, события старого сокета игнорируются.
 */
export class TestPeerClient {
  readonly index: number;
  status: ClientStatus = 'idle';
  /** id текущего пребывания в комнате; при каждом входе новый. */
  participantId: string | null = null;
  socket: ClientSocket | null = null;
  readonly manager: PeerManager;
  /** Все сессии за время жизни клиента, включая закрытые, в порядке создания. */
  readonly sessions: FakePeerSession[] = [];
  /** Коды отказов room:join в порядке получения. */
  readonly joinErrors: ServerErrorCode[] = [];

  private readonly url: string;
  private readonly roomId: string;

  constructor(opts: { index: number; url: string; roomId: string }) {
    this.index = opts.index;
    this.url = opts.url;
    this.roomId = opts.roomId;
    this.manager = new PeerManager({
      media: { getTracks: () => NO_TRACKS, onTrackChange: () => () => {} },
      rtcConfig: {},
      sendSignal: (to, data) => {
        if (this.status === 'joined') this.socket?.emit('signal', { to, data });
      },
      onPeerStatus: () => {},
      onNotice: () => {},
      createSession: (deps) => {
        const session = new FakePeerSession(deps);
        this.sessions.push(session);
        return session.asPeerSession();
      },
    });
  }

  /** Сессии, которые PeerManager сейчас держит. */
  liveSessions(): FakePeerSession[] {
    const ids = new Set(this.manager.ids());
    return this.sessions.filter((s) => !s.closed && ids.has(s.remoteId));
  }

  /** No-op, если вход уже идёт или выполнен (как RoomSession.join). */
  join(name = `Участник ${this.index + 1}`): void {
    if (this.status !== 'idle') return;
    this.status = 'joining';

    const socket: ClientSocket = io(this.url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      autoConnect: false,
    });
    this.socket = socket;
    const isCurrent = () => this.socket === socket;
    const isJoined = () => isCurrent() && this.status === 'joined';

    socket.on('participant:joined', ({ participant }) => {
      if (isJoined()) this.manager.handleParticipantJoined(participant.id);
    });
    socket.on('participant:left', ({ participantId }) => {
      if (isJoined()) this.manager.handleParticipantLeft(participantId);
    });
    socket.on('signal', ({ from, data }) => {
      if (isJoined()) this.manager.handleSignal(from, data);
    });
    socket.on('connect_error', () => {
      if (isCurrent()) this.teardown();
    });
    socket.on('disconnect', (reason) => {
      if (isCurrent() && reason !== 'io client disconnect') this.teardown();
    });
    socket.once('connect', () => {
      if (!isCurrent() || this.status !== 'joining') return;
      const media = { audio: false, video: false };
      socket.emit('room:join', { roomId: this.roomId, name, media }, (res: JoinAck) => {
        if (!isCurrent() || this.status !== 'joining') return;
        if (!res.ok) {
          this.joinErrors.push(res.error.code);
          this.teardown();
          return;
        }
        this.status = 'joined';
        this.participantId = res.self.id;
        // Старожилы пришлют offer сами (I1): answerer-сессии создаются лениво.
      });
    });
    socket.connect();
  }

  /** «Выйти»: room:leave с ack, затем отключение. Из joining — просто отключение. */
  leave(): void {
    const socket = this.socket;
    const wasJoined = this.status === 'joined';
    this.teardown({ disconnect: false });
    if (!socket) return;
    if (wasJoined && socket.connected) socket.emit('room:leave', () => socket.disconnect());
    else socket.disconnect();
  }

  /** Обрыв без room:leave (закрыли вкладку): сервер узнаёт о выходе из disconnect. */
  disconnect(): void {
    this.teardown();
  }

  /** Выход и немедленный вход в том же тике: новый participantId и joinSeq. */
  rejoin(): void {
    this.leave();
    this.join();
  }

  private teardown({ disconnect = true } = {}): void {
    const socket = this.socket;
    this.socket = null;
    this.status = 'idle';
    this.participantId = null;
    if (disconnect) socket?.disconnect();
    this.manager.closeAll();
  }
}
