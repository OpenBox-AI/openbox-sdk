# OpenBox SDK

Modular TypeScript SDK for the OpenBox AI governance platform - a universal client surface that runs the same command set against both production and staging.

## Packages

| Package | Description |
|---|---|
| `openbox-sdk/types` | Shared types and response models |
| `openbox-sdk/client` | Backend API client (`api.openbox.ai`) |
| `openbox-sdk/core-client` | Governance API client (`core.openbox.ai`) |
| `openbox-sdk/cli` | `openbox` CLI tool |

## Setup

```bash
git clone https://github.com/OpenBox-AI/openbox-sdk.git
cd openbox-sdk
npm install
npm run build
```

Not published to npm. Consume locally via `npm link` (works for Node-resolved
consumers like a VS Code extension) or via tarballs (works for everything,
including bundlers that don't follow symlinks well - Metro, esbuild in some
configs):

```bash
# A. Symlink: from this repo, link the CLI binary onto PATH
npm link -w packages/cli

# B. Tarball: build all four consumable packages into dist-pack/ as .tgz
npm run pack:all
ls dist-pack/
# openbox-client-0.1.0.tgz
# the-core-service-client-0.1.0.tgz
# openbox-env-0.1.0.tgz
# openbox-types-0.1.0.tgz
```

A consuming app then either `npm link openbox-sdk/client openbox-sdk/env` (for
A) or installs the tarballs directly (for B):

```bash
# In the consumer repo (e.g. the-mobile-app):
npm install \
  file:../openbox-sdk/dist-pack/openbox-client-0.1.0.tgz \
  file:../openbox-sdk/dist-pack/openbox-env-0.1.0.tgz
# Re-run `npm run pack:all` in openbox-sdk + `npm install` here on every SDK change.
```

Browser login uses `playwright` - install it if you don't have it: `npm install playwright`.

## CLI

```bash
# First-time login (opens Chrome, captures JWT + refresh token from the SPA)
openbox auth login                    # production (default)
openbox --env staging auth login      # staging

# Use the API
openbox auth profile
openbox --env staging agent list
openbox --env staging guardrail create <agent-id> -n MyGuard --type pii --stage 0

# Inspect cached permissions
openbox auth permissions              # current env
openbox auth permissions --all        # both envs
openbox auth permissions --compare staging    # diff
```

### Environments

The CLI ships with registered hostnames for both envs in `packages/cli/src/environments.ts`:

| Env | Backend API | Core API | Platform (login) |
|---|---|---|---|
| production | `https://api.openbox.ai` | `https://core.openbox.ai` | `https://platform.openbox.ai` |
| staging | `https://openbox-api.node.lat` | `https://the-core-service.node.lat` | `https://openbox.node.lat` |

Selection precedence: `--env <name>` flag → `OPENBOX_ENV` env var → default `production`. Individual URL overrides via `OPENBOX_API_URL` / `OPENBOX_CORE_URL` / `OPENBOX_PLATFORM_URL` still work on top of the selected env.

### Permission pre-flight

The CLI caches your role's permissions per env on login. Commands that require granular permissions (`guardrail *`, `policy *`, `behavior *`, `session *`, `observe *`) check locally first and refuse with an actionable message if the env's role is missing what's needed - instead of firing a request and getting 403. Permission requirements are mapped in `packages/cli/src/permissions.ts`.

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

const client = new OpenBoxClient({
  env: 'staging',                        // optional - branches when prod/staging diverge
  apiUrl: 'https://openbox-api.node.lat',
  accessToken: '<jwt>',
  refreshToken: '<rt>',                  // optional; auto-refresh is currently disabled, see DEFERRED.md
});

const agents = await client.listAgents({ search: 'my-agent' });
const pending = await client.getPendingApprovals(agents.data[0].id);
await client.decideApproval(agents.data[0].id, eventId, 'approve');
```

```typescript
import { OpenBoxCoreClient } from 'openbox-sdk/core-client';

const core = new OpenBoxCoreClient({
  env: 'staging',
  apiUrl: 'https://the-core-service.node.lat',
  apiKey: 'obx_live_...',
});

const verdict = await core.evaluate(payload);
```

Every request includes the `X-Openbox-Client: openbox-cli` header (backend's auth guard requires the header to be present; the value is arbitrary).

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
