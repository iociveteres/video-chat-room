// Проверяет, что тестовый хук window.__vcr не попал в prod-сборку (TDD этапа 3 §12).
// Запуск: npm run check:no-e2e-hook (сначала собирает клиент без VITE_E2E).
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = '__vcr';
const distDir = fileURLToPath(new URL('../dist/', import.meta.url));

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}

const offenders = [];
for await (const file of files(distDir)) {
  if ((await readFile(file, 'utf8')).includes(MARKER)) offenders.push(file);
}

if (offenders.length > 0) {
  console.error(`"${MARKER}" found in the production build:\n${offenders.join('\n')}`);
  process.exit(1);
}
console.log(`OK: "${MARKER}" is not in the production build`);
