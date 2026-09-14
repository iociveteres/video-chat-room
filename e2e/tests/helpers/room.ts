import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** Участник — отдельный browser context: свои вкладка, сокет и память (как разные люди). */
export interface Participant {
  context: BrowserContext;
  page: Page;
}

const openContexts: BrowserContext[] = [];

export async function newParticipant(
  browser: Browser,
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<Participant> {
  const context = await browser.newContext(options);
  openContexts.push(context);
  return { context, page: await context.newPage() };
}

/** Закрывает все контексты, созданные newParticipant; вызывать в test.afterEach. */
export async function closeParticipants(): Promise<void> {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
}

/**
 * Элементы списка участников. Список живёт во вкладке «Участники», которая по умолчанию скрыта
 * (открыт чат), поэтому локатор включает скрытые элементы; toHaveText читает textContent.
 */
export function participantList(page: Page) {
  return page
    .getByRole('tabpanel', { name: /Участники/, includeHidden: true })
    .getByRole('listitem', { includeHidden: true });
}

/** Стартовый экран → «Создать комнату» → комната. Возвращает URL комнаты. */
export async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto('/');
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Создать комнату' }).click();
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
  expect(page.url()).toMatch(/\/r\/[A-Za-z0-9_-]{12}$/);
  return page.url();
}

/** Открыть ссылку, ввести имя и нажать «Войти» (результат входа проверяет вызывающий). */
export async function openLinkAndSubmitName(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Войти' }).click();
}

export async function joinByLink(page: Page, url: string, name: string): Promise<void> {
  await openLinkAndSubmitName(page, url, name);
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
}
