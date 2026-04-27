# OpenBox SDK

_Last updated: 2026-04-26_

Modular TypeScript SDK for the OpenBox AI governance platform - a universal client surface for managing agents, approvals, guardrails, policies, and behavior rules.

## Public surface

The whole SDK installs and imports as a single package, `openbox-sdk`. Pick the entry that matches what you need; bundlers tree-shake the rest.

| Import path | What it gives you |
|---|---|
| `'openbox-sdk'` | Everything (root facade) |
| `'openbox-sdk/client'` | `OpenBoxClient` - backend API (`api.openbox.ai`) |
| `'openbox-sdk/core-client'` | `OpenBoxCoreClient` - governance API (`core.openbox.ai`) |
| `'openbox-sdk/env'` | `ENVIRONMENTS`, `resolveEnv`, `resolveUrls`, `parseTokenStore`, `serializeTokenStore`, `resolveClientName` |
| `'openbox-sdk/types'` | Hand-curated DTOs + auto-generated `Backend` / `Core` namespaces |

Internally a workspace monorepo (`ts/{client,core-client,env,types,cli}/`); externally consumers never see that.

## Install - for consumer apps

```jsonc
// consumer's package.json
"dependencies": {
  "openbox-sdk": "github:OpenBox-AI/openbox-sdk"
}
```

Then `npm install` clones the repo, runs the `prepare` hook (builds the workspaces + bundles via tsup into `dist/`), and drops the result into `node_modules/openbox-sdk/`. Not on npm. Tree-shaking handles unused entries.

## Develop - for SDK contributors

```bash
git clone https://github.com/OpenBox-AI/openbox-sdk.git
cd openbox-sdk
npm install   # workspaces resolve internally
npm run build # workspaces in topo order, then tsup bundles dist/
```

Browser login uses `playwright` - install it if you don't have it: `npm install playwright`.

## CLI

```bash
# First-time login (opens Chrome, captures JWT + refresh token from the SPA)
openbox auth login

# Use the API
openbox auth profile
openbox agent list
openbox guardrail create <agent-id> -n MyGuard --type pii --stage 0

# Inspect cached permissions
openbox auth permissions
```

### Environments

The CLI ships with registered hostnames for production in `ts/cli/src/environments.ts`:

| Env | Backend API | Core API | Platform (login) |
|---|---|---|---|
| production | `https://api.openbox.ai` | `https://core.openbox.ai` | `https://platform.openbox.ai` |
| local | `http://localhost:3000` | `http://localhost:8086` | `http://localhost:3233` |

Selection precedence: `--env <name>` flag → `OPENBOX_ENV` env var → default `production`. Individual URL overrides via `OPENBOX_API_URL` / `OPENBOX_CORE_URL` / `OPENBOX_PLATFORM_URL` still work on top of the selected env.

### Permission pre-flight

The CLI caches your role's permissions per env on login. Commands that require granular permissions (`guardrail *`, `policy *`, `behavior *`, `session *`, `observe *`) check locally first and refuse with an actionable message if the env's role is missing what's needed - instead of firing a request and getting 403. Permission requirements are mapped in `ts/cli/src/permissions.ts`.

### Token storage

A single plain-text file (`~/.openbox/tokens` or project-local `.tokens`) with env-namespaced entries:

```
production.ACCESS_TOKEN=...
production.REFRESH_TOKEN=...
production.PERMISSIONS=Admin,create:agent,...
staging.ACCESS_TOKEN=...
staging.REFRESH_TOKEN=...
staging.PERMISSIONS=Admin,create:agent,create:agent_guardrail,...
```

Legacy flat-format files (unprefixed `ACCESS_TOKEN=...`) are read as `production` and rewritten on the next save.

## Library usage

```typescript
import { OpenBoxClient } from 'openbox-sdk/client';
import { ENVIRONMENTS } from 'openbox-sdk/env';

const client = new OpenBoxClient({
  env: 'production',                     // optional - branches when env-specific behavior is needed
  apiUrl: ENVIRONMENTS.production.apiUrl,
  accessToken: '<jwt>',
  refreshToken: '<rt>',                  // optional; auto-refresh is currently disabled, see DEFERRED.md
  clientName: 'my-app',                  // optional - sent as X-Openbox-Client (default 'openbox-cli')
});

const agents = await client.listAgents({ search: 'my-agent' });
const result = await client.getOrgApprovals(orgId, { status: 'pending' });
const pending = result.approvals.data;
await client.decideApproval(agents.data[0].id, eventId, 'approve');
```

```typescript
import { OpenBoxCoreClient } from 'openbox-sdk/core-client';
import { ENVIRONMENTS } from 'openbox-sdk/env';

const core = new OpenBoxCoreClient({
  env: 'production',
  apiUrl: ENVIRONMENTS.production.coreUrl,
  apiKey: 'obx_live_...',
});

const verdict = await core.evaluate(payload);
```

Every backend request includes an `X-Openbox-Client` header (backend's auth guard requires the header to be present; the value is purely a telemetry dimension). `clientName` defaults to `openbox-cli`; each consumer should set its own (`apps/extension`, `the-mobile-app`, `runtime/mcp`, ...). Setting `OPENBOX_CLIENT_VARIANT=claude-code` in the environment auto-suffixes the value (e.g. `openbox-cli/claude-code`) so backend logs can distinguish skill-driven traffic from human-typed traffic.

## Tests

```bash
npm run test:unit   # 233 pass / 6 skip (skips are refresh-related, re-enable when upstream lands)
npm run test:e2e    # requires live tokens - see DEFERRED.md for the env-var recipe
```

## Design principle - universal CLI

The CLI runs the same surface against both envs. Tolerable divergence: *temporary* flag / permission gaps that converge over time. **Structurally-hidden-in-prod services do not get CLI paths.** See `DEFERRED.md` for details and the list of things intentionally not exposed.

## Pending external work

See `DEFERRED.md` for:
- Upstream `/auth/refresh` fix PRs (two paired bugs in backend + fe)
- Production Keycloak role sync (backfill granular permissions added in backend PR #237)

Both are tracked with exact steps for re-enabling CLI features once they're resolved.
