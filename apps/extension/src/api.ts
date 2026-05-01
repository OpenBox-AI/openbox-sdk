// Thin extension-side adapter around OpenBoxClient. The SDK handles HTTP +
// retries + the X-Openbox-Client header; we own:
//   - reading env-namespaced tokens from ~/.openbox/tokens (the same file the
//     `openbox` CLI writes), so logging in via CLI works for both
//   - writing refreshed tokens back to the right env namespace
//
// One client instance per env. extension.ts rebuilds when the user switches
// envs via VS Code settings.

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { OpenBoxClient } from "openbox-sdk/client";
import {
  ENVIRONMENTS,
  parseTokenStore,
  serializeTokenStore,
  type EnvName,
  type TokenStore,
} from "openbox-sdk/env";

function tokenPath(): string {
  // Mirror the CLI: prefer `.tokens` in cwd if it exists, else
  // `~/.openbox/tokens`. The `.tokens` override is mainly for local-dev
  // scratch use; production users land on the home-dir path.
  const local = path.resolve(".tokens");
  if (fs.existsSync(local)) return local;
  const dir = path.join(os.homedir(), ".openbox");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "tokens");
}

function readStore(): TokenStore {
  const p = tokenPath();
  if (!fs.existsSync(p)) return {};
  return parseTokenStore(fs.readFileSync(p, "utf-8"));
}

function loadTokens(env: EnvName): { accessToken: string; refreshToken?: string } {
  const entry = readStore()[env];
  if (!entry?.accessToken) {
    throw new Error(
      `No tokens for env '${env}'. Run: openbox --env ${env} auth login`,
    );
  }
  return { accessToken: entry.accessToken, refreshToken: entry.refreshToken };
}

function persistTokens(env: EnvName, accessToken: string, refreshToken: string | undefined) {
  const store = readStore();
  const existing = store[env] ?? {};
  store[env] = {
    accessToken,
    // When the backend doesn't rotate the refresh token, the SDK passes
    // undefined; keep the previously-stored value rather than clobber it.
    refreshToken: refreshToken ?? existing.refreshToken,
    updatedAt: new Date().toISOString(),
    permissions: existing.permissions,
    features: existing.features,
  };
  fs.writeFileSync(tokenPath(), serializeTokenStore(store));
}

export function createApi(env: EnvName): OpenBoxClient {
  return createApiContext(env).client;
}

/**
 * Like createApi, but also surfaces the resolved apiBase + the raw
 * accessToken so the WS realtime path can reuse the same auth/host
 * without re-loading tokens or re-resolving env. PollingService takes
 * just the client; RealtimeService takes all three.
 */
export function createApiContext(env: EnvName): {
  client: OpenBoxClient;
  accessToken: string;
  apiBase: string;
} {
  const tokens = loadTokens(env);
  const apiBase = ENVIRONMENTS[env].apiUrl;
  const client = new OpenBoxClient({
    apiUrl: apiBase,
    env,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    clientName: "openbox-extension",
    onTokenRefresh: ({ accessToken, refreshToken }) => {
      persistTokens(env, accessToken, refreshToken);
    },
  });
  return { client, accessToken: tokens.accessToken, apiBase };
}
