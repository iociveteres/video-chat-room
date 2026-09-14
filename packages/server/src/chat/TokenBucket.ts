export interface TokenBucketOptions {
  /** Максимум токенов и размер допустимого всплеска. */
  capacity: number;
  refillPerSecond: number;
  now?: () => number;
}

/**
 * Антифлуд на участника (TDD §4.2). Бакет стартует полным и пополняется пропорционально
 * прошедшему времени, без таймеров: пересчёт происходит при каждом tryTake().
 */
export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private tokens: number;
  private lastRefillAt: number;

  constructor(opts: TokenBucketOptions) {
    this.capacity = opts.capacity;
    this.refillPerMs = opts.refillPerSecond / 1000;
    this.now = opts.now ?? (() => Date.now());
    this.tokens = opts.capacity;
    this.lastRefillAt = this.now();
  }

  /** Синхронно: пополнить по прошедшему времени и списать 1 токен, если он есть. */
  tryTake(): boolean {
    const now = this.now();
    // Часы могут отойти назад — отрицательный интервал не должен отнимать токены.
    const elapsed = Math.max(0, now - this.lastRefillAt);
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefillAt = now;

    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
