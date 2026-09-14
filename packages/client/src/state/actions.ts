import type { ParticipantDTO } from '@vcr/shared';

/** Причины неудачного входа, которые показываются пользователю. */
export type JoinFailure = 'ROOM_FULL' | 'SERVER_UNAVAILABLE' | 'INVALID_NAME' | 'INTERNAL';

export type AppAction =
  | { type: 'JOIN_REQUESTED'; roomId: string; name: string }
  | { type: 'JOIN_SUCCEEDED'; self: ParticipantDTO; participants: ParticipantDTO[] }
  | { type: 'JOIN_FAILED'; reason: JoinFailure }
  | { type: 'PARTICIPANT_JOINED'; participant: ParticipantDTO }
  | { type: 'PARTICIPANT_LEFT'; participantId: string }
  | { type: 'CONNECTION_LOST' }
  | { type: 'LEFT_ROOM' };
