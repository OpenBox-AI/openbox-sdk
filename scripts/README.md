# Scripts Audit

Generation is TypeSpec-owned. `tsp compile specs/typespec` runs the OpenBox
emitter and writes TypeScript and Python generated SDK artifacts from the same
canonical TypeSpec contract.

## Emitter-Owned

- `generate:sdks` is the generic SDK artifact generation command. It builds
  the TypeSpec decorator libraries and shared emitter, then compiles the
  canonical TypeSpec contract. TypeScript, Python, OpenAPI, JSON Schema, and
  future language targets must all hang off this command.
- `check:generated-drift` reruns `npm run generate:sdks`, then checks generated
  TypeScript, Python, OpenAPI, JSON Schema, TypeSpec-emitted contract metadata
  maps, CLI/env/lifecycle fixtures, and conformance fixture artifacts for drift.
  The artifact inventory comes from the TypeSpec-emitted
  `codegen/fixtures/sdk-targets.json` manifest, not from a script-local target
  list.
- `clean:generated` reads the same TypeSpec-emitted artifact inventory and
  removes generated roots/files without carrying language-specific path lists in
  `package.json`.
- `check:sdks` is the generic target-native validation gate. It regenerates the
  TypeSpec-owned artifacts, then reads `codegen/fixtures/sdk-targets.json` and
  runs each target's native lint/type/test/build commands. Future language SDKs
  and spec-bound app targets should join `specs/typespec/sdk/main.tsp` instead
  of adding root-level `check:<language>`, `check:<app>`, or
  `generate:<language>` entry points.
- Spec-bound apps currently include the VS Code extension and n8n custom-node
  package. The n8n package also consumes a generated manifest emitted from
  `specs/typespec/govern/capabilities.tsp`.

## Local CI

- `ci:local` composes the full local PR/release gate: `check:sdks`, coverage,
  bundle build, generated drift, generated banners, OpenAPI lint, npm audit, and
  the repository security audit.

## Operational Scripts

- `sync-runtime-assets.ts` copies runtime templates and exports built plugin
  bundles after `tsup`; this depends on built runtime code and is not a spec
  emitter.
- `openbox-cli-dev.mjs` is a local developer launcher for the TypeScript CLI.
- `security-audit.mjs` orchestrates npm audit and secret scanning.
- `spec-drift.ts` compares emitted OpenAPI against deployed/upstream services.
- `check-generated-banners.ts` enforces generated-file provenance.

Rule of thumb: scripts may check, copy, launch, or compare. Anything that
authors SDK/API contract artifacts belongs in the shared TypeSpec emitter and
must be reachable through `npm run generate:sdks`, not a language-specific
script.
