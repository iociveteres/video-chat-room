/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' — сборка для E2E: подключается тестовый хук window.__vcr (см. app/e2eHook.ts). */
  readonly VITE_E2E?: string;
}
