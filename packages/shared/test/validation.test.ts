import { describe, expect, it } from 'vitest';
import { MESSAGE_MAX_LENGTH, NAME_MAX_LENGTH } from '../src/constants';
import {
  isValidRoomId,
  normalizeMessage,
  normalizeName,
  validateMessage,
  validateName,
} from '../src/validation';

describe('normalizeName', () => {
  it('trims and collapses any whitespace runs into a single space', () => {
    expect(normalizeName('  Алекс \t\n  Иванов\u00A0 ')).toBe('Алекс Иванов');
  });

  it('converts NFD to NFC', () => {
    const decomposed = 'и\u0306';
    expect(normalizeName(decomposed)).toBe('й');
    expect(normalizeName(decomposed)).toHaveLength(1);
  });
});

describe('validateName', () => {
  it.each(['', '   ', '\t\n'])('rejects empty or whitespace-only %j', (raw) => {
    expect(validateName(raw)).toEqual({ ok: false, reason: 'EMPTY' });
  });

  it('accepts exactly NAME_MAX_LENGTH code points', () => {
    expect(validateName('a'.repeat(NAME_MAX_LENGTH))).toEqual({
      ok: true,
      value: 'a'.repeat(NAME_MAX_LENGTH),
    });
  });

  it('rejects NAME_MAX_LENGTH + 1 code points', () => {
    expect(validateName('a'.repeat(NAME_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: 'TOO_LONG',
    });
  });

  it('counts code points, not UTF-16 code units', () => {
    // U+1D49C MATHEMATICAL SCRIPT CAPITAL A — буква вне BMP, 2 code units.
    const astral = '\u{1D49C}'.repeat(NAME_MAX_LENGTH);
    expect(astral.length).toBe(NAME_MAX_LENGTH * 2);
    expect(validateName(astral).ok).toBe(true);
  });

  it('measures length after whitespace is collapsed', () => {
    const name = `${'a'.repeat(15)}          ${'b'.repeat(14)}`;
    expect(validateName(name)).toEqual({ ok: true, value: `${'a'.repeat(15)} ${'b'.repeat(14)}` });
  });

  it.each(['Алекс', 'Жанна-Мария', 'john.doe_42', 'Zoë', '李小龙', '42'])('accepts %j', (raw) => {
    expect(validateName(raw)).toEqual({ ok: true, value: raw });
  });

  it('returns the normalized value for NFD input', () => {
    expect(validateName('Андреи\u0306')).toEqual({ ok: true, value: 'Андрей' });
  });

  it.each(['Alex😀', '😀', '<b>', '<img src=x onerror=alert(1)>', 'a&b', "O'Brien", 'a\u200Bb'])(
    'rejects forbidden characters in %j',
    (raw) => {
      expect(validateName(raw)).toEqual({ ok: false, reason: 'FORBIDDEN_CHARS' });
    },
  );

  it.each(['...', '_-_', ' - ', '\u0301'])('rejects names without a letter or digit: %j', (raw) => {
    expect(validateName(raw)).toEqual({ ok: false, reason: 'FORBIDDEN_CHARS' });
  });
});

describe('isValidRoomId', () => {
  it.each(['q7Z3kP0aX_2m', 'a', 'room-1', 'x'.repeat(64)])('accepts %j', (id) => {
    expect(isValidRoomId(id)).toBe(true);
  });

  it.each(['', 'x'.repeat(65), '../x', 'a b', '<script>', 'комната', 'a/b', 'a.b'])(
    'rejects %j',
    (id) => {
      expect(isValidRoomId(id)).toBe(false);
    },
  );
});

describe('normalizeMessage', () => {
  it('converts CRLF and lone CR to LF', () => {
    expect(normalizeMessage('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('keeps inner line breaks and tabs, trims the edges', () => {
    expect(normalizeMessage('  \n строка 1\n\tстрока 2 \t\n')).toBe('строка 1\n\tстрока 2');
  });

  it('removes C0, DEL and C1 control characters', () => {
    expect(normalizeMessage('a\u0000b\u0007c\u001Bd\u007Fe\u0085f\u009Fg')).toBe('abcdefg');
  });

  it.each([
    ['\u202Eabc', 'abc'],
    ['a\u202Ab\u202Bc\u202Cd\u202De', 'abcde'],
    ['\u2066a\u2067b\u2068c\u2069', 'abc'],
  ])('removes bidi controls from %j', (raw, expected) => {
    expect(normalizeMessage(raw)).toBe(expected);
  });

  it('converts NFD to NFC', () => {
    expect(normalizeMessage('и\u0306')).toBe('й');
  });

  it('does not escape HTML', () => {
    expect(normalizeMessage('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('validateMessage', () => {
  it.each(['', '   ', '\n\t', '\r\n', '\u202E', '\u0000\u202E \u2066'])(
    'rejects empty %j',
    (raw) => {
      expect(validateMessage(raw)).toEqual({ ok: false, reason: 'EMPTY' });
    },
  );

  it('returns the normalized value', () => {
    expect(validateMessage(' Привет\r\nмир ')).toEqual({ ok: true, value: 'Привет\nмир' });
  });

  it('accepts exactly MESSAGE_MAX_LENGTH code points', () => {
    const text = 'a'.repeat(MESSAGE_MAX_LENGTH);
    expect(validateMessage(text)).toEqual({ ok: true, value: text });
  });

  it('rejects MESSAGE_MAX_LENGTH + 1 code points', () => {
    expect(validateMessage('a'.repeat(MESSAGE_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: 'TOO_LONG',
    });
  });

  it('counts emoji as one code point each at the boundary', () => {
    const emoji = '😀'.repeat(MESSAGE_MAX_LENGTH);
    expect(emoji.length).toBe(MESSAGE_MAX_LENGTH * 2);
    expect(validateMessage(emoji).ok).toBe(true);
    expect(validateMessage(`${emoji}😀`)).toEqual({ ok: false, reason: 'TOO_LONG' });
  });

  it('measures length after trimming', () => {
    const text = 'a'.repeat(MESSAGE_MAX_LENGTH);
    expect(validateMessage(`  ${text}\n\n`)).toEqual({ ok: true, value: text });
  });
});
