// Decorator implementations for typespec-cli. See ../env/src/
// decorators.ts for the same shape; getter helpers are exported here
// for emitter consumption; the TypeSpec compiler sees the decorators
// through src/index.ts ($decorators export) only.

import type {
  DecoratorContext,
  Interface,
  Model,
  ModelProperty,
  Operation,
  Program,
} from '@typespec/compiler';
import { reportDiagnostic, stateKeys } from './lib.js';

export interface CommandBinding {
  readonly name: string;
  readonly description: string | undefined;
}

export interface FlagBinding {
  readonly description: string;
  readonly short: string | undefined;
  readonly env: string | undefined;
}

function kebabCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

export function $cli_command(
  context: DecoratorContext,
  target: Interface,
  commandName?: string,
  description?: string,
): void {
  context.program.stateMap(stateKeys.command).set(target, {
    name: commandName ?? kebabCase(target.name),
    description,
  } satisfies CommandBinding);
}

export function getCommand(program: Program, target: Interface): CommandBinding | undefined {
  return program.stateMap(stateKeys.command).get(target);
}

export function $cli_flag(
  context: DecoratorContext,
  target: ModelProperty,
  description: string,
  short?: string,
  env?: string,
): void {
  context.program.stateMap(stateKeys.flag).set(target, {
    description,
    short,
    env,
  } satisfies FlagBinding);
}

export function getFlag(program: Program, target: ModelProperty): FlagBinding | undefined {
  return program.stateMap(stateKeys.flag).get(target);
}

export function $cli_validator(
  context: DecoratorContext,
  target: ModelProperty,
  name: string,
): void {
  context.program.stateMap(stateKeys.validator).set(target, name);
}

export function getValidator(program: Program, target: ModelProperty): string | undefined {
  return program.stateMap(stateKeys.validator).get(target);
}

// ─── Maturity ─────────────────────────────────────────────────
// CLI command surface gating. `stable` ships in the default openbox
// surface; `beta` requires --experimental beta or env opt-in; `experimental`
// requires --experimental. Decorator can target either a whole command
// (Interface) or a single subcommand (Operation).

export type Maturity = 'stable' | 'beta' | 'experimental';
const MATURITY_LEVELS: ReadonlySet<Maturity> = new Set(['stable', 'beta', 'experimental']);

export function $cli_maturity(
  context: DecoratorContext,
  target: Interface | Operation,
  level: string,
): void {
  if (!MATURITY_LEVELS.has(level as Maturity)) {
    reportDiagnostic(context.program, {
      code: 'invalid-maturity',
      format: { level },
      target,
    });
    return;
  }
  context.program.stateMap(stateKeys.maturity).set(target, level as Maturity);
}

export function getMaturity(
  program: Program,
  target: Interface | Operation,
): Maturity | undefined {
  return program.stateMap(stateKeys.maturity).get(target);
}

// ─── Feature flags ────────────────────────────────────────────
// Fine-grained gates inside otherwise-stable commands. Dotted-path
// names: `agent.list.include-deleted`. Each carries its own maturity
// (typically `experimental` or `beta`).

const FEATURE_NAME_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/;

export interface FeatureFlagBinding {
  readonly name: string;
  readonly maturity: Maturity;
}

export function $feature_flag(
  context: DecoratorContext,
  target: Operation | ModelProperty,
  name: string,
  maturity: string,
): void {
  if (!FEATURE_NAME_PATTERN.test(name)) {
    reportDiagnostic(context.program, {
      code: 'invalid-feature-name',
      format: { name },
      target,
    });
    return;
  }
  if (!MATURITY_LEVELS.has(maturity as Maturity)) {
    reportDiagnostic(context.program, {
      code: 'invalid-maturity',
      format: { level: maturity },
      target,
    });
    return;
  }
  context.program.stateMap(stateKeys.featureFlag).set(target, {
    name,
    maturity: maturity as Maturity,
  } satisfies FeatureFlagBinding);
}

export function getFeatureFlag(
  program: Program,
  target: Operation | ModelProperty,
): FeatureFlagBinding | undefined {
  return program.stateMap(stateKeys.featureFlag).get(target);
}

// ─── Backend call binding ─────────────────────────────────────
// Tells the CLI emitter which client method to invoke + how its
// arguments are arranged. Defaults to body-style: positional spec params
// go positional in the client call, all flags merge into a single body
// object passed last.

export type CallShape = 'positional' | 'body';

export interface CallsBackendBinding {
  readonly method: string;
  readonly shape: CallShape;
}

export function $cli_calls(
  context: DecoratorContext,
  target: Operation,
  method: string,
  shape?: string,
): void {
  const s: CallShape = shape === 'positional' ? 'positional' : 'body';
  context.program.stateMap(stateKeys.callsBackend).set(target, {
    method,
    shape: s,
  } satisfies CallsBackendBinding);
}

export function getCallsBackend(
  program: Program,
  target: Operation,
): CallsBackendBinding | undefined {
  return program.stateMap(stateKeys.callsBackend).get(target);
}

// ─── Output style ────────────────────────────────────────────
// Picks the output renderer the action runs after the backend call.
//   table:                  generic record/list renderer
//   list:<label>            paginated-list renderer (label shown when empty)
//   json:                   JSON dump
//   kv:                     key/value single-record renderer (same as table for one obj)
//   custom:                 hand-coded action body; emitter skips generation

export type OutputKind = 'table' | 'list' | 'json' | 'kv' | 'binary' | 'custom';

export interface OutputBinding {
  readonly kind: OutputKind;
  /** For `list` style: shown when the page is empty. */
  readonly label: string | undefined;
}

const OUTPUT_KINDS: ReadonlySet<OutputKind> = new Set([
  'table',
  'list',
  'json',
  'kv',
  'binary',
  'custom',
]);

export function $cli_output_kind(
  context: DecoratorContext,
  target: Operation,
  kind: string,
  label?: string,
): void {
  if (!OUTPUT_KINDS.has(kind as OutputKind)) {
    reportDiagnostic(context.program, {
      code: 'invalid-output-kind',
      format: { kind },
      target,
    });
    return;
  }
  context.program.stateMap(stateKeys.outputKind).set(target, {
    kind: kind as OutputKind,
    label,
  } satisfies OutputBinding);
}

export function getOutputKind(
  program: Program,
  target: Operation,
): OutputBinding | undefined {
  return program.stateMap(stateKeys.outputKind).get(target);
}

/** Dotted path into the response; the renderer reads `getPath(data,
 *  path)` and uses that as the data argument to `output`/`outputList`.
 *  Replaces the per-command "extract result.approvals.data before
 *  rendering" pattern. */
export function $cli_output_pluck(
  context: DecoratorContext,
  target: Operation,
  path: string,
): void {
  context.program.stateMap(stateKeys.outputPluck).set(target, path);
}

export function getOutputPluck(program: Program, target: Operation): string | undefined {
  return program.stateMap(stateKeys.outputPluck).get(target);
}

/** Names a callback (registered in the runtime's OUTPUT_POST_REGISTRY)
 *  to invoke after output. The callback receives the *original*
 *  response (pre-pluck); used for stderr banners like the runtime-key
 *  highlight after `agent create` / `api-key rotate`. */
export function $cli_output_post(
  context: DecoratorContext,
  target: Operation,
  callbackName: string,
): void {
  context.program.stateMap(stateKeys.outputPost).set(target, callbackName);
}

export function getOutputPost(program: Program, target: Operation): string | undefined {
  return program.stateMap(stateKeys.outputPost).get(target);
}

// ─── Pagination ──────────────────────────────────────────────
// Marker that adds the canonical -p/--page and -l/--limit flags + auto-
// merges them into the body via parsePagination(opts). No params on the
// decorator; its mere presence signals "wire this up".

export function $cli_pagination(context: DecoratorContext, target: Operation): void {
  context.program.stateMap(stateKeys.pagination).set(target, true);
}

export function isPaginated(program: Program, target: Operation): boolean {
  return program.stateMap(stateKeys.pagination).get(target) === true;
}

// ─── Param body-key + flag-shape ─────────────────────────────
// Per-flag binding for body construction. Without it, a flag's name
// becomes its body key verbatim. With it, the flag maps to a different
// backend key and/or a coercion runs (parseInt, JSON.parse).

export type FlagParse = 'int' | 'json' | 'csv' | 'bool';

export interface FlagBindingExtra {
  readonly bodyKey: string | undefined;
  readonly parse: FlagParse | undefined;
  readonly choices: ReadonlyArray<string> | undefined;
  readonly defaultValue: string | undefined;
  readonly variadic: boolean | undefined;
  readonly required: boolean | undefined;
}

export function $cli_body_key(
  context: DecoratorContext,
  target: ModelProperty,
  key: string,
): void {
  const cur = (context.program.stateMap(stateKeys.flagExtra).get(target) ?? {}) as Record<string, unknown>;
  context.program.stateMap(stateKeys.flagExtra).set(target, { ...cur, bodyKey: key });
}

export function $cli_parse(
  context: DecoratorContext,
  target: ModelProperty,
  kind: string,
): void {
  const cur = (context.program.stateMap(stateKeys.flagExtra).get(target) ?? {}) as Record<string, unknown>;
  context.program.stateMap(stateKeys.flagExtra).set(target, { ...cur, parse: kind });
}

export function $cli_choice(
  context: DecoratorContext,
  target: ModelProperty,
  raw: unknown,
): void {
  const choices = Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string') : [];
  const cur = (context.program.stateMap(stateKeys.flagExtra).get(target) ?? {}) as Record<string, unknown>;
  context.program.stateMap(stateKeys.flagExtra).set(target, { ...cur, choices });
}

export function $cli_default(
  context: DecoratorContext,
  target: ModelProperty,
  value: string,
): void {
  const cur = (context.program.stateMap(stateKeys.flagExtra).get(target) ?? {}) as Record<string, unknown>;
  context.program.stateMap(stateKeys.flagExtra).set(target, { ...cur, defaultValue: value });
}

/** Marks a flag as variadic; Commander syntax `--name <v...>` collects
 *  every space-separated arg into an array. The flag's body value is
 *  the array verbatim. */
export function $cli_variadic(
  context: DecoratorContext,
  target: ModelProperty,
): void {
  const cur = (context.program.stateMap(stateKeys.flagExtra).get(target) ?? {}) as Record<string, unknown>;
  context.program.stateMap(stateKeys.flagExtra).set(target, { ...cur, variadic: true });
}

/** Marks a flag as required (Commander `requiredOption`). Without it,
 *  the user gets a clear "missing required option --x" error before
 *  the action runs. Off by default; flags are optional unless tagged.
 *
 *  When the parent op carries @cli_json_merge, "required" flips to
 *  "the merged body must have this key from either the flag or --json"
 * ; commander's requiredOption can't see inside --json so the check
 *  moves to runtime. */
export function $cli_required(
  context: DecoratorContext,
  target: ModelProperty,
): void {
  const cur = (context.program.stateMap(stateKeys.flagExtra).get(target) ?? {}) as Record<string, unknown>;
  context.program.stateMap(stateKeys.flagExtra).set(target, { ...cur, required: true });
}

/** Marks an op as accepting a `--json <body>` escape hatch alongside
 *  per-flag overrides. Modes:
 *    "fill"    ; --json is the body base, flag values fill missing keys
 *    "replace" ; --json fully replaces the flag-derived body when present
 *    "only"    ; like "replace", but --json is required (no flag fallback)
 *
 *  @cli_required flags become "must be present in the merged body"; checked
 *  at runtime instead of via Commander's requiredOption. */
export function $cli_json_merge(
  context: DecoratorContext,
  target: Operation,
  mode?: string,
): void {
  const m: 'fill' | 'replace' | 'only' =
    mode === 'replace' ? 'replace' : mode === 'only' ? 'only' : 'fill';
  context.program.stateMap(stateKeys.jsonMerge).set(target, m);
}

export function getJsonMerge(
  program: Program,
  target: Operation,
): 'fill' | 'replace' | 'only' | undefined {
  return program.stateMap(stateKeys.jsonMerge).get(target);
}

/** Cross-field constraint: when ANY of the named flags is set, ALL
 *  of them must be set. Closes the goal-update "all four config
 *  fields required together unless --json" rule. The constraint is
 *  bypassed entirely when --json is supplied (jsonMerge "replace"). */
export function $cli_required_together(
  context: DecoratorContext,
  target: Operation,
  raw: unknown,
): void {
  const fields = Array.isArray(raw)
    ? raw.filter((c): c is string => typeof c === 'string')
    : [];
  if (fields.length < 2) {
    reportDiagnostic(context.program, {
      code: 'invalid-output-kind',
      format: { kind: '@cli_required_together needs ≥2 field names' },
      target,
    });
    return;
  }
  context.program.stateMap(stateKeys.requiredTogether).set(target, fields);
}

export function getRequiredTogether(
  program: Program,
  target: Operation,
): string[] | undefined {
  return program.stateMap(stateKeys.requiredTogether).get(target);
}

/** Cross-field constraint: at least one of these flags (by parameter
 *  name) must be set or present in --json. Closes the team-create
 *  "name OR icon required" rule that doesn't fit @cli_required (which
 *  is per-field). */
export function $cli_at_least_one(
  context: DecoratorContext,
  target: Operation,
  raw: unknown,
): void {
  const fields = Array.isArray(raw)
    ? raw.filter((c): c is string => typeof c === 'string')
    : [];
  if (fields.length < 2) {
    reportDiagnostic(context.program, {
      code: 'invalid-output-kind',
      format: { kind: '@cli_at_least_one needs ≥2 field names' },
      target,
    });
    return;
  }
  context.program.stateMap(stateKeys.atLeastOne).set(target, fields);
}

export function getAtLeastOne(program: Program, target: Operation): string[] | undefined {
  return program.stateMap(stateKeys.atLeastOne).get(target);
}

/** Marks an op as not making any backend / core HTTP call (doctor,
 *  verify, versions). Documents intent in spec; the import-allowlist
 *  drift test guarantees the implementation matches. */
export function $cli_local_only(context: DecoratorContext, target: Operation): void {
  context.program.stateMap(stateKeys.localOnly).set(target, true);
}

export function isLocalOnly(program: Program, target: Operation): boolean {
  return program.stateMap(stateKeys.localOnly).get(target) === true;
}

export function $cli_destructive(context: DecoratorContext, target: Operation): void {
  context.program.stateMap(stateKeys.destructive).set(target, true);
}

export function isDestructive(program: Program, target: Operation): boolean {
  return program.stateMap(stateKeys.destructive).get(target) === true;
}

/** Names a callback registered in PREFLIGHT_REGISTRY that runs before
 *  the main backend call. Receives the assembled body and the client
 *  resolver; can perform GETs (preflight existence checks), throw to
 *  block, or mutate the body in place. */
export function $cli_preflight(
  context: DecoratorContext,
  target: Operation,
  callbackName: string,
): void {
  context.program.stateMap(stateKeys.preflight).set(target, callbackName);
}

export function getPreflight(program: Program, target: Operation): string | undefined {
  return program.stateMap(stateKeys.preflight).get(target);
}

/** Declarative DTO defaults; JSON literal merged into the body when
 *  the corresponding key isn't present (spec base, flags fill, then
 *  defaults fill the still-missing keys). Used for things like agent
 *  create's hardcoded AIVSS baseline. */
export function $cli_dto_defaults(
  context: DecoratorContext,
  target: Operation,
  raw: unknown,
): void {
  const obj = unwrapTspValue(raw);
  context.program.stateMap(stateKeys.dtoDefaults).set(target, obj);
}

export function getDtoDefaults(program: Program, target: Operation): unknown {
  return program.stateMap(stateKeys.dtoDefaults).get(target);
}

/** Names a callback registered in POST_VALIDATE_REGISTRY that runs
 *  after the body is assembled and before the call fires. Lets the
 *  spec wire cross-field validators, such as behavior's
 *  `validateApprovalTimeout(verdict, approval_timeout)`, without
 *  leaving the action body to do it. */
export function $cli_post_validate(
  context: DecoratorContext,
  target: Operation,
  callbackName: string,
): void {
  const list = (context.program.stateMap(stateKeys.postValidate).get(target) ?? []) as string[];
  list.push(callbackName);
  context.program.stateMap(stateKeys.postValidate).set(target, list);
}

export function getPostValidate(program: Program, target: Operation): string[] | undefined {
  return program.stateMap(stateKeys.postValidate).get(target);
}

// `unwrapTspValue` lives next to the decorators it serves. Inline
// minimal copy here so the file doesn't need to reach into another
// module. (Workflow lib has the same helper for @payloadShape / @installTarget.)
function unwrapTspValue(v: unknown): unknown {
  if (v instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of v.entries()) {
      if (typeof k === 'string') out[k] = unwrapTspValue(val);
    }
    return out;
  }
  if (Array.isArray(v)) return v.map(unwrapTspValue);
  return v;
}

export function getFlagExtra(
  program: Program,
  target: ModelProperty,
): FlagBindingExtra | undefined {
  return program.stateMap(stateKeys.flagExtra).get(target);
}
