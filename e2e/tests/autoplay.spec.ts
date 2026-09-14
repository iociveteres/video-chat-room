import { expect, test } from '@playwright/test';
import { blockFirstUnmutedPlay, expectRemoteVideoPlaying, remoteTile } from './helpers/call';
import { closeParticipants, createRoom, joinByLink, newParticipant } from './helpers/room';

test.afterEach(closeParticipants);

test('autoplay blocked → banner; «Включить звук» resumes the remote video and hides the banner', async ({
  browser,
}) => {
  const a = await newParticipant(browser);
  const b = await newParticipant(browser);
  await blockFirstUnmutedPlay(b.page);
  const url = await createRoom(a.page, 'Алекс');
  await joinByLink(b.page, url, 'Борис');

  const banner = b.page.getByRole('region', { name: 'Звук заблокирован' });
  await expect(banner).toContainText('Браузер заблокировал воспроизведение звука', {
    timeout: 15_000,
  });
  const video = remoteTile(b.page, 'Алекс').locator('video');
  expect(await video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
  // У A политика не срабатывала — баннера нет.
  await expect(a.page.getByRole('region', { name: 'Звук заблокирован' })).toHaveCount(0);

  await banner.getByRole('button', { name: 'Включить звук' }).click();

  await expect(banner).toHaveCount(0);
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(false);
  expect(await video.evaluate((el: HTMLVideoElement) => el.muted)).toBe(false);
  await expectRemoteVideoPlaying(b.page, 'Алекс');
});
