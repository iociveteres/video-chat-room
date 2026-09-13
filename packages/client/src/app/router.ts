import { isValidRoomId } from '@vcr/shared';
import { useMemo, useSyncExternalStore } from 'react';

export type Route = { name: 'lobby' } | { name: 'room'; roomId: string } | { name: 'invalid-link' };

const ROOM_PATH = /^\/r\/([^/]+)\/?$/;
/** Сигнал об изменении истории через navigate(): pushState сам popstate не порождает. */
const NAVIGATE_EVENT = 'vcr:navigate';

/**
 * Маршруты: "/" и "/r/:roomId". Всё остальное, включая невалидный id, — некорректная ссылка:
 * комнату с произвольными символами в id не создаём (TDD §14, п. 5).
 */
export function parseRoute(pathname: string): Route {
  if (pathname === '/') return { name: 'lobby' };
  const roomId = ROOM_PATH.exec(pathname)?.[1];
  // Валидный id не содержит символов, требующих percent-encoding, поэтому декодировать не нужно.
  if (roomId !== undefined && isValidRoomId(roomId)) return { name: 'room', roomId };
  return { name: 'invalid-link' };
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

function getPathname(): string {
  return window.location.pathname;
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, getPathname);
  return useMemo(() => parseRoute(pathname), [pathname]);
}

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}
