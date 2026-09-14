import type {
  Ack,
  ChatMessage,
  ChatSendAck,
  ClientToServerEvents,
  JoinAck,
  MediaState,
  ParticipantDTO,
  ServerToClientEvents,
} from '@vcr/shared';
import { io, type Socket } from 'socket.io-client';

export type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Сокет без типов контракта — для отправки заведомо невалидных payload. */
export interface RawEmitter {
  emit(event: string, ...args: unknown[]): unknown;
}

const openClients = new Set<TestClient>();

/** Настоящий socket.io-клиент: только websocket, без переподключений. */
export async function connectClient(url: string): Promise<TestClient> {
  const client: TestClient = io(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  openClients.add(client);
  await new Promise<void>((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
  });
  return client;
}

export function connectClients(url: string, count: number): Promise<TestClient[]> {
  return Promise.all(Array.from({ length: count }, () => connectClient(url)));
}

export function disconnectAll(): void {
  for (const client of openClients) client.disconnect();
  openClients.clear();
}

/** Начальное media в room:join, если тесту не важно конкретное значение. */
export const DEFAULT_MEDIA: MediaState = { audio: true, video: true };

export function join(
  client: TestClient,
  roomId: string,
  name = 'Тест',
  media: MediaState = DEFAULT_MEDIA,
): Promise<JoinAck> {
  return new Promise((resolve) => {
    client.emit('room:join', { roomId, name, media }, resolve);
  });
}

export async function joinOk(
  client: TestClient,
  roomId: string,
  name = 'Тест',
  media: MediaState = DEFAULT_MEDIA,
) {
  const res = await join(client, roomId, name, media);
  if (!res.ok) throw new Error(`join failed: ${res.error.code}`);
  return res;
}

export function leave(client: TestClient): Promise<Ack> {
  return new Promise((resolve) => {
    client.emit('room:leave', resolve);
  });
}

export function rawJoin(client: TestClient, payload: unknown): Promise<JoinAck> {
  return new Promise((resolve) => {
    (client as unknown as RawEmitter).emit('room:join', payload, resolve);
  });
}

export function sendChat(client: TestClient, text: string): Promise<ChatSendAck> {
  return new Promise((resolve) => {
    client.emit('chat:send', { text }, resolve);
  });
}

export function rawSendChat(client: TestClient, payload: unknown): Promise<ChatSendAck> {
  return new Promise((resolve) => {
    (client as unknown as RawEmitter).emit('chat:send', payload, resolve);
  });
}

/** Записывает chat:message клиента в порядке получения. */
export function recordChat(client: TestClient): ChatMessage[] {
  const messages: ChatMessage[] = [];
  client.on('chat:message', ({ message }) => messages.push(message));
  return messages;
}

export function userMessages(messages: ChatMessage[]) {
  return messages.filter((m) => m.kind === 'user');
}

export type RecordedEvent =
  { type: 'joined'; participant: ParticipantDTO } | { type: 'left'; participantId: string };

/** Записывает participant:* события клиента в порядке получения. */
export function recordEvents(client: TestClient): RecordedEvent[] {
  const events: RecordedEvent[] = [];
  client.on('participant:joined', ({ participant }) =>
    events.push({ type: 'joined', participant }),
  );
  client.on('participant:left', ({ participantId }) =>
    events.push({ type: 'left', participantId }),
  );
  return events;
}
