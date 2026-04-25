# specs/

The authoritative OpenAPI snapshot for the OpenBox backend surface.

- `backend.json` - pulled from `https://api.openbox.ai/api/docs-json`. Both
  production and staging serve the same schema today; re-pull from whichever
  env is ahead if they diverge.
- `core.yaml` - curated from the `openbox-core` Go source.

This is the single source of truth for the SDK's client/type surface. Sibling
repos (e.g. `openbox-mcp`, `openbox-typescript-sdk`,
`openbox-skill`) submodule this repo at `specs-ref/` to read from here.

## Refresh

When the backend's spec changes:

```bash
TOKEN=$(grep '^production.ACCESS_TOKEN=' ~/.openbox/tokens | cut -d= -f2-)
curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Openbox-Client: openbox-cli" \
  https://api.openbox.ai/api/docs-json \
  | python3 -m json.tool > specs/backend.json

# then update DTOs / client methods if new endpoints appeared
```

After committing an update here, bump the `specs-ref` submodule pointer in
each sibling repo that references it.
