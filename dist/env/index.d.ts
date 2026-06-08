import { e as RuntimeConfig, h as TokenCodec, i as ClientNameResolver } from '../env-bindings--BxVwc6f.js';
export { A as ApiError, B as BackendClientConfig, C as CLIENT_VARIANT_PATTERN, j as CoreClientConfig, a as Credentials, E as ENV_VAR_BINDINGS, F as FeatureMap, O as OS_PATH_FIELDS, b as OsPathResolver, c as OsPathScope, R as RateLimitConfig, d as RetryConfig, T as TokenEntry, f as TokenPair, g as TokenStore, v as validateApiKeyFormat } from '../env-bindings--BxVwc6f.js';

interface StackEndpoints {
    apiUrl: string;
    coreUrl: string;
    authUrl?: string;
    platformUrl?: string;
}
interface OpenBoxConnection extends StackEndpoints {
    stackUrl?: string;
    displayName?: string;
    source: 'explicit' | 'stack-url';
}
interface ResolveConnectionOptions {
    stackUrl?: string;
    apiUrl?: string;
    coreUrl?: string;
    authUrl?: string;
    platformUrl?: string;
    displayName?: string;
}
declare function normalizeStackUrl(raw: string): string;
declare function endpointsFromStackUrl(raw: string): StackEndpoints;
declare const resolveConnection: (opts?: ResolveConnectionOptions) => OpenBoxConnection & RuntimeConfig;

declare const parseTokenStore: TokenCodec['parseTokenStore'];
declare const serializeTokenStore: TokenCodec['serializeTokenStore'];

declare const resolveClientName: ClientNameResolver['resolveClientName'];

/**
 * Build the Authorization-or-X-API-Key header object for a backend
 * request. The shape matches what `fetch`'s `headers` option expects.
 *
 * @returns
 *   - `{ 'X-API-Key': apiKey }` when `apiKey` is set
 *   - `{ Authorization: 'Bearer <token>' }` when only `accessToken` is set
 *   - `{}` when neither is set (caller decides what to do; usually 401)
 */
declare function buildAuthHeader(creds: {
    apiKey?: string;
    accessToken?: string;
}): Record<string, string>;

export { type OpenBoxConnection, type ResolveConnectionOptions, RuntimeConfig, type StackEndpoints, buildAuthHeader, endpointsFromStackUrl, normalizeStackUrl, parseTokenStore, resolveClientName, resolveConnection, serializeTokenStore };
