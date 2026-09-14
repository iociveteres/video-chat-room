import { describe, expect, it } from 'vitest';
import type { DeviceStatus } from '../src/media/MediaController';
import { acquireNotice, deviceStatusLabel } from '../src/media/mediaTexts';

describe('deviceStatusLabel', () => {
  it.each([
    ['video', 'acquiring', 'Включаем камеру…'],
    ['video', 'off', 'Камера выключена'],
    ['video', 'denied', 'Нет доступа к камере'],
    ['video', 'not-found', 'Камера не найдена'],
    ['video', 'busy', 'Камера занята другим приложением'],
    ['video', 'lost', 'Камера отключена'],
    ['video', 'failed', 'Не удалось включить камеру'],
    ['audio', 'acquiring', 'Включаем микрофон…'],
    ['audio', 'off', 'Микрофон выключен'],
    ['audio', 'denied', 'Нет доступа к микрофону'],
    ['audio', 'not-found', 'Микрофон не найден'],
    ['audio', 'busy', 'Микрофон занят другим приложением'],
    ['audio', 'lost', 'Микрофон отключён'],
    ['audio', 'failed', 'Не удалось включить микрофон'],
  ] as const)('%s %s → «%s»', (kind, status, label) => {
    expect(deviceStatusLabel(kind, status)).toBe(label);
  });
});

describe('acquireNotice', () => {
  it.each<[DeviceStatus, DeviceStatus, string, 'info' | 'error']>([
    ['on', 'not-found', 'Камера не найдена — вы в комнате без видео', 'info'],
    ['not-found', 'on', 'Микрофон не найден — вы в комнате без звука', 'info'],
    [
      'not-found',
      'not-found',
      'Камера и микрофон не найдены — вы в комнате без видео и звука',
      'info',
    ],
    [
      'denied',
      'denied',
      'Нет доступа к камере и микрофону — вы в комнате без видео и звука',
      'error',
    ],
    [
      'busy',
      'busy',
      'Камера и микрофон заняты другим приложением — вы в комнате без видео и звука',
      'error',
    ],
    [
      'failed',
      'failed',
      'Не удалось включить камеру и микрофон — вы в комнате без видео и звука',
      'error',
    ],
    ['on', 'busy', 'Камера занята другим приложением — вы в комнате без видео', 'error'],
    ['denied', 'on', 'Нет доступа к микрофону — вы в комнате без звука', 'error'],
    ['denied', 'busy', 'Нет доступа к микрофону. Камера занята другим приложением.', 'error'],
    ['not-found', 'denied', 'Микрофон не найден. Нет доступа к камере.', 'error'],
  ])('audio=%s video=%s → «%s» (%s)', (audio, video, text, tone) => {
    expect(acquireNotice({ audio, video })).toEqual({ text, tone });
  });

  it.each<[DeviceStatus, DeviceStatus]>([
    ['on', 'on'],
    ['off', 'on'],
    ['off', 'off'],
  ])('audio=%s video=%s → no notice', (audio, video) => {
    expect(acquireNotice({ audio, video })).toBeNull();
  });
});
