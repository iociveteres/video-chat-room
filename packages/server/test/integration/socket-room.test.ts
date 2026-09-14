import { MAX_PARTICIPANTS, NAME_MAX_LENGTH, type JoinAck } from '@vcr/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomRegistry } from '../../src/rooms/RoomRegistry';
import {
  connectClient,
  connectClients,
  DEFAULT_MEDIA,
  disconnectAll,
  join,
  joinOk,
  leave,
  rawJoin,
  recordEvents,
  type RawEmitter,
} from '../helpers/socketClient';
import { startTestServer, type TestServer } from '../helpers/startTestServer';

function countResults(results: JoinAck[]) {
  return {
    ok: results.filter((r) => r.ok).length,
    full: results.filter((r) => !r.ok && r.error.code === 'ROOM_FULL').length,
  };
}

describe('room:join / room:leave / disconnect', () => {
  let t: TestServer;

  beforeEach(async () => {
    t = await startTestServer();
  });

  afterEach(async () => {
    disconnectAll();
    await t.close();
  });

  describe('joining', () => {
    it('lets two clients join and notifies the first one', async () => {
      const [a, b] = await connectClients(t.url, 2);
      const aEvents = recordEvents(a!);
      const bEvents = recordEvents(b!);

      const ackA = await joinOk(a!, 'room1', 'Алекс');
      expect(ackA.participants).toEqual([ackA.self]);

      const ackB = await joinOk(b!, 'room1', 'Борис', { audio: true, video: false });
      expect(ackB.self.name).toBe('Борис');
      expect(ackB.self.id).not.toBe(ackA.self.id);
      expect(ackB.participants).toEqual([ackA.self, ackB.self]);

      await vi.waitFor(() => {
        expect(aEvents).toEqual([{ type: 'joined', participant: ackB.self }]);
      });
      // Новичок не получает событие о самом себе.
      expect(bEvents).toEqual([]);
    });

    it('carries media from room:join in the DTOs of the newcomer and the old-timers', async () => {
      const [a, b] = await connectClients(t.url, 2);
      const aEvents = recordEvents(a!);

      const ackA = await joinOk(a!, 'room1', 'Алекс', { audio: false, video: true });
      expect(ackA.self.media).toEqual({ audio: false, video: true });

      const ackB = await joinOk(b!, 'room1', 'Борис', { audio: true, video: false });
      expect(ackB.self.media).toEqual({ audio: true, video: false });
      expect(ackB.participants.map((p) => p.media)).toEqual([
        { audio: false, video: true },
        { audio: true, video: false },
      ]);

      await vi.waitFor(() => {
        expect(aEvents).toEqual([{ type: 'joined', participant: ackB.self }]);
      });
      expect(t.server.registry.getParticipant('room1', ackB.self.id)?.media).toEqual({
        audio: true,
        video: false,
      });
    });

    it('normalizes the name before storing it', async () => {
      const client = await connectClient(t.url);
      const ack = await joinOk(client, 'room1', '  Андрей   Иванов ');
      expect(ack.self.name).toBe('Андрей Иванов');
    });

    it('allows duplicate names as distinct participants', async () => {
      const [a, b] = await connectClients(t.url, 2);
      const ackA = await joinOk(a!, 'room1', 'Алекс');
      const ackB = await joinOk(b!, 'room1', 'Алекс');
      expect(ackB.self.id).not.toBe(ackA.self.id);
    });
  });

  describe('participant limit', () => {
    it('rejects the 5th participant with ROOM_FULL', async () => {
      const clients = await connectClients(t.url, MAX_PARTICIPANTS + 1);
      for (const client of clients.slice(0, MAX_PARTICIPANTS)) await joinOk(client, 'room1');

      const res = await join(clients[MAX_PARTICIPANTS]!, 'room1');

      expect(res).toEqual({ ok: false, error: { code: 'ROOM_FULL' } });
      expect(t.server.registry.getRoom('room1')?.participants.size).toBe(MAX_PARTICIPANTS);
    });

    it('race for the last slot: exactly one of two concurrent joins succeeds', async () => {
      const clients = await connectClients(t.url, MAX_PARTICIPANTS + 1);
      for (const client of clients.slice(0, MAX_PARTICIPANTS - 1)) await joinOk(client, 'room1');

      const results = await Promise.all(
        clients.slice(MAX_PARTICIPANTS - 1).map((c) => join(c, 'room1')),
      );

      expect(countResults(results)).toEqual({ ok: 1, full: 1 });
      expect(t.server.registry.getRoom('room1')?.participants.size).toBe(MAX_PARTICIPANTS);
    });

    it('5 concurrent joins into an empty room: 4 ok, 1 ROOM_FULL (50 runs)', async () => {
      const clients = await connectClients(t.url, MAX_PARTICIPANTS + 1);

      for (let run = 0; run < 50; run++) {
        const roomId = `race-${run}`;
        const results = await Promise.all(clients.map((c) => join(c, roomId)));

        expect(countResults(results), `run ${run}`).toEqual({ ok: MAX_PARTICIPANTS, full: 1 });
        expect(t.server.registry.getRoom(roomId)?.participants.size).toBe(MAX_PARTICIPANTS);

        await Promise.all(clients.map((c) => leave(c)));
        expect(t.server.registry.getRoom(roomId)).toBeUndefined();
      }
    });
  });

  describe('leaving', () => {
    it('notifies the others on disconnect', async () => {
      const [a, b] = await connectClients(t.url, 2);
      const ackA = await joinOk(a!, 'room1');
      const aEvents = recordEvents(a!);
      const ackB = await joinOk(b!, 'room1');

      b!.disconnect();

      await vi.waitFor(() => {
        expect(aEvents).toEqual([
          { type: 'joined', participant: ackB.self },
          { type: 'left', participantId: ackB.self.id },
        ]);
      });
      expect(t.server.registry.listParticipants('room1')).toEqual([ackA.self]);
    });

    it('notifies the others on room:leave and acks ok', async () => {
      const [a, b] = await connectClients(t.url, 2);
      await joinOk(a!, 'room1');
      const aEvents = recordEvents(a!);
      const bEvents = recordEvents(b!);
      const ackB = await joinOk(b!, 'room1');

      expect(await leave(b!)).toEqual({ ok: true });

      await vi.waitFor(() => {
        expect(aEvents).toEqual([
          { type: 'joined', participant: ackB.self },
          { type: 'left', participantId: ackB.self.id },
        ]);
      });
      expect(bEvents).toEqual([]);
    });

    it('lets a socket join again as a new participant after room:leave', async () => {
      const client = await connectClient(t.url);
      const first = await joinOk(client, 'room1');
      await leave(client);

      const second = await joinOk(client, 'room1');

      expect(second.self.id).not.toBe(first.self.id);
      expect(second.participants).toEqual([second.self]);
    });

    it('acks ok on room:leave outside a room', async () => {
      const client = await connectClient(t.url);
      expect(await leave(client)).toEqual({ ok: true });
    });

    it('deletes the room when the last participant disconnects; a new join starts empty', async () => {
      const [a, b] = await connectClients(t.url, 2);
      await joinOk(a!, 'room1');
      await joinOk(b!, 'room1');

      a!.disconnect();
      b!.disconnect();

      await vi.waitFor(() => {
        expect(t.server.registry.getRoom('room1')).toBeUndefined();
      });
      const c = await connectClient(t.url);
      const ack = await joinOk(c, 'room1');
      expect(ack.participants).toEqual([ack.self]);
    });
  });

  describe('validation', () => {
    const media = DEFAULT_MEDIA;

    it.each([
      ['empty object', {}, 'INVALID_PAYLOAD'],
      ['non-object payload', 'room1', 'INVALID_PAYLOAD'],
      ['null payload', null, 'INVALID_PAYLOAD'],
      ['extra fields', { roomId: 'room1', name: 'Алекс', media, admin: true }, 'INVALID_PAYLOAD'],
      ['wrong field types', { roomId: 1, name: 'Алекс', media }, 'INVALID_PAYLOAD'],
      [
        'name over the raw ceiling',
        { roomId: 'room1', name: 'a'.repeat(201), media },
        'INVALID_PAYLOAD',
      ],
      ['missing media', { roomId: 'room1', name: 'Алекс' }, 'INVALID_PAYLOAD'],
      ['null media', { roomId: 'room1', name: 'Алекс', media: null }, 'INVALID_PAYLOAD'],
      [
        'partial media',
        { roomId: 'room1', name: 'Алекс', media: { audio: true } },
        'INVALID_PAYLOAD',
      ],
      [
        'non-boolean media',
        { roomId: 'room1', name: 'Алекс', media: { audio: 1, video: 'yes' } },
        'INVALID_PAYLOAD',
      ],
      [
        'extra media fields',
        { roomId: 'room1', name: 'Алекс', media: { ...media, screen: true } },
        'INVALID_PAYLOAD',
      ],
      ['path traversal roomId', { roomId: '../x', name: 'Алекс', media }, 'INVALID_ROOM_ID'],
      ['empty roomId', { roomId: '', name: 'Алекс', media }, 'INVALID_ROOM_ID'],
      ['html in name', { roomId: 'room1', name: '<b>', media }, 'INVALID_NAME'],
      ['whitespace name', { roomId: 'room1', name: '   ', media }, 'INVALID_NAME'],
      [
        'too long name',
        { roomId: 'room1', name: 'a'.repeat(NAME_MAX_LENGTH + 1), media },
        'INVALID_NAME',
      ],
    ])('rejects %s with %s', async (_label, payload, code) => {
      const client = await connectClient(t.url);

      expect(await rawJoin(client, payload)).toEqual({ ok: false, error: { code } });
      expect(t.server.registry.roomCount).toBe(0);
    });

    it('rejects a second room:join from the same socket with ALREADY_JOINED', async () => {
      const client = await connectClient(t.url);
      await joinOk(client, 'room1');

      expect(await join(client, 'room2')).toEqual({ ok: false, error: { code: 'ALREADY_JOINED' } });
      expect(t.server.registry.getRoom('room2')).toBeUndefined();
      expect(t.server.registry.getRoom('room1')?.participants.size).toBe(1);
    });

    it('ignores room:join without an ack function', async () => {
      const client = await connectClient(t.url);
      (client as unknown as RawEmitter).emit('room:join', {
        roomId: 'room1',
        name: 'Алекс',
        media: DEFAULT_MEDIA,
      });

      // Следующая команда обрабатывается после предыдущей: сокет не попал в комнату.
      const ack = await joinOk(client, 'room2');
      expect(ack.participants).toHaveLength(1);
      expect(t.server.registry.getRoom('room1')).toBeUndefined();
    });
  });

  it('isolates rooms: a client in X does not receive events from Y', async () => {
    const [x1, x2, y1, y2] = await connectClients(t.url, 4);
    await joinOk(x1!, 'X');
    const xEvents = recordEvents(x1!);

    await joinOk(y1!, 'Y');
    await joinOk(y2!, 'Y');
    await leave(y2!);
    const ackX2 = await joinOk(x2!, 'X');

    // События доставляются по порядку: если бы события Y дошли до x1, они были бы раньше.
    await vi.waitFor(() => {
      expect(xEvents).toEqual([{ type: 'joined', participant: ackX2.self }]);
    });
  });
});

describe('safeHandler', () => {
  class ThrowingRegistry extends RoomRegistry {
    override join(): never {
      throw new Error('registry exploded');
    }
  }

  let t: TestServer;
  beforeEach(async () => {
    t = await startTestServer({ registry: new ThrowingRegistry() });
  });
  afterEach(async () => {
    disconnectAll();
    await t.close();
  });

  it('acks INTERNAL on an unhandled exception and keeps serving', async () => {
    const client = await connectClient(t.url);

    expect(await join(client, 'room1')).toEqual({ ok: false, error: { code: 'INTERNAL' } });
    expect(client.connected).toBe(true);
    expect(await leave(client)).toEqual({ ok: true });
  });
});
