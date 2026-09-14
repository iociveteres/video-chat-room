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

  describe('full mesh of 4 participants (TDD этапа 5 §6.4, §11.3)', () => {
    const NAMES = ['Алекс', 'Борис', 'Вера', 'Глеб'];
    /** SDP с именем отправителя: видно, что relay доставил именно его описание. */
    const sdpOf = (type: 'offer' | 'answer', name: string) => `v=0\r\ns=${type}-${name}\r\n`;

    it('each participant gets exactly 3 signal streams from the right senders: 6 offers, 6 answers', async () => {
      await start();
      const clients = await connectClients(t.url, NAMES.length);
      const ids: string[] = [];
      const received = clients.map(recordSignals);

      // Клиенты ведут себя как PeerManager: на participant:joined — offer и кандидат (I1),
      // на offer — answer и кандидат.
      clients.forEach((client, i) => {
        const name = NAMES[i]!;
        client.on('participant:joined', ({ participant }) => {
          sendSignal(client, participant.id, { type: 'offer', sdp: sdpOf('offer', name) });
          sendSignal(client, participant.id, candidate(i));
        });
        client.on('signal', ({ from, data }) => {
          if (data.type !== 'offer') return;
          sendSignal(client, from, { type: 'answer', sdp: sdpOf('answer', name) });
          sendSignal(client, from, candidate(i));
        });
      });

      // 6.1: входят по очереди — каждый следующий получает offer от всех, кто уже в комнате.
      for (const [i, client] of clients.entries()) {
        ids.push((await joinOk(client, 'room1', NAMES[i])).self.id);
      }
      const total = () => received.reduce((sum, signals) => sum + signals.length, 0);
      // 6 пар × (offer + answer) × (описание + кандидат).
      await vi.waitFor(() => {
        expect(total()).toBe(24);
      });
      await settle(...clients);

      // 6.2: у каждого ровно 3 потока — от остальных участников; от вошедших раньше — offer,
      // от вошедших позже — answer, в каждом потоке описание приходит раньше кандидата.
      received.forEach((signals, me) => {
        const senders = [...new Set(signals.map((s) => s.from))].sort();
        expect(senders).toEqual(ids.filter((_, i) => i !== me).sort());

        for (const [peer, peerId] of ids.entries()) {
          if (peer === me) continue;
          const type = peer < me ? 'offer' : 'answer';
          expect(signals.filter((s) => s.from === peerId).map((s) => s.data)).toEqual([
            { type, sdp: sdpOf(type, NAMES[peer]!) },
            candidate(peer),
          ]);
        }
      });

      const all = received.flat().map((s) => s.data.type);
      expect(all.filter((type) => type === 'offer')).toHaveLength(6);
      expect(all.filter((type) => type === 'answer')).toHaveLength(6);
      expect(lines.filter((line) => line.includes('Signal dropped'))).toEqual([]);
    });
  });

  // Границы и форма payload — в unit-тестах SignalSchema; здесь — что обработчик их применяет.
  describe('validation', () => {
    it.each<[string, (to: string) => unknown[]]>([
      [
        'SDP longer than SDP_MAX_LENGTH',
        (to) => [{ to, data: { type: 'offer', sdp: 'a'.repeat(SDP_MAX_LENGTH + 1) } }],
      ],
      // Отправителя задаёт сервер: поле from в payload — лишнее и отбрасывается целиком.
      ['a forged from', (to) => [{ to, from: randomUUID(), data: OFFER }]],
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
      // Первые burst доставлены подряд; токены, пополненные посреди потока, пропускают более
      // поздние сигналы — порядок при этом только возрастает, без перестановок.
      const sentIndex = (data: SignalData) =>
        data.type === 'candidate'
          ? Number(/^candidate:(\d+) /.exec(data.candidate.candidate)![1])
          : -1;
      const delivered = bSignals.map((s) => sentIndex(s.data));
      expect(delivered.slice(0, SIGNAL_RATE_LIMIT.burst)).toEqual(
        Array.from({ length: SIGNAL_RATE_LIMIT.burst }, (_, i) => i),
      );
      expect(delivered).toEqual([...delivered].sort((x, y) => x - y));
      expect(new Set(delivered).size).toBe(delivered.length);
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
