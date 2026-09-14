import { expect, test } from '@playwright/test';
import {
  attachCamera,
  detachCamera,
  expectGrowing,
  expectRemoteVideoPlaying,
  expectStalled,
  inboundRtp,
  onlyPeerId,
  peerIds,
  remoteTile,
  signalCounts,
} from './helpers/call';
import { createdTracks, deviceToggle } from './helpers/media';
import { closeParticipants, createRoom, joinByLink, newParticipant } from './helpers/room';

test.afterEach(closeParticipants);

// Звонок в loopback между двумя browser context: реальные RTCPeerConnection и fake-медиа.
test.describe.configure({ timeout: 60_000 });

async function twoInCall(browser: Parameters<typeof newParticipant>[0]) {
  const a = await newParticipant(browser);
  const b = await newParticipant(browser);
  const url = await createRoom(a.page, 'Алекс');
  await joinByLink(b.page, url, 'Борис');
  return { a, b, url };
}

test('two participants see and hear each other', async ({ browser }) => {
  const { a, b } = await twoInCall(browser);

  await expectRemoteVideoPlaying(a.page, 'Борис');
  await expectRemoteVideoPlaying(b.page, 'Алекс');

  for (const page of [a.page, b.page]) {
    const peer = await onlyPeerId(page);
    await expectGrowing(async () => (await inboundRtp(page, peer, 'video')).bytesReceived);
    await expectGrowing(async () => (await inboundRtp(page, peer, 'audio')).bytesReceived);
  }
});

test('no glare or renegotiation: one offer from the old-timer after 5 camera and mic cycles', async ({
  browser,
}) => {
  const { a, b } = await twoInCall(browser);
  await expectRemoteVideoPlaying(b.page, 'Алекс');
  const bId = await onlyPeerId(a.page);
  const aId = await onlyPeerId(b.page);

  for (let i = 0; i < 5; i++) {
    for (const page of [a.page, b.page]) {
      for (const device of ['Камера', 'Микрофон'] as const) {
        await deviceToggle(page, device).click();
        await expect(deviceToggle(page, device)).toHaveAttribute('aria-pressed', 'false');
        await deviceToggle(page, device).click();
        await expect(deviceToggle(page, device)).toHaveAttribute('aria-pressed', 'true');
      }
    }
  }

  await expectRemoteVideoPlaying(a.page, 'Борис');
  await expectRemoteVideoPlaying(b.page, 'Алекс');
  expect((await signalCounts(a.page))[bId]).toMatchObject({ offer: 1, answer: 0 });
  expect((await signalCounts(b.page))[aId]).toMatchObject({ offer: 0, answer: 1 });
});

test('camera off at A → B shows the placeholder within 1 s and stops decoding; A releases the camera', async ({
  browser,
}) => {
  const { a, b } = await twoInCall(browser);
  await expectRemoteVideoPlaying(b.page, 'Алекс');
  const aId = await onlyPeerId(b.page);

  await deviceToggle(a.page, 'Камера').click();

  await expect(remoteTile(b.page, 'Алекс')).toContainText('Камера выключена', { timeout: 1_000 });
  await expectStalled(async () => (await inboundRtp(b.page, aId, 'video')).framesDecoded);
  await expect
    .poll(async () => (await createdTracks(a.page, 'video')).map((t) => t.readyState))
    .toEqual(['ended']);
});

test('joined without a camera, then turned it on → B decodes video without a new offer', async ({
  browser,
}) => {
  const a = await newParticipant(browser);
  const b = await newParticipant(browser);
  await detachCamera(b.page);
  const url = await createRoom(a.page, 'Алекс');
  await joinByLink(b.page, url, 'Борис');
  await expect(deviceToggle(b.page, 'Камера')).toHaveAttribute('title', 'Камера не найдена');
  // Звук идёт сразу: соединение поднято с пустым видео-трансивером (I2).
  const bId = await onlyPeerId(a.page);
  await expectGrowing(async () => (await inboundRtp(a.page, bId, 'audio')).bytesReceived);
  await expect(remoteTile(a.page, 'Борис')).toContainText('Камера выключена');

  await attachCamera(b.page);
  await deviceToggle(b.page, 'Камера').click();

  await expectRemoteVideoPlaying(a.page, 'Борис');
  await expectGrowing(async () => (await inboundRtp(a.page, bId, 'video')).framesDecoded);
  const aId = await onlyPeerId(b.page);
  expect((await signalCounts(a.page))[bId]?.offer).toBe(1);
  expect((await signalCounts(b.page))[aId]?.offer ?? 0).toBe(0);
});

test('microphone off at A → B sees the crossed-out microphone on the tile', async ({ browser }) => {
  const { a, b } = await twoInCall(browser);
  const tile = remoteTile(b.page, 'Алекс');
  await expect(tile.getByRole('img', { name: 'Микрофон выключен' })).toHaveCount(0);

  await deviceToggle(a.page, 'Микрофон').click();

  await expect(tile.getByRole('img', { name: 'Микрофон выключен' })).toBeVisible({
    timeout: 1_000,
  });
});

test('A leaves → B loses the tile and the connection within 2 s', async ({ browser }) => {
  const { a, b } = await twoInCall(browser);
  await expectRemoteVideoPlaying(b.page, 'Алекс');

  await a.page.getByRole('button', { name: 'Выйти' }).click();

  await expect(remoteTile(b.page, 'Алекс')).toHaveCount(0, { timeout: 2_000 });
  await expect.poll(() => peerIds(b.page), { timeout: 2_000 }).toEqual([]);
  expect(await peerIds(a.page)).toEqual([]);
});

test('A closes the tab → B loses the tile and the connection within 2 s', async ({ browser }) => {
  const { a, b } = await twoInCall(browser);
  await expectRemoteVideoPlaying(b.page, 'Алекс');

  await a.page.close();

  await expect(remoteTile(b.page, 'Алекс')).toHaveCount(0, { timeout: 2_000 });
  await expect.poll(() => peerIds(b.page), { timeout: 2_000 }).toEqual([]);
});
