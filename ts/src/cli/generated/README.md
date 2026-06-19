# `ts/src/cli/generated/`

**AUTO-GENERATED. Do not hand-edit any file in this directory.**

| Source | Reproduces |
|---|---|
| `specs/typespec/cli/main.tsp` | the `Auth` interface, the `EnvFlag`, `AuthProfileOutput`, and `PersistedCredentials` types, and `CLI_COMMAND_MANIFEST` |
| `codegen/emitters/typespec-emitter-openbox/src/index.ts` | the emit logic |

Regenerate with `npm run specs:compile`.

## How hand-written CLI code uses this

Two consumption patterns:

- **`CLI_COMMAND_MANIFEST`.** Generated metadata records command,
  subcommand, and flag shapes for drift checks and typed handlers.
  Active command registration remains hand-authored in `ts/src/cli/`.
- **The `<Command>` interfaces, e.g. `Auth`.** Hand-written handler
  functions annotate themselves with `Auth['setApiKey']` and
  `Auth['clearApiKey']` so a return-type or argument-list drift from
  the spec is a `tsc` error, not a runtime surprise.

Add a new command by:

1. Declaring the interface in `specs/typespec/cli/main.tsp` with
   `@cli_command` plus per-method `@cli_flag` decorators.
2. Running `npm run specs:compile`.
3. Adding a handler in `ts/src/cli/commands/<name>.ts` that imports
   the new interface and the `CLI_COMMAND_MANIFEST` entry.
