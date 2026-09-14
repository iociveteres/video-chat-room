import { expect, type Page } from '@playwright/test';

/** Форма этапа 4 в window.__vcr (packages/client/src/app/e2eHook.ts): e2e не импортирует типы клиента. */
interface VcrPeersWindow {
  __vcr: {
    peers: {
      ids(): string[];
      getStats(participantId: string): Promise<Record<string, unknown>[] | null>;
    };
    debug: {
      signalCounts(): Record<string, { offer: number; answer: number; candidate: number }>;
    };
  };
}

export interface InboundRtp {
  bytesReceived: number;
  framesDecoded: number;
}

export function remoteTile(page: Page, name: string) {
  return page.getByRole('figure', { name });
}

export function peerIds(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as VcrPeersWindow).__vcr.peers.ids());
}

/** Единственный пир на вкладке (звонок двух участников). */
export async function onlyPeerId(page: Page): Promise<string> {
  await expect.poll(() => peerIds(page)).toHaveLength(1);
  return (await peerIds(page))[0]!;
}

export function signalCounts(page: Page) {
  return page.evaluate(() => (window as unknown as VcrPeersWindow).__vcr.debug.signalCounts());
}

/** inbound-rtp нужного kind из getStats() пира; нули, если потока ещё нет. */
export async function inboundRtp(
  page: Page,
  peerId: string,
  kind: 'audio' | 'video',
): Promise<InboundRtp> {
  const stats = await page.evaluate(
    (id) => (window as unknown as VcrPeersWindow).__vcr.peers.getStats(id),
    peerId,
  );
  const inbound = (stats ?? []).find((s) => s.type === 'inbound-rtp' && s.kind === kind);
  return {
    bytesReceived: Number(inbound?.bytesReceived ?? 0),
    framesDecoded: Number(inbound?.framesDecoded ?? 0),
  };
}

/** Метрика растёт: второй замер через intervalMs больше первого. */
export async function expectGrowing(
  measure: () => Promise<number>,
  intervalMs = 2_000,
): Promise<void> {
  // Первые пакеты могут прийти не сразу после connected: ждём, пока поток пойдёт.
  await expect.poll(measure, { timeout: 10_000 }).toBeGreaterThan(0);
  const before = await measure();
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
  expect(await measure()).toBeGreaterThan(before);
}

/** Метрика стоит: за intervalMs не меняется (после паузы на уже отправленные кадры). */
export async function expectStalled(
  measure: () => Promise<number>,
  intervalMs = 1_500,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const before = await measure();
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
  expect(await measure()).toBe(before);
}

/** Удалённое видео действительно воспроизводится: есть размер кадра и идёт время. */
export async function expectRemoteVideoPlaying(page: Page, name: string): Promise<void> {
  const video = remoteTile(page, name).locator('video');
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.videoWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const before = await video.evaluate((el: HTMLVideoElement) => el.currentTime);
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(before);
  await expect(remoteTile(page, name).locator('.avatar-placeholder')).toBeHidden();
}

/**
 * Камеры «нет», пока тест не вызовет attachCamera(): getUserMedia с video отклоняется
 * NotFoundError, остальное — как обычно. Ставится до загрузки приложения.
 */
export async function detachCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cameraAttached: boolean };
    w.__cameraAttached = false;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) =>
      constraints?.video && !w.__cameraAttached
        ? Promise.reject(new DOMException('Requested device not found', 'NotFoundError'))
        : original(constraints);
  });
}

export function attachCamera(page: Page): Promise<void> {
  return page.evaluate(() => {
    (window as unknown as { __cameraAttached: boolean }).__cameraAttached = true;
  });
}
