# `.github/workflows/`

| Workflow | Triggers | Purpose |
|---|---|---|
| `codegen.yml` | push to `main`, PR to `main`, `workflow_dispatch` | TypeSpec compile and emitter snapshots, codegen-drift assertion, Spectral lint, breaking-change diff |
| `publish.yml` | semver tag push, `workflow_dispatch` | Release governance, quality, security, optional SonarQube, npm packing, and npm publish |
| `pr-governance.yml` | push to `main`, PR to `main`, `workflow_dispatch` | Branch, PR title, optional commit convention, and sensitive path ownership checks |
| `pr-quality.yml` | push to `main`, PR to `main`, `workflow_dispatch` | npm install, spec/type generation, lint, typecheck, coverage tests, build, optional Codecov and SonarQube |
| `pr-security.yml` | push to `main`, PR to `main`, `workflow_dispatch` | Trivy filesystem scan and Gitleaks secret scan with SARIF artifacts |
| `test.yml` | push to `main`, PR to `main`, `workflow_dispatch` | TypeScript compile, lint, generated spec/type checks, Vitest unit, contract, and hook integration tests |
| `spec-drift.yml` | `workflow_dispatch` only | Reports drift between this repo's TypeSpec and the live deployments plus the upstream service repositories. PR and scheduled triggers are commented out until the secrets and first run validate clean |
| `release-branch.yml` | `v*` tag push, `workflow_dispatch` | Builds and creates a `release-v*` branch with committed `dist/` so consumers can install from `github:OpenBox-AI/openbox-sdk#release-v*` without running `prepare` |

## Required repo secrets

| Secret | Used by | Notes |
|---|---|---|
| `CODECOV_TOKEN` | `pr-quality.yml` | Optional token for Codecov coverage uploads |
| `OPENBOX_STAGING_API_URL` | `spec-drift.yml`, staging tier | Backend staging base URL. Read by CI only; not shipped in SDK code |
| `SONAR_HOST_URL` | `pr-quality.yml`, `publish.yml` | Optional SonarQube server URL |
| `SONAR_TOKEN` | `pr-quality.yml`, `publish.yml` | Optional token for SonarQube analysis |
| `UPSTREAM_REPO_TOKEN` | `spec-drift.yml`, develop and main tiers | PAT with `repo:read` scope for `gh api` calls into the upstream service repositories. Read-only by intent. The workflow never pushes or comments on those repos |

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
gh workflow run release-branch.yml --ref main -f tag=v1.2.3
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
