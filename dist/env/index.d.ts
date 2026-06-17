import { e as RuntimeConfig, h as TokenCodec, i as ClientNameResolver } from '../env-bindings-CCaolEHB.js';
export { A as ApiError, B as BackendClientConfig, C as CLIENT_VARIANT_PATTERN, j as CoreClientConfig, a as Credentials, E as ENV_VAR_BINDINGS, F as FeatureMap, O as OS_PATH_FIELDS, b as OsPathResolver, c as OsPathScope, R as RateLimitConfig, d as RetryConfig, T as TokenEntry, f as TokenPair, g as TokenStore, v as validateApiKeyFormat } from '../env-bindings-CCaolEHB.js';
import { A as AgentIdentityConfig } from '../core-client-BaOdHXQU.js';
import '../core-types-Dxgkbox0.js';

interface OpenBoxConnection extends RuntimeConfig {
    source: 'explicit';
}
interface ResolveConnectionOptions {
    apiUrl?: string;
    coreUrl?: string;
    authUrl?: string;
    platformUrl?: string;
}
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

interface AgentIdentitySource {
    OPENBOX_AGENT_DID?: string;
    OPENBOX_AGENT_PRIVATE_KEY?: string;
}
/**
 * Resolve the optional signed agent identity used by Core when an
 * agent has signing_required=true. Both values must be present; a
 * half-configured identity would silently downgrade signed agents
 * back into 401s.
 */
declare function resolveAgentIdentity(source?: AgentIdentitySource): AgentIdentityConfig | undefined;

export { type AgentIdentitySource, type OpenBoxConnection, type ResolveConnectionOptions, RuntimeConfig, buildAuthHeader, parseTokenStore, resolveAgentIdentity, resolveClientName, resolveConnection, serializeTokenStore };
