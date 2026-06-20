# Scripts Audit

Generation is TypeSpec-owned. `tsp compile specs/typespec` runs the OpenBox
emitter and writes TypeScript and Python generated SDK artifacts from the same
canonical TypeSpec contract.

## Emitter-Owned

- `generate:sdks` is the generic SDK artifact generation command. It builds
  the TypeSpec-emitted `sdkGeneration.steps` pipeline. TypeScript, Python,
  OpenAPI, JSON Schema, and future language targets must all hang off this
  command. If generated fixtures were cleaned, it falls back to the bootstrap
  generation sequence long enough to regenerate the canonical manifest.
- `build:codegen` reads the TypeSpec-emitted `codegenBuild.steps` pipeline from
  `codegen/fixtures/sdk-targets.json` and builds the TypeSpec decorator
  libraries plus shared emitter. If generated fixtures were cleaned, it falls
  back to codegen workspace package metadata only long enough to regenerate the
  canonical manifest.
- `build:bundle` reads the TypeSpec-emitted `bundleBuild.steps` pipeline for
  bundling and runtime asset sync. Add build-stage changes in
  `specs/typespec/sdk/main.tsp`, not in the root package script.
- `build` and `check:sdks` read TypeSpec-emitted `rootPipelines` entries. Keep
  high-level root pipeline composition in `specs/typespec/sdk/main.tsp`, not in
  `package.json`.
- `check:generated-drift` reruns `npm run generate:sdks`, then checks generated
  TypeScript, Python, OpenAPI, JSON Schema, TypeSpec-emitted contract metadata
  maps, CLI/env/lifecycle fixtures, and conformance fixture artifacts for drift.
  The artifact inventory comes from the TypeSpec-emitted
  `codegen/fixtures/sdk-targets.json` manifest, not from a script-local target
  list.
- `clean:generated` reads the same TypeSpec-emitted artifact inventory and
  removes generated roots/files without carrying language-specific path lists in
  `package.json`.
- `clean` reads the TypeSpec-emitted `cleanArtifacts` inventory from the same
  SDK target manifest, removes root/package build artifacts, and then delegates
  generated-file cleanup to `clean:generated`. Add new build artifact paths in
  `specs/typespec/sdk/main.tsp`, not in `package.json`.
- `check:sdks` is the generic target-native validation gate. It regenerates the
  TypeSpec-owned artifacts, then reads `codegen/fixtures/sdk-targets.json` and
  validates declared app manifests before running each target's native
  lint/type/test/build commands. Future language SDKs and spec-bound app
  targets should join `specs/typespec/sdk/main.tsp` instead of adding
  root-level `check:<language>`, `check:<app>`, or `generate:<language>` entry
  points.
- `test`, `test:unit`, `test:contract`, and `test:hook-integration` read the
  TypeSpec-emitted `testSuites` routing table and execute the declared suite
  commands. Add, remove, or rename root test suites in
  `specs/typespec/sdk/main.tsp`, not in `package.json`.
- `lint` and `format` read the TypeSpec-emitted `qualityCommands` table. Add
  quality command path or tool changes in `specs/typespec/sdk/main.tsp`, not in
  `package.json`.
- `audit:security` reads the TypeSpec-emitted security audit section in
  `codegen/fixtures/sdk-targets.json` for package audit commands and annotated
  secret-scan excludes. Add new audited package roots or fixture exclusions in
  `specs/typespec/sdk/main.tsp`; do not hard-code package-specific audit steps
  or unreasoned scan allowlists in `scripts/security-audit.mjs`.
- `ci:local` reads the TypeSpec-emitted `localCi.steps` pipeline and executes
  those commands in order. Add or reorder local CI gates in
  `specs/typespec/sdk/main.tsp`, not in `package.json`.
- Spec-bound apps currently include the VS Code extension and n8n custom-node
  package. The VS Code extension declares its package manifest surface in
  `specs/typespec/sdk/main.tsp`, and `check:sdks` compares that spec to
  `apps/extension/package.json`. The n8n package also consumes a generated
  manifest emitted from `specs/typespec/govern/capabilities.tsp`.

## Local CI

- `ci:local` composes the full local PR/release gate declared in the SDK target
  manifest: `check:sdks`, coverage, bundle build, generated drift, generated
  banners, OpenAPI lint, npm audit, and the repository security audit.

## Operational Scripts

- `sync-runtime-assets.ts` copies runtime templates and exports built plugin
  bundles after the bundle step; this depends on built runtime code and is not
  a spec emitter.
- `lib/spec-steps.mjs` is the shared runner framework for TypeSpec-emitted
  command pipelines.
- `openbox-cli-dev.mjs` is a local developer launcher for the TypeScript CLI.
- `security-audit.mjs` orchestrates TypeSpec-declared package audits and secret
  scanning.
- `spec-drift.ts` compares emitted OpenAPI against deployed/upstream services.
- `check-generated-banners.ts` enforces generated-file provenance.

Rule of thumb: scripts may check, copy, launch, or compare. Anything that
authors SDK/API contract artifacts belongs in the shared TypeSpec emitter and
must be reachable through `npm run generate:sdks`, not a language-specific
script.
