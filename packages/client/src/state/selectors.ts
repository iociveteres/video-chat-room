import type { ParticipantDTO } from '@vcr/shared';
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
