import type { LocalTracks } from '../media/MediaController';
import type { RoomSession } from '../session/RoomSession';

/**
 * Тестовый хук для Playwright (TDD этапа 3 §11.5). Подключается только при VITE_E2E=1:
 * вызов стоит под `import.meta.env.VITE_E2E === '1'`, и в prod-сборке этот модуль вырезается
 * целиком — проверка `npm run check:no-e2e-hook`.
 */

export interface CreatedTrackSnapshot {
  id: string;
  kind: string;
  readyState: MediaStreamTrackState;
}

export interface VcrE2EHook {
  media: {
    /** Живые объекты треков controller'а — E2E может, например, послать им 'ended'. */
    getTracks(): LocalTracks;
    /** Все треки, выданные getUserMedia за жизнь вкладки, включая остановленные. */
    debugCreatedTracks(): CreatedTrackSnapshot[];
  };
}

declare global {
  interface Window {
    __vcr?: VcrE2EHook;
  }
}

type MediaDevicesLike = Pick<MediaDevices, 'getUserMedia'>;

const recorded = new WeakMap<MediaDevicesLike, MediaStreamTrack[]>();

/**
 * Оборачивает getUserMedia и запоминает каждый выданный трек. Идемпотентно: повторный вызов
 * (StrictMode, перемонтирование провайдера) не оборачивает второй раз.
 */
export function recordCreatedTracks(mediaDevices: MediaDevicesLike): MediaStreamTrack[] {
  const existing = recorded.get(mediaDevices);
  if (existing) return existing;

  const tracks: MediaStreamTrack[] = [];
  recorded.set(mediaDevices, tracks);
  const original = mediaDevices.getUserMedia.bind(mediaDevices);
  mediaDevices.getUserMedia = async (constraints) => {
    const stream = await original(constraints);
    tracks.push(...stream.getTracks());
    return stream;
  };
  return tracks;
}

/** Публикует window.__vcr для текущей сессии; возвращает функцию снятия. */
export function installE2EHook(
  session: RoomSession,
  win: Window = window,
  mediaDevices: MediaDevicesLike | undefined = win.navigator.mediaDevices,
): () => void {
  const tracks = mediaDevices ? recordCreatedTracks(mediaDevices) : [];
  const hook: VcrE2EHook = {
    media: {
      getTracks: () => session.media.getTracks(),
      debugCreatedTracks: () =>
        tracks.map(({ id, kind, readyState }) => ({ id, kind, readyState })),
    },
  };
  win.__vcr = hook;
  return () => {
    if (win.__vcr === hook) delete win.__vcr;
  };
}
