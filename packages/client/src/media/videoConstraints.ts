import { VIDEO_CONSTRAINTS, type MediaConstraintsSpec } from '@vcr/shared';

type RangeKey = 'width' | 'height' | 'frameRate';
const RANGE_KEYS: readonly RangeKey[] = ['width', 'height', 'frameRate'];

function isRange(value: unknown): value is { ideal?: number; max?: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([key, n]) =>
        (key === 'ideal' || key === 'max') && typeof n === 'number' && Number.isFinite(n) && n > 0,
    )
  );
}

function defaultConstraints(): MediaConstraintsSpec {
  // Копия: объект уходит в getUserMedia и не должен делить вложенные объекты с константой.
  return structuredClone(VIDEO_CONSTRAINTS);
}

/**
 * Ограничения захвата камеры из VITE_VIDEO_CONSTRAINTS (JSON с width/height/frameRate
 * { ideal, max }). E2E-проект mesh собирает клиент с пониженным разрешением: 4–5 вкладок
 * с fake-камерой на одной машине (TDD этапа 5 §11.4). Не задана или невалидна — 640×360@24.
 */
export function getVideoConstraints(
  env: Pick<ImportMetaEnv, 'VITE_VIDEO_CONSTRAINTS'> = import.meta.env,
): MediaConstraintsSpec {
  const raw = env.VITE_VIDEO_CONSTRAINTS;
  if (raw === undefined || raw.trim() === '') return defaultConstraints();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    console.warn('VITE_VIDEO_CONSTRAINTS is not valid JSON, using the default constraints');
    return defaultConstraints();
  }
  const valid =
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.entries(value).every(
      ([key, range]) => RANGE_KEYS.includes(key as RangeKey) && isRange(range),
    );
  if (!valid) {
    console.warn('VITE_VIDEO_CONSTRAINTS has an unexpected shape, using the default constraints');
    return defaultConstraints();
  }
  return value as MediaConstraintsSpec;
}
