# Building a new OpenBox client app

This is the canonical recipe for any new app that talks to OpenBox - VS Code / Cursor extensions, Expo / React Native apps, MCP servers, Tauri tray apps, CLIs. Reference implementations:

- `openbox-cli` (in this repo, `packages/cli/`) - Node CLI
- `openbox-extension` - VS Code / Cursor extension
- `openbox-mobile` - Expo / React Native iOS app
- `openbox-mcp` - MCP server
- `openbox-approver` - Tauri (Rust) tray app

## 1. Install

```jsonc
// package.json (TS clients)
"dependencies": {
  "openbox-sdk": "github:OpenBox-AI/openbox-sdk"
}
```

`npm install` clones the repo, runs the SDK's `prepare` hook (builds workspaces + bundles via tsup), drops `dist/` into `node_modules`. **Not on npm**, so don't try `npm i openbox-sdk` from the registry.

For non-TS clients (Rust, Go, Python): port the env table + token codec from `packages/env/src/environments.json` and `packages/env/src/token-codec.ts`. The Rust port in `openbox-approver/src-tauri/src/env.rs` is the reference.

## 2. Imports

Pick the surface you need; bundlers tree-shake the rest.

```typescript
import { OpenBoxClient } from 'openbox-sdk/client';
import { OpenBoxCoreClient } from 'openbox-sdk/core-client';
import {
  ENVIRONMENTS,
  resolveEnv,
  resolveUrls,
  parseTokenStore,
  serializeTokenStore,
  resolveClientName,
  type EnvName,
} from 'openbox-sdk/env';
import type { Approval, UserProfile } from 'openbox-sdk/types';
```

The root facade `'openbox-sdk'` re-exports everything if you prefer one import.

## 3. Env selection

Three envs supported: `production` | `staging` | `local`. Selection rule - **per consumer convention, not enforced by the SDK**:

| App type | How env is selected |
|---|---|
| CLI (`openbox-cli`) | `--env` flag → `OPENBOX_ENV` env var → `production` |
| MCP server (`openbox-mcp-*`) | `OPENBOX_ENV` env var → `production` |
| VS Code / Cursor extension | `openbox.environment` setting (gated to dev mode) → `production` |
| Expo / RN mobile | `selectedEnv` in SecureStore (UI gated to `__DEV__`) → `production` |
| Tauri / native app | `OPENBOX_ENV` env var → `production` |

Always default to `production` when nothing is set. Always hard-fail on unknown env names - silent fallback to production while echoing the bogus name is a footgun.

## 4. Token storage

Tokens live in `~/.openbox/tokens` (or project-local `.tokens` for dev), env-namespaced KV format:

```
production.ACCESS_TOKEN=...
production.REFRESH_TOKEN=...
production.UPDATED_AT=...
staging.ACCESS_TOKEN=...
local.ACCESS_TOKEN=...
```

Use `parseTokenStore(content)` and `serializeTokenStore(store)` from `'openbox-sdk/env'` - don't reinvent the parser. The codec migrates legacy unprefixed entries (pre-multi-env CLI installs) into `production.*` automatically.

For platforms without a shared filesystem (mobile uses iOS Keychain via `expo-secure-store`, browser extensions use `chrome.storage`, etc.) - keep the env-namespaced key convention but swap the storage backend. Reference: `openbox-mobile/src/auth/tokens.ts`.

## 5. Build the client

```typescript
const env = await resolveSelectedEnv(); // however your app selects
const tokens = loadTokens(env);

const client = new OpenBoxClient({
  apiUrl: ENVIRONMENTS[env].apiUrl,
  env,
  accessToken: tokens.accessToken,
  refreshToken: tokens.refreshToken,
  clientName: 'openbox-<your-app>',
  onTokenRefresh: ({ accessToken, refreshToken }) => {
    // Persist back to your env-namespaced storage. SDK passes
    // refreshToken=undefined when Keycloak rotation is off - preserve
    // the existing one in that case.
    saveTokens(env, accessToken, refreshToken);
  },
});
```

## 6. The `X-Openbox-Client` header

Backend's auth guard is presence-only - any value passes. The value is purely a telemetry dimension. Set `clientName` to your app's identifier (`openbox-extension`, `openbox-mobile`, `openbox-mcp`, `openbox-approver`, ...).

`OPENBOX_CLIENT_VARIANT` in the environment auto-suffixes the value (e.g. `openbox-cli/claude-code`) so backend logs can distinguish skill-driven traffic from human use. Honored automatically by `OpenBoxClient` - you don't have to wire it.

For MCP servers, read `mcp.server.getClientVersion()?.name` after `server.connect()` and feed it into a per-request `X-Openbox-Client: openbox-mcp/<caller>` header. Reference: `openbox-mcp/src/config.ts:setMcpClientName`.

## 7. Env switcher UI - dev only

If your app exposes a UI to switch environments, gate it behind dev mode:

| Platform | Gate |
|---|---|
| React Native / Expo | `if (__DEV__) { ... }` |
| VS Code extension | `enablement: "openbox.devMode"` on the command, set context from `vscode.ExtensionMode.Development` in `activate()` |
| Tauri / Rust | `#[cfg(debug_assertions)] { ... }` |

End users on a release build should never see a way to point the app at staging - they'll just confuse themselves with wrong-env data. Reference: `openbox-mobile/app/(tabs)/profile/index.tsx` and `openbox-extension/src/extension.ts`.

## 8. Don't reinvent

- **Env table**: `ENVIRONMENTS` from `'openbox-sdk/env'` is the source of truth. If you need it in non-TS code, port from `packages/env/src/environments.json` and document the manual sync.
- **Token codec**: `parseTokenStore` / `serializeTokenStore`. Don't write your own KV parser - the legacy migration logic is non-obvious and matters.
- **HTTP**: `OpenBoxClient.request()` handles retries, timeouts, the auth header, the envelope unwrap, and (eventually) reactive token refresh. Don't shell out to `fetch` unless you have a concrete reason.
- **Approval flow**: `client.getProfile()`, `client.listAgents(query)`, `client.getOrgApprovals(orgId, query)`, `client.decideApproval(agentId, eventId, action)`. Don't construct paths by hand.
