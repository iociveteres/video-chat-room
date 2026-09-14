// Проверяет, что тестовый хук window.__vcr (TDD этапа 3 §12) и DiagnosticsOverlay (TDD этапа 5
// §4.4, §10) не попали в prod-сборку. Запуск: npm run check:no-e2e-hook (сначала собирает клиент
// без VITE_E2E).
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// __vcr — имя хука; qualityLimitationReason — поле getStats, которое читает только диагностика;
// diagnostics — класс оверлея в его JS и CSS.
const MARKERS = ['__vcr', 'qualityLimitationReason', 'diagnostics'];
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
  const content = await readFile(file, 'utf8');
  for (const marker of MARKERS) {
    if (content.includes(marker)) offenders.push(`"${marker}" in ${file}`);
  }
}

if (offenders.length > 0) {
  console.error(`Debug code found in the production build:\n${offenders.join('\n')}`);
  process.exit(1);
}
console.log(`OK: ${MARKERS.map((marker) => `"${marker}"`).join(', ')} not in the production build`);
