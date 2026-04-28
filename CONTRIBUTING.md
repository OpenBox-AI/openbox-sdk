# Contributing to openbox-sdk

The repo is **spec-driven**: TypeSpec is the source of truth, emitters
turn it into TS source under `ts/src/**/generated/`, and the rest is
hand-written code that consumes those generated artifacts. Most
non-trivial changes are a one-line spec edit + regen.

## The spec-vs-hand-coded boundary

The repo has a consistent rule for "what gets spec'd vs hand-coded":

| Spec it (TypeSpec) | Hand-code it |
|---|---|
| Wire schemas, HTTP method shapes | Per-tool payload extraction (Read needs file content, Bash needs cwd) |
| Govern protocol (event types, verdicts, presets, adapters) | Side-effects (writing config files into `~/.claude/`, `~/.cursor/`) |
| Adapter transport + verdict shapes + tool routing tables | Test fixtures, mock state |
| Env var names, OS path semantics | UI / display formatting |
| CLI command structure (args, flags, permissions) | CLI command bodies (the action callback) |

The line is roughly: **structural / contractual stuff goes in the spec,
data-shaping logic and side-effects stay hand-coded**. When in doubt,
ask "would another language SDK want this?" - yes ⇒ spec, no ⇒ hand-code.

The TypeScript boundary is enforced by:
- `// AUTO-GENERATED` banner check (`npm run lint:generated-banners`)
- `check:generated-drift` script asserts `git diff --exit-code` on
  `ts/src/**/generated/` after a full regen - CI does this on every PR
- Per-package contracts: hand-written code uses generated `interface`
  / `type` annotations so a spec change that's not reflected in code
  fails `tsc` at compile time

## Common contributor flows

### Add a new framework preset (e.g. for a new agent SDK)

1. Edit `specs/typespec/govern/main.tsp`, add a new `@preset`-decorated
   interface.
2. `npm run specs:all`. The emitter generates a typed `<X>Session`
   class + adds it to the `presets` registry.
3. `npm test`. Done - consumers can now write
   `govern({ ..., preset: presets.<x> }, ...)`.

### Add a new runtime adapter (new LLM host with hook protocol)

1. Edit `specs/typespec/govern/adapters.tsp`. Add an `@adapter(...)` interface
   with `@hookEvent` + `@verdictShape` (and `@activityRouting` if the
   host dispatches multiple activity_types from one hook event).
2. `npm run specs:all`. Generates `core-client/generated/runtime/<adapter>.ts`.
3. Create `ts/src/runtime/<platform>/index.ts` re-exporting the adapter
   + your platform-specific entry points (install + hook handler +
   per-tool mappers).
4. Add a CLI subcommand at `ts/src/cli/commands/<platform>.ts` that
   wires `install` / `uninstall` / `hook` actions, and register it in
   `cli/index.ts`.
5. Mark commands as `experimental` in `cli/maturity.ts` until verified.

### Add a new CLI command

1. Edit `specs/typespec/cli/main.tsp`, add a `@cli_command(...)` interface
   with operations matching the subcommand structure.
2. `npm run specs:all`. Regenerates `cli-bindings.ts` (the manifest
   the maturity gate + permission pre-flight read).
3. Hand-write `ts/src/cli/commands/<name>.ts` exporting a
   `register<Name>Commands(program: Command)` function. The body wires
   commander.
4. Register the call in `ts/src/cli/index.ts`.
5. If the command needs a backend permission, add it to
   `codegen/method-permissions.json` (the `@Permissions(...)`
   decorators on the openbox-backend controllers are mirrored here).
6. Add an entry to `tests/unit/cli/<name>.test.ts` exercising the
   command's surface against a mock client.

### Add a new env var

1. Edit `specs/typespec/env/main.tsp`. Add a field on `RuntimeConfig`
   (URLs / runtime config), `Credentials` (secrets), or
   `CliRuntimeConfig` (CLI-only gating) with `@env_var("OPENBOX_...")`.
2. `npm run specs:all`. The emitter adds the var to `ENV_VAR_BINDINGS`.
3. Code that reads the var imports `ENV_VAR_BINDINGS` from
   `'openbox-sdk/env'` and reads `process.env[BINDING.name]` - no magic
   string lookup, no drift.

## Commit conventions

The repo uses Conventional Commits (`feat:` / `fix:` / `chore:` / etc).
Pre-commit hook runs commitlint - local commits will reject if the
title doesn't conform. Commit messages should say *why*, not *what*
(the diff already shows the what).

Co-author trailers: don't add them. The repo's commit history is one
voice on purpose.

## Local development

```bash
npm install              # workspaces resolve in topological order
npm run specs:all        # TypeSpec compile → emitters → openapi-typescript
npm run build            # codegen + bundle to dist/
npm test                 # vitest unit + e2e
npm run check:generated-drift  # asserts no uncommitted regen output
```

For UI work in `apps/extension/`:

```bash
cd apps/extension
npm run watch            # esbuild watcher
npm run package          # builds the .vsix
```

## Filing issues + PRs

External contributors: file an issue first, especially for non-trivial
changes. The spec is opinionated - what looks like a missing feature
may be a deliberate non-goal (multi-policy-per-agent, custom event
types beyond the canonical six, etc).
