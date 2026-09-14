import { expect, type Browser } from '@playwright/test';
import { peerStats, type PeerSummary, type SignalCounts, type VcrPeersWindow } from './call';
import { createRoom, joinByLink, newParticipant, type Participant } from './room';

/** Имена по порядку входа: A, B, C, D и пятый — E. */
export const MESH_NAMES = ['Алекс', 'Борис', 'Вера', 'Глеб', 'Дина'] as const;

export interface MeshParticipant extends Participant {
  name: string;
}

export interface MeshRoom {
  url: string;
  participants: MeshParticipant[];
}

/** Первый создаёт комнату, остальные входят по ссылке строго по очереди (порядок = joinSeq). */
export async function openMeshRoom(
  browser: Browser,
  count: number,
  names: readonly string[] = MESH_NAMES,
): Promise<MeshRoom> {
  const first = await newParticipant(browser);
  const url = await createRoom(first.page, names[0]!);
  const participants: MeshParticipant[] = [{ ...first, name: names[0]! }];
  for (const name of names.slice(1, count)) {
    participants.push(await joinMeshRoom(browser, url, name));
  }
  return { url, participants };
}

/** Ещё один участник входит по ссылке (успех входа проверяет joinByLink). */
export async function joinMeshRoom(
  browser: Browser,
  url: string,
  name: string,
): Promise<MeshParticipant> {
  const participant = await newParticipant(browser);
  await joinByLink(participant.page, url, name);
  return { ...participant, name };
}

export function peerSummary(participant: Participant): Promise<PeerSummary[]> {
  return participant.page.evaluate(() =>
    (window as unknown as VcrPeersWindow).__vcr.peers.summary(),
  );
}

/**
 * Ждёт, пока у каждого участника будет ровно N − 1 пар и все connected. Возвращает время
 * ожидания в мс — для оценки времени подключения.
 */
export async function waitForFullMesh(
  participants: readonly Participant[],
  timeout = 30_000,
): Promise<number> {
  const startedAt = Date.now();
  const expected = participants.length - 1;
  await expect
    .poll(
      async () => {
        const summaries = await Promise.all(participants.map(peerSummary));
        return summaries.map((pairs) =>
          pairs.length === expected && pairs.every((p) => p.status === 'connected')
            ? 'full'
            : pairs.map((p) => p.status).join(',') || 'none',
        );
      },
      { timeout, message: 'every participant has N − 1 connected pairs' },
    )
    .toEqual(participants.map(() => 'full'));
  return Date.now() - startedAt;
}

/**
 * participantId каждого участника по имени. В DOM у ячейки удалённой плитки есть
 * data-participant-id, поэтому id участника читается со страницы другого участника.
 */
export async function participantIds(
  participants: readonly MeshParticipant[],
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const [i, { name }] of participants.entries()) {
    const observer = participants[i === 0 ? 1 : 0];
    if (!observer) throw new Error('participantIds needs at least two participants');
    const cell = observer.page.locator('.video-grid__cell', {
      has: observer.page.getByRole('figure', { name, exact: true }),
    });
    const id = await cell.getAttribute('data-participant-id');
    if (!id) throw new Error(`No tile for ${name}`);
    ids[name] = id;
  }
  return ids;
}

/** Отправленные участником сигналы, по имени адресата. */
export async function signalCountsByName(
  participant: Participant,
  ids: Record<string, string>,
): Promise<SignalCounts> {
  const counts = await participant.page.evaluate(() =>
    (window as unknown as VcrPeersWindow).__vcr.debug.signalCounts(),
  );
  const names = Object.fromEntries(Object.entries(ids).map(([name, id]) => [id, name]));
  return Object.fromEntries(Object.entries(counts).map(([id, count]) => [names[id] ?? id, count]));
}

/** getStats() пары participant ↔ peerName. */
export function pairStats(
  participant: Participant,
  ids: Record<string, string>,
  peerName: string,
): Promise<Record<string, unknown>[]> {
  const id = ids[peerName];
  if (!id) throw new Error(`Unknown participant ${peerName}`);
  return peerStats(participant.page, id);
}

/** Настройки локального видеотрека: E2E проверяет, что захват действительно понижен. */
export function localVideoSettings(participant: Participant) {
  return participant.page.evaluate(() => {
    const hook = (window as unknown as { __vcr: { media: { getTracks(): LocalTracks } } }).__vcr;
    const { width, height, frameRate } = hook.media.getTracks().video?.getSettings() ?? {};
    return { width, height, frameRate };
  });
}

interface LocalTracks {
  audio: MediaStreamTrack | null;
  video: MediaStreamTrack | null;
}
