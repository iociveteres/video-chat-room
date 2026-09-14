import { expect, test, type Page } from '@playwright/test';
import { callConfig, expectRemoteVideoPlaying, peerIds } from './helpers/call';
import {
  localVideoSettings,
  MESH_NAMES,
  openMeshRoom,
  participantIds,
  signalCountsByName,
  waitForFullMesh,
  type MeshParticipant,
} from './helpers/mesh';
import { createdTracks, currentTracks } from './helpers/media';
import {
  closeParticipants,
  createRoom,
  newParticipant,
  openLinkAndSubmitName,
} from './helpers/room';

// Проект mesh (playwright.config.ts): один воркер, 120 с на тест, захват 320×180@15.
// Полная комната в mesh (TDD этапа 5 §11.4, сценарии 1–4).
test.afterEach(closeParticipants);

const [ALEX, BORIS, VERA, , DINA] = MESH_NAMES;

function videoGrid(page: Page) {
  return page.getByRole('region', { name: 'Видео' });
}

/** Сетка на count плиток и видео каждого из остальных участников действительно идёт. */
async function expectRemoteTilesPlaying(me: MeshParticipant, others: readonly MeshParticipant[]) {
  await expect(videoGrid(me.page)).toHaveAttribute('data-count', String(others.length + 1));
  for (const other of others) await expectRemoteVideoPlaying(me.page, other.name);
  expect(await peerIds(me.page)).toHaveLength(others.length);
}

test('full room: everyone sees 3 remote tiles with video in a 2×2 grid', async ({ browser }) => {
  const { participants } = await openMeshRoom(browser, 4);

  expect((await callConfig(participants[0]!.page)).videoConstraints).toMatchObject({
    width: { ideal: 320 },
  });
  await waitForFullMesh(participants);

  for (const me of participants) {
    await expectRemoteTilesPlaying(
      me,
      participants.filter((p) => p !== me),
    );
    // Пониженный захват E2E-сборки действительно применился.
    expect((await localVideoSettings(me)).width).toBeLessThanOrEqual(320);
  }
});

test('no glare: offers go only from the earlier to the later participant, one per pair', async ({
  browser,
}) => {
  const { participants } = await openMeshRoom(browser, 4);
  await waitForFullMesh(participants);
  const ids = await participantIds(participants);

  for (const [i, me] of participants.entries()) {
    const counts = await signalCountsByName(me, ids);
    const sent = Object.fromEntries(
      participants
        .filter((p) => p !== me)
        .map((peer) => {
          const { offer, answer } = counts[peer.name] ?? { offer: 0, answer: 0 };
          return [peer.name, { offer, answer }];
        }),
    );
    // A → B, C, D; B → C, D; C → D; D — ни одного offer. Вошедшим раньше — только answer.
    const expected = Object.fromEntries(
      participants
        .map((peer, j) => [peer, j] as const)
        .filter(([peer]) => peer !== me)
        .map(([peer, j]) => [peer.name, j > i ? { offer: 1, answer: 0 } : { offer: 0, answer: 1 }]),
    );
    expect(sent, `signals sent by ${me.name}`).toEqual(expected);
  }
});

test('the 5th participant gets «Комната заполнена» with media released, then gets in after a leave', async ({
  browser,
}) => {
  const { url, participants } = await openMeshRoom(browser, 4);
  const [a, b, c, d] = participants as [
    MeshParticipant,
    MeshParticipant,
    MeshParticipant,
    MeshParticipant,
  ];
  await waitForFullMesh(participants);

  const fifth: MeshParticipant = { ...(await newParticipant(browser)), name: DINA };
  await openLinkAndSubmitName(fifth.page, url, DINA);
  await expect(fifth.page.getByRole('heading', { name: 'Комната заполнена' })).toBeVisible();
  // Медиа захватывается до room:join: треки были созданы — и все остановлены, пар нет.
  await expect
    .poll(async () =>
      (await createdTracks(fifth.page)).map((t) => `${t.kind}:${t.readyState}`).sort(),
    )
    .toEqual(['audio:ended', 'video:ended']);
  expect(await currentTracks(fifth.page)).toEqual({ audio: null, video: null });
  expect(await peerIds(fifth.page)).toEqual([]);

  await b.page.getByRole('button', { name: 'Выйти' }).click();
  await expect(videoGrid(a.page)).toHaveAttribute('data-count', '3');

  await fifth.page.getByRole('button', { name: 'Повторить вход' }).click();
  await expect(fifth.page.getByRole('button', { name: 'Выйти' })).toBeVisible();
  const room = [a, c, d, fifth];
  await waitForFullMesh(room);
  await expectRemoteTilesPlaying(fifth, [a, c, d]);
  await expect(videoGrid(a.page)).toHaveAttribute('data-count', '4');
});

test('simultaneous join: B and C click «Войти» at once, all 3 pairs connect without glare', async ({
  browser,
}) => {
  const a = await newParticipant(browser);
  const url = await createRoom(a.page, ALEX);
  const b = await newParticipant(browser);
  const c = await newParticipant(browser);
  for (const [guest, name] of [
    [b, BORIS],
    [c, VERA],
  ] as const) {
    await guest.page.goto(url);
    await guest.page.getByLabel('Ваше имя').fill(name);
  }

  await Promise.all(
    [b, c].map((guest) => guest.page.getByRole('button', { name: 'Войти' }).click()),
  );

  const participants: MeshParticipant[] = [
    { ...a, name: ALEX },
    { ...b, name: BORIS },
    { ...c, name: VERA },
  ];
  await waitForFullMesh(participants);
  // Кто из двоих вошёл раньше, решил сервер; в любом случае — ровно один offer на пару.
  const ids = await participantIds(participants);
  const offers = new Map<string, number>();
  for (const me of participants) {
    for (const [peer, count] of Object.entries(await signalCountsByName(me, ids))) {
      const pair = [me.name, peer].sort().join('–');
      offers.set(pair, (offers.get(pair) ?? 0) + count.offer);
    }
  }
  expect(Object.fromEntries(offers)).toEqual({
    [[ALEX, BORIS].sort().join('–')]: 1,
    [[ALEX, VERA].sort().join('–')]: 1,
    [[BORIS, VERA].sort().join('–')]: 1,
  });
});
