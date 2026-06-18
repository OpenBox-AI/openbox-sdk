# Contributing to openbox-sdk

The repo is **spec-driven**. TypeSpec is the source of truth, emitters
turn it into TS source under `ts/src/**/generated/`, and the rest is
hand-written code that consumes those generated artifacts. Most
non-trivial changes are a one-line spec edit plus a regen.

## The spec-vs-hand-coded boundary

Consistent rule for what gets specced vs hand-coded:

| Spec it in TypeSpec | Hand-code it |
|---|---|
| Wire schemas and HTTP method shapes | OAuth flows, browser launch, interactive prompts |
| Govern protocol: event types, verdicts, presets, adapters | `fs.readFileSync`, `JSON.parse`, `randomUUID` primitives |
| Adapter transport, verdict shapes, activity routing tables | Process-boundary glue: stdin, stdout, exit codes |
| Per-tool activity payload field map via `@payloadShape` | Algorithmic transforms: redaction, JSON merge |
| Adapter install target and per-event timeout via `@installTarget` | Display formatting in `output.ts`, `outputList.ts` |
| Env var names and OS path semantics | Test fixtures, mock state |
| CLI command structure: args, flags, validators, body-key map, output kind, backend method, maturity, feature flags | Non-canonical CLI command bodies: preflight checks, `--body` fallbacks, runtime-key one-time prints |

Roughly: **structural and contractual code goes in the spec;
data-shaping logic and platform-boundary primitives stay hand-coded**.
When in doubt, ask "would another SDK target want this?". Yes means
spec; no means hand-code.

The TypeScript boundary is enforced by:

- The `// AUTO-GENERATED` banner check (`npm run lint:generated-banners`)
- The `check:generated-drift` script asserts `git diff --exit-code` on
  `ts/src/**/generated/` after a full regen. CI runs the same check on
  every PR.
- Per-package contracts: hand-written code uses generated `interface`
  and `type` annotations so a spec change that's not reflected in code
  fails `tsc` at compile time.

## Common contributor flows

### Add a new framework preset for a new agent SDK

1. Edit `specs/typespec/govern/main.tsp`, add a new `@preset`-decorated
   interface.
2. `npm run specs:all`. The emitter generates a typed `<X>Session`
   class and adds it to the `presets` registry.
3. `npm test`. Consumers can now write
   `govern({ ..., preset: presets.<x> }, ...)`.

### Add a new runtime adapter for an LLM host with a hook protocol

1. Edit `specs/typespec/govern/adapters.tsp`. Add an `@adapter(...)`
   interface, plus on each operation:
   - `@hookEvent("...")` and `@verdictShape("...")`
   - `@activityRouting(#{ ... })` if multiple activity_types dispatch
     from one hook event
   - `@payloadShape(#{ default, byTool? })` declaring the activity
     payload field map, or `@noPayload` for lifecycle-only ops
   - `@installTimeout(seconds)` on long-running events
   On the interface itself, `@installTarget(#{ file, key, style,
   command, configDir })` tells the install command where to write the
   hook configuration.
2. `npm run specs:all`. Generates
   `core-client/generated/runtime/<adapter>.ts` carrying the adapter
   factory, `INSTALL_SPEC`, `<EVENT>_ROUTING` constants, and one
   `build<Op>Payload(env, toolName?, sideEffects)` per op.
3. Add `ts/src/runtime/<platform>/side-effects.ts` supplying impls for
   any `sideEffect:` callbacks declared in the spec (`readFile`,
   `stringify`, `extractMcpText`, etc).
4. Add `ts/src/runtime/<platform>/install.ts`. Around 10 LOC: import
   `INSTALL_SPEC` and delegate to `installAdapter` / `uninstallAdapter`
   from `@openbox-ai/openbox-sdk/install`.
5. Add per-event mappers under `ts/src/runtime/<platform>/mappers/`.
   Each mapper is a thin shell: load envelope, call generated builder,
   fire activity, mark halt. Around 30–50 LOC each.
6. Add a CLI subcommand at `ts/src/cli/commands/<platform>.ts` and
   register it in `cli/index.ts`. Mark `@cli_maturity("experimental")`
   in the spec until verified.

### Add a new CLI subcommand (canonical CRUD)

1. Edit `specs/typespec/cli/main.tsp`. Add the operation under the
   right `@cli_command` interface with the wiring decorators:
   - `@cli_calls("methodName", "positional"|"body")`
   - `@cli_output_kind("table"|"list"|"kv"|"json"|"custom", label?)`
   - `@cli_pagination` if the op accepts page/limit
   - `@cli_flag(...)` per parameter
   - Per-flag extras: `@cli_body_key(...)`, `@cli_parse(...)`,
     `@cli_choice(...)`, `@cli_default(...)`, `@cli_variadic`
   - `@cli_validator("validateIsoDate")` for inline validators
2. `npm run specs:all`. Generates the matching
   `cli/generated/cli-handlers/<cmd>.ts`, plus updates to
   `cli-maturity.ts` and `cli-features.ts`.
3. `wireSubcommands(parent, <CMD>_HANDLERS, getClient)` in the command
   file picks up the new entry. No hand-written commander wiring
   needed.
4. If the command body is genuinely non-canonical (preflight checks,
   hand-rolled DTO defaults, --body fallback merging), use
   `@cli_output_kind("custom")` and put the action body in
   `ts/src/cli/commands/<name>.ts`.

### Promote a CLI subcommand from experimental to stable

1. Run `npm run test:e2e` against the live backend covering that
   subcommand path.
2. Edit the spec: change `@cli_maturity("experimental")` to
   `@cli_maturity("stable")` (or remove the override if the parent
   interface is `@cli_maturity("stable")`).
3. `npm run specs:all`. The generated `cli-maturity.ts` table updates,
   and the runtime gate stops hiding it from `--help`.

### Add a new env var

1. Edit `specs/typespec/env/main.tsp`. Add a field on `RuntimeConfig`
   (URLs / runtime config), `Credentials` (secrets), or
   `CliRuntimeConfig` (CLI-only gating) with `@env_var("OPENBOX_...")`.
2. `npm run specs:all`. The emitter adds the var to `ENV_VAR_BINDINGS`.
3. Code reading the var imports `ENV_VAR_BINDINGS` from
   `@openbox-ai/openbox-sdk/env` and reads `process.env[BINDING.name]`. No magic
   string lookups, no drift.

## Commit conventions

The repo uses Conventional Commits (`feat:` / `fix:` / `chore:` etc.).
A `commit-msg` hook runs commitlint, so local commits reject when the
subject doesn't conform. Messages should say *why*, not *what*: the
diff already shows the what.

Co-author trailers: don't add them. The history is one voice on
purpose.

## Local development

```bash
npm install                    # workspaces resolve in topological order
npm run specs:all              # TypeSpec compile, emitters, openapi-typescript
npm run build                  # codegen + bundle to dist/
npm test                       # vitest unit + contract + hook integration
npm run test:e2e               # CLI e2e with explicit OPENBOX_CLI
npm run check:generated-drift  # asserts no uncommitted regen output
```

For UI work in `apps/extension/`:

```bash
cd apps/extension
npm run watch       # esbuild watcher
npm run package     # builds the .vsix
```

## Filing issues and PRs

External contributors: open an issue first, especially for non-trivial
changes. The spec is opinionated. What looks like a missing feature
may be a deliberate non-goal (multi-policy-per-agent, custom event
types beyond the canonical six, etc.).
