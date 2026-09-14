import type { MediaState, ParticipantDTO } from '@vcr/shared';
import type { AppState } from './appReducer';

/** Участники в порядке входа. Возвращает новый массив — мемоизируйте в компонентах. */
export function selectParticipants(state: AppState): ParticipantDTO[] {
  return state.participantIds.flatMap((id) => {
    const participant = state.participantsById[id];
    return participant ? [participant] : [];
  });
}

export function selectSelf(state: AppState): ParticipantDTO | null {
  return state.selfId === null ? null : (state.participantsById[state.selfId] ?? null);
}

export function selectIsSelf(state: AppState, participantId: string): boolean {
  return state.selfId === participantId;
}

/**
 * Включены ли mic/cam участника. Для себя — по localMedia (без задержки сети),
 * для остальных — по серверному состоянию. null — участник неизвестен.
 */
export function selectParticipantMedia(state: AppState, participantId: string): MediaState | null {
  if (participantId === state.selfId) {
    return { audio: state.localMedia.audio === 'on', video: state.localMedia.video === 'on' };
  }
  return state.participantsById[participantId]?.media ?? null;
}
