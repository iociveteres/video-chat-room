import { defineConfig, devices } from '@playwright/test';

// Отдельные порты: E2E не конфликтует с запущенным `npm run dev` (3000 / 5173).
const SERVER_PORT = 3100;
const CLIENT_PORT = 5174;
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}`;

/** Недостижимый STUN: порт discard на loopback, ответа не будет (TDD этапа 4 §11.4, FR-34). */
const UNREACHABLE_STUN = '[{"urls":"stun:127.0.0.1:9"}]';

/**
 * Клиенты с другим env сборки (TDD этапа 4 §11.4, §12): VITE_* вшиваются при старте Vite,
 * поэтому каждому сценарию ICE — свой dev-сервер, свой порт и свой Playwright-проект.
 * Сервер (сигналинг) у всех общий.
 */
const ICE_CLIENTS = [
  {
    project: 'chromium-stun-unreachable',
    spec: /ice[\\/]stun-unreachable\.spec\.ts/,
    port: 5175,
    env: { VITE_ICE_SERVERS: UNREACHABLE_STUN },
  },
  {
    project: 'chromium-ice-relay',
    spec: /ice[\\/]relay-failed\.spec\.ts/,
    port: 5176,
    // relay без TURN не соединится никогда; таймаут укорочен с 20 с до 3 с.
    env: {
      VITE_ICE_SERVERS: UNREACHABLE_STUN,
      VITE_ICE_TRANSPORT_POLICY: 'relay',
      VITE_PEER_CONNECT_TIMEOUT_MS: '3000',
    },
  },
] as const;

/**
 * Комната из 4–5 участников (TDD этапа 5 §11.4): до 5 вкладок с fake-камерой на одной машине,
 * поэтому захват понижен до 320×180@15. Свой dev-сервер: env сборки задаётся при старте Vite.
 */
const MESH_CLIENT = {
  project: 'mesh',
  spec: /mesh-\d+\.spec\.ts/,
  port: 5177,
  env: {
    VITE_VIDEO_CONSTRAINTS: JSON.stringify({
      width: { ideal: 320 },
      height: { ideal: 180 },
      frameRate: { ideal: 15, max: 15 },
    }),
  },
} as const;

const chromiumUse = {
  ...devices['Desktop Chrome'],
  // По умолчанию — Chromium из `npx playwright install chromium`.
  // PW_CHANNEL=chrome или msedge запускает установленный в системе браузер.
  channel: process.env.PW_CHANNEL,
  launchOptions: {
    // Фейковые камера и микрофон, запрос разрешения подтверждается автоматически.
    // Без mDNS host-кандидаты — обычные IP: звонок между контекстами идёт по loopback
    // без резолва *.local (TDD этапа 4 §11.4).
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
    ],
  },
};

const firefoxProject = {
  name: 'firefox',
  grep: /@firefox/,
  use: {
    ...devices['Desktop Firefox'],
    launchOptions: {
      firefoxUserPrefs: {
        'media.navigator.streams.fake': true,
        'media.navigator.permission.disabled': true,
      },
    },
  },
};

/** Dev-сервер клиента для E2E; VITE_E2E=1 подключает хук window.__vcr (app/e2eHook.ts). */
function clientServer(port: number, env: Record<string, string> = {}, cacheDir?: string) {
  return {
    command: `npm -w @vcr/client run dev -- --port ${port}`,
    cwd: '..',
    url: `http://127.0.0.1:${port}`,
    env: {
      VCR_E2E: '1',
      VITE_E2E: '1',
      VCR_SERVER_PORT: String(SERVER_PORT),
      ...(cacheDir ? { VCR_VITE_CACHE_DIR: cacheDir } : {}),
      ...env,
    },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  };
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  // Тесты создают много сокетов на одном сервере — последовательный прогон стабильнее.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // Loopback по http — secure context, сертификат не нужен.
    baseURL: CLIENT_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // Сценарии ICE и mesh требуют своего env сборки и идут в собственных проектах.
      testIgnore: [/[\\/]ice[\\/]/, MESH_CLIENT.spec],
      use: chromiumUse,
    },
    ...ICE_CLIENTS.map(({ project, spec, port }) => ({
      name: project,
      testMatch: spec,
      use: { ...chromiumUse, baseURL: `http://127.0.0.1:${port}` },
    })),
    {
      name: MESH_CLIENT.project,
      testMatch: MESH_CLIENT.spec,
      // 4–5 браузерных контекстов с медиа тяжёлые: по одному тесту и с запасом по времени.
      workers: 1,
      timeout: 120_000,
      use: { ...chromiumUse, baseURL: `http://127.0.0.1:${MESH_CLIENT.port}` },
    },
    // Should (TDD этапа 3 §11.5): сценарии локального медиа с тегом @firefox во втором движке.
    // Включается PW_FIREFOX=1; нужен `npx playwright install firefox`.
    ...(process.env.PW_FIREFOX === '1' ? [firefoxProject] : []),
  ],
  webServer: [
    {
      command: 'npx tsx packages/server/src/index.ts',
      cwd: '..',
      url: `http://127.0.0.1:${SERVER_PORT}/healthz`,
      env: { PORT: String(SERVER_PORT), HOST: '127.0.0.1', LOG_LEVEL: 'warn' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    clientServer(CLIENT_PORT),
    ...[...ICE_CLIENTS, MESH_CLIENT].map(({ project, port, env }) =>
      clientServer(port, env, `node_modules/.vite-e2e-${project}`),
    ),
  ],
});
