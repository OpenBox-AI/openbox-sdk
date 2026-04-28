# `.github/workflows/`

| Workflow | Triggers | Purpose |
|---|---|---|
| `codegen.yml` | `workflow_dispatch` only | Drives TypeSpec compile + emitter - gated until consumers cut over. |
| `test.yml` | `workflow_dispatch` only | Vitest suite. Same gating as codegen. |
| `spec-drift.yml` | `workflow_dispatch` only (PR + daily commented out) | TypeSpec ↔ deployed prod/staging + upstream develop/main drift detector. Re-enable PR/schedule once secrets + first run validate clean. |
| `release-branch.yml` | `workflow_dispatch` only (tag-push commented out) | Builds + creates `release-v*` branch with committed `dist/` so consumers can `github:.../#release-v*` install fast. Re-enable tag trigger once consumers verify the new SDK. |

**All four workflows ship disabled.** Each has a `workflow_dispatch` entry so you can run on demand from the Actions tab. Re-enabling = uncomment the natural triggers in each YAML.

## Required repo secrets

| Secret | Used by | Notes |
|---|---|---|
| `OPENBOX_STAGING_API_URL` | `spec-drift.yml` (staging tier) | Backend staging base URL. Sensitive - kept out of `specs/environments.json` which is public. |
| `UPSTREAM_REPO_TOKEN` | `spec-drift.yml` (develop/main tiers) | PAT (`repo:read` scope) for `gh api` calls into `OpenBox-AI/openbox-{backend,core}`. Read-only by intent - workflow never pushes/comments on those repos. |

If any secret is unset, the corresponding tier emits a "skipped"
report instead of failing the run. Other tiers continue independently
(`fail-fast: false` on the matrix).

## Codegen workflows: why disabled

## Why codegen + test are disabled

This pipeline provides the TypeSpec source, decorator libraries, and a TS
emitter that produces `ts/<package>/src/generated/`. While codegen sources are still hand-mirrored
swaps consumers (`rust/build.rs`, `openapi-typescript`,
`@openbox/env`) over to read **only** the generated artifacts,
running CI against the `assert no uncommitted codegen drift` step
would fail every contributor's PR for unrelated reasons. Better to
keep the pipeline runnable on demand and turn it on once the
authoring side is the source of truth. (`spec-drift.yml` is enabled
because it's purely informational - never fails a PR; only comments.)

## How to run on demand

GitHub UI → Actions tab → pick `Codegen Pipeline` or `Test` →
"Run workflow" → choose a branch.

Or via gh CLI:

```bash
gh workflow run codegen.yml --ref feat/typespec-codegen-pipeline
gh workflow run test.yml    --ref feat/typespec-codegen-pipeline
```

## How to enable

When the codegen pipeline takes over, swap the `on:` block in each workflow file to:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

The rest of the workflow is already wired correctly.
