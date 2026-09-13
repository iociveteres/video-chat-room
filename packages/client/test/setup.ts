import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Без test.globals Testing Library не размонтирует компоненты сама.
afterEach(() => {
  cleanup();
});
