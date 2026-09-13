import { NAME_MAX_LENGTH, ROOM_ID_PATTERN } from './constants';

const WHITESPACE_RUN = /\s+/gu;
/** Буквы любых алфавитов, диакритика, цифры, пробел, `.`, `_`, `-`. */
const NAME_PATTERN = /^[\p{L}\p{M}\p{N} ._-]+$/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * NFC → схлопывание пробельных символов в один пробел → trim.
 * NFC обязателен: «й», набранная как `и` + U+0306, иначе не совпадёт с ожиданиями по длине и виду.
 */
export function normalizeName(raw: string): string {
  return raw.normalize('NFC').replace(WHITESPACE_RUN, ' ').trim();
}

export type NameValidation =
  { ok: true; value: string } | { ok: false; reason: 'EMPTY' | 'TOO_LONG' | 'FORBIDDEN_CHARS' };

/**
 * Проверяет имя после нормализации. Длина 1..NAME_MAX_LENGTH code points,
 * только разрешённые символы и хотя бы одна буква или цифра.
 * На клиенте — UX-подсказка, на сервере — окончательная проверка.
 */
export function validateName(raw: string): NameValidation {
  const value = normalizeName(raw);
  if (value.length === 0) return { ok: false, reason: 'EMPTY' };
  if ([...value].length > NAME_MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  if (!NAME_PATTERN.test(value) || !LETTER_OR_DIGIT.test(value)) {
    return { ok: false, reason: 'FORBIDDEN_CHARS' };
  }
  return { ok: true, value };
}

export function isValidRoomId(id: string): boolean {
  return ROOM_ID_PATTERN.test(id);
}
