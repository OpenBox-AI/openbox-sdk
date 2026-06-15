export { OpenBoxClient, OpenBoxApiError } from './client.js';
export type { ClientConfig } from './client.js';
export { TokenBucket } from './rate-limiter.js';
export {
  METHOD_PERMISSIONS,
  MissingPermissionError,
} from './generated/wrapper-methods.js';

// `RetryConfig` and `RateLimitConfig` are spec-driven; import them from
// `@openbox-ai/openbox-sdk/env`. They're not re-exported here because the SDK's root
// index.ts gets them via `@openbox-ai/openbox-sdk/env` already, and double-exporting
// them from `@openbox-ai/openbox-sdk/client` would cause a `export *` collision.
