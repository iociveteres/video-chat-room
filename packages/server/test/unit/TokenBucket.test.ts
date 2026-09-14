import { describe, expect, it } from 'vitest';
import { TokenBucket } from '../../src/chat/TokenBucket';

function createBucket(opts: { capacity?: number; refillPerSecond?: number } = {}) {
  let clock = 1_000_000;
  const bucket = new TokenBucket({
    capacity: opts.capacity ?? 5,
    refillPerSecond: opts.refillPerSecond ?? 1,
    now: () => clock,
  });
  const take = (count: number) => Array.from({ length: count }, () => bucket.tryTake());
  return {
    bucket,
    take,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('TokenBucket', () => {
  it('starts full: 5 takes succeed, the 6th fails', () => {
    const { take } = createBucket();
    expect(take(6)).toEqual([true, true, true, true, true, false]);
  });

  it('refills one token per second', () => {
    const { take, advance } = createBucket();
    take(5);

    advance(1_000);

    expect(take(2)).toEqual([true, false]);
  });

  it('accumulates partial refills', () => {
    const { take, advance } = createBucket();
    take(5);

    advance(500);
    expect(take(1)).toEqual([false]);
    advance(500);
    expect(take(1)).toEqual([true]);
  });

  it('does not accumulate more than capacity', () => {
    const { take, advance } = createBucket();
    take(5);

    advance(60 * 60 * 1_000);

    expect(take(6)).toEqual([true, true, true, true, true, false]);
  });

  it('honours a custom capacity and refill rate', () => {
    const { take, advance } = createBucket({ capacity: 2, refillPerSecond: 4 });
    expect(take(3)).toEqual([true, true, false]);

    advance(250);

    expect(take(2)).toEqual([true, false]);
  });

  it('does not lose tokens when the clock goes backwards', () => {
    const { take, advance } = createBucket();
    take(4);

    advance(-10_000);
    expect(take(1)).toEqual([true]);
    advance(1_000);
    expect(take(2)).toEqual([true, false]);
  });

  it('keeps a steady rate of one message per second under flood', () => {
    const { bucket, advance } = createBucket();
    let accepted = 0;
    // 100 попыток в секунду в течение 10 секунд: всплеск 5 + по одному в секунду.
    for (let elapsed = 0; elapsed <= 10_000; elapsed += 10) {
      if (bucket.tryTake()) accepted += 1;
      advance(10);
    }
    // Дробные пополнения копятся в float, поэтому последний токен может не успеть.
    expect(accepted).toBeGreaterThanOrEqual(5 + 9);
    expect(accepted).toBeLessThanOrEqual(5 + 10);
  });
});
