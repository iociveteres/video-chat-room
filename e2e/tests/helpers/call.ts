import { expect, type Page } from '@playwright/test';

export interface PeerSummary {
  participantId: string;
  role: 'offerer' | 'answerer';
  status: 'connecting' | 'connected' | 'unstable' | 'failed' | 'closed';
}

export type SignalCounts = Record<string, { offer: number; answer: number; candidate: number }>;

/** Форма этапов 4–5 в window.__vcr (packages/client/src/app/e2eHook.ts): e2e не импортирует типы клиента. */
export interface VcrPeersWindow {
  __vcr: {
    peers: {
      ids(): string[];
      summary(): PeerSummary[];
      getStats(participantId: string): Promise<Record<string, unknown>[] | null>;
    };
    debug: {
      signalCounts(): SignalCounts;
      callConfig(): {
        rtc: RTCConfiguration;
        connectTimeoutMs: number;
        videoConstraints: Record<string, { ideal?: number; max?: number }>;
      };
    };
  };
}

/** Конфигурация звонка, с которой собран клиент на этой вкладке. */
export function callConfig(page: Page) {
  return page.evaluate(() => (window as unknown as VcrPeersWindow).__vcr.debug.callConfig());
}

/** Статистика пира как есть: массив словарей RTCStats. */
export async function peerStats(page: Page, peerId: string): Promise<Record<string, unknown>[]> {
  const stats = await page.evaluate(
    (id) => (window as unknown as VcrPeersWindow).__vcr.peers.getStats(id),
    peerId,
  );
  return stats ?? [];
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
  const stats = await peerStats(page, peerId);
  const inbound = stats.find((s) => s.type === 'inbound-rtp' && s.kind === kind);
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

/**
 * Autoplay-политика без жеста пользователя: первый play() элемента со звуком отклоняется
 * NotAllowedError, а сам элемент ставится на паузу — атрибут autoplay не запустит его в обход
 * (pause() снимает флаг autoplaying). Беззвучный self-view политика пропускает.
 */
export async function blockFirstUnmutedPlay(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Вызывается через original.call(this) — привязка к элементу сохраняется.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = HTMLMediaElement.prototype.play;
    let blocked = false;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!blocked && !this.muted) {
        blocked = true;
        this.pause();
        return Promise.reject(new DOMException('play() without a user gesture', 'NotAllowedError'));
      }
      return original.call(this);
    };
  });
}
