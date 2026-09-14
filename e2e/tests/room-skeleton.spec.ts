import { expect, test } from '@playwright/test';
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

test('A creates a room, B joins by link, both see two participants', async ({ browser }) => {
  const a = await newParticipant(browser);
  const b = await newParticipant(browser);

  const url = await createRoom(a.page, 'Алекс');
  await joinByLink(b.page, url, 'Борис');

  await expect(participantList(a.page)).toHaveText(['Алекс (вы)', 'Борис']);
  await expect(participantList(b.page)).toHaveText(['Алекс', 'Борис (вы)']);
});

test('the 5th participant sees «Комната заполнена» and gets in after someone leaves', async ({
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

  await guests[0]!.page.getByRole('button', { name: 'Выйти' }).click();
  await expect(participantList(host.page)).toHaveCount(3);

  await fifth.page.getByRole('button', { name: 'Повторить вход' }).click();
  await expect(fifth.page.getByRole('button', { name: 'Выйти' })).toBeVisible();
  await expect(participantList(fifth.page)).toHaveText([
    'Участник 1',
    'Участник 3',
    'Участник 4',
    'Участник 5 (вы)',
  ]);
  await expect(participantList(host.page)).toHaveCount(4);
});

test('when B closes the page, A sees the updated list within 2 seconds', async ({ browser }) => {
  const a = await newParticipant(browser);
  const b = await newParticipant(browser);
  const url = await createRoom(a.page, 'Алекс');
  await joinByLink(b.page, url, 'Борис');
  await expect(participantList(a.page)).toHaveCount(2);

  await b.page.close();

  await expect(participantList(a.page)).toHaveText(['Алекс (вы)'], { timeout: 2_000 });
});

test('shows «Сервер недоступен» when Socket.io requests fail', async ({ browser }) => {
  const a = await newParticipant(browser);
  await a.page.route('**/socket.io/**', (route) => route.abort());

  await a.page.goto('/');
  await a.page.getByLabel('Ваше имя').fill('Алекс');
  await a.page.getByRole('button', { name: 'Создать комнату' }).click();

  await expect(a.page.getByRole('heading', { name: 'Сервер недоступен' })).toBeVisible();
  await expect(a.page.getByRole('button', { name: 'Повторить' })).toBeVisible();
});

test('«Скопировать ссылку» puts the room URL into the clipboard', async ({ browser }) => {
  const a = await newParticipant(browser, {
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const url = await createRoom(a.page, 'Алекс');

  await a.page.getByRole('button', { name: 'Скопировать ссылку' }).click();

  await expect(a.page.getByRole('status')).toHaveText('Ссылка скопирована');
  expect(await a.page.evaluate(() => navigator.clipboard.readText())).toBe(url);
});
