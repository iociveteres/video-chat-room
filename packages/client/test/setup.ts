import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom не умеет воспроизводить медиа: play() только пишет «Not implemented» в консоль
// и не возвращает Promise. Подменяем на успешный no-op; тесты могут шпионить за ним.
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true,
  writable: true,
  value: () => Promise.resolve(),
});

// Без test.globals Testing Library не размонтирует компоненты сама.
afterEach(() => {
  cleanup();
});
