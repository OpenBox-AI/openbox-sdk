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
  /** Emit `requiredOption` instead of `option`. */
  required?: boolean;
}

export interface ArgSpec {
  /** Positional arg name in camelCase. */
  name: string;
  /** When set, this positional's *value* is routed into the body under
   *  this key instead of being passed as a positional client arg.
   *  Used for hybrid call shapes like `decideApproval(agentId, eventId,
   *  {action})` - agentId/eventId stay positional, action goes in body. */
  bodyKey?: string;
  /** Restrict the positional to a fixed set of values (validateEnum).
   *  Same semantics as @cli_choice on flags. */
  choices?: ReadonlyArray<string>;
  /** Run a named validator on the positional value before forwarding. */
  validator?: string;
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
  output: {
    kind: 'table' | 'list' | 'json' | 'kv' | 'custom';
    label?: string;
    /** Dotted path into the response - renderer pulls this sub-value
     *  instead of the full envelope. */
    pluck?: string;
    /** Name of a registered post-output callback. */
    post?: string;
  };
}

const VALIDATOR_REGISTRY: Record<string, (val: unknown, label: string) => unknown> = {
  validateIsoDate,
};

/**
 * Post-output callbacks runnable via @cli_output_post(name). Each
 * receives the original response (pre-pluck) and writes any side-effect
 * banner the spec asks for. Add a callback here when you spec a new
 * post hook - the spec tells the runtime *which* to call by name; the
 * body lives here so the spec stays language-agnostic.
 */
export const OUTPUT_POST_REGISTRY: Record<string, (data: unknown) => void> = {
  /** Highlight the runtime API key returned by `agent create` and
   *  `api-key rotate` to stderr. The wire returns the obx_live_/
   *  obx_test_ token under `token` (sometimes nested under `agent`);
   *  we surface it once because subsequent fetches won't see it. */
  highlightRuntimeKey(data: unknown): void {
    const d = data as { token?: string; agent?: { id?: string } } | null;
    const key = d?.token;
    if (typeof key !== 'string' || (!key.startsWith('obx_live_') && !key.startsWith('obx_test_'))) return;
    const agentId = d?.agent?.id ?? '<id>';
    console.error('');
    console.error('────────────────────────────────────────────────────────────');
    console.error('  Runtime API key (capture now - only shown once):');
    console.error(`    ${key}`);
    console.error('');
    console.error('  Use this as OPENBOX_API_KEY for core/governance calls.');
    console.error(`  To recover later: openbox api-key rotate ${agentId}`);
    console.error('  (rotation invalidates the previous key).');
    console.error('────────────────────────────────────────────────────────────');
  },

  /** Log the org-approvals response's `metrics` envelope to stderr. The
   *  spec already plucks the `approvals` sub-object for rendering; this
   *  callback surfaces the metrics that were dropped. */
  logApprovalMetrics(data: unknown): void {
    const m = (data as { metrics?: unknown } | null)?.metrics;
    if (m) console.error(`metrics: ${JSON.stringify(m)}`);
  },
};

function getPath(env: unknown, path: string): unknown {
  if (env == null || typeof env !== 'object') return undefined;
  let cur: unknown = env;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

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
  // Pluck happens before rendering - the original response is still
  // forwarded to the post callback (so it sees fields the renderer
  // didn't display, e.g. metrics envelopes).
  const renderable = sub.output.pluck ? getPath(data, sub.output.pluck) : data;
  switch (sub.output.kind) {
    case 'list':
      outputList(renderable, sub.output.label ?? 'items');
      break;
    case 'table':
    case 'kv':
    case 'json':
    default:
      output(renderable);
  }
  if (sub.output.post) {
    const fn = OUTPUT_POST_REGISTRY[sub.output.post];
    if (fn) fn(data);
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
    if (flag.required) {
      cmd.requiredOption(flagSig, flag.description);
    } else if (flag.default !== undefined) {
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
        const positionalValues = rawArgs.slice(0, sub.args.length);
        const opts = (rawArgs[sub.args.length] ?? {}) as Record<string, unknown>;
        const client = getClient() as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
        const fn = client[sub.backend.method];
        if (typeof fn !== 'function') {
          throw new Error(`Backend method '${sub.backend.method}' missing on OpenBoxClient`);
        }

        // Positional-with-body-key: argument is captured positionally on
        // the command line, but the value is forwarded into the body
        // object instead of as a positional client arg. Lets us spec
        // hybrid wire signatures like decideApproval(a, e, {action}).
        const clientPositionals: unknown[] = [];
        const bodyFromArgs: Record<string, unknown> = {};
        for (let i = 0; i < sub.args.length; i++) {
          const arg = sub.args[i];
          let value = positionalValues[i];
          if (arg.choices && arg.choices.length > 0) {
            value = validateEnum(value, arg.choices, `<${arg.name}>`);
          }
          if (arg.validator) {
            const fn = VALIDATOR_REGISTRY[arg.validator];
            if (fn) value = fn(value, `<${arg.name}>`);
          }
          if (arg.bodyKey) {
            bodyFromArgs[arg.bodyKey] = value;
          } else {
            clientPositionals.push(value);
          }
        }

        let data: unknown;
        if (sub.backend.shape === 'positional') {
          const trailingArgs = sub.flags.map((f) => transformFlag(opts[f.name], f));
          data = await fn.apply(client, [...clientPositionals, ...trailingArgs]);
        } else {
          const body = { ...bodyFromArgs, ...buildBody(opts, sub) };
          data = await fn.apply(client, [...clientPositionals, body]);
        }
        renderOutput(data, sub);
      } catch (err) {
        reportAndExit(err);
      }
    });
  }
}
