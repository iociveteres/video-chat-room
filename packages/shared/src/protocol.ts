// Сокет-контракт. Этап 1 — комната, этап 2 — чат; следующие этапы только добавляют события и поля.

export interface ParticipantDTO {
  /** UUID, генерирует сервер; в UI не показывается. */
  id: string;
  /** Нормализованное имя. */
  name: string;
  /** Epoch ms по серверным часам; задаёт порядок. */
  joinedAt: number;
}

export type SystemEvent = 'participant-joined' | 'participant-left';

export type ChatMessage =
  | {
      kind: 'user';
      /** UUID, генерирует сервер. */
      id: string;
      /** Epoch ms по серверным часам; клиент форматирует в своей TZ. */
      ts: number;
      authorId: string;
      /** Снимок имени на момент отправки: автор мог уже выйти. */
      authorName: string;
      /** Нормализованный текст, НЕ HTML-экранированный. */
      text: string;
    }
  | {
      kind: 'system';
      id: string;
      ts: number;
      event: SystemEvent;
      participantId: string;
      /** Снимок имени на момент события. */
      participantName: string;
    };

export type ServerErrorCode =
  | 'INVALID_PAYLOAD'
  | 'INVALID_NAME'
  | 'INVALID_ROOM_ID'
  | 'ALREADY_JOINED'
  | 'ROOM_FULL'
  | 'NOT_IN_ROOM'
  | 'INTERNAL'
  // этап 2
  | 'INVALID_MESSAGE'
  | 'RATE_LIMITED';

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
  /** История чата от старых к новым; последним идёт собственное participant-joined. */
  messages: ChatMessage[];
}>;

export interface ChatSendRequest {
  text: string;
}

export type ChatSendAck = Ack<{ messageId: string }>;

export interface ClientToServerEvents {
  'room:join': (req: JoinRequest, ack: (res: JoinAck) => void) => void;
  'room:leave': (ack: (res: Ack) => void) => void;
  'chat:send': (req: ChatSendRequest, ack: (res: ChatSendAck) => void) => void;
}

export interface ServerToClientEvents {
  'participant:joined': (e: { participant: ParticipantDTO }) => void;
  'participant:left': (e: { participantId: string }) => void;
  /** Всем в комнате, включая отправителя. */
  'chat:message': (e: { message: ChatMessage }) => void;
}

/** Межсерверных событий нет: один процесс Node. */
export type InterServerEvents = Record<string, never>;

export interface SocketData {
  roomId?: string;
  participantId?: string;
}
