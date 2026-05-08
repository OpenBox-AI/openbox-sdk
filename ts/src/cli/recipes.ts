// Tier-2 (composite) CLI commands. Driven by @cli_recipe in the spec.
//
// A recipe is a CLI subcommand that fans out to multiple tier-1 backend
// calls in parallel and assembles their results into a single envelope.
// Useful for "describe" / "overview" / "summary" commands where the
// user wants ONE answer but the API surface is normalized into many
// resources.
//
// The spec declares the recipe as an array of steps; the codegen emits
// a `RecipeSpec` per op into `ts/src/cli/generated/cli-recipes/<cmd>.ts`;
// hand-coded `register*Commands` files call `wireRecipes(parent, RECIPES,
// getClient)` alongside the existing `wireSubcommands` for tier-1 ops.

import type { Command } from 'commander';
import { reportAndExit } from '../validators/index.js';
import { output } from './output.js';

/** One backend call inside a recipe. */
export interface RecipeStep {
  /** Method on the active client to invoke. */
  call: string;
  /** Recipe-op parameter names to forward as positional client args. */
  args: ReadonlyArray<string>;
  /** Key in the assembled output envelope. */
  into: string;
  /** Walk every page of a paginated listing into one flat array. */
  paginate?: boolean;
  /** Catch failures and store null instead of failing the recipe. */
  optional?: boolean;
}

export interface RecipeSpec {
  /** Subcommand verb (kebab-case). */
  name: string;
  description: string;
  /** Positional CLI args (forwarded to step.args by name). */
  args: ReadonlyArray<{ name: string }>;
  steps: ReadonlyArray<RecipeStep>;
  /** Output renderer; tier-2 envelopes are JSON by default. */
  output: { kind: 'json' | 'kv' };
}

export type ClientResolver = () => Record<string, (...a: unknown[]) => Promise<unknown>>;

/** Walk every page of a paginated client method until empty / total
 *  reached. Mirrors the loop in commands/agent-audit.ts so recipe
 *  output matches what `agent audit` produces today. */
async function paginateAll(
  fn: (...a: unknown[]) => Promise<unknown>,
  client: object,
  positional: unknown[],
): Promise<unknown[]> {
  const all: unknown[] = [];
  let page = 0;
  while (all.length < 5000) {
    const resp = (await fn.apply(client, [
      ...positional,
      { page, perPage: 100 },
    ])) as { data?: unknown; total?: number } | unknown[];
    const rows = Array.isArray(resp) ? resp : (resp.data as unknown[] | undefined) ?? [];
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    const total =
      !Array.isArray(resp) && typeof resp.total === 'number' ? resp.total : undefined;
    if (typeof total === 'number' && all.length >= total) break;
    page += 1;
    if (page > 100) break;
  }
  return all;
}

/** Register every recipe in `specs` as a subcommand under `parent`. */
export function wireRecipes(
  parent: Command,
  specs: ReadonlyArray<RecipeSpec>,
  getClient: ClientResolver,
): void {
  for (const spec of specs) {
    const argSig = spec.args.map((a) => `<${a.name}>`).join(' ');
    const cmd = parent
      .command(argSig ? `${spec.name} ${argSig}` : spec.name)
      .description(spec.description);

    cmd.action(async (...rawArgs: unknown[]) => {
      try {
        const positionals = rawArgs.slice(0, spec.args.length);
        const argMap: Record<string, unknown> = {};
        for (let i = 0; i < spec.args.length; i++) {
          argMap[spec.args[i].name] = positionals[i];
        }

        const client = getClient();
        const tasks = spec.steps.map(async (step) => {
          const fn = client[step.call];
          if (typeof fn !== 'function') {
            throw new Error(
              `recipe '${spec.name}': step '${step.call}' is not a method on the client`,
            );
          }
          const callArgs = step.args.map((name) => argMap[name]);
          try {
            const result = step.paginate
              ? await paginateAll(fn, client, callArgs)
              : await fn.apply(client, callArgs);
            return [step.into, result] as const;
          } catch (err) {
            if (step.optional) return [step.into, null] as const;
            throw err;
          }
        });

        const results = await Promise.all(tasks);
        const envelope: Record<string, unknown> = {};
        for (const [key, value] of results) envelope[key] = value;

        output(envelope);
      } catch (err) {
        reportAndExit(err);
      }
    });
  }
}
