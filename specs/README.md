# specs/

Checked-in snapshot of the live backend's OpenAPI spec.

- `backend.json` - pulled from `https://api.openbox.ai/api/docs-json`
- `core.yaml` - curated from `openbox-core` source

## Source of truth

The `api-ref/` submodule at the repo root pins the exact `openbox-backend`
commit these snapshots should correspond to. Bump the submodule pointer
and re-pull the spec when the backend publishes a new surface:

```bash
# refresh the backend source pointer
git submodule update --remote api-ref

# re-pull the live swagger (requires a valid access token):
TOKEN=$(grep '^production.ACCESS_TOKEN=' ~/.openbox/tokens | cut -d= -f2-)
curl -sS -H "Authorization: Bearer $TOKEN" -H "X-Openbox-Client: openbox-cli" \
  https://api.openbox.ai/api/docs-json | python3 -m json.tool > specs/backend.json

# commit both changes together so the submodule pointer and spec stay aligned.
```

## Why checked in?

- Monorepo builds don't need network access
- Hand-curated DTOs in `@openbox/types` are easier to diff/review against a
  version-pinned file than an on-demand fetch
