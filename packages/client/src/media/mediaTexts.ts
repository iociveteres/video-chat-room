import type { DeviceStatus, TrackKind } from './MediaController';

/** Подпись статуса на self-view и в title кнопки (TDD этапа 3 §8.1). */
const STATUS_LABELS: Record<TrackKind, Record<DeviceStatus, string>> = {
  video: {
    acquiring: 'Включаем камеру…',
    on: 'Камера включена',
    off: 'Камера выключена',
    denied: 'Нет доступа к камере',
    'not-found': 'Камера не найдена',
    busy: 'Камера занята другим приложением',
    lost: 'Камера отключена',
    failed: 'Не удалось включить камеру',
  },
  audio: {
    acquiring: 'Включаем микрофон…',
    on: 'Микрофон включён',
    off: 'Микрофон выключен',
    denied: 'Нет доступа к микрофону',
    'not-found': 'Микрофон не найден',
    busy: 'Микрофон занят другим приложением',
    lost: 'Микрофон отключён',
    failed: 'Не удалось включить микрофон',
  },
};

/** Одна фраза, когда оба устройства в одном статусе ошибки. */
const BOTH_LABELS: Record<ProblemStatus, string> = {
  denied: 'Нет доступа к камере и микрофону',
  'not-found': 'Камера и микрофон не найдены',
  busy: 'Камера и микрофон заняты другим приложением',
  lost: 'Камера и микрофон отключены',
  failed: 'Не удалось включить камеру и микрофон',
};

const WITHOUT: Record<TrackKind, string> = { video: 'без видео', audio: 'без звука' };

type ProblemStatus = Exclude<DeviceStatus, 'acquiring' | 'on' | 'off'>;

export interface MediaNotice {
  text: string;
  tone: 'info' | 'error';
}

const LOST_NOTICES: Record<TrackKind, string> = {
  video: 'Камера отключена или стала недоступна. Проверьте устройство и включите камеру снова.',
  audio: 'Микрофон отключён или стал недоступен. Проверьте устройство и включите микрофон снова.',
};

/** Тост при потере устройства во время звонка (TDD этапа 3 §4.3, FR-20). */
export function lostNotice(kind: TrackKind): string {
  return LOST_NOTICES[kind];
}

export function deviceStatusLabel(kind: TrackKind, status: DeviceStatus): string {
  return STATUS_LABELS[kind][status];
}

function isProblem(status: DeviceStatus): status is ProblemStatus {
  return status !== 'acquiring' && status !== 'on' && status !== 'off';
}

/**
 * Сводный тост по итогам захвата при входе. null — всё включилось.
 * Тон info, только если устройств просто нет (not-found): это не ошибка пользователя.
 */
export function acquireNotice(statuses: Record<TrackKind, DeviceStatus>): MediaNotice | null {
  const problems = (['video', 'audio'] as const).filter((kind) => isProblem(statuses[kind]));
  if (problems.length === 0) return null;

  const tone = problems.every((kind) => statuses[kind] === 'not-found') ? 'info' : 'error';
  const [first] = problems;
  if (problems.length === 1 && first) {
    return {
      text: `${deviceStatusLabel(first, statuses[first])} — вы в комнате ${WITHOUT[first]}`,
      tone,
    };
  }

  const { audio, video } = statuses;
  if (audio === video && isProblem(audio)) {
    return { text: `${BOTH_LABELS[audio]} — вы в комнате без видео и звука`, tone };
  }
  return {
    text: `${deviceStatusLabel('audio', audio)}. ${deviceStatusLabel('video', video)}.`,
    tone,
  };
}
