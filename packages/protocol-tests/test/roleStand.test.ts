import { afterEach, describe, expect, it } from 'vitest';
import { SYNTHETIC_SDP } from './stand/FakePeerSession';
import { RoleStand, type ClientCommand } from './stand/RoleStand';
import type { TestPeerClient } from './stand/TestPeerClient';

let stand: RoleStand | undefined;

async function start(clientCount: number): Promise<RoleStand> {
  stand = await RoleStand.start(clientCount);
  return stand;
}

afterEach(async () => {
  await stand?.close();
  stand = undefined;
});

const join = (client: number): ClientCommand => ({ type: 'join', client });

/** Живые сессии клиента: remoteId → роль. */
function roles(client: TestPeerClient): Record<string, string> {
  return Object.fromEntries(client.liveSessions().map((s) => [s.remoteId, s.role]));
}

function idOf(client: TestPeerClient | undefined): string {
  if (!client?.participantId) throw new Error('Client is not in the room');
  return client.participantId;
}

describe('RoleStand', () => {
  it('sequential joins: offers go from the earlier to the later participant, one per pair', async () => {
    const t = await start(3);

    await t.run([join(0), { type: 'wait', ms: 20 }, join(1), { type: 'wait', ms: 20 }, join(2)]);
    await t.settle();

    const [a, b, c] = t.clients.map(idOf);
    expect(t.liveParticipantIds()).toEqual([a, b, c]);
    expect(t.joinSeq(a!)).toBeLessThan(t.joinSeq(b!));
    expect(t.joinSeq(b!)).toBeLessThan(t.joinSeq(c!));

    expect(roles(t.clients[0]!)).toEqual({ [b!]: 'offerer', [c!]: 'offerer' });
    expect(roles(t.clients[1]!)).toEqual({ [a!]: 'answerer', [c!]: 'offerer' });
    expect(roles(t.clients[2]!)).toEqual({ [a!]: 'answerer', [b!]: 'answerer' });
    for (const client of t.clients) {
      for (const session of client.liveSessions()) {
        const expected = session.role === 'offerer' ? ['offer', 'answer'] : ['answer', 'offer'];
        expect([session.sent, session.received]).toEqual([[expected[0]], [expected[1]]]);
      }
    }
    expect(t.roleViolations()).toEqual([]);
  });

  it('commands in one tick: two newcomers at once still get unambiguous roles', async () => {
    const t = await start(3);

    await t.run([
      join(0),
      { type: 'wait', ms: 20 },
      { type: 'tick', commands: [join(1), join(2)] },
    ]);
    await t.settle();

    const [first, second] = t.liveParticipantIds().slice(1);
    const byId = (id: string | undefined) => t.clients.find((c) => c.participantId === id)!;
    expect(roles(byId(first))[second!]).toBe('offerer');
    expect(roles(byId(second))[first!]).toBe('answerer');
    expect(t.clients.every((c) => c.liveSessions().length === 2)).toBe(true);
    expect(t.roleViolations()).toEqual([]);
  });

  it('five at once: four get in, the fifth gets ROOM_FULL and no sessions', async () => {
    const t = await start(5);

    await t.run([{ type: 'tick', commands: [0, 1, 2, 3, 4].map(join) }]);
    await t.settle();

    const joined = t.clients.filter((c) => c.status === 'joined');
    const rejected = t.clients.filter((c) => c.status === 'idle');
    expect(joined).toHaveLength(4);
    expect(rejected.map((c) => c.joinErrors)).toEqual([['ROOM_FULL']]);
    expect(rejected[0]!.sessions).toEqual([]);
    expect(joined.every((c) => c.liveSessions().length === 3)).toBe(true);
  });

  it('leave, disconnect and rejoin close the pairs; a rejoin is a new, latest participant', async () => {
    const t = await start(4);
    await t.run([join(0), join(1), join(2), join(3)]);
    await t.settle();
    const oldId = idOf(t.clients[0]);

    await t.run([
      { type: 'leave', client: 1 },
      { type: 'disconnect', client: 2 },
      { type: 'rejoin', client: 0 },
    ]);
    await t.settle();

    const [a, d] = [idOf(t.clients[0]), idOf(t.clients[3])];
    expect(a).not.toBe(oldId);
    expect(t.liveParticipantIds()).toEqual([d, a]);
    expect(roles(t.clients[3]!)).toEqual({ [a]: 'offerer' });
    expect(roles(t.clients[0]!)).toEqual({ [d]: 'answerer' });
    expect(t.clients[1]!.liveSessions()).toEqual([]);
    expect(t.clients[2]!.liveSessions()).toEqual([]);
    // Сессии ушедших у D закрыты, а не просто забыты.
    expect(t.clients[3]!.sessions.filter((s) => s.closed)).toHaveLength(3);
  });

  it('collects server role-violation logs', async () => {
    const t = await start(2);
    await t.run([join(0), { type: 'wait', ms: 20 }, join(1)]);
    await t.settle();

    // Поздно вошедший шлёт offer старожилу в обход PeerManager.
    t.clients[1]!.socket!.emit('signal', {
      to: idOf(t.clients[0]),
      data: { type: 'offer', sdp: SYNTHETIC_SDP },
    });
    await t.settle();

    expect(t.roleViolations()).toHaveLength(1);
  });
});
