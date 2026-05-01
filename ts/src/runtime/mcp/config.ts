// Env + token + client factory. Backed by openbox-sdk/env so the URL
// table, the env-namespaced KV codec, and the X-Openbox-Client variant
// resolver all stay in sync with the rest of the openbox ecosystem
// instead of being reinvented here.
//
// Public surface preserved for tests:
//   ENV_DEFAULTS  : { production, staging, local } → { api, core }
//   resolveEnv()  : { name, apiUrl, coreUrl }
//   readTokens()  : { access, refresh? }
//   createApi()   : (path, method?, body?) => Promise<unknown>
//
// Plus new:
//   setMcpClientName(name): per-request `runtime/mcp/<name>` header
//                            so we can pass through MCP clientInfo from
//                            the calling LLM tool.

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  ENVIRONMENTS,
  parseTokenStore,
  resolveClientName,
  type EnvName,
} from "../../env/index.js";

// Tests import this. Same shape as before, sourced from the SDK.
export const ENV_DEFAULTS: Record<EnvName, { api: string; core: string }> = {
  production: { api: ENVIRONMENTS.production.apiUrl, core: ENVIRONMENTS.production.coreUrl },
  staging:    { api: ENVIRONMENTS.staging.apiUrl,    core: ENVIRONMENTS.staging.coreUrl },
  local:      { api: ENVIRONMENTS.local.apiUrl,      core: ENVIRONMENTS.local.coreUrl },
};

const VALID: readonly EnvName[] = ["production", "staging", "local"];

// Returns the same object shape this module always returned. Unknown names
// hard-fail (we used to silently fall back to production URLs while
// returning the bogus name; a footgun for misconfigured installs).
export function resolveEnv(envVar: string | undefined = process.env.OPENBOX_ENV) {
  const raw = (envVar || "production").toLowerCase();
  if (!VALID.includes(raw as EnvName)) {
    throw new Error(
      `Unknown OPENBOX_ENV='${raw}'. Use 'production', 'staging', or 'local'.`,
    );
  }
  const name = raw as EnvName;
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
export function readTokens(opts: TokenReaderOptions = {}): { access: string; refresh?: string } {
  const envName = (opts.envName || process.env.OPENBOX_ENV || "production").toLowerCase();
  let p = opts.tokensPath;
  if (!p) {
    const local = path.resolve(".tokens");
    const home = path.join(os.homedir(), ".openbox", "tokens");
    p = fs.existsSync(local) ? local : home;
  }
  if (!fs.existsSync(p)) {
    throw new Error(`No tokens at ${p}. Run: openbox --env ${envName} auth login`);
  }
  const store = parseTokenStore(fs.readFileSync(p, "utf-8"));
  const entry = store[envName as EnvName];
  if (!entry?.accessToken) {
    throw new Error(
      `No ${envName} ACCESS_TOKEN in ${p}. Run: openbox --env ${envName} auth login`,
    );
  }
  return { access: entry.accessToken, refresh: entry.refreshToken };
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
  let cachedToken = "";
  try {
    cachedToken = readTokens({ envName: env.name, tokensPath: opts.tokensPath }).access;
  } catch {
    /* defer until first call */
  }

  return async function api(urlPath: string, method = "GET", body?: unknown): Promise<any> {
    if (!cachedToken) {
      cachedToken = readTokens({ envName: env.name, tokensPath: opts.tokensPath }).access;
    }
    const res = await fetch(`${env.apiUrl}${urlPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${cachedToken}`,
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
