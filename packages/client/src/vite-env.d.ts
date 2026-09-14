/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' — сборка для E2E: подключается тестовый хук window.__vcr (см. app/e2eHook.ts). */
  readonly VITE_E2E?: string;
  /** JSON-массив RTCIceServer; не задан или невалиден — Google STUN ×2 (см. call/rtcConfig.ts). */
  readonly VITE_ICE_SERVERS?: string;
  /** 'relay' — только для E2E-сценария «ICE failed»; иначе 'all'. */
  readonly VITE_ICE_TRANSPORT_POLICY?: string;
  /** Таймаут медиасоединения в мс; по умолчанию PEER_CONNECT_TIMEOUT_MS. Короткий — для E2E. */
  readonly VITE_PEER_CONNECT_TIMEOUT_MS?: string;
}
