// Сокет-контракт этапа 1. Этапы 2–5 только добавляют события и поля (TDD §4.1).

export interface ParticipantDTO {
  /** UUID, генерирует сервер; в UI не показывается. */
  id: string;
  /** Нормализованное имя. */
  name: string;
  /** Epoch ms по серверным часам; задаёт порядок. */
  joinedAt: number;
}

export type ServerErrorCode =
  | 'INVALID_PAYLOAD'
  | 'INVALID_NAME'
  | 'INVALID_ROOM_ID'
  | 'ALREADY_JOINED'
  | 'ROOM_FULL'
  | 'NOT_IN_ROOM'
  | 'INTERNAL';

export type AckError = { ok: false; error: { code: ServerErrorCode } };
export type Ack<T extends object = object> = ({ ok: true } & T) | AckError;

export interface JoinRequest {
  roomId: string;
  name: string;
}

export type JoinAck = Ack<{
  self: ParticipantDTO;
  /** Все участники, включая self, по joinedAt. */
  participants: ParticipantDTO[];
}>;

export interface ClientToServerEvents {
  'room:join': (req: JoinRequest, ack: (res: JoinAck) => void) => void;
  'room:leave': (ack: (res: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'participant:joined': (e: { participant: ParticipantDTO }) => void;
  'participant:left': (e: { participantId: string }) => void;
}

/** Межсерверных событий нет: один процесс Node. */
export type InterServerEvents = Record<string, never>;

export interface SocketData {
  roomId?: string;
  participantId?: string;
}
