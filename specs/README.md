# specs/

The single source of truth for everything the SDKs generate. As of the codegen pipeline:

| File / dir | Role |
|---|---|---|
| `backend.json` | OpenAPI snapshot of the backend mgmt API (source until TypeSpec translation lands) | existing |
| `core.yaml` | OpenAPI for the core governance API (same) | existing |
| `environments.json` | URL data per env (production/staging/local). Every language's env package reads this. | moved here (was `ts/env/src/environments.json`) |
| `typespec/` | TypeSpec source files (`.tsp`) - REST + workflow protocol + CLI bindings + env. **Initially empty.** | 1 |
| `generated/` | TypeSpec emits OpenAPI + JSON Schema here as derived artifacts. **Initially empty.** | 1 |

## Status

- TypeSpec becomes the authoring format. `specs/typespec/main.tsp` is the root.
- `specs/backend.json` and `specs/core.yaml` become *generated* outputs (TypeSpec → OpenAPI emitter), not edited by humans.
- Custom decorators (`@workflow`, `@activity`, `@cli_command`, `@env_var`, etc.) come from the TypeSpec libraries at `codegen/typespec-libs/`.

## Refreshing the backend OpenAPI snapshot (pre-TypeSpec)

```bash
TOKEN=$(grep '^production.ACCESS_TOKEN=' ~/.openbox/tokens | cut -d= -f2-)
curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Openbox-Client: openbox-cli" \
  https://api.openbox.ai/api/docs-json \
  | python3 -m json.tool > specs/backend.json
```

Once TypeSpec sources are authored, you stop editing `backend.json` directly - instead edit `.tsp` and let TypeSpec regenerate.

## Sibling-repo consumption (current)

`runtime/mcp`, `the-mobile-app`, `apps/extension`, `the-approver-app` consume the SDK by git tag (`github:OpenBox-AI/openbox-sdk#v0.1.0-alpha.1`). The codegen pipeline produces their language's outputs into `ts/`, `rust/`, etc., committed in this repo - consumers don't need codegen tooling installed locally.
