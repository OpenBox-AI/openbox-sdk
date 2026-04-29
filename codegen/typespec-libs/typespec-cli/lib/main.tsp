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

/**
 * CLI maturity gate. `stable` ships in the default surface; `beta`
 * requires --experimental=beta (or env); `experimental` requires
 * --experimental. Decorator can target a whole command interface
 * (gates the whole subtree) or a single operation (gates one
 * subcommand within an otherwise-stable parent).
 *
 * Default if unspecified: anything not labeled is treated as
 * `experimental` by the runtime - the conservative default flips
 * promotion into a deliberate spec edit, not a silent expansion.
 */
extern dec cli_maturity(
  target: Interface | Operation,
  level: valueof "stable" | "beta" | "experimental",
);

/**
 * Fine-grained feature flag inside an otherwise-stable command. Use
 * a dotted lowercase name scoped under the command:
 *   `agent.list.include-deleted`, `audit.deep-scan`,
 *   `doctor.migrate-config-v2`.
 *
 * Each flag carries its own maturity. Code paths use
 * `isFeatureEnabled('agent.list.include-deleted')` to gate experimental
 * branches inside otherwise-stable command code.
 */
extern dec feature_flag(
  target: Operation | ModelProperty,
  name: valueof string,
  maturity: valueof "stable" | "beta" | "experimental",
);

/**
 * Tells the emitter which `OpenBoxClient` method this CLI op invokes
 * and how its arguments are arranged.
 *
 * @param method Name of the wrapper method on the generated client
 *   (e.g. "getTrustHistories", "listAgents").
 * @param shape "body" (default) - TypeSpec positional params go positional
 *   in the call and flags merge into a final body object;
 *   "positional" - every parameter (positional + flag) goes positional
 *   in declaration order. Use "positional" for the older client methods
 *   that take individual scalar args.
 */
extern dec cli_calls(
  target: Operation,
  method: valueof string,
  shape?: valueof "positional" | "body",
);

/**
 * Picks the output renderer the CLI runs after the backend call.
 * Adding a new kind requires extending the runtime helper as well as
 * this enum + the emitter's switch statement.
 *
 * @param kind table | list | json | kv | custom
 * @param label `list`-only: shown when the page is empty
 *   (e.g. "trust events", "agents").
 */
extern dec cli_output_kind(
  target: Operation,
  kind: valueof "table" | "list" | "json" | "kv" | "binary" | "custom",
  label?: valueof string,
);

/**
 * Marks the operation as accepting the canonical pagination flag set:
 *   -p / --page <n>  (default '0')
 *   -l / --limit <n> (default '10')
 *
 * The runtime helper auto-merges them into the body via
 * `parsePagination(opts)`.
 */
extern dec cli_pagination(target: Operation);

/**
 * Renames a flag's body key. Default body key = the flag's parameter
 * name verbatim. Use this when the wire shape disagrees with the CLI
 * naming (e.g. `--from` → `fromTime`).
 */
extern dec cli_body_key(target: ModelProperty, key: valueof string);

/**
 * Coerces a flag's string value before merging into the body.
 *   "int"  → parseInt
 *   "json" → JSON.parse (with helpful error)
 *   "csv"  → split on `,` to a string[]
 *   "bool" → "true" / "false" → boolean (anything else stays string)
 */
extern dec cli_parse(target: ModelProperty, kind: valueof "int" | "json" | "csv" | "bool");

/**
 * Restricts a flag to one of a fixed set of strings. Validated locally
 * before the backend call so a typo doesn't return an empty result.
 */
extern dec cli_choice(target: ModelProperty, values: valueof string[]);

/**
 * Default value for a flag (string form - coerced via @cli_parse if any).
 */
extern dec cli_default(target: ModelProperty, value: valueof string);

/**
 * Marks a flag as variadic (Commander `<value...>`). Repeats of the flag
 * collect into an array; the array value is the body value verbatim.
 */
extern dec cli_variadic(target: ModelProperty);

/**
 * Marks a flag as required (Commander `requiredOption`). Without it
 * the user gets a clear "missing required option --x" error before
 * the action runs. Use sparingly - required flags break tab-completion
 * UX and are usually a sign the field belongs as a positional arg.
 */
extern dec cli_required(target: ModelProperty);

/**
 * Dotted path into the response - the renderer reads
 * `getPath(data, path)` and renders the sub-value instead of the full
 * envelope. Use when the wire returns a wrapper like
 * `{ approvals: { data: [...] }, metrics: {...} }` and you want
 * `outputList(approvals)` rendering, not the wrapper.
 */
extern dec cli_output_pluck(target: Operation, path: valueof string);

/**
 * Names a callback (registered via wire-subcommands.OUTPUT_POST_REGISTRY)
 * the runtime invokes after `output()` returns. The callback receives
 * the original response data (pre-pluck). Used for stderr banners -
 * e.g. the runtime-key highlight that fires after `agent create` and
 * `api-key rotate`.
 */
extern dec cli_output_post(target: Operation, callbackName: valueof string);

/**
 * Marks an op as accepting a `--json <body>` escape hatch alongside
 * its per-flag overrides. Auto-emits a `--json` flag onto the
 * subcommand; the runtime parses and merges per the chosen mode.
 *
 * Mode "fill" (default): --json is the body base, flag values fill
 *   missing keys (audit export, guardrail create pattern).
 * Mode "replace": --json fully replaces the flag-derived body when
 *   present (audit preview, team create pattern).
 *
 * @cli_required flags become "must be present in the merged body" -
 * the check runs after the merge instead of via Commander's
 * requiredOption (which can't see inside --json).
 */
extern dec cli_json_merge(
  target: Operation,
  mode?: valueof "fill" | "replace" | "only",
);

/**
 * Cross-field constraint: at least one of these parameter names must
 * be set on the command line (or present in --json when paired with
 * @cli_json_merge). Closes the team-create "name OR icon required"
 * rule that doesn't fit @cli_required (which is per-field).
 */
extern dec cli_at_least_one(target: Operation, fields: valueof string[]);

/**
 * Cross-field constraint: when ANY of the named flags is set, ALL of
 * them must be set. Bypassed entirely when --json is supplied
 * (jsonMerge "replace"). Closes the goal-update "all four config
 * fields required together unless --json" rule.
 */
extern dec cli_required_together(target: Operation, fields: valueof string[]);

/**
 * Marks an op as local-only - it never calls the OpenBox backend or
 * core. Documents intent in spec; the cli-import-allowlist drift test
 * guarantees the implementation matches.
 */
extern dec cli_local_only(target: Operation);

/**
 * Names a callback registered in PREFLIGHT_REGISTRY (in
 * wire-subcommands.ts) the runtime invokes BEFORE the main backend
 * call. Receives the merged body + the client resolver. Used for
 * `agent create`'s team-existence + name-collision pre-flight GETs
 * that would orphan the agent if skipped.
 */
extern dec cli_preflight(target: Operation, callbackName: valueof string);

/**
 * Declarative DTO defaults - JSON literal merged into the body for
 * keys the user didn't set. Order: --json (if jsonMerge) → flag
 * values → dto_defaults. Used for `agent create`'s hardcoded AIVSS
 * baseline so the user can omit it without the backend rejecting.
 */
extern dec cli_dto_defaults(target: Operation, defaults: valueof Record<unknown>);

/**
 * Names a callback registered in POST_VALIDATE_REGISTRY that runs
 * AFTER body assembly and BEFORE the call. Lets the spec wire cross-
 * field validators (behavior's validateApprovalTimeout(verdict,
 * approval_timeout) for instance) without leaving the action body to
 * do it. Stackable - @cli_post_validate can be repeated for multiple
 * checks per op.
 */
extern dec cli_post_validate(target: Operation, callbackName: valueof string);
