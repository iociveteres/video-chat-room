import { defineConfig } from 'vitest/config';

const ALL_METRICS = (percent: number) => ({
  statements: percent,
  branches: percent,
  functions: percent,
  lines: percent,
});

export default defineConfig({
  test: {
    // Каждый пакет — отдельный project; имя берётся из его package.json.
    projects: ['packages/*'],
    // Включается флагом `--coverage` (npm run test:coverage).
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      reporter: ['text-summary', 'html'],
      // Пороги чата (TDD chat-system-messages §11.5) и звонка: падение ниже — ошибка прогона.
      thresholds: {
        'packages/server/src/chat/ChatService.ts': ALL_METRICS(95),
        'packages/server/src/chat/TokenBucket.ts': ALL_METRICS(95),
        'packages/shared/src/validation.ts': ALL_METRICS(95),
        'packages/client/src/state/appReducer.ts': ALL_METRICS(90),
        'packages/client/src/features/chat/**/*.{ts,tsx}': ALL_METRICS(80),
        // Ядро звонка (TDD webrtc-peer-call §11.6): ветки инвариантов I1–I4 покрыты тестами.
        'packages/client/src/call/PeerSession.ts': ALL_METRICS(90),
        'packages/client/src/call/PeerManager.ts': ALL_METRICS(90),
        'packages/server/src/socket/handlers/signal.ts': ALL_METRICS(95),
      },
    },
  },
});
