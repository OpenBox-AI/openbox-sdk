export { C as ClientConfig, M as METHOD_PERMISSIONS, a as MissingPermissionError, O as OpenBoxApiError, b as OpenBoxClient } from '../client-C43Hkmge.js';
import '../responses-C2s9PwZF.js';
import '../env-bindings-CCaolEHB.js';

/**
 * Token bucket rate limiter for controlling request throughput.
 */
declare class TokenBucket {
    private tokens;
    private lastRefill;
    private readonly capacity;
    private readonly refillRate;
    constructor(requestsPerSecond: number, burst?: number);
    acquire(): Promise<void>;
    private refill;
}

export { TokenBucket };
