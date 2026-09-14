import { setTimeout as sleep } from 'node:timers/promises';
import { createAppServer, type AppServerHandle } from '../../../server/src/app';
import { createLogger } from '../../../server/src/logger';
import { RoomRegistry, type JoinResult } from '../../../server/src/rooms/RoomRegistry';
import { TestPeerClient } from './TestPeerClient';

export type Command =
  | { type: 'join'; client: number }
  | { type: 'leave'; client: number }
  | { type: 'disconnect'; client: number }
  | { type: 'rejoin'; client: number }
  | { type: 'wait'; ms: number }
  /** Несколько команд подряд в одном синхронном блоке — «в одном тике». */
  | { type: 'tick'; commands: ClientCommand[] };

export type ClientCommand = Extract<Command, { client: number }>;

export interface ServerLogLine {
  level: 'debug' | 'info' | 'warn' | 'error';
  line: string;
}

/**
 * Запоминает joinSeq каждого вошедшего (после выхода registry его уже не отдаёт), наибольший
 * размер комнаты и её размер в момент каждого отказа ROOM_FULL.
 */
class RecordingRegistry extends RoomRegistry {
  readonly joinSeqs = new Map<string, number>();
  maxRoomSize = 0;
  readonly roomSizesOnReject: number[] = [];

  // Остаётся синхронным, как и родитель: на этом держится атомарность лимита.
  override join(...args: Parameters<RoomRegistry['join']>): JoinResult {
    const result = super.join(...args);
    if (result.ok) {
      this.joinSeqs.set(result.participant.id, result.participant.joinSeq);
      this.maxRoomSize = Math.max(this.maxRoomSize, result.room.participants.size);
    } else {
      this.roomSizesOnReject.push(this.getRoom(args[0])?.participants.size ?? 0);
    }
    return result;
  }
}

export const STAND_ROOM_ID = 'role-stand';

/**
 * Стенд протокола ролей (TDD этапа 5 §11.2): настоящий сервер на эфемерном порту
 * и K клиентов с настоящим PeerManager и FakePeerSession.
 */
export class RoleStand {
  readonly clients: TestPeerClient[];

  private constructor(
    private readonly server: AppServerHandle,
    private readonly registry: RecordingRegistry,
    /** Все строки серверного лога в порядке записи. */
    readonly logs: readonly ServerLogLine[],
    url: string,
    clientCount: number,
  ) {
    this.clients = Array.from(
      { length: clientCount },
      (_, index) => new TestPeerClient({ index, url, roomId: STAND_ROOM_ID }),
    );
  }

  static async start(clientCount: number): Promise<RoleStand> {
    const registry = new RecordingRegistry();
    const logs: ServerLogLine[] = [];
    const server = createAppServer({
      port: 0,
      host: '127.0.0.1',
      registry,
      logger: createLogger('debug', (level, line) => logs.push({ level, line })),
    });
    const { port } = await server.listen();
    return new RoleStand(server, registry, logs, `http://127.0.0.1:${port}`, clientCount);
  }

  /** Команды по очереди; между командами — оборот event loop, чтобы сеть успела вклиниться. */
  async run(commands: readonly Command[]): Promise<void> {
    for (const command of commands) {
      if (command.type === 'wait') {
        await sleep(command.ms);
        continue;
      }
      if (command.type === 'tick') command.commands.forEach((c) => this.apply(c));
      else this.apply(command);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  /**
   * Ждёт, пока протокол успокоится: никто не входит, сервер и клиенты согласны, кто в комнате,
   * и два полных раунда round-trip через каждый сокет не изменили ни одного счётчика.
   */
  async settle(timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let previous: string | null = null;
    let stableRounds = 0;

    while (stableRounds < 2) {
      if (Date.now() > deadline) {
        throw new Error(`RoleStand did not settle in ${timeoutMs} ms: ${this.describe()}`);
      }
      if (!this.membershipAgrees()) {
        previous = null;
        stableRounds = 0;
        await sleep(5);
        continue;
      }
      await this.flushAll();
      const current = this.fingerprint();
      stableRounds = current === previous && this.membershipAgrees() ? stableRounds + 1 : 0;
      previous = current;
    }
  }

  /** Живые участники комнаты по данным сервера, в порядке входа. */
  liveParticipantIds(): string[] {
    return this.registry.listParticipants(STAND_ROOM_ID).map((p) => p.id);
  }

  /** Наибольшее число участников комнаты за всё время стенда. */
  get maxRoomSize(): number {
    return this.registry.maxRoomSize;
  }

  /** Размер комнаты в момент каждого отказа ROOM_FULL. */
  get roomSizesOnReject(): readonly number[] {
    return this.registry.roomSizesOnReject;
  }

  joinSeq(participantId: string): number {
    const seq = this.registry.joinSeqs.get(participantId);
    if (seq === undefined) throw new Error(`Unknown participant ${participantId}`);
    return seq;
  }

  /** Сигналы, которые сервер отбросил как нарушение ролей (защита в глубину I1). */
  roleViolations(): string[] {
    return this.logs
      .map((entry) => entry.line)
      .filter((line) => line.includes('Signal dropped') && line.includes('"role-violation"'));
  }

  async close(): Promise<void> {
    for (const client of this.clients) client.disconnect();
    await this.server.close();
  }

  describe(): string {
    const clients = this.clients.map((c) => ({
      index: c.index,
      status: c.status,
      participantId: c.participantId,
      sessions: c.liveSessions().map((s) => `${s.role}:${s.remoteId}`),
    }));
    return JSON.stringify({ server: this.liveParticipantIds(), clients });
  }

  private apply(command: ClientCommand): void {
    const client = this.clients[command.client];
    if (!client) throw new Error(`No client #${command.client}`);
    client[command.type]();
  }

  private membershipAgrees(): boolean {
    if (this.clients.some((c) => c.status === 'joining')) return false;
    const onClients = this.clients
      .map((c) => c.participantId)
      .filter((id): id is string => id !== null)
      .sort();
    return JSON.stringify(onClients) === JSON.stringify(this.liveParticipantIds().sort());
  }

  /**
   * Round-trip через каждый подключённый сокет: заведомо невалидный room:join отклоняется
   * сервером без побочных эффектов, а ack приходит после всех событий, уже поставленных
   * этому сокету.
   */
  private async flushAll(): Promise<void> {
    for (const client of this.clients) {
      const socket = client.socket;
      if (!socket?.connected) continue;
      await new Promise<void>((resolve) => {
        // Сокет могут закрыть, пока идёт раунд: ack тогда не придёт.
        const done = () => {
          socket.off('disconnect', done);
          resolve();
        };
        socket.on('disconnect', done);
        const raw = socket as unknown as { emit(event: string, ...args: unknown[]): void };
        raw.emit('room:join', null, done);
      });
    }
  }

  private fingerprint(): string {
    return JSON.stringify({
      logs: this.logs.length,
      clients: this.clients.map((c) => [
        c.status,
        c.participantId,
        c.sessions.length,
        c.sessions.map((s) => `${s.sent.join()}/${s.received.join()}/${s.closed}`),
      ]),
    });
  }
}
