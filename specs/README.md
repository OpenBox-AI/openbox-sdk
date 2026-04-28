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

## Drift detection

TypeSpec is the source of truth. The manual mirrors `specs/backend.json`
and `specs/core.yaml` were dropped - they kept going stale (most recently
the four `/dashboard/*` endpoints).

`.github/workflows/spec-drift.yml` runs daily (and on PRs that touch
`specs/typespec/**`) to compare TypeSpec against:
- live deployed prod swagger (curl `https://api.openbox.ai/api/docs-json`)
- live deployed staging swagger (URL from secrets)
- upstream `OpenBox-AI/openbox-backend@develop` (path-only via regex parse)
- upstream `OpenBox-AI/openbox-core@develop` (path-only - core has no swagger endpoint)

Drift opens an issue with `label:spec-drift,automated`.

## Sibling-repo consumption (current)

`openbox-mcp`, `openbox-mobile`, `openbox-extension`, `openbox-approver` consume the SDK by git tag (`github:OpenBox-AI/openbox-sdk#v0.1.0-alpha.1`). The codegen pipeline produces their language's outputs into `ts/`, `rust/`, etc., committed in this repo - consumers don't need codegen tooling installed locally.
