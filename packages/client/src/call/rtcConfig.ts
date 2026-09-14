/** Публичные Google STUN: TURN нет, недостижимость отдельной пары допустима (PRD §7). */
export const DEFAULT_ICE_SERVERS: readonly RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

export type RtcEnv = Pick<ImportMetaEnv, 'VITE_ICE_SERVERS' | 'VITE_ICE_TRANSPORT_POLICY'>;

/** Конфигурация RTCPeerConnection из переменных сборки (TDD этапа 4 §4.3, §12). */
export function getRtcConfiguration(env: RtcEnv = import.meta.env): RTCConfiguration {
  return {
    // Копия: RTCConfiguration уходит в браузер и не должна делить объекты с константой.
    iceServers:
      parseIceServers(env.VITE_ICE_SERVERS) ??
      DEFAULT_ICE_SERVERS.map((server) => ({ ...server, urls: [...server.urls] })),
    // relay без TURN не соединится никогда — нужно только E2E-сценарию «ICE failed».
    iceTransportPolicy: env.VITE_ICE_TRANSPORT_POLICY === 'relay' ? 'relay' : 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  };
}

/**
 * JSON-массив RTCIceServer из VITE_ICE_SERVERS. null — переменная не задана или невалидна:
 * вызывающий подставит дефолт. Пустой массив валиден и означает «только host-кандидаты».
 */
export function parseIceServers(raw: string | undefined): RTCIceServer[] | null {
  if (raw === undefined || raw.trim() === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    console.warn('VITE_ICE_SERVERS is not valid JSON, using the default STUN servers');
    return null;
  }
  if (!Array.isArray(value) || !value.every(isIceServer)) {
    console.warn(
      'VITE_ICE_SERVERS is not an array of RTCIceServer, using the default STUN servers',
    );
    return null;
  }
  return value.map(({ urls, username, credential }) => ({
    urls,
    ...(username !== undefined && { username }),
    ...(credential !== undefined && { credential }),
  }));
}

function isIceServer(value: unknown): value is RTCIceServer {
  if (typeof value !== 'object' || value === null) return false;
  const { urls, username, credential } = value as Record<string, unknown>;
  const validUrls =
    (typeof urls === 'string' && urls !== '') ||
    (Array.isArray(urls) &&
      urls.length > 0 &&
      urls.every((url) => typeof url === 'string' && url !== ''));
  return (
    validUrls &&
    (username === undefined || typeof username === 'string') &&
    (credential === undefined || typeof credential === 'string')
  );
}
