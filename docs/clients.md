# Building a new OpenBox client app

Canonical recipe for any new app that talks to OpenBox: VS Code or
Cursor extensions, Expo and React Native apps, MCP servers, Tauri tray
apps, CLIs. The protocol is language-agnostic; pick the SDK for your
language and follow the same shape.

## Spec-first contract

Every wire shape, env binding, token-codec rule, and CLI flag here
comes from `specs/typespec/` and `specs/environments.json`. Each
language SDK regenerates its bindings from that spec, so this guide
applies regardless of stack. Examples are in TypeScript because that
is the reference implementation. The names map directly to the same
artifacts in sibling language SDKs.

Reference implementations in this repo:

- `ts/src/cli/`: the `openbox` CLI on Node.
- `apps/extension/`: VS Code and Cursor extension on TypeScript.
- `ts/src/runtime/mcp/`: MCP server runtime on TypeScript, invoked via
  `openbox mcp serve`.
- `rust/`: Rust crate. Wire client today, full SDK in flight.

## 1. Install

```jsonc
// package.json for TS clients
"dependencies": {
  "openbox-sdk": "github:OpenBox-AI/openbox-sdk"
}
```

`npm install` clones the repo, runs the SDK's `prepare` hook to build
workspaces and bundle via tsup, and drops `dist/` into `node_modules`.
The package is not on npm; do not try `npm i openbox-sdk` from the
registry.

For non-TS clients, regenerate from the same TypeSpec source. The
language emitter under `codegen/emitters/typespec-emitter-<lang>/`
writes a native bindings package; the SDK's runtime layer consumes it.
`specs/environments.json` is the canonical env table every language
reads at runtime. `specs/typespec/env/main.tsp` declares the
token-codec semantics: env-namespaced keys, `obx_live_*` and
`obx_test_*` runtime-key formats, `obx_key_*` org-key format, and OS
path resolution.

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

The root facade `'openbox-sdk'` re-exports everything if you prefer
one import.

## 3. Env selection

Three envs are supported: `production`, `staging`, `local`. The SDK
does not enforce a selection rule; it is a per-consumer convention.

| App type | Selection order |
|---|---|
| CLI | `--env` flag, then `OPENBOX_ENV`, then `production` |
| MCP server | `OPENBOX_ENV`, then `production` |
| VS Code or Cursor extension | `openbox.environment` setting gated to dev mode, then `production` |
| Expo or React Native mobile | App-specific secure-storage key with the UI gated to dev, then `production` |
| Tauri or native app | `OPENBOX_ENV`, then `production` |

Default to `production` when nothing is set. Hard-fail on unknown env
names. Silent fallback to production while echoing the bogus name is a
footgun.

## 4. Token storage

Tokens live in `~/.openbox/tokens`, or a project-local `.tokens` for
dev work, in env-namespaced KV format:

```
production.ACCESS_TOKEN=...
production.REFRESH_TOKEN=...
production.UPDATED_AT=...
production.API_KEY=obx_key_...
staging.ACCESS_TOKEN=...
local.ACCESS_TOKEN=...
```

Use `parseTokenStore(content)` and `serializeTokenStore(store)` from
`'openbox-sdk/env'`. The codec migrates legacy unprefixed entries from
pre-multi-env installs into `production.*` automatically. Do not
reinvent the parser.

For platforms without a shared filesystem, such as mobile or browser
extensions, keep the env-namespaced key convention but swap the
storage backend. iOS Keychain via `expo-secure-store` and
`chrome.storage` are typical.

## 5. Build the client

```typescript
const env = await resolveSelectedEnv();
const tokens = loadTokens(env);

const client = new OpenBoxClient({
  apiUrl: ENVIRONMENTS[env].apiUrl,
  env,
  accessToken: tokens.accessToken,
  refreshToken: tokens.refreshToken,
  clientName: 'openbox-<your-app>',
  onTokenRefresh: ({ accessToken, refreshToken }) => {
    saveTokens(env, accessToken, refreshToken);
  },
});
```

The SDK passes `refreshToken: undefined` when rotation is off; preserve
the existing one in that case.

For X-API-Key auth with org keys, construct with `apiKey` instead:

```typescript
const client = new OpenBoxClient({
  apiUrl: ENVIRONMENTS[env].apiUrl,
  env,
  apiKey: process.env.OPENBOX_BACKEND_API_KEY!,
  clientName: 'openbox-<your-app>',
});
```

The wrapper picks X-API-Key when both `apiKey` and `accessToken` are
provided.

## 6. The `X-Openbox-Client` header

The backend's auth guard checks for the header's presence; any value
passes. The value is a telemetry dimension. Set `clientName` to your
app's identifier, such as `apps/extension` or `runtime/mcp`.

`OPENBOX_CLIENT_VARIANT` in the environment auto-suffixes the value,
yielding strings like `openbox-cli/claude-code`, so backend logs can
distinguish skill-driven traffic from human use. `OpenBoxClient`
honors it automatically.

MCP servers read `mcp.server.getClientVersion()?.name` after
`server.connect()` and feed it into a per-request
`X-Openbox-Client: runtime/mcp/<caller>` header. Reference:
`ts/src/runtime/mcp/config.ts setMcpClientName`.

## 7. Env switcher UI: dev only

If your app exposes a UI to switch environments, gate it behind dev
mode.

| Platform | Gate |
|---|---|
| React Native or Expo | `if (__DEV__) { ... }` |
| VS Code extension | `enablement: "openbox.devMode"` on the command; set context from `vscode.ExtensionMode.Development` in `activate()` |
| Tauri or Rust | `#[cfg(debug_assertions)] { ... }` |

End users on a release build should never see a way to point the app
at staging; they will just confuse themselves with wrong-env data.
Reference: `apps/extension/src/extension.ts`.

## 8. Don't reinvent

- **Env table.** `specs/environments.json` is the source of truth. TS
  reads it via `ENVIRONMENTS` from `'openbox-sdk/env'`. Other languages
  consume the same JSON at codegen time. Do not hand-port.
- **Token codec.** Declared in `specs/typespec/env/main.tsp` via
  `@env_var`, `@token_format`, `@os_path`. TS exposes
  `parseTokenStore` and `serializeTokenStore` from `'openbox-sdk/env'`.
  Do not write your own KV parser; the legacy-migration logic matters.
- **HTTP.** Wrapper methods are spec-emitted from
  `specs/typespec/backend/main.tsp` and `specs/typespec/core/main.tsp`.
  In TS, call `OpenBoxClient` and `OpenBoxCoreClient` methods. Retries,
  timeouts, the auth header, and envelope unwrap are baked in. In
  other languages, call the generated wrapper, not raw HTTP.
- **Approval flow.** `client.getProfile()`, `client.listAgents(query)`,
  `client.getOrgApprovals(orgId, query)`,
  `client.decideApproval(agentId, eventId, action)`. Do not construct
  paths by hand; the wrapper covers every spec'd endpoint.
