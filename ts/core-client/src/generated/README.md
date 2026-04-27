# `ts/core-client/src/generated/`

Same pattern as `ts/client/src/generated/` - the wrapper is typed
against `Core.paths` / `Core.components` from
`@openbox/types`/`generated/core.ts`, but no method-coverage manifest
is emitted yet. Read `../client/src/generated/README.md` for the
full rationale; the rules below mirror it.

## Hand-written rules

1. Every method on `OpenBoxCoreClient` MUST be typed via
   `Core.paths['/...']['post']` from `@openbox/types`.
2. Wire request bodies and verdict responses come straight from
   `Core.components['schemas']`. Don't redeclare them locally.
3. The four emitted verdicts (`allow`, `require_approval`, `block`,
   `halt`) and the placeholder `constrain` are also the spec's
   `Verdict` enum at `specs/typespec/govern/main.tsp`. New verdict
   arms get added there first, in `OpenboxCore.json` second, then in
   the wrapper's verdict handler.

## Open holes (parity with `ts/client`)

- No `CORE_ENDPOINT_MANIFEST` yet - adding a new `paths` entry in
  `core.yaml` doesn't fail CI when the wrapper hasn't grown a method.
  Tracked in the same future emitter pass that wires `ts/client`.

Files in this directory will start with `// AUTO-GENERATED` once that
pass exists. Until then this README is the placeholder.
