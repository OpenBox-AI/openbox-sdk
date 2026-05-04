# `src/core/generated`

**AUTO-GENERATED. Do not hand-edit.**

| Source | Reproduces |
|---|---|
| `specs/typespec/core/main.tsp` | endpoint_manifest.rs: the CORE_ENDPOINT_MANIFEST array enumerating every core governance HTTP operation |
| `specs/typespec/core/main.tsp` | wrapper_methods.rs: one async fn on OpenBoxCoreClient per core HTTP operation |
| `specs/typespec/govern/main.tsp` | govern.rs: the canonical event_type / activity_type / verdict_arm sets and the spec-driven activity_type → display label table |
| `codegen/emitters/typespec-emitter-rust/src/index.ts` | the emit logic |

Regenerate with `npm run specs:compile`.
