# `.github/workflows/`

| Workflow | Triggers | Purpose |
|---|---|---|
| `codegen.yml` | push to `main`, PR to `main`, `workflow_dispatch` | TypeSpec compile and emitter snapshots, codegen-drift assertion, Spectral lint, breaking-change diff |
| `test.yml` | `workflow_dispatch` only | Vitest unit and e2e suite. Push and PR triggers are commented out until the e2e harness is hardened |
| `spec-drift.yml` | `workflow_dispatch` only | Reports drift between this repo's TypeSpec and deployed prod and staging, plus upstream `OpenBox-AI/openbox-backend` and `OpenBox-AI/openbox-core` on `develop` and `main`. PR and scheduled triggers are commented out until the secrets and first run validate clean |
| `release-branch.yml` | `workflow_dispatch` only | Builds and creates a `release-v*` branch with committed `dist/` so consumers can `github:.../#release-v*` install without running `prepare`. Tag-push trigger is commented out until consumers verify the new SDK |

## Required repo secrets

| Secret | Used by | Notes |
|---|---|---|
| `OPENBOX_STAGING_API_URL` | `spec-drift.yml`, staging tier | Backend staging base URL. Kept out of `specs/environments.json`, which ships public |
| `UPSTREAM_REPO_TOKEN` | `spec-drift.yml`, develop and main tiers | PAT with `repo:read` scope for `gh api` calls into `OpenBox-AI/openbox-backend` and `OpenBox-AI/openbox-core`. Read-only by intent. The workflow never pushes or comments on those repos |

If any secret is unset, the matching tier emits a "skipped" report
instead of failing the run. Other tiers continue independently;
the matrix uses `fail-fast: false`.

## How to run a dispatch-only workflow

GitHub UI: Actions tab, pick the workflow, "Run workflow", choose a
branch.

Via `gh`:

```bash
gh workflow run test.yml          --ref main
gh workflow run spec-drift.yml    --ref main
gh workflow run release-branch.yml --ref main -f tag=v0.2.0-alpha.1
```

## How to enable a dispatch-only workflow on push/PR

Replace the `on:` block in the workflow YAML:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

`codegen.yml` already uses this pattern, so it's the reference.
