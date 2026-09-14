import type { ChatMessage, MediaState, ParticipantDTO } from '@vcr/shared';
import type { DeviceStatus, TrackKind } from '../media/MediaController';

/** Причины неудачного входа, которые показываются пользователю. */
export type JoinFailure = 'ROOM_FULL' | 'SERVER_UNAVAILABLE' | 'INVALID_NAME' | 'INTERNAL';

/**
 * Причины неудачной отправки сообщения. TIMEOUT — клиентский: ack не пришёл за ACK_TIMEOUT_MS.
 * INTERNAL — любой другой отказ сервера (ошибка обработчика или баг клиента).
 */
export type ChatSendFailure =
  'INVALID_MESSAGE' | 'RATE_LIMITED' | 'NOT_IN_ROOM' | 'TIMEOUT' | 'INTERNAL';

export type AppAction =
  | { type: 'JOIN_REQUESTED'; roomId: string; name: string }
  /** Медиа захвачено (или пропущено), идёт подключение к серверу. */
  | { type: 'JOIN_CONNECTING' }
  | {
      type: 'JOIN_SUCCEEDED';
      self: ParticipantDTO;
      participants: ParticipantDTO[];
      /** История чата из ack, от старых к новым. */
      messages: ChatMessage[];
    }
  | { type: 'JOIN_FAILED'; reason: JoinFailure }
  | { type: 'PARTICIPANT_JOINED'; participant: ParticipantDTO }
  | { type: 'PARTICIPANT_LEFT'; participantId: string }
  | { type: 'CONNECTION_LOST' }
  | { type: 'LEFT_ROOM' }
  | { type: 'CHAT_MESSAGE_RECEIVED'; message: ChatMessage }
  | { type: 'CHAT_SEND_FAILED'; code: ChatSendFailure }
  /** Тост из side effects (медиа): текст уже готов, фаза не важна. */
  | { type: 'NOTICE_SHOWN'; text: string; tone: 'info' | 'error' }
  | { type: 'NOTICE_DISMISSED' }
  // этап 3
  | { type: 'LOCAL_MEDIA_STATUS_CHANGED'; kind: TrackKind; status: DeviceStatus }
  /** Сменился объект видеотрека в previewStream — self-view перепривязывает srcObject. */
  | { type: 'LOCAL_VIDEO_TRACK_CHANGED' }
  | { type: 'PARTICIPANT_MEDIA_CHANGED'; participantId: string; media: MediaState };
