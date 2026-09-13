import { describe, expect, it } from 'vitest';

describe('@vcr/shared', () => {
  it('loads the package entry point', async () => {
    await expect(import('../src/index')).resolves.toBeTypeOf('object');
  });
});
