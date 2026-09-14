import { CHAT_HISTORY_LIMIT, type ChatMessage, type ParticipantDTO } from '@vcr/shared';
import type { PeerStatus } from '../call/PeerSession';
import type { DeviceStatus } from '../media/MediaController';
import type { AppAction, ChatSendFailure, JoinFailure } from './actions';

export type SessionPhase =
  | { kind: 'idle' }
  | { kind: 'joining' }
  | { kind: 'joined' }
  | { kind: 'failed'; reason: JoinFailure }
  | { kind: 'connection-lost' };

export interface ChatState {
  /** От старых к новым, ≤ CHAT_HISTORY_LIMIT. */
  messages: ChatMessage[];
  /** id сообщений из messages — для дедупликации (Record, а не Set: state сериализуем). */
  messageIds: Record<string, true>;
}

/**
 * Зеркало статусов MediaController (этап 3). Источник правды для собственного mic/cam в UI:
 * participantsById[selfId].media обновляется только сервером и отстаёт на сеть.
 */
export interface LocalMediaState {
  audio: DeviceStatus;
  video: DeviceStatus;
  /** ++ при каждой смене видеотрека → перепривязка srcObject. */
  videoTrackVersion: number;
}

/** Подэтап фазы joining: захват медиа до room:join, затем подключение. */
export type JoinStep = 'acquiring-media' | 'connecting';

/** Общий слот тостов: чат (этап 2), медиа и звонок (этапы 3–4). */
export interface Notice {
  /** Растёт с каждым новым тостом: повтор того же текста — новый тост. */
  id: number;
  text: string;
  tone: 'info' | 'error';
}

/** Этап 4: состояние пары с удалённым участником. RTCPeerConnection и потоки — в PeerManager. */
export interface PeerState {
  status: PeerStatus;
}

/**
 * Сериализуемое состояние приложения. Сокеты и прочие side effects сюда не попадают —
 * ими владеет RoomSession (TDD §3.1, принцип 3).
 */
export interface AppState {
  /** Только в памяти вкладки: переживает выход и ошибки, но не перезагрузку. */
  displayName: string | null;
  roomId: string | null;
  phase: SessionPhase;
  /** Не null только в фазе joining. */
  joinStep: JoinStep | null;
  selfId: string | null;
  /** Порядок = joinedAt. */
  participantIds: string[];
  participantsById: Record<string, ParticipantDTO>;
  chat: ChatState;
  notice: Notice | null;
  /** Не сбрасывается при выходе: controller сам сообщает off после stopAll(). */
  localMedia: LocalMediaState;
  /** Этап 4: по id удалённых участников; self здесь не бывает. */
  peers: Record<string, PeerState>;
  /** Этап 4: браузер заблокировал воспроизведение звука до жеста пользователя (FR-37). */
  autoplayBlocked: boolean;
}

const emptyChat: ChatState = { messages: [], messageIds: {} };

export const initialAppState: AppState = {
  displayName: null,
  roomId: null,
  phase: { kind: 'idle' },
  joinStep: null,
  selfId: null,
  participantIds: [],
  participantsById: {},
  chat: emptyChat,
  notice: null,
  localMedia: { audio: 'off', video: 'off', videoTrackVersion: 0 },
  peers: {},
  autoplayBlocked: false,
};

/** Всё, что относится к конкретному пребыванию в комнате. */
const noRoomData = {
  joinStep: null,
  selfId: null,
  participantIds: [],
  participantsById: {},
  chat: emptyChat,
  peers: {},
  autoplayBlocked: false,
} satisfies Partial<AppState>;

/** Тексты тостов об ошибке отправки (TDD §6.4). NOT_IN_ROOM молча игнорируется. */
export const CHAT_SEND_FAILURE_TEXT: Record<Exclude<ChatSendFailure, 'NOT_IN_ROOM'>, string> = {
  INVALID_MESSAGE: 'Сообщение пустое или слишком длинное',
  RATE_LIMITED: 'Слишком часто. Подождите секунду',
  TIMEOUT: 'Не удалось отправить сообщение',
  INTERNAL: 'Не удалось отправить сообщение',
};

/** Дедупликация по id и обрезка до последних CHAT_HISTORY_LIMIT сообщений. */
function buildChat(messages: readonly ChatMessage[]): ChatState {
  const unique: ChatMessage[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    unique.push(message);
  }
  const kept = unique.slice(-CHAT_HISTORY_LIMIT);
  return {
    messages: kept,
    messageIds: Object.fromEntries(kept.map((m) => [m.id, true] as const)),
  };
}

/**
 * Чистый reducer сессии. Действие, недопустимое в текущей фазе (например, запоздавший ack
 * после выхода), возвращает тот же объект state.
 *
 *   idle / failed / connection-lost ──JOIN_REQUESTED──▶ joining (acquiring-media)
 *   joining (acquiring-media) ──JOIN_CONNECTING──▶ joining (connecting)
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
        ...noRoomData,
        displayName: action.name,
        roomId: action.roomId,
        phase: { kind: 'joining' },
        joinStep: 'acquiring-media',
      };
    }

    case 'JOIN_CONNECTING': {
      if (state.phase.kind !== 'joining' || state.joinStep === 'connecting') return state;
      return { ...state, joinStep: 'connecting' };
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
        joinStep: null,
        selfId: action.self.id,
        participantIds,
        participantsById,
        chat: buildChat(action.messages),
      };
    }

    case 'JOIN_FAILED': {
      if (state.phase.kind !== 'joining') return state;
      // roomId и displayName сохраняются: «Повторить вход» не спрашивает их заново.
      return { ...state, ...noRoomData, phase: { kind: 'failed', reason: action.reason } };
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
      const { [participantId]: _peer, ...peers } = state.peers;
      return {
        ...state,
        participantIds: state.participantIds.filter((id) => id !== participantId),
        participantsById,
        peers,
      };
    }

    case 'CONNECTION_LOST': {
      if (state.phase.kind !== 'joined') return state;
      return { ...state, ...noRoomData, phase: { kind: 'connection-lost' } };
    }

    case 'LEFT_ROOM': {
      if (state.phase.kind === 'idle' && state.roomId === null) return state;
      return { ...state, ...noRoomData, roomId: null, phase: { kind: 'idle' } };
    }

    case 'CHAT_MESSAGE_RECEIVED': {
      const { message } = action;
      if (state.phase.kind !== 'joined' || message.id in state.chat.messageIds) return state;
      if (state.chat.messages.length < CHAT_HISTORY_LIMIT) {
        return {
          ...state,
          chat: {
            messages: [...state.chat.messages, message],
            messageIds: { ...state.chat.messageIds, [message.id]: true },
          },
        };
      }
      return { ...state, chat: buildChat([...state.chat.messages, message]) };
    }

    case 'CHAT_SEND_FAILED': {
      if (state.phase.kind !== 'joined' || action.code === 'NOT_IN_ROOM') return state;
      const text = CHAT_SEND_FAILURE_TEXT[action.code];
      return { ...state, notice: { id: (state.notice?.id ?? 0) + 1, text, tone: 'error' } };
    }

    case 'NOTICE_SHOWN': {
      const { text, tone } = action;
      return { ...state, notice: { id: (state.notice?.id ?? 0) + 1, text, tone } };
    }

    case 'NOTICE_DISMISSED': {
      if (state.notice === null) return state;
      return { ...state, notice: null };
    }

    // Статусы приходят в любой фазе: захват идёт во время joining, stopAll() — после выхода.
    case 'LOCAL_MEDIA_STATUS_CHANGED': {
      if (state.localMedia[action.kind] === action.status) return state;
      return { ...state, localMedia: { ...state.localMedia, [action.kind]: action.status } };
    }

    case 'LOCAL_VIDEO_TRACK_CHANGED': {
      const { localMedia } = state;
      return {
        ...state,
        localMedia: { ...localMedia, videoTrackVersion: localMedia.videoTrackVersion + 1 },
      };
    }

    case 'PARTICIPANT_MEDIA_CHANGED': {
      if (state.phase.kind !== 'joined') return state;
      const participant = state.participantsById[action.participantId];
      if (!participant) return state;
      const { audio, video } = action.media;
      if (participant.media.audio === audio && participant.media.video === video) return state;
      return {
        ...state,
        participantsById: {
          ...state.participantsById,
          [participant.id]: { ...participant, media: { audio, video } },
        },
      };
    }

    case 'PEER_STATUS_CHANGED': {
      const { participantId, status } = action;
      // Опоздавший статус ушедшего участника не должен воскрешать запись.
      if (state.phase.kind !== 'joined' || participantId === state.selfId) return state;
      if (!(participantId in state.participantsById)) return state;
      if (state.peers[participantId]?.status === status) return state;
      return { ...state, peers: { ...state.peers, [participantId]: { status } } };
    }

    case 'AUTOPLAY_BLOCKED': {
      if (state.phase.kind !== 'joined' || state.autoplayBlocked) return state;
      return { ...state, autoplayBlocked: true };
    }

    case 'AUTOPLAY_RESUMED': {
      if (!state.autoplayBlocked) return state;
      return { ...state, autoplayBlocked: false };
    }
  }
}
