import { describe, expect, it } from 'vitest';
import { formatTime } from '../src/features/chat/formatTime';

// Тесты клиента идут с TZ=Europe/Moscow (UTC+3, без перехода на летнее время).
describe('formatTime', () => {
  it('runs in the Europe/Moscow time zone', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Moscow');
  });

  it('formats epoch ms as local HH:MM with a leading zero', () => {
    expect(formatTime(Date.UTC(2026, 8, 14, 6, 5, 59))).toBe('09:05');
  });

  it.each([
    [Date.UTC(2026, 8, 13, 21, 0), '00:00'],
    [Date.UTC(2026, 8, 14, 9, 30), '12:30'],
    [Date.UTC(2026, 8, 14, 20, 59), '23:59'],
  ])('uses the 24-hour clock: %d → %s', (ts, expected) => {
    expect(formatTime(ts)).toBe(expected);
  });

  it('always matches HH:MM', () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(formatTime(Date.UTC(2026, 0, 1, hour, 7))).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});
