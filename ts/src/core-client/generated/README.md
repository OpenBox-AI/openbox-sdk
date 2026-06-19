# `ts/src/core-client/generated/`

**AUTO-GENERATED. Do not hand-edit.** Same shape as
`ts/src/client/generated/`; read that file's README for the full
rationale. The rules below mirror it.

| Source | Reproduces |
|---|---|
| `specs/typespec/core/main.tsp` | `endpoint-manifest.ts` (`CORE_ENDPOINT_MANIFEST`) |
| `codegen/emitters/typespec-emitter-openbox/src/index.ts` | the emit logic |

Regenerate with `npm run specs:compile`.

## Authoring rules

1. Every method on `OpenBoxCoreClient` MUST be typed via `Core.paths['/...']['post']` from `@openbox-ai/openbox-sdk/types`.
2. Wire request bodies and verdict responses come straight from `Core.components['schemas']`. Don't redeclare them locally.
3. The five emitted verdicts (`allow`, `constrain`, `require_approval`, `block`, `halt`) are the spec's `Verdict` enum at `specs/typespec/govern/main.tsp`. New verdict arms get added there first, then in the wrapper's verdict handler.
4. `tests/unit/endpoint-coverage.test.ts` walks `CORE_ENDPOINT_MANIFEST` and asserts every entry has a `this.<verb>(<path>, ...)` call on the wrapper. Adding a route to the spec without a matching method fails CI.
