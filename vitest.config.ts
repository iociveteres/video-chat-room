import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Каждый пакет — отдельный project; имя берётся из его package.json.
    projects: ['packages/*'],
  },
});
