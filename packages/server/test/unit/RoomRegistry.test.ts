import { MAX_PARTICIPANTS } from '@vcr/shared';
import { describe, expect, it } from 'vitest';
import { TokenBucket } from '../../src/chat/TokenBucket';
import { RoomRegistry } from '../../src/rooms/RoomRegistry';

function createRegistry(opts: { maxParticipants?: number; now?: () => number } = {}) {
  let clock = 1_000;
  const registry = new RoomRegistry({ now: () => clock++, ...opts });
  let seq = 0;
  const join = (roomId: string, name = `user-${seq}`, media = { audio: true, video: true }) => {
    seq += 1;
    const chatBucket = new TokenBucket({ capacity: 5, refillPerSecond: 1 });
    const signalBucket = new TokenBucket({ capacity: 100, refillPerSecond: 50 });
    return registry.join(roomId, {
      id: `p${seq}`,
      socketId: `s${seq}`,
      name,
      chatBucket,
      signalBucket,
      media,
    });
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
    const { chatBucket, signalBucket, ...fields } = participant;
    expect(fields).toEqual({
      id: 'p1',
      socketId: 's1',
      name: 'Алекс',
      joinedAt: 1_001,
      joinSeq: 0,
      media: { audio: true, video: true },
    });
    expect(chatBucket).toBeInstanceOf(TokenBucket);
    expect(signalBucket).toBeInstanceOf(TokenBucket);
    expect(signalBucket).not.toBe(chatBucket);
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

  describe('joinSeq', () => {
    it('is strictly increasing across rooms, leaves and a rejected ROOM_FULL join', () => {
      const { registry, join } = createRegistry({ maxParticipants: 2 });
      const seqs = [
        joinOk(join('r1')).participant.joinSeq,
        joinOk(join('r2')).participant.joinSeq,
        joinOk(join('r1')).participant.joinSeq,
      ];
      expect(join('r1')).toEqual({ ok: false, reason: 'ROOM_FULL' });
      registry.leave('r1', 'p1');
      registry.leave('r2', 'p2');
      seqs.push(joinOk(join('r2')).participant.joinSeq);

      expect(seqs).toEqual([0, 1, 2, 3]);
    });

    it('orders joins that land on the same millisecond', () => {
      const { join } = createRegistry({ now: () => 5_000 });
      const first = joinOk(join('r1')).participant;
      const second = joinOk(join('r1')).participant;

      expect(second.joinedAt).toBe(first.joinedAt);
      expect(second.joinSeq).toBeGreaterThan(first.joinSeq);
    });
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
    joinOk(join('r1', 'C', { audio: false, video: true }));
    registry.leave('r1', 'p2');
    joinOk(join('r1', 'D', { audio: true, video: false }));

    expect(registry.listParticipants('r1')).toEqual([
      { id: 'p1', name: 'A', joinedAt: 1_001, media: { audio: true, video: true } },
      { id: 'p3', name: 'C', joinedAt: 1_003, media: { audio: false, video: true } },
      { id: 'p4', name: 'D', joinedAt: 1_004, media: { audio: true, video: false } },
    ]);
  });

  it('isolates rooms from each other', () => {
    const { registry, join } = createRegistry();
    for (let i = 0; i < MAX_PARTICIPANTS; i++) joinOk(join('x'));

    joinOk(join('y'));

    expect(registry.roomCount).toBe(2);
    expect(registry.listParticipants('y')).toHaveLength(1);
  });

  describe('updateMedia', () => {
    it('stores a changed state and exposes it in the DTO', () => {
      const { registry, join } = createRegistry();
      joinOk(join('r1', 'A'));

      expect(registry.updateMedia('r1', 'p1', { audio: false, video: true })).toBe(true);

      expect(registry.getParticipant('r1', 'p1')?.media).toEqual({ audio: false, video: true });
      expect(registry.listParticipants('r1')[0]?.media).toEqual({ audio: false, video: true });
    });

    it('returns false and changes nothing for the same value', () => {
      const { registry, join } = createRegistry();
      joinOk(join('r1', 'A', { audio: true, video: false }));

      expect(registry.updateMedia('r1', 'p1', { audio: true, video: false })).toBe(false);
      expect(registry.getParticipant('r1', 'p1')?.media).toEqual({ audio: true, video: false });
    });

    it('returns false for an unknown participant or room', () => {
      const { registry, join } = createRegistry();
      joinOk(join('r1'));

      expect(registry.updateMedia('r1', 'unknown', { audio: false, video: false })).toBe(false);
      expect(registry.updateMedia('no-such-room', 'p1', { audio: false, video: false })).toBe(
        false,
      );
      expect(registry.updateMedia('r1', 'p1', { audio: true, video: true })).toBe(false);
    });

    it('does not share the media object with the caller or with issued DTOs', () => {
      const { registry, join } = createRegistry();
      const input = { audio: true, video: true };
      joinOk(join('r1', 'A', input));
      const dto = registry.listParticipants('r1')[0]!;

      input.audio = false;
      dto.media.video = false;
      expect(registry.getParticipant('r1', 'p1')?.media).toEqual({ audio: true, video: true });

      const before = registry.listParticipants('r1')[0]!;
      registry.updateMedia('r1', 'p1', { audio: false, video: false });
      expect(before.media).toEqual({ audio: true, video: true });
    });
  });
});
