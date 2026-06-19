# specs/

The TypeSpec contract source for the TypeScript SDK and any future
SDK tracks.

| File or dir | Role |
|---|---|
| `typespec/` | TypeSpec sources. `main.tsp` is the root; per-area modules sit under `backend/`, `core/`, `env/`, `cli/`, `govern/` |
| `tspconfig.yaml` | Compiler config: output paths and emitter list. Lives inside `typespec/` |
| `generated/` | TypeSpec emits OpenAPI3 and JSON Schema here. Untracked; reproduce with `npm run specs:compile` |

## Compile

```bash
npm run specs:compile      # tsp compile specs/typespec
npm run generate:sdks      # generic alias for specs:compile
npm run specs:all          # build:codegen + specs:compile
```

The OpenBox emitter under
`codegen/emitters/typespec-emitter/` writes generated SDK
artifacts for language targets such as TypeScript and Python. The
hand-written files only consume those generated artifacts.

## Drift detection

`.github/workflows/spec-drift.yml` is wired to compare this repo's
TypeSpec against the live deployments and the matching upstream
service repositories. PR and scheduled triggers are commented out
until the secrets and first run validate clean; the workflow is
`workflow_dispatch` only today.

## Backend snapshot bugs fixed at the TypeSpec layer

Two issues that previously required downstream patching are now correct
in the spec:

1. 13 endpoints under `/organization/{organizationId}/...` lacked
   path-param declarations because the NestJS upstream was missing
   `@ApiParam`.
2. Two `AgentController` endpoints declared a redundant
   `organization_id` query param alongside `{agentId}`.

Downstream generators should consume the emitted spec directly instead
of carrying local patches for these cases.
