// Reads `<env>.API_KEY` from the CLI's `~/.openbox/tokens` and builds
// an `OpenBoxClient`. One client per env; rebuilt by extension.ts on
// settings change.

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { OpenBoxClient } from "openbox-sdk/client";
import {
  ENVIRONMENTS,
  parseTokenStore,
  type EnvName,
  type TokenStore,
} from "openbox-sdk/env";

function tokenPath(): string {
  // `.tokens` in cwd wins for local-dev; otherwise the per-OS home-
  // dir path the CLI uses.
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

function loadApiKey(env: EnvName): string {
  const entry = readStore()[env];
  if (!entry?.apiKey) {
    const flag = env === "production" ? "" : `--env ${env} `;
    throw new Error(
      `No X-API-Key for env '${env}'. The OpenBox extension reads the same ` +
        `token store the CLI writes: install + log in via:\n  ` +
        `npm i -g openbox\n  openbox ${flag}auth set-api-key`,
    );
  }
  return entry.apiKey;
}

export function createApi(env: EnvName): OpenBoxClient {
  return createApiContext(env).client;
}

/**
 * Like createApi, but also surfaces the resolved apiBase so the
 * caller can show "Signed in to <apiBase>" in the status bar without
 * re-resolving the env.
 */
export function createApiContext(env: EnvName): {
  client: OpenBoxClient;
  apiBase: string;
} {
  const apiKey = loadApiKey(env);
  const apiBase = ENVIRONMENTS[env].apiUrl;
  const client = new OpenBoxClient({
    apiUrl: apiBase,
    env,
    apiKey,
    clientName: "apps/extension",
  });
  return { client, apiBase };
}
