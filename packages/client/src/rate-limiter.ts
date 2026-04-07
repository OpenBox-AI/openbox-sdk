/**
 * Token bucket rate limiter for controlling request throughput.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per ms

  constructor(requestsPerSecond: number, burst?: number) {
    this.capacity = burst ?? requestsPerSecond;
    this.tokens = this.capacity;
    this.refillRate = requestsPerSecond / 1000;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = (1 - this.tokens) / this.refillRate;
    return new Promise((resolve) => {
      setTimeout(() => {
        this.refill();
        this.tokens -= 1;
        resolve();
      }, waitMs);
    });
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}
