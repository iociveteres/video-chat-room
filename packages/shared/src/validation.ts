import { MESSAGE_MAX_LENGTH, NAME_MAX_LENGTH, ROOM_ID_PATTERN } from './constants';

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

const LINE_BREAK = /\r\n?/gu;
/** Управляющие символы C0, DEL и C1 (\p{Cc}), кроме перевода строки и табуляции. */
const CONTROL_CHARS = /(?![\n\t])\p{Cc}/gu;
/** Bidi embedding/override (U+202A–U+202E) и isolate (U+2066–U+2069). */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/gu;

/**
 * CRLF/CR → LF → удаление управляющих символов (кроме \n и \t) и bidi-override → NFC → trim.
 * Bidi-символы убираются против спуфинга: `‮txt.exe` иначе отображается перевёрнутым.
 * HTML не экранируется: текст выводится текстовым узлом на клиенте (TDD §4.1).
 */
export function normalizeMessage(raw: string): string {
  return raw
    .replace(LINE_BREAK, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(BIDI_CONTROLS, '')
    .normalize('NFC')
    .trim();
}

export type MessageValidation =
  { ok: true; value: string } | { ok: false; reason: 'EMPTY' | 'TOO_LONG' };

/**
 * Проверяет сообщение после нормализации: 1..MESSAGE_MAX_LENGTH code points.
 * На клиенте — состояние кнопки отправки, на сервере — окончательная проверка.
 */
export function validateMessage(raw: string): MessageValidation {
  const value = normalizeMessage(raw);
  if (value.length === 0) return { ok: false, reason: 'EMPTY' };
  if ([...value].length > MESSAGE_MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  return { ok: true, value };
}

export function isValidRoomId(id: string): boolean {
  return ROOM_ID_PATTERN.test(id);
}
