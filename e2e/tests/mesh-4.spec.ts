import { expect, test, type Page } from '@playwright/test';
import {
  callConfig,
  expectGrowing,
  expectRemoteVideoPlaying,
  inboundRtp,
  peerIds,
  remoteTile,
} from './helpers/call';
import {
  joinMeshRoom,
  localVideoSettings,
  MESH_NAMES,
  openMeshRoom,
  participantIds,
  peerSummary,
  signalCountsByName,
  waitForFullMesh,
  type MeshParticipant,
} from './helpers/mesh';
import { createdTracks, currentTracks, deviceToggle } from './helpers/media';
import {
  closeParticipants,
  createRoom,
  newParticipant,
  openLinkAndSubmitName,
} from './helpers/room';

// Проект mesh (playwright.config.ts): один воркер, 120 с на тест, захват 320×180@15.
// Полная комната в mesh (TDD этапа 5 §11.4, сценарии 1–4).
test.afterEach(closeParticipants);

const [ALEX, BORIS, VERA, GLEB, DINA] = MESH_NAMES;

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

// Изоляция отказов и сетка (TDD этапа 5 §11.4, сценарии 5–8).

/** Всего offer, отправленных участниками комнаты: новые offer означали бы ренеготиацию. */
async function totalOffers(participants: readonly MeshParticipant[], ids: Record<string, string>) {
  let total = 0;
  for (const me of participants) {
    for (const count of Object.values(await signalCountsByName(me, ids))) total += count.offer;
  }
  return total;
}

function idOf(ids: Record<string, string>, name: string): string {
  const id = ids[name];
  if (!id) throw new Error(`Unknown participant ${name}`);
  return id;
}

test('C leaves from the middle: the other three keep their pairs, no renegotiation', async ({
  browser,
}) => {
  const { participants } = await openMeshRoom(browser, 4);
  const [a, b, c, d] = participants as [
    MeshParticipant,
    MeshParticipant,
    MeshParticipant,
    MeshParticipant,
  ];
  await waitForFullMesh(participants);
  const ids = await participantIds(participants);
  const rest = [a, b, d];
  const offersBefore = await totalOffers(rest, ids);

  await c.page.close();

  for (const me of rest) {
    await expect(videoGrid(me.page)).toHaveAttribute('data-count', '3', { timeout: 2_000 });
    await expect(remoteTile(me.page, VERA)).toHaveCount(0);
  }
  for (const [me, peer] of [
    [a, b],
    [a, d],
    [b, d],
  ] as const) {
    await expectGrowing(
      async () => (await inboundRtp(me.page, idOf(ids, peer.name), 'video')).bytesReceived,
    );
  }
  await waitForFullMesh(rest);
  expect(await totalOffers(rest, ids)).toBe(offersBefore);
});

test('camera off and on at A: B, C and D show the placeholder, then decode again without new offers', async ({
  browser,
}) => {
  const { participants } = await openMeshRoom(browser, 4);
  const [a, ...others] = participants as [MeshParticipant, ...MeshParticipant[]];
  await waitForFullMesh(participants);
  const ids = await participantIds(participants);
  const offersBefore = await totalOffers(participants, ids);
  const aId = idOf(ids, ALEX);

  await deviceToggle(a.page, 'Камера').click();
  for (const me of others) {
    await expect(remoteTile(me.page, ALEX)).toContainText('Камера выключена', { timeout: 2_000 });
  }

  await deviceToggle(a.page, 'Камера').click();
  for (const me of others) {
    await expectRemoteVideoPlaying(me.page, ALEX);
    await expectGrowing(async () => (await inboundRtp(me.page, aId, 'video')).framesDecoded);
  }
  expect(await totalOffers(participants, ids)).toBe(offersBefore);
});

test('one broken pair: only C and D see «Не удалось установить медиасоединение» for each other', async ({
  browser,
}) => {
  // Порядок входа A, B, D, C: следующее соединение D — именно пара с C.
  const { url, participants: first } = await openMeshRoom(browser, 3, [ALEX, BORIS, GLEB]);
  const [a, b, d] = first as [MeshParticipant, MeshParticipant, MeshParticipant];
  await waitForFullMesh(first);
  await d.page.evaluate(() => {
    const Native = window.RTCPeerConnection;
    const w = window as unknown as { __relayNextPeerConnection?: boolean };
    w.__relayNextPeerConnection = true;
    // relay без TURN не соединится никогда: пара C–D уйдёт в failed по таймауту соединения.
    window.RTCPeerConnection = class extends Native {
      constructor(config?: RTCConfiguration) {
        const relay = w.__relayNextPeerConnection === true;
        w.__relayNextPeerConnection = false;
        super(relay ? { ...config, iceTransportPolicy: 'relay' } : config);
      }
    };
  });
  const c = await joinMeshRoom(browser, url, VERA);
  const participants = [a, b, c, d];
  const ids = await participantIds(participants);

  const FAILED = 'Не удалось установить медиасоединение';
  // PEER_CONNECT_TIMEOUT_MS — 20 с.
  await expect(remoteTile(c.page, GLEB)).toContainText(FAILED, { timeout: 30_000 });
  await expect(remoteTile(d.page, VERA)).toContainText(FAILED, { timeout: 10_000 });

  const statusOf = async (me: MeshParticipant, peer: string) =>
    (await peerSummary(me)).find((p) => p.participantId === idOf(ids, peer))?.status;
  expect(await statusOf(c, GLEB)).toBe('failed');
  expect(await statusOf(d, VERA)).toBe('failed');
  // Остальные 5 пар живы с обеих сторон.
  const healthyPairs: [MeshParticipant, MeshParticipant][] = [
    [a, b],
    [a, c],
    [a, d],
    [b, c],
    [b, d],
  ];
  const directions = healthyPairs.flatMap(([p, q]): [MeshParticipant, MeshParticipant][] => [
    [p, q],
    [q, p],
  ]);
  for (const [x, y] of directions) {
    expect(await statusOf(x, y.name), `${x.name} → ${y.name}`).toBe('connected');
    await expect(remoteTile(x.page, y.name)).not.toContainText(FAILED);
  }
});

test('grid layout for 1–4 participants at 1024 and 1440 px', async ({ browser }) => {
  const WIDTHS = [
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ];
  const { url, participants } = await openMeshRoom(browser, 1);
  const [a] = participants as [MeshParticipant];
  // Кадры fake-камеры меняются: видео скрыто, сравниваются раскладка, фон, рамки и подписи.
  // Не mask: маска закрыла бы и подписи с подсказкой, лежащие поверх <video>.
  await a.page.addStyleTag({ content: '.video-grid video { opacity: 0 !important; }' });

  for (const name of [BORIS, VERA, GLEB, undefined]) {
    const room = participants.slice();
    if (room.length > 1) await waitForFullMesh(room);
    for (const other of room.slice(1)) await expectRemoteVideoPlaying(a.page, other.name);

    for (const viewport of WIDTHS) {
      await a.page.setViewportSize(viewport);
      await expect(videoGrid(a.page)).toHaveScreenshot(
        `grid-${room.length}-${viewport.width}.png`,
        { animations: 'disabled' },
      );
    }
    if (name) participants.push(await joinMeshRoom(browser, url, name));
  }
});
