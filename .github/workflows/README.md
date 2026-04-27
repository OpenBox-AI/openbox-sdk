# `.github/workflows/`

CI for the codegen pipeline. **Both workflows here are gated on
`workflow_dispatch` only - they do not run on push or pull_request
yet.** The codegen pipeline (cutting consumers over to the
generated artifacts) flips the triggers on.

## Why disabled

This pipeline provides the TypeSpec source, decorator libraries, and a TS
emitter that produces `ts/<package>/src/generated/`. While codegen sources are still hand-mirrored
swaps consumers (`rust/build.rs`, `openapi-typescript`,
`@openbox/env`) over to read **only** the generated artifacts,
running CI against the `assert no uncommitted codegen drift` step
would fail every contributor's PR for unrelated reasons. Better to
keep the pipeline runnable on demand and turn it on once the
authoring side is the source of truth.

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
