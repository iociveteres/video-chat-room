import { defineConfig, devices } from '@playwright/test';

// Отдельные порты: E2E не конфликтует с запущенным `npm run dev` (3000 / 5173).
const SERVER_PORT = 3100;
const CLIENT_PORT = 5174;
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}`;

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
      use: {
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
      },
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
    {
      command: `npm -w @vcr/client run dev -- --port ${CLIENT_PORT}`,
      cwd: '..',
      url: CLIENT_URL,
      // VITE_E2E=1 подключает тестовый хук window.__vcr (packages/client/src/app/e2eHook.ts).
      env: { VCR_E2E: '1', VITE_E2E: '1', VCR_SERVER_PORT: String(SERVER_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
