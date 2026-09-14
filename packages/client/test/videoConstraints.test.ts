import { VIDEO_CONSTRAINTS } from '@vcr/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVideoConstraints } from '../src/media/videoConstraints';

afterEach(() => {
  vi.restoreAllMocks();
});

const env = (raw: string | undefined) => ({ VITE_VIDEO_CONSTRAINTS: raw });

describe('getVideoConstraints', () => {
  it.each([undefined, '', '  '])(
    'unset %j → a copy of VIDEO_CONSTRAINTS without warning',
    (raw) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const constraints = getVideoConstraints(env(raw));

      expect(constraints).toEqual(VIDEO_CONSTRAINTS);
      expect(constraints).not.toBe(VIDEO_CONSTRAINTS);
      expect(constraints.width).not.toBe(VIDEO_CONSTRAINTS.width);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('parses width, height and frameRate ranges', () => {
    const low = { width: { ideal: 320 }, height: { ideal: 180, max: 240 }, frameRate: { max: 15 } };

    expect(getVideoConstraints(env(JSON.stringify(low)))).toEqual(low);
  });

  it.each([
    ['not JSON', '{width:'],
    ['an array', '[]'],
    ['an empty object', '{}'],
    ['an unknown key', '{"facingMode":{"ideal":1}}'],
    ['a non-object range', '{"width":320}'],
    ['an empty range', '{"width":{}}'],
    ['an unknown range key', '{"width":{"exact":320}}'],
    ['a non-positive number', '{"width":{"ideal":0}}'],
    ['a string number', '{"width":{"ideal":"320"}}'],
  ])('%s → default with a warning', (_label, raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(getVideoConstraints(env(raw))).toEqual(VIDEO_CONSTRAINTS);
    expect(warn).toHaveBeenCalledOnce();
  });
});
