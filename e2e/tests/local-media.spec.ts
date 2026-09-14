import { expect, test } from '@playwright/test';
import {
  createdTracks,
  currentTracks,
  denyMediaAccess,
  deviceToggle,
  dispatchVideoEnded,
  expectSelfVideoPlaying,
  participantItem,
  removeAllDevices,
  selfTile,
} from './helpers/media';
import {
  closeParticipants,
  createRoom,
  joinByLink,
  newParticipant,
  openLinkAndSubmitName,
  participantList,
  type Participant,
} from './helpers/room';

test.afterEach(closeParticipants);

// Сценарии 10.1–10.2 идут и в Firefox-проекте (тег @firefox), остальные — только в Chromium.

test(
  'by default the microphone and the camera are on and the self-view plays',
  { tag: '@firefox' },
  async ({ browser }) => {
    const a = await newParticipant(browser);

    await createRoom(a.page, 'Алекс');

    await expect(deviceToggle(a.page, 'Микрофон')).toHaveAttribute('aria-pressed', 'true');
    await expect(deviceToggle(a.page, 'Камера')).toHaveAttribute('aria-pressed', 'true');
    await expectSelfVideoPlaying(a.page);
    expect(await currentTracks(a.page)).toMatchObject({
      audio: { readyState: 'live' },
      video: { readyState: 'live' },
    });
  },
);

test(
  'turning the camera off stops every video track; turning it on creates a new live one',
  { tag: '@firefox' },
  async ({ browser }) => {
    const a = await newParticipant(browser);
    await createRoom(a.page, 'Алекс');
    await expectSelfVideoPlaying(a.page);
    const [first] = await createdTracks(a.page, 'video');

    await deviceToggle(a.page, 'Камера').click();

    await expect(deviceToggle(a.page, 'Камера')).toHaveAttribute('aria-pressed', 'false');
    // FR-19: камера физически освобождена — ни одного живого видеотрека, включая клоны.
    await expect
      .poll(async () => (await createdTracks(a.page, 'video')).map((t) => t.readyState))
      .toEqual(['ended']);
    expect((await currentTracks(a.page)).video).toBeNull();
    await expect(selfTile(a.page).locator('.avatar-placeholder')).toBeVisible();
    await expect(selfTile(a.page)).toContainText('Камера выключена');

    await deviceToggle(a.page, 'Камера').click();

    await expect(deviceToggle(a.page, 'Камера')).toHaveAttribute('aria-pressed', 'true');
    const video = await createdTracks(a.page, 'video');
    expect(video).toHaveLength(2);
    expect(video[0]).toMatchObject({ id: first!.id, readyState: 'ended' });
    expect(video[1]).toMatchObject({ readyState: 'live' });
    expect((await currentTracks(a.page)).video?.id).toBe(video[1]!.id);
    await expect(selfTile(a.page).locator('.avatar-placeholder')).toBeHidden();
    await expectSelfVideoPlaying(a.page);
  },
);

test('B mutes the microphone → A sees the crossed-out microphone at B within 1 second', async ({
  browser,
}) => {
  const a = await newParticipant(browser);
  const b = await newParticipant(browser);
  const url = await createRoom(a.page, 'Алекс');
  await joinByLink(b.page, url, 'Борис');
  const borisAtA = await participantItem(a.page, 'Борис');
  await expect(borisAtA.getByRole('img')).toHaveCount(0);

  await deviceToggle(b.page, 'Микрофон').click();

  await expect(borisAtA.getByRole('img', { name: 'Микрофон выключен' })).toBeVisible({
    timeout: 1_000,
  });
  await expect(borisAtA.getByRole('img', { name: 'Камера выключена' })).toHaveCount(0);
  expect((await currentTracks(b.page)).audio?.readyState).toBe('live');

  await deviceToggle(b.page, 'Микрофон').click();
  await expect(borisAtA.getByRole('img')).toHaveCount(0, { timeout: 1_000 });
});

test('access denied → the user is in the room with a banner, others see both devices off', async ({
  browser,
}) => {
  const a = await newParticipant(browser);
  const b = await newParticipant(browser);
  await denyMediaAccess(b.page);
  const url = await createRoom(a.page, 'Алекс');

  await joinByLink(b.page, url, 'Борис');

  await expect(b.page.getByRole('region', { name: 'Нет доступа к устройствам' })).toContainText(
    'Нет доступа к камере и микрофону.',
  );
  await expect(deviceToggle(b.page, 'Камера')).toHaveAttribute('title', 'Нет доступа к камере');
  await expect(deviceToggle(b.page, 'Микрофон')).toHaveAttribute('aria-pressed', 'false');
  await expect(selfTile(b.page)).toContainText('Нет доступа к камере');
  expect(await createdTracks(b.page)).toEqual([]);

  const borisAtA = await participantItem(a.page, 'Борис');
  await expect(borisAtA.getByRole('img', { name: 'Микрофон выключен' })).toBeVisible();
  await expect(borisAtA.getByRole('img', { name: 'Камера выключена' })).toBeVisible();
});

test('no devices at all → joins without a permission request, both not found', async ({
  browser,
}) => {
  const a = await newParticipant(browser);
  await removeAllDevices(a.page);

  await createRoom(a.page, 'Алекс');

  expect(
    await a.page.evaluate(() => (window as unknown as { __gumCalls: number }).__gumCalls),
  ).toBe(0);
  expect(await createdTracks(a.page)).toEqual([]);
  await expect(deviceToggle(a.page, 'Камера')).toHaveAttribute('title', 'Камера не найдена');
  await expect(deviceToggle(a.page, 'Микрофон')).toHaveAttribute('title', 'Микрофон не найден');
  await expect(
    a.page.getByRole('status').filter({ hasText: 'Камера и микрофон не найдены' }),
  ).toBeVisible();
  await expect(a.page.getByRole('region', { name: 'Нет доступа к устройствам' })).toHaveCount(0);
});

test('camera lost → «Камера отключена» for the owner, the others see the camera off', async ({
  browser,
}) => {
  const a = await newParticipant(browser);
  const b = await newParticipant(browser);
  const url = await createRoom(a.page, 'Алекс');
  await joinByLink(b.page, url, 'Борис');
  await expectSelfVideoPlaying(b.page);

  await dispatchVideoEnded(b.page);

  await expect(selfTile(b.page)).toContainText('Камера отключена');
  await expect(deviceToggle(b.page, 'Камера')).toHaveAttribute('title', 'Камера отключена');
  await expect(b.page.getByRole('alert')).toContainText('Камера отключена или стала недоступна');
  await expect.poll(() => currentTracks(b.page)).toMatchObject({ video: null });

  const borisAtA = await participantItem(a.page, 'Борис');
  await expect(borisAtA.getByRole('img', { name: 'Камера выключена' })).toBeVisible();
  await expect(borisAtA.getByRole('img', { name: 'Микрофон выключен' })).toHaveCount(0);
});

test('ROOM_FULL releases the camera and the microphone of the 5th participant', async ({
  browser,
}) => {
  const members = await Promise.all(Array.from({ length: 4 }, () => newParticipant(browser)));
  const [host, ...guests] = members as [Participant, ...Participant[]];
  const url = await createRoom(host.page, 'Участник 1');
  for (const [index, guest] of guests.entries()) {
    await joinByLink(guest.page, url, `Участник ${index + 2}`);
  }
  await expect(participantList(host.page)).toHaveCount(4);

  const fifth = await newParticipant(browser);
  await openLinkAndSubmitName(fifth.page, url, 'Участник 5');
  await expect(fifth.page.getByRole('heading', { name: 'Комната заполнена' })).toBeVisible();

  // Медиа захватывается до room:join, поэтому треки были созданы — и все остановлены.
  await expect
    .poll(async () =>
      (await createdTracks(fifth.page)).map((t) => `${t.kind}:${t.readyState}`).sort(),
    )
    .toEqual(['audio:ended', 'video:ended']);
  expect(await currentTracks(fifth.page)).toEqual({ audio: null, video: null });
});
