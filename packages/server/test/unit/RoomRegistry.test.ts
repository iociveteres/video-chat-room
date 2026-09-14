import { MAX_PARTICIPANTS } from '@vcr/shared';
import { describe, expect, it } from 'vitest';
import { TokenBucket } from '../../src/chat/TokenBucket';
import { RoomRegistry } from '../../src/rooms/RoomRegistry';

function createRegistry(opts: { maxParticipants?: number } = {}) {
  let clock = 1_000;
  const registry = new RoomRegistry({ ...opts, now: () => clock++ });
  let seq = 0;
  const join = (roomId: string, name = `user-${seq}`) => {
    seq += 1;
    const chatBucket = new TokenBucket({ capacity: 5, refillPerSecond: 1 });
    return registry.join(roomId, { id: `p${seq}`, socketId: `s${seq}`, name, chatBucket });
  };
  return { registry, join };
}

function joinOk(result: ReturnType<RoomRegistry['join']>) {
  if (!result.ok) throw new Error(`expected join to succeed, got ${result.reason}`);
  return result;
}

describe('RoomRegistry', () => {
  it('creates the room on the first join', () => {
    const { registry, join } = createRegistry();
    expect(registry.getRoom('r1')).toBeUndefined();

    const { room, participant } = joinOk(join('r1', 'Алекс'));

    expect(registry.roomCount).toBe(1);
    expect(registry.getRoom('r1')).toBe(room);
    expect(room).toMatchObject({ id: 'r1', createdAt: 1_000, messages: [] });
    const { chatBucket, ...fields } = participant;
    expect(fields).toEqual({ id: 'p1', socketId: 's1', name: 'Алекс', joinedAt: 1_001 });
    expect(chatBucket).toBeInstanceOf(TokenBucket);
    expect(registry.getParticipant('r1', 'p1')).toBe(participant);
  });

  it('defaults the limit to MAX_PARTICIPANTS and rejects the next join with ROOM_FULL', () => {
    const { registry, join } = createRegistry();
    for (let i = 0; i < MAX_PARTICIPANTS; i++) joinOk(join('r1'));

    expect(join('r1')).toEqual({ ok: false, reason: 'ROOM_FULL' });
    expect(registry.getRoom('r1')?.participants.size).toBe(MAX_PARTICIPANTS);
  });

  it('honours an injected maxParticipants', () => {
    const { join } = createRegistry({ maxParticipants: 2 });
    joinOk(join('r1'));
    joinOk(join('r1'));
    expect(join('r1')).toEqual({ ok: false, reason: 'ROOM_FULL' });
  });

  it('frees a slot when a participant leaves a full room', () => {
    const { registry, join } = createRegistry();
    for (let i = 0; i < MAX_PARTICIPANTS; i++) joinOk(join('r1'));

    registry.leave('r1', 'p2');

    joinOk(join('r1'));
  });

  it('keeps the room while participants remain', () => {
    const { registry, join } = createRegistry();
    const { participant } = joinOk(join('r1'));
    joinOk(join('r1'));

    expect(registry.leave('r1', 'p1')).toEqual({ participant, roomDeleted: false });
    expect(registry.getRoom('r1')?.participants.size).toBe(1);
    expect(registry.getParticipant('r1', 'p1')).toBeUndefined();
  });

  it('deletes the room when the last participant leaves', () => {
    const { registry, join } = createRegistry();
    joinOk(join('r1'));

    expect(registry.leave('r1', 'p1')).toMatchObject({ roomDeleted: true });
    expect(registry.getRoom('r1')).toBeUndefined();
    expect(registry.roomCount).toBe(0);
    expect(registry.listParticipants('r1')).toEqual([]);
  });

  it('is idempotent: a repeated leave returns null', () => {
    const { registry, join } = createRegistry();
    joinOk(join('r1'));
    joinOk(join('r1'));

    expect(registry.leave('r1', 'p1')).not.toBeNull();
    expect(registry.leave('r1', 'p1')).toBeNull();
    expect(registry.leave('r1', 'unknown')).toBeNull();
    expect(registry.leave('no-such-room', 'p2')).toBeNull();
    expect(registry.getRoom('r1')?.participants.size).toBe(1);
  });

  it('creates a new Room object when joining after the room was deleted', () => {
    const { registry, join } = createRegistry();
    const first = joinOk(join('r1')).room;
    registry.leave('r1', 'p1');

    const second = joinOk(join('r1')).room;

    expect(second).not.toBe(first);
    expect(second.createdAt).toBeGreaterThan(first.createdAt);
    expect(registry.listParticipants('r1')).toHaveLength(1);
  });

  it('allows duplicate names as distinct participants', () => {
    const { registry, join } = createRegistry();
    joinOk(join('r1', 'Алекс'));
    joinOk(join('r1', 'Алекс'));

    const participants = registry.listParticipants('r1');
    expect(participants.map((p) => p.name)).toEqual(['Алекс', 'Алекс']);
    expect(new Set(participants.map((p) => p.id)).size).toBe(2);
  });

  it('lists participants in join order as DTOs without socketId', () => {
    const { registry, join } = createRegistry();
    joinOk(join('r1', 'A'));
    joinOk(join('r1', 'B'));
    joinOk(join('r1', 'C'));
    registry.leave('r1', 'p2');
    joinOk(join('r1', 'D'));

    expect(registry.listParticipants('r1')).toEqual([
      { id: 'p1', name: 'A', joinedAt: 1_001 },
      { id: 'p3', name: 'C', joinedAt: 1_003 },
      { id: 'p4', name: 'D', joinedAt: 1_004 },
    ]);
  });

  it('isolates rooms from each other', () => {
    const { registry, join } = createRegistry();
    for (let i = 0; i < MAX_PARTICIPANTS; i++) joinOk(join('x'));

    joinOk(join('y'));

    expect(registry.roomCount).toBe(2);
    expect(registry.listParticipants('y')).toHaveLength(1);
  });
});
