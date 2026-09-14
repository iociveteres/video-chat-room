import type { MediaState } from '@vcr/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/logger';
import { RoomRegistry } from '../../src/rooms/RoomRegistry';
import {
  connectClient,
  connectClients,
  disconnectAll,
  join,
  joinOk,
  leave,
  rawUpdateMedia,
  recordMedia,
  updateMedia,
} from '../helpers/socketClient';
import { startTestServer, type TestServer } from '../helpers/startTestServer';

const ALL_ON: MediaState = { audio: true, video: true };
const MIC_OFF: MediaState = { audio: false, video: true };
const CAM_OFF: MediaState = { audio: true, video: false };
const ALL_OFF: MediaState = { audio: false, video: false };

describe('media:update', () => {
  let t: TestServer;

  beforeEach(async () => {
    t = await startTestServer();
  });

  afterEach(async () => {
    disconnectAll();
    await t.close();
  });

  describe('delivery', () => {
    it('broadcasts participant:media to the others and stores the new state', async () => {
      const [a, b, c] = await connectClients(t.url, 3);
      const ackA = await joinOk(a!, 'room1', 'Алекс');
      await joinOk(b!, 'room1', 'Борис');
      await joinOk(c!, 'room1', 'Вера');
      const [bMedia, cMedia] = [b!, c!].map(recordMedia);

      updateMedia(a!, MIC_OFF);

      const expected = [{ participantId: ackA.self.id, media: MIC_OFF }];
      await vi.waitFor(() => {
        expect(bMedia).toEqual(expected);
        expect(cMedia).toEqual(expected);
      });
      expect(t.server.registry.getParticipant('room1', ackA.self.id)?.media).toEqual(MIC_OFF);
    });

    it('does not send participant:media back to the sender', async () => {
      const [a, b] = await connectClients(t.url, 2);
      const ackA = await joinOk(a!, 'room1', 'Алекс');
      const ackB = await joinOk(b!, 'room1', 'Борис');
      const [aMedia, bMedia] = [a!, b!].map(recordMedia);

      updateMedia(a!, MIC_OFF);
      await vi.waitFor(() => {
        expect(bMedia).toEqual([{ participantId: ackA.self.id, media: MIC_OFF }]);
      });
      updateMedia(b!, CAM_OFF);

      // Сервер обработал A раньше B, так что своё событие пришло бы A первым.
      await vi.waitFor(() => {
        expect(aMedia).toEqual([{ participantId: ackB.self.id, media: CAM_OFF }]);
      });
    });

    it('does not broadcast a repeated value', async () => {
      const [a, b] = await connectClients(t.url, 2);
      const ackA = await joinOk(a!, 'room1', 'Алекс', ALL_ON);
      await joinOk(b!, 'room1', 'Борис');
      const bMedia = recordMedia(b!);

      updateMedia(a!, ALL_ON); // совпадает со значением из room:join
      updateMedia(a!, MIC_OFF);
      updateMedia(a!, MIC_OFF);
      updateMedia(a!, ALL_OFF);

      await vi.waitFor(() => {
        expect(bMedia).toEqual([
          { participantId: ackA.self.id, media: MIC_OFF },
          { participantId: ackA.self.id, media: ALL_OFF },
        ]);
      });
    });

    it('keeps the order of updates from one socket: the last value wins', async () => {
      const [a, b] = await connectClients(t.url, 2);
      const ackA = await joinOk(a!, 'room1', 'Алекс');
      await joinOk(b!, 'room1', 'Борис');
      const bMedia = recordMedia(b!);

      const sequence = [MIC_OFF, ALL_OFF, CAM_OFF, ALL_OFF, MIC_OFF];
      for (const media of sequence) updateMedia(a!, media);

      await vi.waitFor(() => {
        expect(bMedia.map((e) => e.media)).toEqual(sequence);
      });
      expect(t.server.registry.getParticipant('room1', ackA.self.id)?.media).toEqual(MIC_OFF);
    });

    it('shows the updated state to a participant who joins later', async () => {
      const [a, b] = await connectClients(t.url, 2);
      const ackA = await joinOk(a!, 'room1', 'Алекс', ALL_ON);
      updateMedia(a!, CAM_OFF);
      // Следующая команда того же сокета обрабатывается после media:update.
      expect(await join(a!, 'room1')).toEqual({ ok: false, error: { code: 'ALREADY_JOINED' } });

      const ackB = await joinOk(b!, 'room1', 'Борис');

      expect(ackB.participants).toEqual([{ ...ackA.self, media: CAM_OFF }, ackB.self]);
    });

    it('isolates rooms: a client in X does not receive updates from Y', async () => {
      const [x1, x2, y1] = await connectClients(t.url, 3);
      await joinOk(x1!, 'X');
      const ackX2 = await joinOk(x2!, 'X');
      await joinOk(y1!, 'Y');
      const x1Media = recordMedia(x1!);

      updateMedia(y1!, ALL_OFF);
      await leave(y1!); // media:update того же сокета уже обработан
      updateMedia(x2!, MIC_OFF);

      await vi.waitFor(() => {
        expect(x1Media).toEqual([{ participantId: ackX2.self.id, media: MIC_OFF }]);
      });
    });
  });

  describe('validation', () => {
    it.each([
      ['null payload', [null]],
      ['no payload', []],
      ['string payload', ['off']],
      ['empty object', [{}]],
      ['partial state', [{ audio: false }]],
      ['non-boolean fields', [{ audio: 0, video: 'no' }]],
      ['extra field', [{ audio: false, video: false, screen: true }]],
      ['forged participantId', [{ audio: false, video: false, participantId: 'someone' }]],
    ])('ignores %s and keeps serving', async (_label, args) => {
      const [a, b] = await connectClients(t.url, 2);
      const ackA = await joinOk(a!, 'room1', 'Алекс');
      await joinOk(b!, 'room1', 'Борис');
      const bMedia = recordMedia(b!);

      rawUpdateMedia(a!, ...args);
      updateMedia(a!, CAM_OFF);

      // Валидное событие пришло первым — значит, невалидное не рассылалось.
      await vi.waitFor(() => {
        expect(bMedia).toEqual([{ participantId: ackA.self.id, media: CAM_OFF }]);
      });
      expect(a!.connected).toBe(true);
      expect(t.server.registry.getParticipant('room1', ackA.self.id)?.media).toEqual(CAM_OFF);
    });

    it('ignores media:update before room:join', async () => {
      const [a, b] = await connectClients(t.url, 2);
      await joinOk(a!, 'room1', 'Алекс');
      const aMedia = recordMedia(a!);

      updateMedia(b!, ALL_OFF);
      const ackB = await joinOk(b!, 'room1', 'Борис', ALL_ON);
      updateMedia(b!, MIC_OFF);

      await vi.waitFor(() => {
        expect(aMedia).toEqual([{ participantId: ackB.self.id, media: MIC_OFF }]);
      });
      expect(ackB.self.media).toEqual(ALL_ON);
      expect(b!.connected).toBe(true);
    });

    it('ignores media:update after room:leave', async () => {
      const [a, b, c] = await connectClients(t.url, 3);
      await joinOk(a!, 'room1', 'Алекс');
      await joinOk(b!, 'room1', 'Борис');
      const ackC = await joinOk(c!, 'room1', 'Вера');
      const aMedia = recordMedia(a!);

      await leave(b!);
      updateMedia(b!, ALL_OFF);
      await leave(b!); // вне комнаты ack приходит всё равно: media:update уже обработан
      updateMedia(c!, CAM_OFF);

      await vi.waitFor(() => {
        expect(aMedia).toEqual([{ participantId: ackC.self.id, media: CAM_OFF }]);
      });
      expect(b!.connected).toBe(true);
    });
  });
});

describe('media:update safeHandler', () => {
  class ThrowingRegistry extends RoomRegistry {
    override updateMedia(): never {
      throw new Error('registry exploded');
    }
  }

  let t: TestServer;
  const lines: string[] = [];

  beforeEach(async () => {
    lines.length = 0;
    t = await startTestServer({
      registry: new ThrowingRegistry(),
      logger: createLogger('error', (_level, line) => lines.push(line)),
    });
  });

  afterEach(async () => {
    disconnectAll();
    await t.close();
  });

  it('logs an unhandled exception and keeps the socket and the process alive', async () => {
    const client = await connectClient(t.url);
    await joinOk(client, 'room1');

    updateMedia(client, ALL_OFF);

    await vi.waitFor(() => {
      expect(lines.some((line) => line.includes('"media:update" handler'))).toBe(true);
    });
    expect(client.connected).toBe(true);
    expect(await leave(client)).toEqual({ ok: true });
  });
});
