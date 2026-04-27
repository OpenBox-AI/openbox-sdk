# specs/

The single source of truth for everything the SDKs generate. As of the codegen pipeline:

| File / dir | Role |
|---|---|---|
| `backend.json` | OpenAPI snapshot of the backend mgmt API (source until TypeSpec translation lands) | existing |
| `core.yaml` | OpenAPI for the core governance API (same) | existing |
| `environments.json` | URL data per env (production/staging/local). Every language's env package reads this. | moved here (was `ts/env/src/environments.json`) |
| `typespec/` | TypeSpec source files (`.tsp`) - REST surface today, workflow protocol + CLI bindings + env in subsequent passes. | 1 (REST landed) |
| `generated/` | TypeSpec emits OpenAPI + JSON Schema here as derived artifacts. Untracked - reproduce with `npm run specs:compile`. | 1 (REST landed) |

## Status

REST surface translated. `specs/typespec/main.tsp` is the root; per-service modules sit under `backend/` and `core/`. `npm run specs:compile` rebuilds `specs/generated/openapi3/{OpenboxBackend,OpenboxCore}.json`. The hand-written `backend.json` / `core.yaml` stay authoritative until the emitted artifacts are wired into downstream codegen (future codegen pipeline).

Two backend.json bugs are now fixed at the TypeSpec layer rather than patched at consumer-build time:

1. 13 endpoints under `/organization/{organizationId}/...` were missing path-param declarations (NestJS upstream lacked `@ApiParam`). The Rust `build.rs` patches these in-flight today; once the emitter swaps `rust/build.rs` over to the emitted spec, the patch can be deleted.
2. Two `AgentController` endpoints declared a redundant `organization_id` query param alongside their `{agentId}` path. Same Rust patch dropped them; same removal applies.

Still pending currently:

- Custom decorator libraries at `codegen/typespec-libs/{workflow,cli,env}/` - `@workflow`, `@activity`, `@cli_command`, `@env_var`, etc. Empty for now; populated in the next push.
- Workflow protocol (`govern.tsp`), CLI bindings (`cli.tsp`), env spec (`env.tsp`) authored against those decorators.

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

`openbox-mcp`, `openbox-mobile`, `openbox-extension`, `openbox-approver` consume the SDK by git tag (`github:OpenBox-AI/openbox-sdk#v0.1.0-alpha.1`). The codegen pipeline produces their language's outputs into `ts/`, `rust/`, etc., committed in this repo - consumers don't need codegen tooling installed locally.
