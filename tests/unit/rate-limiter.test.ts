import { describe, it, expect } from 'vitest';
import { TokenBucket } from '../../ts/src/client/rate-limiter.js';

describe('TokenBucket', () => {
  it('allows burst of requests up to capacity', async () => {
    const bucket = new TokenBucket(5, 5);

    // Should allow 5 immediate requests
    for (let i = 0; i < 5; i++) {
      await bucket.acquire();
    }
  });

  it('throttles requests beyond capacity', async () => {
    const bucket = new TokenBucket(100, 2);

    // Use up the burst capacity
    await bucket.acquire();
    await bucket.acquire();

    // Third request should be delayed
    const start = Date.now();
    await bucket.acquire();
    const elapsed = Date.now() - start;

    // Should have waited ~10ms (1/100 per second = 10ms per token)
    expect(elapsed).toBeGreaterThanOrEqual(5);
  });

  it('refills tokens over time', async () => {
    const bucket = new TokenBucket(1000, 1);

    // Use the single token
    await bucket.acquire();

    // Wait for refill
    await new Promise((r) => setTimeout(r, 10));

    // Should have refilled by now (1000/s = 10 tokens in 10ms)
    const start = Date.now();
    await bucket.acquire();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5);
  });

  it('defaults burst to requestsPerSecond', async () => {
    const bucket = new TokenBucket(3);

    // Should allow 3 immediate requests (burst = requestsPerSecond)
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
  });

  it('does not exceed capacity on refill', async () => {
    const bucket = new TokenBucket(100, 2);

    // Wait to accumulate tokens
    await new Promise((r) => setTimeout(r, 100));

    // Should still only allow burst capacity immediately
    const start = Date.now();
    await bucket.acquire();
    await bucket.acquire();
    // Third should be delayed even after long wait
    await bucket.acquire();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(5);
  });
});
