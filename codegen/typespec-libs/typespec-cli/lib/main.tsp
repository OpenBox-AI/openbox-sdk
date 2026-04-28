// typespec-cli - decorators that describe the CLI surface
// in protocol form, separate from any one language's argument parser.
// Per-language emitters lower these to commander/clap/click/cobra
// while the .tsp source captures only the contract: command tree,
// flag names + types + defaults, validators, output schema.

import "../dist/index.js";

using TypeSpec.Reflection;

namespace OpenBox.Cli;

/**
 * Marks an interface as a CLI command (or sub-command group when
 * interfaces are nested via `extends`). The verb shown to users is
 * `commandName` if provided, otherwise the interface name in
 * kebab-case. Interface methods become subcommands; flags come from
 * their parameters annotated with `@cli_flag`.
 *
 * @param commandName Override for the default kebab-cased name.
 * @param description One-line description shown in `<cmd> --help`.
 */
extern dec cli_command(
  target: Interface,
  commandName?: valueof string,
  description?: valueof string,
);

/**
 * Promotes an operation parameter to a CLI flag. The default short
 * form is the first letter of the parameter name unless `short` is
 * given; the long form is `--<paramName-in-kebab-case>`.
 *
 * @param description Help text shown in `--help`.
 * @param short Single-letter alias; pass `""` to disable the short form.
 * @param env Environment variable that supplies a default if the
 *   flag is unset on the command line. Composes with `@env_var` on
 *   models - emitters chain the two when both target the same field.
 */
extern dec cli_flag(
  target: ModelProperty,
  description: valueof string,
  short?: valueof string,
  env?: valueof string,
);

/**
 * Attaches a validator name to a flag. The named validator must exist
 * in the per-language runtime helper bundle (e.g. `validateApiKeyFormat`
 * for the `obx_live_*` regex). Emitters generate the call site; they
 * do not emit the validator body itself.
 *
 * @param name Validator function identifier shared across languages.
 */
extern dec cli_validator(target: ModelProperty, name: valueof string);

/**
 * Marks a model as the structured output payload of a CLI command.
 * Emitters produce both human-readable rendering and a `--json` mode
 * that prints this model verbatim. Only one `@cli_output` per command.
 */
extern dec cli_output(target: Model);
