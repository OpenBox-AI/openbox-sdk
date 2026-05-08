// Env + token + client factory. Backed by openbox-sdk/env so the URL
// table, the env-namespaced KV codec, and the X-Openbox-Client variant
// resolver all stay in sync with the rest of the openbox ecosystem
// instead of being reinvented here.
//
// Public surface preserved for tests:
//   ENV_DEFAULTS  : { production, staging, local } → { api, core }
//   resolveEnv()  : { name, apiUrl, coreUrl }
//   readTokens()  : { access?, refresh?, apiKey? } — at least one of access/apiKey
//   createApi()   : (path, method?, body?) => Promise<unknown>
//
// Auth precedence in createApi(): X-API-Key (`obx_key_*`) wins when present,
// otherwise the Bearer access JWT. The org-level X-API-Key has no
// expiration so it survives JWT staleness; the OAuth path stays available
// for users who only have a sign-in flow.
//
// Plus new:
//   setMcpClientName(name): per-request `runtime/mcp/<name>` header
//                            so we can pass through MCP clientInfo from
//                            the calling LLM tool.

import * as fs from "fs";
import * as path from "path";
import {
  ENVIRONMENTS,
  parseTokenStore,
  resolveClientName,
  buildAuthHeader,
  resolveEnv as resolveEnvName,
  type EnvName,
} from "../../env/index.js";
import { resolveOsPath } from "../../env/os-paths.js";

// Tests import this. Derived from the spec-emitted ENVIRONMENTS table
// instead of being hand-keyed; new env added in TypeSpec flows in
// without an edit.
export const ENV_DEFAULTS: Record<EnvName, { api: string; core: string }> = Object.fromEntries(
  (Object.keys(ENVIRONMENTS) as EnvName[]).map((k) => [
    k,
    { api: ENVIRONMENTS[k].apiUrl, core: ENVIRONMENTS[k].coreUrl },
  ]),
) as Record<EnvName, { api: string; core: string }>;

// Returns the resolved env with effective URLs (env vars override
// the spec-emitted defaults). Validation goes through the SDK's
// resolveEnv so the allowed-names list isn't duplicated here.
export function resolveEnv(envVar: string | undefined = process.env.OPENBOX_ENV) {
  const name = resolveEnvName(envVar);
  return {
    name,
    apiUrl: process.env.OPENBOX_API_URL || ENVIRONMENTS[name].apiUrl,
    coreUrl: process.env.OPENBOX_CORE_URL || ENVIRONMENTS[name].coreUrl,
  };
}

export interface TokenReaderOptions {
  envName?: string;
  tokensPath?: string;
}

// Reads ~/.openbox/tokens (or ./.tokens) via the SDK's parseTokenStore,
// then plucks the env-namespaced entry. Legacy unprefixed tokens are
// migrated by parseTokenStore into store.production, so production reads
// pick them up; non-production envs see no leakage.
export function readTokens(
  opts: TokenReaderOptions = {},
): { access?: string; refresh?: string; apiKey?: string } {
  // Resolve via the SDK so the env-name fallback chain stays in lockstep
  // with the rest of the toolchain (env var → global config → spec default).
  const envName = resolveEnvName(opts.envName || process.env.OPENBOX_ENV);
  let p = opts.tokensPath;
  if (!p) {
    const local = path.resolve(".tokens");
    const home = resolveOsPath("tokens");
    p = fs.existsSync(local) ? local : home;
  }
  if (!fs.existsSync(p)) {
    throw new Error(`No tokens at ${p}. Run: openbox --env ${envName} auth set-api-key`);
  }
  const store = parseTokenStore(fs.readFileSync(p, "utf-8"));
  const entry = store[envName as EnvName];
  if (!entry?.accessToken && !entry?.apiKey) {
    throw new Error(
      `No ${envName} API_KEY in ${p}. Run: openbox --env ${envName} auth set-api-key ` +
        `(mint a key in the dashboard: Organization → API Keys). ` +
        `Mobile/SSO consumers can populate ACCESS_TOKEN via the JWT path; CLI / MCP / IDE / runtime use X-API-Key.`,
    );
  }
  return {
    access: entry.accessToken,
    refresh: entry.refreshToken,
    apiKey: entry.apiKey,
  };
}

// Per-request X-Openbox-Client value. McpServer doesn't know the calling
// LLM tool until after `initialize`, so index.ts updates this once the
// transport connects.
let mcpCallerName: string | undefined;

export function setMcpClientName(name: string | undefined) {
  mcpCallerName = name && name.length > 0 ? name : undefined;
}

function currentClientName(): string {
  // Base 'runtime/mcp' + caller from MCP initialize, then the SDK's
  // OPENBOX_CLIENT_VARIANT pass; order is `<base>/<caller>`.
  const base = mcpCallerName ? `runtime/mcp/${mcpCallerName}` : "runtime/mcp";
  return resolveClientName(base);
}

export function createApi(opts: { envName?: string; tokensPath?: string } = {}) {
  const env = resolveEnv(opts.envName ?? process.env.OPENBOX_ENV);
  let cachedApiKey: string | undefined;
  let cachedAccess: string | undefined;
  try {
    const tok = readTokens({ envName: env.name, tokensPath: opts.tokensPath });
    cachedApiKey = tok.apiKey;
    cachedAccess = tok.access;
  } catch {
    /* defer until first call */
  }

  return async function api(urlPath: string, method = "GET", body?: unknown): Promise<any> {
    if (!cachedApiKey && !cachedAccess) {
      const tok = readTokens({ envName: env.name, tokensPath: opts.tokensPath });
      cachedApiKey = tok.apiKey;
      cachedAccess = tok.access;
    }
    const authHeader = buildAuthHeader({
      apiKey: cachedApiKey,
      accessToken: cachedAccess,
    });
    const res = await fetch(`${env.apiUrl}${urlPath}`, {
      method,
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
        "X-Openbox-Client": currentClientName(),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as any;
    return json?.data ?? json;
  };
}
