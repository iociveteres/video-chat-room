import { defineProject } from 'vitest/config';

// Отдельный конфиг, чтобы тесты не подхватывали dev-сервер из vite.config.ts (SSL, proxy).
export default defineProject({
  test: {
    name: '@vcr/client',
    environment: 'node',
  },
});
