// Cross-consumer client factory. The CLI, the VS Code / Cursor
// extension, and the iOS app all need the same X-API-Key-authenticated
// `OpenBoxClient` configured against explicit OpenBox service URLs; they
// only differ in where the API key lives (file for CLI/extension,
// SecureStore for mobile, env var for tests).
//
// Pass a `getApiKey` callback. Returning a Promise is fine; keychain
// reads are async on iOS. Throwing or returning empty is treated as
// "no key configured"; the factory rewraps that into a uniform error
// the consumer can show.
//
// Replaces the per-consumer `createApi` / `createApiContext` helpers
// that each lifted Apartment-style copies of the same boot logic.

import { OpenBoxClient } from '../client/index.js';
import { resolveConnection } from '../env/index.js';

export interface ConsumerClientOptions {
  /** Explicit endpoint overrides for endpoint-first/self-hosted consumers. */
  apiUrl?: string;
  coreUrl?: string;
  authUrl?: string;
  platformUrl?: string;
  stackUrl?: string;
  /**
   * Returns the X-API-Key. May be sync or async. Return
   * undefined / empty string to signal "no key configured"; the
   * factory throws a uniform error in that case.
   */
  getApiKey: () => Promise<string | undefined> | string | undefined;
  /**
   * Value sent in the `X-Openbox-Client` header so the backend can
   * attribute traffic to a specific consumer (e.g. "apps/extension",
   * "apps/mobile"). Defaults to "openbox-sdk/client-factory" so an
   * unattributed call still shows up clearly in audit logs.
   */
  clientName?: string;
  /**
   * Override the per-request timeout (ms). Falls back to the SDK's
   * default when omitted; caller should rarely need to set this
   * unless governing operations that block on long approval windows.
   */
  timeoutMs?: number;
}

export interface ConsumerClientContext {
  client: OpenBoxClient;
  /** Resolved API base URL; handy for "Signed in to <apiBase>"
   *  affordances without re-resolving the env. */
  apiBase: string;
}

const DEFAULT_CLIENT_NAME = 'openbox-sdk/client-factory';

/**
 * Build an `OpenBoxClient` for one consumer + explicit URL target. Throws a uniform
 * error when no API key is available so the caller can render the
 * same "set your API key" prompt regardless of which token source
 * they plugged in.
 */
export async function createConsumerClient(
  opts: ConsumerClientOptions,
): Promise<ConsumerClientContext> {
  const connection = resolveConnection({
    apiUrl: opts.apiUrl,
    coreUrl: opts.coreUrl,
    authUrl: opts.authUrl,
    platformUrl: opts.platformUrl,
    stackUrl: opts.stackUrl,
  });
  const apiBase = connection.apiUrl;
  const apiKey = await opts.getApiKey();
  if (!apiKey) {
    throw new Error(
      `OpenBox: no API key configured for the active connection. ` +
        `Run openbox connect <stack-url> --api-key <key> or use your consumer's auth flow.`,
    );
  }
  const client = new OpenBoxClient({
    apiUrl: apiBase,
    apiKey,
    clientName: opts.clientName ?? DEFAULT_CLIENT_NAME,
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
  });
  return { client, apiBase };
}
