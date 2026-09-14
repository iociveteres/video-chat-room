import { MAX_PARTICIPANTS } from '@vcr/shared';
import { expect } from 'vitest';
import type { FakePeerSession } from './FakePeerSession';
import type { RoleStand } from './RoleStand';

const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** Все неупорядоченные пары живых участников. */
function livePairs(stand: RoleStand): [string, string][] {
  const ids = stand.liveParticipantIds();
  return ids.flatMap((x, i) => ids.slice(i + 1).map((y): [string, string] => [x, y]));
}

/** Свойство 1: в комнате не больше 4 участников, лишние получили ROOM_FULL. */
export function checkRoomLimit(stand: RoleStand): void {
  const context = `Property 1 (room limit): ${stand.describe()}`;
  expect(stand.maxRoomSize, context).toBeLessThanOrEqual(MAX_PARTICIPANTS);
  // Отказ — только при действительно полной комнате.
  for (const size of stand.roomSizesOnReject) expect(size, context).toBe(MAX_PARTICIPANTS);

  for (const client of stand.clients) {
    const where = `${context}\nclient #${client.index}`;
    expect(client.status, where).not.toBe('joining');
    expect(
      client.joinErrors.every((code) => code === 'ROOM_FULL'),
      where,
    ).toBe(true);
    // Ни одна попытка входа не потерялась: каждая — успех, ROOM_FULL или прерванный вход.
    expect(client.joinAttempts, where).toBe(
      client.joinsSucceeded + client.joinErrors.length + client.joinsAborted,
    );
  }
}

/** Свойство 2: в каждой живой паре ровно одна сторона offerer — участник с меньшим joinSeq. */
export function checkRoles(stand: RoleStand): void {
  const context = `Property 2 (roles): ${stand.describe()}`;
  const live = liveSessionsById(stand);

  for (const [x, y] of livePairs(stand)) {
    const where = `${context}\npair ${pairKey(x, y)}`;
    const xy = live.get(x)?.get(y);
    const yx = live.get(y)?.get(x);
    expect(xy && yx, `${where}: missing session`).toBeTruthy();
    const [earlier, later] = stand.joinSeq(x) < stand.joinSeq(y) ? [xy!, yx!] : [yx!, xy!];
    expect([earlier.role, later.role], where).toEqual(['offerer', 'answerer']);
  }
}

/**
 * Свойство 3: на пару ровно 1 offer и 1 answer (у пары, закрытой до конца согласования, —
 * не больше), и сервер не отбросил ни одного сигнала как нарушение ролей.
 */
export function checkOneOfferAnswerPerPair(stand: RoleStand): void {
  const context = `Property 3 (one offer/answer per pair): ${stand.describe()}`;
  const offers = new Map<string, number>();
  const answers = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, n: number) =>
    map.set(key, (map.get(key) ?? 0) + n);

  // Все сессии за время стенда, включая закрытые: пара — это пара participantId.
  for (const client of stand.clients) {
    const seen = new Set<string>();
    for (const session of client.sessions) {
      const key = pairKey(session.localId, session.remoteId);
      const where = `${context}\nclient #${client.index}, pair ${key}`;
      expect(seen.has(key), `${where}: second session`).toBe(false);
      seen.add(key);
      const allowed = session.role === 'offerer' ? 'offer' : 'answer';
      expect(session.sent, `${where}: ${session.role} sent`).toEqual(
        session.sent.map(() => allowed),
      );
      add(offers, key, session.sent.filter((type) => type === 'offer').length);
      add(answers, key, session.sent.filter((type) => type === 'answer').length);
    }
  }

  for (const [key, n] of [...offers, ...answers]) {
    expect(n, `${context}\npair ${key}`).toBeLessThanOrEqual(1);
  }
  for (const [x, y] of livePairs(stand)) {
    const key = pairKey(x, y);
    expect([offers.get(key), answers.get(key)], `${context}\nlive pair ${key}`).toEqual([1, 1]);
  }

  expect(stand.roleViolations(), context).toEqual([]);
  expect(
    stand.logs.filter((entry) => entry.level === 'error'),
    context,
  ).toEqual([]);
}

/** Свойство 4: сессии клиента — ровно остальные живые участники, без утечек и «призраков». */
export function checkNoLeaksOrGhosts(stand: RoleStand): void {
  const context = `Property 4 (no leaks or ghosts): ${stand.describe()}`;
  const ids = stand.liveParticipantIds();

  for (const client of stand.clients) {
    const where = `${context}\nclient #${client.index}`;
    const self = client.participantId;
    const expected = new Set(self ? ids.filter((id) => id !== self) : []);
    const managed = new Set(client.manager.ids());
    expect(managed, where).toEqual(expected);
    expect(new Set(client.liveSessions().map((s) => s.remoteId)), where).toEqual(expected);
    // Всё, что PeerManager уже отпустил, закрыто.
    const released = client.sessions.filter((s) => s.localId !== self || !managed.has(s.remoteId));
    expect(
      released.filter((s) => !s.closed).map((s) => s.remoteId),
      `${where}: not closed`,
    ).toEqual([]);
  }
}

function liveSessionsById(stand: RoleStand): Map<string, Map<string, FakePeerSession>> {
  const result = new Map<string, Map<string, FakePeerSession>>();
  for (const client of stand.clients) {
    if (!client.participantId) continue;
    result.set(client.participantId, new Map(client.liveSessions().map((s) => [s.remoteId, s])));
  }
  return result;
}
