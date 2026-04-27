# `ts/cli/src/generated/`

**AUTO-GENERATED. Do not hand-edit any file in this directory.**

| Source | Reproduces |
|---|---|
| `specs/typespec/cli/main.tsp` | the `Auth` interface, the `EnvFlag` / `AuthProfileOutput` / `PersistedCredentials` types, and `CLI_COMMAND_MANIFEST` |
| `codegen/emitters/ts/src/index.ts` | the emit logic |

Regenerate with `npm run specs:compile`.

## How hand-written CLI code uses this

Two consumption patterns:

- **`CLI_COMMAND_MANIFEST`** - the commander registration in
  `ts/cli/src/main.ts` walks this array to declare verbs, subcommands,
  flags (long + short + description), and env-var fallbacks. Adding a
  flag in the spec, recompiling, and re-running registers it on the
  CLI without a code edit.

- **The `<Command>` interfaces (e.g. `Auth`)** - hand-written handler
  functions annotate themselves with `Auth['login']` / `Auth['logout']`
  so a return-type or argument-list drift from the spec is a `tsc`
  error, not a runtime surprise.

Add a new command by:

1. Declaring the interface in `specs/typespec/cli/main.tsp` with
   `@cli_command(...)` + per-method `@cli_flag(...)` decorators.
2. Running `npm run specs:compile`.
3. Adding a handler in `ts/cli/src/commands/<name>.ts` that imports
   the new interface and the `CLI_COMMAND_MANIFEST` entry.
