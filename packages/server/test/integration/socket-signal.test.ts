import { randomUUID } from 'node:crypto';
import { SDP_MAX_LENGTH, SIGNAL_RATE_LIMIT, type SignalData } from '@vcr/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppServerOptions } from '../../src/app';
import { createLogger } from '../../src/logger';
import { RoomRegistry } from '../../src/rooms/RoomRegistry';
import {
  connectClient,
  connectClients,
  disconnectAll,
  flush,
  joinOk,
  leave,
  rawSendSignal,
  recordSignals,
  sendSignal,
  type TestClient,
} from '../helpers/socketClient';
import { startTestServer, type TestServer } from '../helpers/startTestServer';

const OFFER: SignalData = { type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' };
const ANSWER: SignalData = { type: 'answer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' };

const candidate = (n: number): SignalData => ({
  type: 'candidate',
  candidate: {
    candidate: `candidate:${n} 1 udp 2122260223 3f1a.local ${50_000 + n} typ host generation 0`,
    sdpMid: '0',
    sdpMLineIndex: 0,
    usernameFragment: 'Vh3x',
  },
});

describe('signal', () => {
  let t: TestServer;
  const lines: string[] = [];

  async function start(opts: Omit<AppServerOptions, 'port'> = {}) {
    lines.length = 0;
    t = await startTestServer({
      logger: createLogger('debug', (_level, line) => lines.push(line)),
      ...opts,
    });
  }

  /** A вошёл раньше B: A — offerer, B — answerer. */
  async function joinPair(opts: Omit<AppServerOptions, 'port'> = {}) {
    await start(opts);
    const [a, b] = (await connectClients(t.url, 2)) as [TestClient, TestClient];
    const ackA = await joinOk(a, 'room1', 'Алекс');
    const ackB = await joinOk(b, 'room1', 'Борис');
    return { a, b, aId: ackA.self.id, bId: ackB.self.id };
  }

  /** Все события отправителя обработаны, всё поставленное адресатам доставлено. */
  async function settle(...clients: TestClient[]) {
    for (const client of clients) await flush(client);
  }

  afterEach(async () => {
    disconnectAll();
    await t.close();
  });

  describe('relay', () => {
    it('delivers offer, answer and candidates only to the addressee with from set by the server', async () => {
      const { a, b, aId, bId } = await joinPair();
      const c = await connectClient(t.url);
      await joinOk(c, 'room1', 'Вера');
      const [aSignals, bSignals, cSignals] = [a, b, c].map(recordSignals);

      sendSignal(a, bId, OFFER);
      sendSignal(a, bId, candidate(1));
      await flush(a);
      sendSignal(b, aId, ANSWER);
      sendSignal(b, aId, candidate(2));
      await settle(b, a, c);

      expect(bSignals).toEqual([
        { from: aId, data: OFFER },
        { from: aId, data: candidate(1) },
      ]);
      expect(aSignals).toEqual([
        { from: bId, data: ANSWER },
        { from: bId, data: candidate(2) },
      ]);
      expect(cSignals).toEqual([]);
    });

    it('keeps the order of 200 candidates from one sender', async () => {
      const { a, b, bId } = await joinPair({ signalRateLimit: false });
      const bSignals = recordSignals(b);
      const sent = Array.from({ length: 200 }, (_, i) => candidate(i));

      for (const data of sent) sendSignal(a, bId, data);

      await vi.waitFor(() => {
        expect(bSignals).toHaveLength(sent.length);
      });
      expect(bSignals.map((s) => s.data)).toEqual(sent);
    });

    it('does not accept a forged from in the payload', async () => {
      const { a, b, bId } = await joinPair();
      const bSignals = recordSignals(b);

      rawSendSignal(a, { to: bId, from: randomUUID(), data: OFFER });
      await settle(a, b);

      expect(bSignals).toEqual([]);
      expect(a.connected).toBe(true);
    });
  });

  describe('addressee', () => {
    it('drops a signal to self', async () => {
      const { a, aId } = await joinPair();
      const aSignals = recordSignals(a);

      sendSignal(a, aId, candidate(1));
      await settle(a);

      expect(aSignals).toEqual([]);
    });

    it('drops a signal to a participant of another room', async () => {
      await start();
      const [a, x1, x2] = (await connectClients(t.url, 3)) as [TestClient, TestClient, TestClient];
      await joinOk(x1, 'X', 'Икс');
      const ackX2 = await joinOk(x2, 'X', 'Икс-2');
      await joinOk(a, 'room1', 'Алекс');
      const x2Signals = recordSignals(x2);

      // A вошёл позже: answer прошёл бы проверку ролей, отбрасывает именно чужая комната.
      sendSignal(a, ackX2.self.id, ANSWER);
      await settle(a, x2);

      expect(x2Signals).toEqual([]);
    });

    it('drops a signal to an unknown or departed participant', async () => {
      const { a, b, bId } = await joinPair();
      const bSignals = recordSignals(b);

      sendSignal(a, randomUUID(), OFFER);
      await leave(b);
      sendSignal(a, bId, OFFER);
      await settle(a, b);

      expect(bSignals).toEqual([]);
      expect(a.connected).toBe(true);
    });

    it('drops a signal from a socket that has not joined or has left', async () => {
      const { a, b, aId } = await joinPair();
      const outsider = await connectClient(t.url);
      const [aSignals, bSignals] = [a, b].map(recordSignals);

      sendSignal(outsider, aId, ANSWER);
      await leave(b);
      sendSignal(b, aId, ANSWER);
      await settle(outsider, b, a);

      expect(aSignals).toEqual([]);
      expect(bSignals).toEqual([]);
    });
  });

  describe('roles (I1)', () => {
    it('drops an offer from the newcomer to the old-timer and logs a warning', async () => {
      const { a, b, aId, bId } = await joinPair();
      const aSignals = recordSignals(a);

      sendSignal(b, aId, OFFER);
      await settle(b, a);

      expect(aSignals).toEqual([]);
      const warning = lines.find((line) => line.includes('WARN Signal dropped'));
      expect(warning).toContain('"reason":"role-violation"');
      expect(warning).toContain('"signalType":"offer"');
      expect(warning).toContain(`"participantId":"${bId}"`);
      expect(warning).not.toContain('v=0');
    });

    it('drops an answer from the old-timer to the newcomer', async () => {
      const { a, b, bId } = await joinPair();
      const bSignals = recordSignals(b);

      sendSignal(a, bId, ANSWER);
      await settle(a, b);

      expect(bSignals).toEqual([]);
      expect(lines.some((line) => line.includes('"reason":"role-violation"'))).toBe(true);
    });

    it('lets candidates flow in both directions', async () => {
      const { a, b, aId, bId } = await joinPair();
      const [aSignals, bSignals] = [a, b].map(recordSignals);

      sendSignal(a, bId, candidate(1));
      sendSignal(b, aId, candidate(2));
      await settle(a, b, a);

      expect(bSignals).toEqual([{ from: aId, data: candidate(1) }]);
      expect(aSignals).toEqual([{ from: bId, data: candidate(2) }]);
    });

    it('decides roles by join order even when joins land on the same millisecond', async () => {
      const { a, b, aId, bId } = await joinPair({ registry: new RoomRegistry({ now: () => 1 }) });
      const [aSignals, bSignals] = [a, b].map(recordSignals);

      sendSignal(b, aId, OFFER);
      sendSignal(a, bId, OFFER);
      await settle(b, a, b);

      expect(aSignals).toEqual([]);
      expect(bSignals).toEqual([{ from: aId, data: OFFER }]);
    });
  });

  describe('validation', () => {
    it.each<[string, (to: string) => unknown[]]>([
      ['no payload', () => []],
      ['null payload', () => [null]],
      [
        'SDP longer than SDP_MAX_LENGTH',
        (to) => [{ to, data: { type: 'offer', sdp: 'a'.repeat(SDP_MAX_LENGTH + 1) } }],
      ],
      ['empty SDP', (to) => [{ to, data: { type: 'offer', sdp: '' } }]],
      ['extra field in data', (to) => [{ to, data: { ...OFFER, sdpType: 'offer' } }]],
      ['unknown signal type', (to) => [{ to, data: { type: 'rollback', sdp: 'v=0' } }]],
      ['non-uuid to', () => [{ to: 'p1', data: OFFER }]],
    ])('drops %s and keeps serving', async (_label, buildArgs) => {
      const { a, b, aId, bId } = await joinPair();
      const bSignals = recordSignals(b);

      rawSendSignal(a, ...buildArgs(bId));
      sendSignal(a, bId, candidate(1));

      // Валидный сигнал пришёл первым — значит, невалидный не пересылался.
      await vi.waitFor(() => {
        expect(bSignals).toEqual([{ from: aId, data: candidate(1) }]);
      });
      expect(a.connected).toBe(true);
      expect(lines.some((line) => line.includes('"reason":"invalid"'))).toBe(true);
    });
  });

  describe('rate limit', () => {
    it('500 synchronous signals → at most burst + refill are delivered', async () => {
      const { a, b, bId } = await joinPair();
      const bSignals = recordSignals(b);

      const startedAt = Date.now();
      for (let i = 0; i < 500; i++) sendSignal(a, bId, candidate(i));
      await flush(a);
      const elapsedSec = (Date.now() - startedAt) / 1000;
      await flush(b);

      const ceiling =
        SIGNAL_RATE_LIMIT.burst + Math.ceil(elapsedSec * SIGNAL_RATE_LIMIT.refillPerSecond);
      expect(bSignals.length).toBeGreaterThanOrEqual(SIGNAL_RATE_LIMIT.burst);
      expect(bSignals.length).toBeLessThanOrEqual(ceiling);
      // Доставленные — префикс отправленных, без перестановок.
      expect(bSignals.map((s) => s.data)).toEqual(
        Array.from({ length: bSignals.length }, (_, i) => candidate(i)),
      );
      expect(lines.some((line) => line.includes('"reason":"rate-limited"'))).toBe(true);
    });

    it('dropped signals do not spend tokens', async () => {
      const { a, b, aId, bId } = await joinPair({
        signalRateLimit: { burst: 2, refillPerSecond: 0 },
      });
      const aSignals = recordSignals(a);

      for (let i = 0; i < 5; i++) sendSignal(b, aId, OFFER); // роль нарушена
      rawSendSignal(b, { to: aId, data: { type: 'offer', sdp: '' } });
      sendSignal(b, aId, ANSWER);
      sendSignal(b, aId, candidate(1));
      sendSignal(b, aId, candidate(2));
      await settle(b, a);

      expect(aSignals).toEqual([
        { from: bId, data: ANSWER },
        { from: bId, data: candidate(1) },
      ]);
    });
  });
});

describe('signal safeHandler', () => {
  class ThrowingRegistry extends RoomRegistry {
    private armed = false;
    arm() {
      this.armed = true;
    }
    override getParticipant(...args: Parameters<RoomRegistry['getParticipant']>) {
      if (this.armed) throw new Error('registry exploded');
      return super.getParticipant(...args);
    }
  }

  let t: TestServer;

  afterEach(async () => {
    disconnectAll();
    await t.close();
  });

  it('logs an unhandled exception and keeps the socket alive', async () => {
    const lines: string[] = [];
    const registry = new ThrowingRegistry();
    t = await startTestServer({
      registry,
      logger: createLogger('error', (_level, line) => lines.push(line)),
    });
    const client = await connectClient(t.url);
    await joinOk(client, 'room1');

    registry.arm();
    sendSignal(client, randomUUID(), OFFER);

    await vi.waitFor(() => {
      expect(lines.some((line) => line.includes('"signal" handler'))).toBe(true);
    });
    expect(client.connected).toBe(true);
  });
});
