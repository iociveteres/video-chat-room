import { expect, test, type Page } from '@playwright/test';
import { closeParticipants, createRoom, joinByLink, newParticipant } from './helpers/room';

test.afterEach(closeParticipants);

function chatLog(page: Page) {
  return page.getByRole('log', { name: 'Сообщения' });
}

function messageInput(page: Page) {
  return page.getByRole('textbox', { name: 'Сообщение' });
}

/** Сообщение ленты, содержащее текст. */
function messageItem(page: Page, text: string) {
  return chatLog(page).getByRole('listitem').filter({ hasText: text });
}

/** Отправляет сообщение Enter'ом и ждёт, пока оно вернётся отправителю broadcast'ом. */
async function sendMessage(page: Page, text: string): Promise<void> {
  await messageInput(page).fill(text);
  await messageInput(page).press('Enter');
  await expect(messageInput(page)).toHaveValue('');
  await expect(messageItem(page, text).last()).toBeVisible();
}

test('the full-height sidebar switches between «Чат» and «Участники» tabs', async ({ browser }) => {
  const a = await newParticipant(browser);
  const b = await newParticipant(browser);
  const url = await createRoom(a.page, 'Алекс');
  await joinByLink(b.page, url, 'Борис');
  const chatTab = a.page.getByRole('tab', { name: 'Чат' });
  const participantsTab = a.page.getByRole('tab', { name: 'Участники (2/4)' });

  await expect(chatTab).toHaveAttribute('aria-selected', 'true');
  await expect(chatLog(a.page)).toBeVisible();
  await messageInput(a.page).fill('черновик');

  // Панель занимает всю высоту окна.
  const sidebar = await a.page.getByRole('complementary').boundingBox();
  const viewport = a.page.viewportSize()!;
  expect(sidebar).toMatchObject({ y: 0, height: viewport.height });

  // Нижние границы шапки комнаты и полосы вкладок — на одной высоте.
  const header = await a.page.getByRole('banner').boundingBox();
  const tablist = await a.page.getByRole('tablist').boundingBox();
  expect(header!.y + header!.height).toBe(tablist!.y + tablist!.height);
  await expect(chatTab).toHaveCSS('box-shadow', /0px -7px 0px 0px inset/);

  await participantsTab.click();
  const participants = a.page.getByRole('tabpanel', { name: /Участники/ });
  await expect(participants.getByRole('listitem')).toHaveText(['Алекс (вы)', 'Борис']);
  await expect(chatLog(a.page)).toBeHidden();

  await chatTab.press('End');
  await expect(participantsTab).toBeFocused();
  await participantsTab.press('Home');
  await expect(chatTab).toHaveAttribute('aria-selected', 'true');
  await expect(messageInput(a.page)).toHaveValue('черновик');
});

test('A writes a message, B sees it with the author name and HH:MM time', async ({ browser }) => {
  const a = await newParticipant(browser);
  const b = await newParticipant(browser);
  const url = await createRoom(a.page, 'Алекс');
  await joinByLink(b.page, url, 'Борис');

  await sendMessage(a.page, 'Привет, Борис!');

  const item = messageItem(b.page, 'Привет, Борис!');
  await expect(item).toBeVisible();
  await expect(item.getByText('Алекс', { exact: true })).toBeVisible();
  await expect(item.locator('time')).toHaveText(/^\d{2}:\d{2}$/);
  // У отправителя то же сообщение помечено как своё.
  await expect(messageItem(a.page, 'Привет, Борис!')).toHaveClass(/message--own/);
  await expect(item).not.toHaveClass(/message--own/);
});

test('XSS: markup in a message is shown as text and never executed', async ({ browser }) => {
  const a = await newParticipant(browser);
  const b = await newParticipant(browser);
  const url = await createRoom(a.page, 'Алекс');
  await joinByLink(b.page, url, 'Борис');
  let dialogOpened = false;
  b.page.on('dialog', (dialog) => {
    dialogOpened = true;
    void dialog.dismiss();
  });

  const payload = '<img src=x onerror="window.__xss=1;alert(1)">';
  await sendMessage(a.page, payload);

  await expect(messageItem(b.page, payload).getByText(payload, { exact: true })).toBeVisible();
  await expect(chatLog(b.page).locator('img')).toHaveCount(0);
  expect(await b.page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
  expect(dialogOpened).toBe(false);
});

test('a late participant sees the history written before joining', async ({ browser }) => {
  const a = await newParticipant(browser);
  const b = await newParticipant(browser);
  const c = await newParticipant(browser);
  const url = await createRoom(a.page, 'Алекс');
  await joinByLink(b.page, url, 'Борис');
  await sendMessage(a.page, 'Первое сообщение');
  await sendMessage(b.page, 'Второе сообщение');

  await joinByLink(c.page, url, 'Вера');

  await expect(chatLog(c.page).getByRole('listitem')).toHaveText([
    /^Алекс присоединился\d{2}:\d{2}$/,
    /^Борис присоединился\d{2}:\d{2}$/,
    /^Алекс\d{2}:\d{2}Первое сообщение$/,
    /^Борис\d{2}:\d{2}Второе сообщение$/,
    /^Вера присоединился\d{2}:\d{2}$/,
  ]);
});

test('system messages: C joins and closes the tab → A sees «присоединился» and «покинул комнату»', async ({
  browser,
}) => {
  const a = await newParticipant(browser);
  const c = await newParticipant(browser);
  const url = await createRoom(a.page, 'Алекс');

  await joinByLink(c.page, url, 'Вера');
  const joined = messageItem(a.page, 'Вера присоединился');
  await expect(joined).toBeVisible();
  await expect(joined.getByText('Вера', { exact: true })).toHaveJSProperty('tagName', 'STRONG');

  await c.page.close();

  await expect(messageItem(a.page, 'Вера покинул комнату')).toBeVisible();
});

test('auto-scrolls to the newest message', async ({ browser }) => {
  // 30 сообщений от двух участников по очереди: у каждого ~1 сообщение в секунду — ниже лимита.
  test.setTimeout(60_000);
  const a = await newParticipant(browser);
  const b = await newParticipant(browser);
  const url = await createRoom(a.page, 'Алекс');
  await joinByLink(b.page, url, 'Борис');

  for (let i = 1; i <= 30; i++) {
    await sendMessage(i % 2 === 1 ? a.page : b.page, `Сообщение №${i}`);
    await a.page.waitForTimeout(550);
  }

  for (const page of [a.page, b.page]) {
    const log = chatLog(page);
    // Лента действительно переполнена, иначе проверка ничего не доказывает.
    expect(await log.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(messageItem(page, 'Сообщение №30')).toBeInViewport();
    await expect(messageItem(page, 'Сообщение №1').first()).not.toBeInViewport();
  }
});

test('an empty message cannot be sent', async ({ browser }) => {
  const a = await newParticipant(browser);
  await createRoom(a.page, 'Алекс');
  const send = a.page.getByRole('button', { name: 'Отправить' });

  await expect(send).toBeDisabled();
  await messageInput(a.page).fill('   \n  ');
  await expect(send).toBeDisabled();
  await messageInput(a.page).press('Enter');
  await expect(chatLog(a.page).getByRole('listitem')).toHaveCount(1); // только «Алекс присоединился»

  await messageInput(a.page).fill('не пусто');
  await expect(send).toBeEnabled();
});

test('Shift+Enter inserts a line break that is kept in the sent message', async ({ browser }) => {
  const a = await newParticipant(browser);
  await createRoom(a.page, 'Алекс');
  const input = messageInput(a.page);

  await input.pressSequentially('строка 1');
  await input.press('Shift+Enter');
  await input.pressSequentially('строка 2');
  await expect(input).toHaveValue('строка 1\nстрока 2');
  await input.press('Enter');

  const text = messageItem(a.page, 'строка 2').locator('p');
  await expect(text).toHaveText('строка 1\nстрока 2', { useInnerText: true });
});

test('a link is clickable, excludes the trailing dot and opens a new tab without opener', async ({
  browser,
}) => {
  const a = await newParticipant(browser);
  const b = await newParticipant(browser);
  const url = await createRoom(a.page, 'Алекс');
  await joinByLink(b.page, url, 'Борис');
  // Внешний сайт подменяем: тест не ходит в интернет.
  const referers: (string | undefined)[] = [];
  await b.context.route('https://example.com/**', async (route) => {
    referers.push((await route.request().headerValue('referer')) ?? undefined);
    await route.fulfill({ contentType: 'text/html', body: '<title>doc</title>ok' });
  });

  await sendMessage(a.page, 'см. https://example.com/doc.');

  const link = messageItem(b.page, 'см. https://example.com/doc.').getByRole('link');
  await expect(link).toHaveText('https://example.com/doc');
  await expect(link).toHaveAttribute('href', 'https://example.com/doc');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');

  const [popup] = await Promise.all([b.context.waitForEvent('page'), link.click()]);
  await popup.waitForLoadState();

  expect(popup.url()).toBe('https://example.com/doc');
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  expect(referers).toEqual([undefined]);
});
