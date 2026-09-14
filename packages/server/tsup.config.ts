import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // @vcr/shared экспортирует TS-исходники без сборки, поэтому вшиваем его в бандл.
  noExternal: ['@vcr/shared'],
});
