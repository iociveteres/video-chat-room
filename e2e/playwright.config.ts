import { defineConfig, devices } from '@playwright/test';

// Отдельные порты: E2E не конфликтует с запущенным `npm run dev` (3000 / 5173).
const SERVER_PORT = 3100;
const CLIENT_PORT = 5174;
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}`;

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
      },
    },
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
      env: { VCR_E2E: '1', VCR_SERVER_PORT: String(SERVER_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
