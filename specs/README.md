# specs/

The single source of truth that every SDK in the monorepo lowers
from.

| File or dir | Role |
|---|---|
| `typespec/` | TypeSpec sources. `main.tsp` is the root; per-area modules sit under `backend/`, `core/`, `env/`, `cli/`, `govern/` |
| `tspconfig.yaml` | Compiler config: output paths and emitter list. Lives inside `typespec/` |
| `generated/` | TypeSpec emits OpenAPI3 and JSON Schema here. Untracked; reproduce with `npm run specs:compile` |

## Compile

```bash
npm run specs:compile      # tsp compile specs/typespec
npm run generate:types     # openapi-typescript on the emitted OpenAPI
npm run specs:all          # build:codegen + specs:compile + generate:types
```

The TypeScript emitter under
`codegen/emitters/typespec-emitter-typescript/` writes language-
native source into `ts/src/**/generated/`. The hand-written files in
`ts/src/` only consume those generated artifacts.

## Drift detection

`.github/workflows/spec-drift.yml` is wired to compare this repo's
TypeSpec against the live deployments and the matching upstream
service repositories. PR and scheduled triggers are commented out
until the secrets and first run validate clean; the workflow is
`workflow_dispatch` only today.

## Backend snapshot bugs fixed at the TypeSpec layer

Two issues that previously required patches in the Rust crate's
`build.rs` are now correct in the spec:

1. 13 endpoints under `/organization/{organizationId}/...` lacked
   path-param declarations because the NestJS upstream was missing
   `@ApiParam`.
2. Two `AgentController` endpoints declared a redundant
   `organization_id` query param alongside `{agentId}`.

Once the Rust crate switches to consuming the emitted spec, the
matching `build.rs` patches can be deleted.
