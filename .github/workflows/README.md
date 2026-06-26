# `.github/workflows/`

| Workflow            | Triggers                                                    | Purpose                                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `codegen.yml`       | push to `main`, PR to `main`/`develop`, `workflow_dispatch` | TypeSpec compile and emitter snapshots, codegen-drift assertion, Spectral lint, breaking-change diff                                                                                                   |
| `publish.yml`       | semver tag push, `workflow_dispatch` from `main` only       | Release governance, cross-language SDK quality, security, optional SonarQube, npm packing, and npm publish with `beta`, `rc`, or `latest` dist-tags                                                    |
| `pr-governance.yml` | push to `main`, PR to `main`/`develop`, `workflow_dispatch` | Branch, PR title, optional commit convention, and sensitive path ownership checks                                                                                                                      |
| `pr-quality.yml`    | push to `main`, PR to `main`/`develop`, `workflow_dispatch` | npm install, generic SDK validation for TypeScript and Python, coverage tests, build, optional Codecov and SonarQube                                                                                   |
| `pr-security.yml`   | push to `main`, PR to `main`/`develop`, `workflow_dispatch` | Trivy filesystem scan and Gitleaks secret scan with SARIF artifacts                                                                                                                                    |
| `test.yml`          | push to `main`, PR to `main`/`develop`, `workflow_dispatch` | Generic SDK validation across Node 20/22: TypeSpec generation, TypeScript lint/type/test, and Python lint/type/test/build                                                                              |
| `spec-drift.yml`    | `workflow_dispatch` only                                    | Reports drift between this repo's TypeSpec and the live deployments plus the upstream service repositories. PR and scheduled triggers are commented out until the secrets and first run validate clean |

## Required repo secrets

| Secret                | Used by                                  | Notes                                                                                                                                                           |
| --------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CODECOV_TOKEN`       | `pr-quality.yml`                         | Optional token for Codecov coverage uploads                                                                                                                     |
| `OPENBOX_API_URL`     | `spec-drift.yml`, staging tier           | Backend staging base URL. Read by CI only; not shipped in SDK code                                                                                              |
| `SONAR_HOST_URL`      | `pr-quality.yml`, `publish.yml`          | Optional SonarQube server URL                                                                                                                                   |
| `SONAR_TOKEN`         | `pr-quality.yml`, `publish.yml`          | Optional token for SonarQube analysis                                                                                                                           |
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
```

## Release channels

The npm publish workflow runs from semver tags. The tag must match the
`package.json` version exactly, ignoring a leading `v`.

| Version shape     | Example tag     | npm dist-tag |
| ----------------- | --------------- | ------------ |
| beta prerelease   | `v0.1.2-beta.0` | `beta`       |
| release candidate | `v0.1.2-rc.0`   | `rc`         |
| stable            | `v0.1.2`        | `latest`     |

Stable releases are only allowed when the tag commit is reachable from
`origin/main`. Develop preview releases must use a beta prerelease tag,
for example `v0.1.2-beta.0`; do not push `v0.1.2` from develop.

## How to enable a dispatch-only workflow on push/PR

Replace the `on:` block in the workflow YAML:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main, develop]
```

`codegen.yml` and `test.yml` use this pattern: full checks for PRs,
prod/main push checks only after merge.
