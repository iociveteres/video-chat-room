// Сокет-контракт. Этап 1 — комната, этап 2 — чат, этап 3 — состояние микрофона и камеры,
// этап 4 — сигналинг WebRTC; следующие этапы только добавляют события и поля.

/** Публичное состояние: «передаётся ли». Причину (denied / not-found / …) знает только владелец. */
export interface MediaState {
  audio: boolean;
  video: boolean;
}

export interface ParticipantDTO {
  /** UUID, генерирует сервер; в UI не показывается. */
  id: string;
  /** Нормализованное имя. */
  name: string;
  /** Epoch ms по серверным часам; задаёт порядок. */
  joinedAt: number;
  /** Этап 3: включены ли микрофон и камера. */
  media: MediaState;
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
  /** Этап 3: начальное состояние после захвата медиа; обязательно. */
  media: MediaState;
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

/** Этап 4: сериализованный RTCIceCandidateInit; структура совместима с DOM-типом. */
export interface IceCandidateDTO {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
}

/** Этап 4: одна пара offer/answer на соединение, дальше только кандидаты (TDD §3.2, I1). */
export type SignalData =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'candidate'; candidate: IceCandidateDTO };

export interface ClientToServerEvents {
  'room:join': (req: JoinRequest, ack: (res: JoinAck) => void) => void;
  'room:leave': (ack: (res: Ack) => void) => void;
  'chat:send': (req: ChatSendRequest, ack: (res: ChatSendAck) => void) => void;
  /** Этап 3: fire-and-forget, последнее значение побеждает. */
  'media:update': (state: MediaState) => void;
  /** Этап 4: fire-and-forget relay адресату в той же комнате. */
  signal: (msg: { to: string; data: SignalData }) => void;
}

export interface ServerToClientEvents {
  'participant:joined': (e: { participant: ParticipantDTO }) => void;
  'participant:left': (e: { participantId: string }) => void;
  /** Всем в комнате, включая отправителя. */
  'chat:message': (e: { message: ChatMessage }) => void;
  /** Этап 3: всем в комнате, кроме отправителя; participantId сервер берёт из сокета. */
  'participant:media': (e: { participantId: string; media: MediaState }) => void;
  /** Этап 4: только адресату; from сервер берёт из сокета отправителя. */
  signal: (msg: { from: string; data: SignalData }) => void;
}

/** Межсерверных событий нет: один процесс Node. */
export type InterServerEvents = Record<string, never>;

export interface SocketData {
  roomId?: string;
  participantId?: string;
}
