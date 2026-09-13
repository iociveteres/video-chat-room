import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** Участник — отдельный browser context: свои вкладка, сокет и память (как разные люди). */
interface Participant {
  context: BrowserContext;
  page: Page;
}

const openContexts: BrowserContext[] = [];

async function newParticipant(
  browser: Browser,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<Participant> {
  const context = await browser.newContext(options);
  openContexts.push(context);
  return { context, page: await context.newPage() };
}

test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
});

function participantList(page: Page) {
  return page.getByRole('region', { name: /Участники/ }).getByRole('listitem');
}

/** Стартовый экран → «Создать комнату» → комната. Возвращает URL комнаты. */
async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto('/');
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Создать комнату' }).click();
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
  expect(page.url()).toMatch(/\/r\/[A-Za-z0-9_-]{12}$/);
  return page.url();
}

/** Открыть ссылку, ввести имя и нажать «Войти» (результат входа проверяет вызывающий). */
async function openLinkAndSubmitName(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Войти' }).click();
}

async function joinByLink(page: Page, url: string, name: string): Promise<void> {
  await openLinkAndSubmitName(page, url, name);
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
}

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
