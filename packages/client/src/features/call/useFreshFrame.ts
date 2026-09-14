import { useEffect, useState, type RefObject } from 'react';

/** Страховка: кадр не пришёл (вкладка в фоне, особенности браузера) — показываем как есть. */
export const FRESH_FRAME_TIMEOUT_MS = 1_000;

function supportsVideoFrameCallback(): boolean {
  return (
    typeof HTMLVideoElement !== 'undefined' &&
    'requestVideoFrameCallback' in HTMLVideoElement.prototype
  );
}

/**
 * TDD этапа 4 §4.8, TBD-5. После перехода wantVideo в true ждёт новый кадр
 * (requestVideoFrameCallback) и только тогда возвращает true. Иначе на долю секунды виден
 * «замёрзший» кадр, оставшийся в <video> с момента выключения камеры собеседником.
 * Без поддержки rVFC — true сразу.
 */
export function useFreshFrame(
  videoRef: RefObject<HTMLVideoElement | null>,
  wantVideo: boolean,
): boolean {
  const [fresh, setFresh] = useState(false);
  const [prevWant, setPrevWant] = useState(wantVideo);
  // Сброс при каждом новом включении — во время рендера, без лишнего кадра со старым значением.
  if (prevWant !== wantVideo) {
    setPrevWant(wantVideo);
    setFresh(false);
  }

  const supported = supportsVideoFrameCallback();

  useEffect(() => {
    const el = videoRef.current;
    if (!wantVideo || !supported || !el) return undefined;
    const handle = el.requestVideoFrameCallback(() => setFresh(true));
    const timer = setTimeout(() => setFresh(true), FRESH_FRAME_TIMEOUT_MS);
    return () => {
      el.cancelVideoFrameCallback(handle);
      clearTimeout(timer);
    };
  }, [videoRef, wantVideo, supported]);

  return wantVideo && (!supported || fresh);
}
