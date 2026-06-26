# Governance Compliance Harness

This document is the lean map for SDK-side governance proof. The canonical
claims live in `specs/typespec/govern/capabilities.tsp` and generated outputs
under `codegen/fixtures/`, `ts/src/**/generated/`, and
`python/openbox_sdk/generated/`.

Generated checklist artifacts:

- `docs/governance-artifacts/capability-checklist.md`
- `docs/governance-artifacts/capability-checklist.csv`
- `docs/governance-artifacts/summary.csv`

## Scope

First-class governance providers and hosts:

- SDK direct governance
- Claude Code
- Codex
- Cursor
- OpenAI Agent SDK
- Anthropic Agent SDK
- MCP protocol
- CopilotKit
- n8n

Reference implementations and neighboring repos are evidence sources only.
They are not counted as provider categories in this SDK checklist.

## Claim Boundary

- `100%` means scored OpenBox-owned checklist coverage.
- Host-owned and caller-owned boundaries remain visible as `[~]` limitations.
- Token/cost adapters collect or forward explicit telemetry; they do not price
  provider spend locally.
- KMS is proven in unsigned local mode and `signing_required=true` local mode.
- Non-native embedding governance is routed through MCP-required governance.

## Proof Lanes

Run the full local-stack proof:

```bash
npm run ci:local-stack
```

The generated local-stack pipeline runs these governance lanes in parallel:

- Claude host and Claude stdin
- Codex
- Cursor
- OpenAI Agent SDK
- Anthropic Agent SDK
- CopilotKit
- n8n
- local KMS signing
- backend/Core governance e2e
- local LlamaFirewall e2e

The runner metadata is generated from `specs/typespec/sdk/main.tsp` into
`codegen/fixtures/sdk-targets.json`; `scripts/run-tests.mjs` and
`scripts/run-root-pipeline.mjs` only route the generated manifest.

List focused local-stack proof lanes:

```bash
npm run local-stack:lane -- --list
```

Run one or more focused lanes without starting unrelated lanes:

```bash
npm run local-stack:lane -- codex-governance
npm run local-stack:lane -- cursor-governance n8n-governance
```

Regenerate checklist artifacts directly:

```bash
npm run governance:checklist
```

## Recorded Hub Proof

Guardrails Hub proof uses a recorded deterministic fixture:

- fixture: `tests/fixtures/guardrails-hub/recorded-results.json`
- recorder: `scripts/record-guardrails-hub.mjs`
- validators: DetectPII, NSFWText, ToxicLanguage, BanList, RegexMatch

Replay the recorded fixture:

```bash
npm run guardrails:hub:replay
```

Check provenance without refreshing the fixture:

```bash
export OPENBOX_GUARDRAILS_REPO=/path/to/openbox-guardrails
npm run guardrails:hub:provenance
```

Refresh from Guardrails Hub only when intentionally updating the recording:

```bash
OPENBOX_RECORD_GUARDRAILS_HUB=1 npm run guardrails:hub:record
```

Normal CI does not call the live Hub. It proves that the checked-in recording is
complete, stable, scrubbed of tokens, and aligned with generated guardrail cases.

## Isolated Fault Lanes

Unavailable-service tests must not stop shared local services. They use
temporary processes or isolated endpoints:

- OPA unavailable: temporary Core server and worker with `OPA_URL` pointed at an
  unavailable local endpoint.
- AGE unavailable: temporary Core server and worker with `AGE_URL` pointed at an
  unavailable local endpoint.
- Guardrails unavailable: temporary backend with `GUARDRAIL_API_URL` pointed at
  an unavailable local endpoint.

Run them directly:

```bash
npm run test:e2e:opa-unavailable
npm run test:e2e:age-unavailable
npm run test:e2e:guardrail-unavailable
```

These lanes prove fail-closed behavior without killing the shared OPA,
Guardrails, AGE, backend, or Core services.

## Focused Checks

Use these before the full gate when editing governance claims:

```bash
npm run specs:compile
npm run check:generated-drift
npx vitest run --project unit tests/unit/provider-capability-matrix.test.ts
npx markdownlint-cli2 docs/governance-compliance-harness.md
```
