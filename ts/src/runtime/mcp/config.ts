import * as fs from "fs";
import * as path from "path";
import {
  parseTokenStore,
  resolveClientName,
  buildAuthHeader,
  resolveConnection,
} from "../../env/index.js";
import { resolveOsPath } from "../../env/os-paths.js";

export interface TokenReaderOptions {
  tokensPath?: string;
}

export function readTokens(
  opts: TokenReaderOptions = {},
): { access?: string; refresh?: string; apiKey?: string } {
  let tokenPath = opts.tokensPath;
  if (!tokenPath) {
    const local = path.resolve(".tokens");
    const home = resolveOsPath("tokens");
    tokenPath = fs.existsSync(local) ? local : home;
  }
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`No tokens at ${tokenPath}. Run: openbox auth set-api-key`);
  }
  const store = parseTokenStore(fs.readFileSync(tokenPath, "utf-8"));
  if (!store.accessToken && !store.apiKey) {
    throw new Error(
      `No API_KEY in ${tokenPath}. Run: openbox auth set-api-key ` +
        `(mint a key in the dashboard: Organization -> API Keys). ` +
        `Mobile/SSO consumers can populate ACCESS_TOKEN via the JWT path; CLI / MCP / IDE / runtime use X-API-Key.`,
    );
  }
  return {
    access: store.accessToken,
    refresh: store.refreshToken,
    apiKey: store.apiKey,
  };
}

let mcpCallerName: string | undefined;

export function setMcpClientName(name: string | undefined) {
  mcpCallerName = name && name.length > 0 ? name : undefined;
}

function currentClientName(): string {
  const base = mcpCallerName ? `runtime/mcp/${mcpCallerName}` : "runtime/mcp";
  return resolveClientName(base);
}

export function createApi(opts: { tokensPath?: string } = {}) {
  const connection = resolveConnection();
  let cachedApiKey: string | undefined;
  let cachedAccess: string | undefined;
  try {
    const tokens = readTokens({ tokensPath: opts.tokensPath });
    cachedApiKey = tokens.apiKey;
    cachedAccess = tokens.access;
  } catch {
    /* defer until first call */
  }

  return async function api(urlPath: string, method = "GET", body?: unknown): Promise<unknown> {
    if (!cachedApiKey && !cachedAccess) {
      const tokens = readTokens({ tokensPath: opts.tokensPath });
      cachedApiKey = tokens.apiKey;
      cachedAccess = tokens.access;
    }
    const authHeader = buildAuthHeader({
      apiKey: cachedApiKey,
      accessToken: cachedAccess,
    });
    const response = await fetch(`${connection.apiUrl}${urlPath}`, {
      method,
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
        "X-Openbox-Client": currentClientName(),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
    const json = (await response.json()) as { data?: unknown };
    return json?.data ?? json;
  };
}
