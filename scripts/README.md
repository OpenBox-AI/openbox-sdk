# Scripts Audit

Generation is TypeSpec-owned. `tsp compile specs/typespec` runs the OpenBox
emitter and writes TypeScript and Python generated SDK artifacts from the same
canonical TypeSpec contract.

## Emitter-Owned

- `check:generated-drift` reruns the TypeSpec compiler and OpenAPI type
  generation, then checks generated TypeScript, Python, and OpenAPI artifacts
  for drift.
- `generate:sdks` is the generic SDK artifact generation command; it delegates
  to `npm run specs:compile`, where the OpenBox TypeSpec emitter writes every
  generated SDK artifact for every language target.

## Operational Scripts

- `sync-runtime-assets.ts` copies runtime templates and exports built plugin
  bundles after `tsup`; this depends on built runtime code and is not a spec
  emitter.
- `openbox-cli-dev.mjs` is a local developer launcher for the TypeScript CLI.
- `security-audit.mjs` orchestrates npm audit and secret scanning.
- `spec-drift.ts` compares emitted OpenAPI against deployed/upstream services.
- `check-generated-banners.ts` enforces generated-file provenance.

Rule of thumb: scripts may check, copy, launch, or compare. Anything that
authors SDK/API contract artifacts belongs in the TypeSpec emitter.
