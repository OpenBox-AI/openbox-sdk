# Contributing to openbox-sdk

The repo is **spec-driven**: TypeSpec is the source of truth, emitters
turn it into TS source under `ts/src/**/generated/`, and the rest is
hand-written code that consumes those generated artifacts. Most
non-trivial changes are a one-line spec edit + regen.

## The spec-vs-hand-coded boundary

The repo has a consistent rule for "what gets spec'd vs hand-coded":

| Spec it (TypeSpec) | Hand-code it |
|---|---|
| Wire schemas, HTTP method shapes | OAuth flows, browser launch, interactive prompts |
| Govern protocol (event types, verdicts, presets, adapters) | `fs.readFileSync` / `JSON.parse` / `randomUUID` primitives |
| Adapter transport + verdict shapes + activity routing tables | Process boundary glue (stdin/stdout/exit codes) |
| Per-tool activity payload field map (`@payloadShape`) | Algorithmic transforms (redaction, JSON merge) |
| Adapter install target + per-event timeout (`@installTarget`) | UI / display formatting (`output.ts`, `outputList.ts`) |
| Env var names, OS path semantics | Test fixtures, mock state |
| CLI command structure: args, flags, validators, body-key map, output kind, backend method, maturity, feature flags | CLI command bodies that do non-canonical work (preflight checks, --json fallbacks, runtime-key one-time prints) |

The line is roughly: **structural / contractual stuff goes in the spec,
data-shaping logic and platform-boundary primitives stay hand-coded**.
When in doubt, ask "would another language SDK want this?" - yes ⇒
spec, no ⇒ hand-code.

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

1. Edit `specs/typespec/govern/adapters.tsp`. Add an `@adapter(...)`
   interface plus, on each operation:
   - `@hookEvent("...")` + `@verdictShape("...")`
   - `@activityRouting(#{ ... })` if multiple activity_types dispatch from one
     hook event
   - `@payloadShape(#{ default, byTool? })` declaring the activity
     payload field map, OR `@noPayload` for lifecycle-only ops
   - `@installTimeout(seconds)` on long-running events
   On the interface itself: `@installTarget(#{ file, key, style,
   command, configDir })` so the install command knows where to write
   its hook block.
2. `npm run specs:all`. Generates
   `core-client/generated/runtime/<adapter>.ts` carrying the adapter
   factory, `INSTALL_SPEC`, `<EVENT>_ROUTING` constants, and one
   `build<Op>Payload(env, toolName?, sideEffects)` per op.
3. Add `ts/src/runtime/<platform>/side-effects.ts` supplying impls for
   any `sideEffect:` callbacks declared in the spec (`readFile`,
   `stringify`, `extractMcpText`, etc).
4. Add `ts/src/runtime/<platform>/install.ts` (~10 LOC: import
   `INSTALL_SPEC` + delegate to `installAdapter` /
   `uninstallAdapter` from `runtime/_shared/install.ts`).
5. Add per-event mappers under `ts/src/runtime/<platform>/mappers/`.
   Each mapper is now a thin shell: load envelope → call generated
   builder → fire activity → halt-mark. ~30-50 LOC each.
6. Add a CLI subcommand at `ts/src/cli/commands/<platform>.ts` and
   register in `cli/index.ts`. Mark `@cli_maturity("experimental")` in
   the spec until verified.

### Add a new CLI subcommand (canonical CRUD)

1. Edit `specs/typespec/cli/main.tsp`. Add the operation under the
   right `@cli_command` interface with all the H.3 decorators:
   - `@cli_calls("methodName", "positional"|"body")`
   - `@cli_output_kind("table"|"list"|"kv"|"json"|"custom", label?)`
   - `@cli_pagination` if the op accepts page/limit
   - `@cli_flag(...)` per parameter
   - Per-flag extras: `@cli_body_key(...)`, `@cli_parse(...)`,
     `@cli_choice(...)`, `@cli_default(...)`, `@cli_variadic`
   - `@cli_validator("validateIsoDate")` for inline validators
2. `npm run specs:all`. Generates the matching
   `cli/generated/cli-handlers/<cmd>.ts` + updates
   `cli-maturity.ts` + `cli-features.ts`.
3. Done - `wireSubcommands(parent, <CMD>_HANDLERS, getClient)` in the
   command file picks up the new entry. No hand-written commander
   wiring needed.
4. If the command's body construction is genuinely non-canonical
   (preflight checks, hand-rolled DTO defaults, --json fallback
   merging), use `@cli_output_kind("custom")` instead and put the
   action body in `ts/src/cli/commands/<name>.ts`.

### Promote a CLI subcommand from experimental to stable

1. Run `npm run test:e2e` against the live backend covering that
   subcommand path.
2. Edit the spec: change `@cli_maturity("experimental")` to
   `@cli_maturity("stable")` (or remove the override if the parent
   interface is `@cli_maturity("stable")`).
3. `npm run specs:all`. The generated `cli-maturity.ts` table updates;
   the runtime gate stops hiding it from `--help`.

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
