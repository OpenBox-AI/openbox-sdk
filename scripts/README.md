# Scripts Audit

Generation is TypeSpec-owned. `tsp compile specs/typespec` runs the OpenBox
emitter and writes TypeScript and Python generated SDK artifacts from the same
canonical TypeSpec contract.

Every file under `scripts/` is cataloged in the TypeSpec-emitted
`scriptInventory` section of `codegen/fixtures/sdk-targets.json`. Adding a new
script requires adding a canonical record in `specs/typespec/sdk/main.tsp`; the
unit suite compares that inventory against the repository tree.

## Emitter-Owned

- `generate:sdks` is the generic SDK artifact generation command. It builds
  the TypeSpec-emitted `sdkGeneration.steps` pipeline. TypeScript, Python,
  OpenAPI, JSON Schema, and future language targets must all hang off this
  command. If generated fixtures were cleaned, it falls back to the bootstrap
  generation sequence long enough to regenerate the canonical manifest.
  Package script synchronization also runs from this pipeline so
  `package.json` command entries are materialized from TypeSpec, not edited as
  a parallel source of truth.
- `specs:compile` and `specs:watch` read the TypeSpec-emitted `specCommands`
  table. These low-level TypeSpec commands keep a bootstrap fallback because
  SDK generation may need them before the emitted fixture exists.
- `build:codegen` reads the TypeSpec-emitted `codegenBuild.steps` pipeline from
  `codegen/fixtures/sdk-targets.json` and builds the TypeSpec decorator
  libraries plus shared emitter. If generated fixtures were cleaned, it falls
  back to codegen package metadata only long enough to regenerate the
  canonical manifest.
- `build:bundle` reads the TypeSpec-emitted `bundleBuild.steps` pipeline for
  bundling and runtime asset sync. Add build-stage changes in
  `specs/typespec/sdk/main.tsp`, not in the root package script.
- `build` and `check:sdks` read TypeSpec-emitted `rootPipelines` entries. Keep
  high-level root pipeline composition in `specs/typespec/sdk/main.tsp`, not in
  `package.json`.
- `check:generated-drift` reruns `npm run generate:sdks`, then checks generated
  TypeScript, Python, OpenAPI, JSON Schema, TypeSpec-emitted contract metadata
  maps, CLI/env/lifecycle fixtures, conformance fixture artifacts, and
  generated-adjacent synced files such as root `package.json` scripts for drift.
  The artifact inventory comes from the TypeSpec-emitted
  `codegen/fixtures/sdk-targets.json` manifest, not from a script-local target
  list.
- `lint:generated-banners` and `check:generated-drift` are routed by the
  TypeSpec-emitted `generatedChecks` table, so generated-artifact checks are
  declared alongside their generated artifact inventory.
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
- Root `package.json` scripts are also declared in the TypeSpec-emitted
  `packageScripts` table. The package script test compares `package.json`
  exactly against that table so new root entrypoints must be intentional
  spec-owned routers or explicit npm lifecycle/compatibility aliases.
- `test`, `test:unit`, `test:openapi-mock`, `test:contract`,
  `test:hook-integration`, `test:e2e`, and governance e2e entrypoints read the
  TypeSpec-emitted `testSuites` routing table and execute the declared suite
  commands. Governance e2e starts with `local-stack:check`, which fails fast if
  backend/Core endpoints, Guardrails, AGE, LlamaFirewall, OPA bundle polling,
  and the AWS-compatible S3 bucket are not aligned. Governance domains that do
  not mutate the shared backend-owned OPA bundle run as independent parallel
  suite lanes. Policy/OPA bundle mutators stay as separate serial suite modules
  unless the local stack provides per-lane backend/OPA isolation. Shared
  dependency failure cases run in isolated lanes with dependency URLs pointed at
  unavailable endpoints, not by stopping shared local-stack services. Add,
  remove, or rename root test suites in `specs/typespec/sdk/main.tsp`, not in
  `package.json`.
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
- `ci:local-stack` reads the TypeSpec-emitted `rootPipelines` table and runs
  the deterministic local CI gate plus the live local-stack e2e suite. This is
  the canonical full local-stack verification command and requires backend/core
  services plus local test credentials.
- `spec-drift.ts` is declared in the TypeSpec-emitted `serviceDrift` section.
  Its service/tier matrix and output path templates are canonical metadata even
  though the script remains a report-only operational comparator.
- Spec-bound apps currently include the VS Code extension and n8n custom-node
  package. The VS Code extension declares its package manifest surface in
  `specs/typespec/sdk/main.tsp`, and `check:sdks` compares that spec to
  `apps/extension/package.json`. The n8n package also consumes a generated
  manifest emitted from `specs/typespec/govern/capabilities.tsp`.

## Local CI

- `ci:local` composes the full local PR/release gate declared in the SDK target
  manifest: generated drift, `check:sdks`, coverage, bundle build, generated
  banners, OpenAPI lint, npm audit, and the repository security audit.
- `ci:local-stack` composes `ci:local` with the live `test:e2e` project for
  backend/core runtime verification against a running local stack.

## Operational Scripts

- `sync-runtime-assets.mjs` copies runtime templates and exports built plugin
  bundles after the bundle step; this depends on built runtime code and is not
  a spec emitter.
- `lib/spec-steps.mjs` is the shared runner framework for TypeSpec-emitted
  command pipelines.
- `openbox-cli-dev.mjs` is a local developer launcher for the TypeScript CLI.
- `security-audit.mjs` orchestrates TypeSpec-declared package audits and secret
  scanning.
- `spec-drift.ts` compares emitted OpenAPI against deployed/upstream services.
- `check-generated-banners.ts` enforces generated-file provenance.
- `sync-package-scripts.mjs` rewrites root `package.json` scripts from the
  TypeSpec-emitted `packageScripts.scripts` table.
- `check-local-stack-alignment.mjs` verifies that the live backend process,
  backend `.env`, Core process, OPA config, Guardrails, AGE, LlamaFirewall, and
  local AWS-compatible S3 endpoint agree before live governance suites run. It
  also checks local KMS mode and requires Core's
  `AGE_CB_SLOW_CALL_THRESHOLD_SEC`, `GOVERNANCE_WORKFLOW_TIMEOUT_SEC`, and
  `GOVERNANCE_ACTIVITY_TIMEOUT_SEC` to be high enough for live Claude Code hook
  teardown, so a slow successful `Stop` hook neither opens the AGE circuit nor
  trips Core's workflow or activity timeout boundaries.
- `local-llamafirewall-server.py` hosts a local HTTP adapter around the
  official LlamaFirewall scanner used by local guardrail drift checks.
- `start-llamafirewall.mjs` starts that adapter using
  `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_MODEL`, and
  `OPENAI_COMPAT_API_KEY` without printing API keys. It verifies the
  selected endpoint/model supports OpenAI structured responses through
  JSON-schema `response_format` or forced tool calls before starting, because
  the official scanner requires structured output.
- `run-local-llamafirewall-e2e.mjs` starts or reuses that adapter and runs the
  focused real-scanner e2e scenario. The default local path uses Ollama with a
  structured-output-capable model; override `OPENBOX_E2E_LLAMAFIREWALL_MODEL`
  when using another local model.
- `run-local-stack-lane.mjs` lists and runs TypeSpec-declared local-stack proof
  lanes by lane id. Use `npm run local-stack:lane -- --list` to inspect the
  generated lane inventory and `npm run local-stack:lane -- <lane-id>` for a
  focused provider, subsystem, or isolated fault lane.

Rule of thumb: scripts may check, copy, launch, or compare. Anything that
authors SDK/API contract artifacts belongs in the shared TypeSpec emitter and
must be reachable through `npm run generate:sdks`, not a language-specific
script.
