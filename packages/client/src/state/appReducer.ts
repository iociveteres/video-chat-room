import type { ParticipantDTO } from '@vcr/shared';
import type { AppAction, JoinFailure } from './actions';

export type SessionPhase =
  | { kind: 'idle' }
  | { kind: 'joining' }
  | { kind: 'joined' }
  | { kind: 'failed'; reason: JoinFailure }
  | { kind: 'connection-lost' };

/**
 * Сериализуемое состояние приложения. Сокеты и прочие side effects сюда не попадают —
 * ими владеет RoomSession (TDD §3.1, принцип 3).
 */
export interface AppState {
  /** Только в памяти вкладки: переживает выход и ошибки, но не перезагрузку. */
  displayName: string | null;
  roomId: string | null;
  phase: SessionPhase;
  selfId: string | null;
  /** Порядок = joinedAt. */
  participantIds: string[];
  participantsById: Record<string, ParticipantDTO>;
}

export const initialAppState: AppState = {
  displayName: null,
  roomId: null,
  phase: { kind: 'idle' },
  selfId: null,
  participantIds: [],
  participantsById: {},
};

const noParticipants = {
  selfId: null,
  participantIds: [],
  participantsById: {},
} satisfies Partial<AppState>;

/**
 * Чистый reducer сессии. Действие, недопустимое в текущей фазе (например, запоздавший ack
 * после выхода), возвращает тот же объект state.
 *
 *   idle / failed / connection-lost ──JOIN_REQUESTED──▶ joining
 *   joining ──JOIN_SUCCEEDED──▶ joined        joining ──JOIN_FAILED──▶ failed
 *   joined ──CONNECTION_LOST──▶ connection-lost
 *   любая фаза ──LEFT_ROOM──▶ idle
 */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'JOIN_REQUESTED': {
      if (state.phase.kind === 'joining' || state.phase.kind === 'joined') return state;
      return {
        ...state,
        ...noParticipants,
        displayName: action.name,
        roomId: action.roomId,
        phase: { kind: 'joining' },
      };
    }

    case 'JOIN_SUCCEEDED': {
      if (state.phase.kind !== 'joining') return state;
      const participantsById: Record<string, ParticipantDTO> = {};
      const participantIds: string[] = [];
      for (const participant of [...action.participants, action.self]) {
        if (!(participant.id in participantsById)) participantIds.push(participant.id);
        participantsById[participant.id] = participant;
      }
      return {
        ...state,
        phase: { kind: 'joined' },
        selfId: action.self.id,
        participantIds,
        participantsById,
      };
    }

    case 'JOIN_FAILED': {
      if (state.phase.kind !== 'joining') return state;
      // roomId и displayName сохраняются: «Повторить вход» не спрашивает их заново.
      return { ...state, ...noParticipants, phase: { kind: 'failed', reason: action.reason } };
    }

    case 'PARTICIPANT_JOINED': {
      if (state.phase.kind !== 'joined') return state;
      const { participant } = action;
      const known = participant.id in state.participantsById;
      return {
        ...state,
        participantIds: known ? state.participantIds : [...state.participantIds, participant.id],
        participantsById: { ...state.participantsById, [participant.id]: participant },
      };
    }

    case 'PARTICIPANT_LEFT': {
      if (state.phase.kind !== 'joined') return state;
      const { participantId } = action;
      if (!(participantId in state.participantsById)) return state;
      const { [participantId]: _removed, ...participantsById } = state.participantsById;
      return {
        ...state,
        participantIds: state.participantIds.filter((id) => id !== participantId),
        participantsById,
      };
    }

    case 'CONNECTION_LOST': {
      if (state.phase.kind !== 'joined') return state;
      return { ...state, ...noParticipants, phase: { kind: 'connection-lost' } };
    }

    case 'LEFT_ROOM': {
      if (state.phase.kind === 'idle' && state.roomId === null) return state;
      return { ...state, ...noParticipants, roomId: null, phase: { kind: 'idle' } };
    }
  }
}
