import { expect, test } from '@playwright/test';
import { callConfig, remoteTile } from '../helpers/call';
import { closeParticipants, createRoom, joinByLink, newParticipant } from '../helpers/room';

// Проект chromium-ice-relay: iceTransportPolicy=relay без TURN и таймаут соединения 3 с (FR-34).
test.afterEach(closeParticipants);

test('ICE cannot connect → «Не удалось установить медиасоединение» after the timeout, chat still works', async ({
  browser,
}) => {
  const a = await newParticipant(browser);
  const b = await newParticipant(browser);
  const url = await createRoom(a.page, 'Алекс');
  expect(await callConfig(a.page)).toMatchObject({
    rtc: { iceTransportPolicy: 'relay' },
    connectTimeoutMs: 3_000,
  });

  await joinByLink(b.page, url, 'Борис');

  await expect(remoteTile(a.page, 'Борис')).toContainText('Подключение…');
  for (const [page, name] of [
    [a.page, 'Борис'],
    [b.page, 'Алекс'],
  ] as const) {
    await expect(remoteTile(page, name)).toContainText('Не удалось установить медиасоединение', {
      timeout: 10_000,
    });
  }

  // Пара без медиа, но комната работает: участник в списке, чат доставляет сообщения.
  await b.page.getByRole('tab', { name: 'Участники (2/4)' }).click();
  await expect(
    b.page.getByRole('tabpanel', { name: /Участники/ }).getByRole('listitem'),
  ).toHaveText(['Алекс', 'Борис (вы)']);
  await b.page.getByRole('tab', { name: 'Чат' }).click();
  const input = b.page.getByRole('textbox', { name: 'Сообщение' });
  await input.fill('Видео не работает, пишу в чат');
  await input.press('Enter');
  await expect(
    a.page.getByRole('log', { name: 'Сообщения' }).getByText('Видео не работает, пишу в чат'),
  ).toBeVisible();
});
