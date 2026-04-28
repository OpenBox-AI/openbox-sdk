// Decorator implementations for typespec-cli. See ../env/src/
// decorators.ts for the same shape - getter helpers are exported here
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

export function $cli_output(context: DecoratorContext, target: Model): void {
  context.program.stateMap(stateKeys.output).set(target, true);
}

export function isOutput(program: Program, target: Model): boolean {
  return program.stateMap(stateKeys.output).get(target) === true;
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
//   custom:                 hand-coded action body - emitter skips generation

export type OutputKind = 'table' | 'list' | 'json' | 'kv' | 'custom';

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

// ─── Pagination ──────────────────────────────────────────────
// Marker that adds the canonical -p/--page and -l/--limit flags + auto-
// merges them into the body via parsePagination(opts). No params on the
// decorator - its mere presence signals "wire this up".

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

export type FlagParse = 'int' | 'json' | 'csv';

export interface FlagBindingExtra {
  readonly bodyKey: string | undefined;
  readonly parse: FlagParse | undefined;
  readonly choices: ReadonlyArray<string> | undefined;
  readonly defaultValue: string | undefined;
  readonly variadic: boolean | undefined;
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

/** Marks a flag as variadic - Commander syntax `--name <v...>` collects
 *  every space-separated arg into an array. The flag's body value is
 *  the array verbatim. */
export function $cli_variadic(
  context: DecoratorContext,
  target: ModelProperty,
): void {
  const cur = (context.program.stateMap(stateKeys.flagExtra).get(target) ?? {}) as Record<string, unknown>;
  context.program.stateMap(stateKeys.flagExtra).set(target, { ...cur, variadic: true });
}

export function getFlagExtra(
  program: Program,
  target: ModelProperty,
): FlagBindingExtra | undefined {
  return program.stateMap(stateKeys.flagExtra).get(target);
}
