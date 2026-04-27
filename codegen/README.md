# codegen/

Spec-driven code generation pipeline for the polyglot SDK. **Empty scaffold - the codegen pipeline.** Files appear here in subsequent phases.

## What goes where

| Path | Contents |
|---|---|---|
| `bin/codegen.ts` | 1 | Orchestrator (commander CLI) - drives TypeSpec compile + emitters |
| `bin/validate.ts` | 4 | Spec linter wrapper (Spectral over derived OpenAPI) |
| `bin/diff.ts` | 4 | Breaking-change detector (Optic wrapper) |
| `typespec-libs/workflow/` | 1 | TypeSpec library: `@workflow`, `@activity`, `@verdict`, `@observer_hook` decorators |
| `typespec-libs/cli/` | 1 | TypeSpec library: `@cli_command`, `@cli_flag`, `@cli_validator`, `@cli_output` |
| `typespec-libs/env/` | 1 | TypeSpec library: `@env_var`, `@token_format`, `@os_path` |
| `emitters/ts/` | 2 | TypeSpec emitter using `ts-morph` (AST-based) - outputs `ts/{cli,client,core-client,env,types,govern}/generated/` |
| `emitters/rust/` | 3 | TypeSpec emitter (TS-side) + Rust AST binary at `tools/codegen-rust-emit/` (uses `syn` + `quote` + `prettyplease`) |
| `emitters/python/` | 6 | Stub for now - TS-side + Python binary using `libcst` |
| `emitters/go/` | 6 | Stub for now - TS-side + Go binary using `go/ast` |
| `fixtures/` | 1 | Cross-language conformance test inputs (JSON) - every language SDK runs the same fixtures |
| `snapshots/` | 2 | Vitest snapshots of emitter outputs - catches unintended drift between codegen runs |

## How a code change flows

1. Edit a `.tsp` file in `specs/`
2. Run `codegen/bin/codegen.ts` - TypeSpec compiles, emitters write language-specific outputs to `ts/`, `rust/`, etc.
3. Snapshot tests assert no unintended diffs vs previous run
4. Per-language test runners (`vitest`, `cargo test`, `pytest`, `go test`) replay shared fixtures to verify behavior parity
5. CI: TypeSpec compile + emit + snapshot diff + conformance - block PR if any drift not committed

## Adding a new language target

1. Create `emitters/<lang>/` with the TS-side TypeSpec emitter that walks the semantic model and produces JSON IR
2. Create `tools/codegen-<lang>-emit/` with the language-native AST emitter binary that reads IR on stdin, writes source on stdout
3. Wire the orchestrator to invoke it
4. Conformance fixtures already exist; the language's test runner replays them
