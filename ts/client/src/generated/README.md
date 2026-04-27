# `ts/client/src/generated/`

The `OpenBoxClient` wrapper in this package is contract-driven, but
its enforcement mechanism is different from the env / cli packages
elsewhere in the monorepo. **Read this before editing
`../client.ts`.**

## Where the contract lives

| Layer | Source | Generated artifact |
|---|---|---|
| Wire types | `specs/backend.json` (today, once codegen swaps it for `specs/generated/openapi3/OpenboxBackend.json`) | `ts/types/src/generated/backend.ts` (via `npm run generate:types`) |
| Method coverage | The `paths` block of the same spec | none yet - see "Open holes" |

`OpenBoxClient` constructs requests against `Backend.paths` /
`Backend.components` from the generated types. Adding a route in
TypeSpec → recompiling → regenerating types → the new endpoint shape
appears in `Backend.paths`, but **the wrapper class doesn't auto-grow
a method**. That's a known gap.

## Hand-written rules (until that gap closes)

1. Every method on `OpenBoxClient` MUST be typed with the
   `Backend.paths['/...']['<verb>']` row from `@openbox/types`. No
   freehand request/response shapes.
2. Don't add a method whose path/verb isn't in the OpenAPI spec -
   either the spec is wrong (fix it upstream and refresh
   `specs/backend.json`) or the method doesn't belong here.
3. Don't redeclare a request DTO - import it from `@openbox/types`.

## Open holes

- **No method-coverage check.** A new `paths` entry in the spec doesn't
  fail CI when the wrapper hasn't grown a method yet. Adding this is
  in scope for a later codegen pass - emit a `BACKEND_ENDPOINT_MANIFEST`
  here listing every (path, verb) tuple, and have a test assert that
  every entry has a corresponding method on `OpenBoxClient`.

This README is the placeholder until the manifest lands. Files in
this directory will start with `// AUTO-GENERATED` once that emitter
pass exists.
