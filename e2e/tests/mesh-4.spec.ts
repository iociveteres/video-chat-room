import { expect, test } from '@playwright/test';
import { callConfig } from './helpers/call';
import {
  localVideoSettings,
  openMeshRoom,
  pairStats,
  participantIds,
  peerSummary,
  signalCountsByName,
  waitForFullMesh,
} from './helpers/mesh';
import { closeParticipants } from './helpers/room';

// Проект mesh (playwright.config.ts): один воркер, 120 с на тест, захват 320×180@15.
test.afterEach(closeParticipants);

test('mesh infrastructure: 4 participants on the reduced capture connect all 6 pairs', async ({
  browser,
}) => {
  const { participants } = await openMeshRoom(browser, 4);
  const [a] = participants;

  expect((await callConfig(a!.page)).videoConstraints).toMatchObject({ width: { ideal: 320 } });
  await waitForFullMesh(participants);

  for (const participant of participants) {
    expect((await localVideoSettings(participant)).width).toBeLessThanOrEqual(320);
  }

  // Хелперы видят одно и то же: 4 разных id, у каждого пары ровно с тремя остальными.
  const ids = await participantIds(participants);
  expect(new Set(Object.values(ids)).size).toBe(4);
  for (const participant of participants) {
    const others = Object.entries(ids).filter(([name]) => name !== participant.name);
    expect((await peerSummary(participant)).map((p) => p.participantId).sort()).toEqual(
      others.map(([, id]) => id).sort(),
    );
    const counts = await signalCountsByName(participant, ids);
    expect(Object.keys(counts).sort()).toEqual(others.map(([name]) => name).sort());
  }
  expect((await pairStats(a!, ids, 'Глеб')).some((s) => s.type === 'inbound-rtp')).toBe(true);
});
