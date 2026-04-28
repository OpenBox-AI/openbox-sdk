// Spec-driven CLI subcommand wiring. Hand-coded `register*Commands`
// files load the matching handlers manifest from
// `cli/generated/cli-handlers/<cmd>.ts` and pass it through here, plus
// a getClient resolver. Every detail (positional args, flags,
// validators, body-key remap, --json escape, output renderer) comes
// from the spec - adding a new subcommand is a spec edit.

import type { Command } from 'commander';
import { output, outputList } from './output.js';
import { parseJsonInput } from './input.js';
import {
  reportAndExit,
  validateEnum,
  validateIsoDate,
  parsePagination,
} from './validators/index.js';
import type { OpenBoxClient } from '../client/index.js';

export interface FlagSpec {
  /** TypeSpec parameter name (camelCase). */
  name: string;
  /** Long flag form (kebab-case). */
  long: string;
  short?: string;
  description: string;
  env?: string;
  bodyKey?: string;
  parse?: 'int' | 'json' | 'csv';
  choices?: ReadonlyArray<string>;
  default?: string;
  validator?: string;
  /** Variadic (Commander `<v...>`). Value type is string[]. */
  variadic?: boolean;
}

export interface ArgSpec {
  /** Positional arg name in camelCase. */
  name: string;
}

export interface SubcommandSpec {
  /** Subcommand verb (kebab-case). */
  name: string;
  description: string;
  args: ArgSpec[];
  flags: FlagSpec[];
  backend: {
    /** Method on OpenBoxClient. */
    method: string;
    /** "positional" - positional spec params + flag values all go positional;
     *  "body"       - positional spec params go positional, flags merge into a body object. */
    shape: 'positional' | 'body';
  };
  /** Adds -p / --page + -l / --limit and merges via parsePagination. */
  pagination: boolean;
  output: { kind: 'table' | 'list' | 'json' | 'kv' | 'custom'; label?: string };
}

const VALIDATOR_REGISTRY: Record<string, (val: unknown, label: string) => unknown> = {
  validateIsoDate,
};

/** Apply all spec-derived per-flag transforms (parse, choices, validator)
 *  in declaration order. Returns the coerced value or the original. */
function transformFlag(raw: unknown, flag: FlagSpec): unknown {
  if (raw === undefined || raw === null) return raw;
  let value: unknown = raw;
  if (flag.parse === 'int') {
    value = parseInt(String(value), 10);
  } else if (flag.parse === 'json') {
    value = parseJsonInput(String(value));
  } else if (flag.parse === 'csv') {
    value = String(value).split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (flag.choices && flag.choices.length > 0) {
    value = validateEnum(value, flag.choices, `--${flag.long}`);
  }
  if (flag.validator) {
    const fn = VALIDATOR_REGISTRY[flag.validator];
    if (fn) value = fn(value, `--${flag.long}`);
  }
  return value;
}

/** Build the body object the backend method receives. Skips undefined
 *  flags (so the wire shape isn't polluted with explicit nulls). */
function buildBody(opts: Record<string, unknown>, sub: SubcommandSpec): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (sub.pagination) {
    Object.assign(body, parsePagination(opts as { page?: unknown; limit?: unknown }));
  }
  for (const flag of sub.flags) {
    const val = transformFlag(opts[flag.name], flag);
    if (val === undefined || val === null || val === '') continue;
    body[flag.bodyKey ?? flag.name] = val;
  }
  return body;
}

function renderOutput(data: unknown, sub: SubcommandSpec): void {
  switch (sub.output.kind) {
    case 'list':
      outputList(data, sub.output.label ?? 'items');
      return;
    case 'table':
    case 'kv':
    case 'json':
    default:
      output(data);
  }
}

function attachFlags(cmd: Command, sub: SubcommandSpec): void {
  if (sub.pagination) {
    cmd.option('-p, --page <n>', 'Page number', '0');
    cmd.option('-l, --limit <n>', 'Items per page', '10');
  }
  for (const flag of sub.flags) {
    const dots = flag.variadic ? '...' : '';
    const placeholder = `<${flag.long.replace(/-/g, '_')}${dots}>`;
    const flagSig = flag.short
      ? `-${flag.short}, --${flag.long} ${placeholder}`
      : `--${flag.long} ${placeholder}`;
    if (flag.default !== undefined) {
      cmd.option(flagSig, flag.description, flag.default);
    } else {
      cmd.option(flagSig, flag.description);
    }
  }
  // Universal --json escape for write commands; no-op for reads since
  // body construction is idempotent.
  // (kept lightweight here; spec-driven JSON escape lives behind a
  // future @cli_allow_json decorator.)
}

export type ClientResolver = () => Pick<OpenBoxClient, never> & Record<string, (...a: unknown[]) => Promise<unknown>>;

/** Wire a list of spec-driven subcommands onto a Commander parent. */
export function wireSubcommands(
  parent: Command,
  specs: readonly SubcommandSpec[],
  getClient: ClientResolver,
): void {
  for (const sub of specs) {
    if (sub.output.kind === 'custom') continue; // hand-coded action elsewhere
    const argSig = sub.args.map((a) => `<${a.name}>`).join(' ');
    const cmd = parent
      .command(argSig ? `${sub.name} ${argSig}` : sub.name)
      .description(sub.description);
    attachFlags(cmd, sub);

    cmd.action(async (...rawArgs: unknown[]) => {
      try {
        // Commander hands the action: <positional1> <positional2> ... <opts> <command>.
        // We slice off positionals based on declared arg count.
        const positionals = rawArgs.slice(0, sub.args.length);
        const opts = (rawArgs[sub.args.length] ?? {}) as Record<string, unknown>;
        const client = getClient() as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
        const fn = client[sub.backend.method];
        if (typeof fn !== 'function') {
          throw new Error(`Backend method '${sub.backend.method}' missing on OpenBoxClient`);
        }
        let data: unknown;
        if (sub.backend.shape === 'positional') {
          // Push transformed flag values onto positionals in flag order.
          const trailingArgs = sub.flags.map((f) => transformFlag(opts[f.name], f));
          data = await fn.apply(client, [...positionals, ...trailingArgs]);
        } else {
          const body = buildBody(opts, sub);
          data = await fn.apply(client, [...positionals, body]);
        }
        renderOutput(data, sub);
      } catch (err) {
        reportAndExit(err);
      }
    });
  }
}
