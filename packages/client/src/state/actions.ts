import type { ChatMessage, ParticipantDTO } from '@vcr/shared';

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
  | { type: 'NOTICE_DISMISSED' };
