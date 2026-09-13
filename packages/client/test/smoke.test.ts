import { describe, expect, it } from 'vitest';

describe('@vcr/client', () => {
  it('loads the package entry point', async () => {
    await expect(import('../src/index')).resolves.toBeTypeOf('object');
  });

  it('resolves @vcr/shared from TS sources via the workspace', async () => {
    await expect(import('@vcr/shared')).resolves.toBeTypeOf('object');
  });
});
