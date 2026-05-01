# Backend API reference

Cross-cutting concerns when calling the backend management API or the
core governance API directly. Resource-specific shapes live in the
generated types under `openbox-sdk/types`.

## Two services, two hosts

| | Host | Auth | Body shape |
|---|---|---|---|
| Backend management API | `api.openbox.ai` | `Authorization: Bearer <jwt>` or `X-API-Key: <obx_key_*>` | Wrapped as `{ status, data }`. Lists are double-nested by the paginator: `data.data` is the rows, and `data` itself carries `start`, `limit`, `total` |
| Core governance API | `core.openbox.ai` | `Authorization: Bearer <obx_live_*>` or `<obx_test_*>` agent runtime key | Raw JSON. No envelope |

Always unwrap defensively:

```ts
const items = body.data?.data ?? body.data ?? body;
```

## `X-Openbox-Client` header

Required on every backend call. The check is presence-only at the
edge, so any non-empty value works. Missing the header returns
`401 Unauthorized` before the backend's auth layer runs.

The CLI, first-party SDKs, and the MCP runtime send the header
automatically. Raw HTTP clients add it themselves:

```
Authorization: Bearer <jwt>
X-Openbox-Client: your-client-name
Content-Type: application/json
```

The core API does not require this header. Core auth is the
`obx_live_<48hex>` or `obx_test_<48hex>` agent runtime key sent as
`Bearer`.

## CLI auth

The `openbox` CLI is X-API-Key-only. The auth flow is:

1. Mint a key in the dashboard under **Organization → API Keys**.
2. Persist it with `openbox auth set-api-key`. Interactive prompt or
   `--key <value>`.
3. Verify with `openbox auth status`.

`openbox auth clear-api-key` removes the saved key for the current
env. `OPENBOX_BACKEND_API_KEY=<key>` overrides the on-disk store for
ephemeral or CI use.

JWT auth is no longer a CLI flow. Programmatic SDK consumers can
still construct `OpenBoxClient` with `accessToken`; only the CLI is
api-key-only.

## `/auth/validate` on core

`GET /api/v1/auth/validate` on `core.openbox.ai` accepts a
`Bearer <obx_live_*>` runtime key and returns:

```json
{
  "valid": true,
  "active": true,
  "agent_id": "uuid",
  "agent_name": "name",
  "environment": "live"
}
```

`openbox doctor` uses this endpoint for the "core API key valid"
check.

## OpenAPI

The hosted services expose Swagger today:

```bash
curl -sI https://api.openbox.ai/api/docs         # 200
curl -sI https://api.openbox.ai/api/docs-json    # 200
```

The repo's TypeSpec sources at `specs/typespec/` are the single source
of truth. Each language's emitter reads from there. The TS step is:

```bash
npm run generate:types
```

## Related references

- `references/governance-flow.md`: core API wire format and the event
  protocol.
- `references/commands.md` § auth: CLI auth commands.
