import { expect, type Page } from '@playwright/test';

/** Снимок трека из window.__vcr (packages/client/src/app/e2eHook.ts). */
export interface TrackSnapshot {
  id: string;
  kind: string;
  readyState: string;
}

/** Минимальная форма хука: e2e не импортирует типы клиента. */
interface VcrWindow {
  __vcr: {
    media: {
      getTracks(): { audio: MediaStreamTrack | null; video: MediaStreamTrack | null };
      debugCreatedTracks(): TrackSnapshot[];
    };
  };
}

/** Все треки, выданные getUserMedia на этой вкладке (в том числе остановленные). */
export function createdTracks(page: Page, kind?: 'audio' | 'video'): Promise<TrackSnapshot[]> {
  return page.evaluate((k) => {
    const all = (window as unknown as VcrWindow).__vcr.media.debugCreatedTracks();
    return k ? all.filter((track) => track.kind === k) : all;
  }, kind);
}

/** Текущие треки controller'а: id и readyState, null — трека нет. */
export function currentTracks(page: Page) {
  return page.evaluate(() => {
    const { audio, video } = (window as unknown as VcrWindow).__vcr.media.getTracks();
    const snap = (t: MediaStreamTrack | null) => t && { id: t.id, readyState: t.readyState };
    return { audio: snap(audio), video: snap(video) };
  });
}

/** Внешнее завершение трека, как при отключении устройства. */
export function dispatchVideoEnded(page: Page): Promise<void> {
  return page.evaluate(() => {
    const track = (window as unknown as VcrWindow).__vcr.media.getTracks().video;
    if (!track) throw new Error('no video track');
    track.dispatchEvent(new Event('ended'));
  });
}

export function deviceToggle(page: Page, name: 'Микрофон' | 'Камера') {
  return page.getByRole('toolbar', { name: 'Управление звонком' }).getByRole('button', { name });
}

export function selfTile(page: Page) {
  return page.getByRole('figure', { name: 'Вы' });
}

/** Ждёт, пока self-view начнёт показывать кадры fake-камеры. */
export async function expectSelfVideoPlaying(page: Page): Promise<void> {
  const video = selfTile(page).locator('video');
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.videoWidth))
    .toBeGreaterThan(0);
}

/** Пункт списка участников по имени; открывает вкладку «Участники». */
export async function participantItem(page: Page, name: string) {
  await page.getByRole('tab', { name: /Участники/ }).click();
  return page.getByRole('list').getByRole('listitem').filter({ hasText: name });
}

/** Подменяет getUserMedia до загрузки приложения: браузер отказывает в доступе. */
export async function denyMediaAccess(page: Page): Promise<void> {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
}

/** Устройств нет вовсе; window.__gumCalls считает вызовы getUserMedia. */
export async function removeAllDevices(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __gumCalls: number };
    w.__gumCalls = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = () => Promise.resolve([]);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      w.__gumCalls += 1;
      return original(constraints);
    };
  });
}
