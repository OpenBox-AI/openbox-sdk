# Backend API Reference

Cross-cutting backend API concerns - response shape, headers, auth, refresh - things that apply to every backend endpoint but aren't specific to any one resource.

## Contents

- [Response Envelope (`{status, data}`)](#response-envelope-status-data)
- [`X-Openbox-Client` Header (Edge-Enforced)](#x-openbox-client-header-edge-enforced)
- [CLI Auth Principle: Stay Inside the Backend Boundary](#cli-auth-principle-stay-inside-the-backend-boundary)
- [`POST /auth/refresh` Caveats](#post-authrefresh-caveats)
- [`/auth/validate` Response (Core)](#authvalidate-response-core)
- [Swagger Availability](#swagger-availability)

## Response Envelope (`{status, data}`)

Every backend response (`api.openbox.ai`) wraps the payload:

```json
{ "status": 200, "data": { ... } }
```

Lists are **double-nested** by NestJS's paginator:

```json
{ "status": 200, "data": { "data": [ ... ], "start": 0, "limit": 10, "total": 42 } }
```

Always unwrap safely:

```ts
const items = body.data?.data ?? body.data ?? body;
```

Source: `src/common/interceptors/transform.interceptors.ts` (global interceptor). Live-verified:

```bash
curl https://api.openbox.ai/health
→ {"status":200,"data":"Success"}
```

Core API (`core.openbox.ai`) does NOT use this envelope - core responses are raw JSON.

## `X-Openbox-Client` Header (Edge-Enforced)

Every backend call needs an `X-Openbox-Client` header. Presence-only check - the value is arbitrary (`openbox-cli`, `cursor-hooks`, `my-app`). Observable behavior on both envs:

```
# Missing header (auth attempt or not):
curl https://api.openbox.ai/auth/profile
→ 401 {"status":401,"message":"Unauthorized"}       ← generic; rejected before NestJS

# Present header, no bearer:
curl -H 'X-Openbox-Client: test' https://api.openbox.ai/auth/profile
→ 401 {"status":401,"message":"No auth token"}       ← Passport/NestJS message

# Present header + valid bearer:
→ 200 with profile JSON
```

**The check is NOT in the backend source.** Grep the `openbox-backend` repo for `X-Openbox-Client`, `openbox-client`, or `No auth token` and you get zero hits. `src/modules/auth/strategies/jwt.strategy.ts` only calls `ExtractJwt.fromAuthHeaderAsBearerToken()`.

Enforcement lives at the **edge proxy / WAF** in front of the NestJS app. The proxy rejects missing-header requests with a generic `"Unauthorized"` body; only requests with the header reach NestJS where the Passport/Bearer check fires.

Implications:
- **Self-hosted parity**: running `openbox-backend` without an equivalent edge proxy gives you a backend that accepts any request with a valid bearer (no header required). Add the check in your own reverse proxy if you want parity.
- **Debugging**: the rejection isn't in code - look at the ingress/WAF config.
- **Error message** depends on which layer rejected: `"Unauthorized"` (edge) vs `"No auth token"` / `"Invalid token format"` (NestJS).

The CLI, first-party SDKs, and `openbox-mcp` send the header automatically. Raw HTTP clients must:

```
Authorization: Bearer <jwt>
X-Openbox-Client: your-client-name
Content-Type: application/json
```

Core API does **not** require this header - core auth uses the `obx_live_*` / `obx_test_*` API key in `Authorization: Bearer …`.

## CLI Auth Principle: Stay Inside the Backend Boundary

The `openbox` CLI talks only to the backend (`/auth/*`) and core (`/api/v1/*`). It never calls the identity provider (Keycloak realm `token` endpoint) directly - even though the Python `openbox-cli` does, and even though it would work around the currently-broken `/auth/refresh` endpoint.

Reason: the backend is the single proxy in front of the identity stack. CLI consumers shouldn't need to know whether auth is Keycloak today or something else tomorrow. Keeping the CLI backend-only means the identity layer is swappable from the user's perspective.

Consequence: when `/auth/refresh` can't be used (see next section), the recovery paths are:

1. `openbox auth login` - browser-based, uses the platform's NextAuth flow which eventually returns a fresh access token via the backend.
2. `openbox auth set-token <token>` - paste a token obtained out-of-band (e.g., copied from the web dashboard's DevTools).

Both stay inside the backend boundary. Auto-refresh is currently disabled via `REFRESH_ENABLED = false` in `packages/client/src/client.ts` pending upstream fixes.

## `POST /auth/refresh` Caveats

The backend refresh endpoint has three things wrong with it right now, all of which push consumers toward re-login instead:

1. **Not `@Public()`** - `JwtAuthGuard` gates it. Requires a still-valid `Authorization: Bearer <accessToken>` header. It's a pre-expiry rotation path, not a post-expiry recovery. Expired access token → 401 before any refresh logic runs.
2. **Backend bug**: `auth.controller.ts:81` passes `user.sub` (the user's UUID) to the identity provider as the realm name - should be `user.orgId`. Realm lookup 404s → backend returns 500.
3. **FE bug**: `openbox-fe`'s `lib/auth-options.ts:57` sends `body: JSON.stringify({ refresh_token: token.refreshToken })` - snake_case - but the backend's `RefreshDto.refreshToken` is camelCase → the body is stripped by the whitelist pipe and the handler receives `{}` → 422 (or the handler's `user.sub` path hits the Keycloak 500 first; order depends on request shape).

The NextAuth JWT callback swallows the refresh failure and the session just expires (no visible banner) - which is why the dashboard appears to work but `/auth/refresh` has been broken for months without alerts. Fix-forward requires both the FE body-shape correction and the backend controller's `user.sub` → `user.orgId` fix. The CLI disables auto-refresh via `REFRESH_ENABLED = false` until those land.

Source references: `openbox-backend/src/modules/auth/auth.controller.ts:81` (wrong-claim bug), `src/modules/auth/dto/auth.dto.ts:69` (RefreshDto.refreshToken camelCase), and `openbox-fe/lib/auth-options.ts:57` (FE sends snake_case).

## `/auth/validate` Response (Core)

Core's `GET /api/v1/auth/validate` (different from backend's `/auth/*` endpoints - this one is on `core.openbox.ai`) takes a `Bearer <obx_live_*>` and returns:

```json
{
  "valid": true,
  "active": true,
  "agent_id": "uuid",
  "agent_name": "name",
  "environment": "live"
}
```

Full shape also includes a `message` field describing the validation result. Does NOT return: org, team, trust score, guardrails, policies - for those, use the Backend API with a JWT. The `openbox doctor` command uses this endpoint for the "core API key valid" check.

## Swagger Availability

Swagger UI + JSON schema are **currently exposed on both hosted environments** despite the source gate:

```bash
curl -sI https://api.openbox.ai/api/docs         # 200
curl -sI https://api.openbox.ai/api/docs-json    # 200
```

`src/main.ts:24` gates Swagger setup on `NODE_ENV === 'development'`, so the hosted services are either running with `NODE_ENV=development` (common misconfig) or the gate is bypassed in the deploy. Either way - docs are live today. You can pull fresh OpenAPI from `/api/docs-json` on prod or staging without a dev-mode local run.

To regenerate typed bindings after a spec pull:

```bash
cd openbox-sdk
npm run generate:types        # rebuilds packages/types/src/generated from specs/backend.json + specs/core.yaml
```

If future hardening closes the docs route, the fallback is asking a teammate with a local backend run for the spec, or reading directly from `openbox-sdk/specs/` which is kept in sync.

## Related references

- `references/governance-flow.md` - core API wire format, event protocol, spec-vs-implementation mismatches
- `references/commands.md` § auth - CLI auth commands
