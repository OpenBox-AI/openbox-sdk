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
//
// ─── What recipes can express, and what they can't ───────────────────
//
// Recipes ARE pure parallel fanout over tier-1 ops:
//   - every step's args resolve from the recipe op's positional CLI
//     args by name (no derived values; no step-A-feeds-step-B)
//   - all steps run via Promise.all (no sequential ordering)
//   - paginate: true walks every page of a paged listing; otherwise
//     the raw client return value passes through
//   - optional: true catches failures and stores null
//
// What stays HAND-CODED (and shouldn't be migrated to a recipe):
//   - protocol-validation logic   → session inspect (paired Start/Complete)
//   - cross-session aggregation   → agent audit (analyzeSessions)
//   - filter-then-act loops       → session prune
//   - filesystem operations       → install / uninstall / verify / cursor sync-rules
//   - sequential / dependent      → mcp:list_pending_approvals (orgId from
//                                    getProfile, then getOrgApprovals)
//   - try-fallback patterns       → session inspect's id-or-search lookup
//   - shorthand-to-API translation → core evaluate (--type → span shape)
//
// The runtime intentionally does NOT support `dependsOn` /
// `forEach` / nested recipes; if a question genuinely needs them,
// it's not a fanout — it's a procedure, and a hand-coded action is
// the right surface. Push back on adding those step types until we
// have at least three real cases that demand them.

import type { Command } from 'commander';
import { reportAndExit } from '../validators/index.js';
import { output } from './output.js';
import { resolveArgs } from './id-resolver.js';

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

/** Execute a recipe's parallel fanout against the given client and
 *  argument map. Pure: no I/O, no console writes. Both the CLI runtime
 *  (`wireRecipes` below) and the MCP runtime (`runtime/mcp/recipe-tools.ts`)
 *  call this so the two surfaces never drift on fanout semantics. */
export async function runRecipe(
  spec: RecipeSpec,
  argMap: Record<string, unknown>,
  client: Record<string, (...a: unknown[]) => Promise<unknown>>,
): Promise<Record<string, unknown>> {
  // Resolve any short / partial IDs before fanning out. No-op for
  // fully-formed UUIDs; users / LLMs that pass `2e6cee17-…` get the
  // full ID looked up via listAgents (or equivalent) and then the
  // recipe steps see the canonical form. Same path runs for both
  // CLI invocations and MCP tool calls.
  const resolved = await resolveArgs(argMap, client);
  const tasks = spec.steps.map(async (step) => {
    const fn = client[step.call];
    if (typeof fn !== 'function') {
      throw new Error(
        `recipe '${spec.name}': step '${step.call}' is not a method on the client`,
      );
    }
    const callArgs = step.args.map((name) => resolved[name]);
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
  return envelope;
}

/** Register every recipe in `specs` as a subcommand under `parent`. */
export function wireRecipes(
  parent: Command,
  specs: ReadonlyArray<RecipeSpec>,
  getClient: ClientResolver,
): void {
  for (const spec of specs) {
    const argSig = spec.args.map((a) => `<${a.name}>`).join(' ');
    // Lead each recipe's description with a `[recipe]` tag so they
    // stand out from tier-1 ops in `<group> --help`. The tag also
    // signals to LLM agents that this is a composite shortcut, not
    // a 1:1 backend call. Steps list lives in the description so
    // `--help` is enough to know what the recipe touches.
    const stepSummary = spec.steps.map((s) => s.call).join(', ');
    const tagged = `[recipe] ${spec.description}\n\nComposes: ${stepSummary}`;
    const cmd = parent
      .command(argSig ? `${spec.name} ${argSig}` : spec.name)
      .description(tagged);

    cmd.action(async (...rawArgs: unknown[]) => {
      try {
        const positionals = rawArgs.slice(0, spec.args.length);
        const argMap: Record<string, unknown> = {};
        for (let i = 0; i < spec.args.length; i++) {
          argMap[spec.args[i].name] = positionals[i];
        }
        const envelope = await runRecipe(spec, argMap, getClient());
        output(envelope);
      } catch (err) {
        reportAndExit(err);
      }
    });
  }
}
