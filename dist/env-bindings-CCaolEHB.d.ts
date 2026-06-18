declare const ENV_VAR_BINDINGS: {
    readonly apiUrl: {
        readonly name: "OPENBOX_API_URL";
    };
    readonly coreUrl: {
        readonly name: "OPENBOX_CORE_URL";
    };
    readonly platformUrl: {
        readonly name: "OPENBOX_PLATFORM_URL";
    };
    readonly authUrl: {
        readonly name: "OPENBOX_AUTH_URL";
    };
    readonly apiKey: {
        readonly name: "OPENBOX_API_KEY";
    };
};
declare function validateApiKeyFormat(value: string): true | string;
declare const OS_PATH_FIELDS: readonly ["path"];
interface RuntimeConfig {
    apiUrl: string;
    coreUrl: string;
    platformUrl?: string;
    authUrl?: string;
}
interface Credentials {
    path: string;
    apiKey: string;
}
interface TokenEntry {
    accessToken?: string;
    refreshToken?: string;
    apiKey?: string;
    updatedAt?: string;
    permissions?: string[];
    features?: Record<string, boolean>;
}
interface TokenStore {
    accessToken?: string;
    refreshToken?: string;
    apiKey?: string;
    updatedAt?: string;
    permissions?: string[];
    features?: Record<string, boolean>;
}
type FeatureMap = NonNullable<TokenEntry['features']>;
interface RetryConfig {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
}
interface RateLimitConfig {
    requestsPerSecond: number;
    burst?: number;
}
interface TokenPair {
    accessToken: string;
    refreshToken?: string;
}
interface BackendClientConfig {
    apiUrl?: string;
    accessToken?: string;
    refreshToken?: string;
    apiKey?: string;
    clientName?: string;
    timeoutMs?: number;
    retry?: RetryConfig;
    rateLimit?: RateLimitConfig;
    permissions?: string[];
}
interface CoreClientConfig {
    apiUrl?: string;
    apiKey: string;
    timeoutMs?: number;
    retry?: RetryConfig;
    rateLimit?: RateLimitConfig;
}
interface ApiError {
    message: string;
    status: number;
    body: unknown;
}
interface TokenCodec {
    parseTokenStore(content: string): TokenStore;
    serializeTokenStore(store: TokenStore): string;
}
interface ClientNameResolver {
    resolveClientName(base: string, variant?: string): string;
}
interface OsPathResolver {
    resolveOsPath(scope: OsPathScope): string;
}
type OsPathScope = "tokens" | "config" | "cache" | "agent-keys";
declare const CLIENT_VARIANT_PATTERN: RegExp;

export { type ApiError as A, type BackendClientConfig as B, CLIENT_VARIANT_PATTERN as C, ENV_VAR_BINDINGS as E, type FeatureMap as F, OS_PATH_FIELDS as O, type RateLimitConfig as R, type TokenEntry as T, type Credentials as a, type OsPathResolver as b, type OsPathScope as c, type RetryConfig as d, type RuntimeConfig as e, type TokenPair as f, type TokenStore as g, type TokenCodec as h, type ClientNameResolver as i, type CoreClientConfig as j, validateApiKeyFormat as v };
