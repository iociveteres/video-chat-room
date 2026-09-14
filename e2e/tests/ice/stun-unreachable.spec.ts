import { expect, test } from '@playwright/test';
import {
  callConfig,
  expectGrowing,
  expectRemoteVideoPlaying,
  inboundRtp,
  onlyPeerId,
  peerStats,
} from '../helpers/call';
import { closeParticipants, createRoom, joinByLink, newParticipant } from '../helpers/room';

// Проект chromium-stun-unreachable: клиент собран с VITE_ICE_SERVERS=stun:127.0.0.1:9 (FR-34).
test.afterEach(closeParticipants);
test.describe.configure({ timeout: 60_000 });

test('STUN unreachable → the call still connects over host candidates', async ({ browser }) => {
  const a = await newParticipant(browser);
  const b = await newParticipant(browser);
  const url = await createRoom(a.page, 'Алекс');
  expect((await callConfig(a.page)).rtc.iceServers).toEqual([{ urls: 'stun:127.0.0.1:9' }]);

  await joinByLink(b.page, url, 'Борис');

  await expectRemoteVideoPlaying(a.page, 'Борис');
  await expectRemoteVideoPlaying(b.page, 'Алекс');
  const bId = await onlyPeerId(a.page);
  await expectGrowing(async () => (await inboundRtp(a.page, bId, 'audio')).bytesReceived);

  // Выбранная пара — host ↔ host, srflx-кандидатов нет: STUN действительно не ответил.
  const stats = await peerStats(a.page, bId);
  const byId = new Map(stats.map((s) => [s.id, s]));
  const pair = stats.find(
    (s) => s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded',
  );
  expect(pair).toBeDefined();
  expect(byId.get(pair!.localCandidateId)?.candidateType).toBe('host');
  expect(byId.get(pair!.remoteCandidateId)?.candidateType).toBe('host');
  expect(stats.filter((s) => s.type === 'local-candidate' && s.candidateType === 'srflx')).toEqual(
    [],
  );
});
