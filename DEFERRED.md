# Deferred work

Items that can't land on a single local commit - they depend on external action or future coordination. Linked to this repo so they don't get lost.

## Design principle for env divergence

The CLI is **universal** - it runs the same surface against production and staging. The only tolerable divergence is *temporary*: a feature is code-deployed but gated behind a flag (permissions, feature toggles) that isn't flipped yet on one env. These converge over time.

**Do NOT add CLI functionality that's structurally hidden in prod** (e.g., services behind private ALBs that only in-cluster pods can reach). Route those through the universal public API instead.

## Pending

### 1. Upstream `/auth/refresh` fix - unblocks auto-refresh

Two paired bugs break refresh end-to-end on both envs; the FE swallows the failure as "force logout" so it's gone unnoticed.

- **openbox-backend** `src/modules/auth/auth.controller.ts:152`
  passes `user.sub` instead of `user.orgId` → Keycloak `/realms/<user-uuid>/…` → 404 → 500
  Fix branch: https://github.com/salamisandwich77/openbox-backend/tree/fix/auth-refresh-passes-wrong-arg
- **openbox-fe** `src/auth/auth-utils.ts:106`
  sends `{refresh_token}` (snake_case) but DTO is `{refreshToken}` → 422
  Fix branch: https://github.com/salamisandwich77/openbox-fe/tree/fix/auth-refresh-body-camelcase

**What to do here when upstream ships**: flip `REFRESH_ENABLED` from `false` to `true` in `packages/client/src/client.ts`. Single line. Unit tests currently `.skip`'d under `describe.skip('token refresh')` in `tests/unit/client.test.ts` will re-enable automatically.

### 2. Production role sync - unblocks write-path on prod

Backend PR #237 (merged 2026-04-12, deployed to prod) split agent permissions into granular subgroups. The enforcement code is live on prod; the Keycloak realm's `Admin` composite role wasn't migrated. Staging has all 42 permissions; prod has 18.

**Fix** (someone with backend deploy access needs to run):
```
yarn command patch-permissions                    # all realms
yarn command patch-permissions <org-realm-name>   # one realm
```

**What to do here when fixed**: `openbox auth permissions --all --refresh` to re-pull permissions, then re-run the write-path e2e against prod (`ACCESS_TOKEN=… OPENBOX_ORG_ID=… npm run test:e2e`).

### 3. Test suite ports - optional

Unit + e2e are ported and green on staging (`107/107 e2e, 233/239 unit`). Not wired to CI yet since there's no shared CI infra for this local-only workspace. If publishing/CI becomes a thing, wire `npm test` into a GitHub Action.

## Intentionally NOT doing

- **Direct `openbox-guardrails` service client.** Prod's guardrails hostname (`guardrail.openbox.ai`) is on a private ALB - internal-only by design. Per the universality principle above, we don't build CLI paths that only work on staging. Backend proxies (`/guardrails/run-test`, governance evaluation pipeline) cover both envs and are sufficient.
- **Publishing `@openbox/*` packages to npm.** Local-only for now (consume via `npm link` from `packages/cli`).
