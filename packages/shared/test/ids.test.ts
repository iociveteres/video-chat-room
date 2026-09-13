import { describe, expect, it } from 'vitest';
import { GENERATED_ROOM_ID_LENGTH } from '../src/constants';
import { generateRoomId } from '../src/ids';
import { isValidRoomId } from '../src/validation';

describe('generateRoomId', () => {
  it('generates ids of GENERATED_ROOM_ID_LENGTH from the [A-Za-z0-9_-] alphabet', () => {
    const id = generateRoomId();
    expect(id).toHaveLength(GENERATED_ROOM_ID_LENGTH);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(isValidRoomId(id)).toBe(true);
  });

  it('produces no collisions in 10 000 generations', () => {
    const ids = new Set(Array.from({ length: 10_000 }, generateRoomId));
    expect(ids.size).toBe(10_000);
  });

  it('uses the whole alphabet', () => {
    const seen = new Set(Array.from({ length: 2_000 }, generateRoomId).join(''));
    expect(seen.size).toBe(64);
  });
});
