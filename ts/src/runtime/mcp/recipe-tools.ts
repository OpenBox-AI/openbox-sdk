// MCP-side recipe registration. For every spec @cli_recipe op, expose
// the same parallel-fanout shortcut as an MCP tool so LLMs using the
// MCP server hit recipes directly without shelling out to the CLI.
//
// The fanout itself is shared with the CLI runtime via `runRecipe` in
// `ts/src/cli/recipes.ts`; this file is just the MCP wrapper. Tool
// names follow the `<cmd>_<recipe>` convention (e.g.,
// `agent_describe`, `org_overview`) so they don't collide with the
// existing hand-coded MCP tools (`get_profile`, `list_agents`,
// `decide_approval`, …).
//
// The `core` recipe is intentionally NOT registered here: its steps
// run against OpenBoxCoreClient, while the MCP server's other tools
// run against OpenBoxClient. Adding it would require routing per-
// recipe; defer until there's a concrete user-facing need (the CLI
// path covers `core overview` already).

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { runRecipe, type RecipeSpec } from '../../cli/recipes.js';

import { AGENT_RECIPES } from '../../cli/generated/cli-recipes/agent.js';
import { AIVSS_RECIPES } from '../../cli/generated/cli-recipes/aivss.js';
import { APPROVAL_RECIPES } from '../../cli/generated/cli-recipes/approval.js';
import { AUDIT_RECIPES } from '../../cli/generated/cli-recipes/audit.js';
import { BEHAVIOR_RECIPES } from '../../cli/generated/cli-recipes/behavior.js';
import { GOAL_RECIPES } from '../../cli/generated/cli-recipes/goal.js';
import { GUARDRAIL_RECIPES } from '../../cli/generated/cli-recipes/guardrail.js';
import { OBSERVE_RECIPES } from '../../cli/generated/cli-recipes/observe.js';
import { ORG_RECIPES } from '../../cli/generated/cli-recipes/org.js';
import { POLICY_RECIPES } from '../../cli/generated/cli-recipes/policy.js';
import { SESSION_RECIPES } from '../../cli/generated/cli-recipes/session.js';
import { SSO_RECIPES } from '../../cli/generated/cli-recipes/sso.js';
import { TEAM_RECIPES } from '../../cli/generated/cli-recipes/team.js';
import { TRUST_RECIPES } from '../../cli/generated/cli-recipes/trust.js';
import { WEBHOOK_RECIPES } from '../../cli/generated/cli-recipes/webhook.js';

const ALL: ReadonlyArray<{ cmd: string; recipes: ReadonlyArray<RecipeSpec> }> = [
  { cmd: 'agent', recipes: AGENT_RECIPES },
  { cmd: 'aivss', recipes: AIVSS_RECIPES },
  { cmd: 'approval', recipes: APPROVAL_RECIPES },
  { cmd: 'audit', recipes: AUDIT_RECIPES },
  { cmd: 'behavior', recipes: BEHAVIOR_RECIPES },
  { cmd: 'goal', recipes: GOAL_RECIPES },
  { cmd: 'guardrail', recipes: GUARDRAIL_RECIPES },
  { cmd: 'observe', recipes: OBSERVE_RECIPES },
  { cmd: 'org', recipes: ORG_RECIPES },
  { cmd: 'policy', recipes: POLICY_RECIPES },
  { cmd: 'session', recipes: SESSION_RECIPES },
  { cmd: 'sso', recipes: SSO_RECIPES },
  { cmd: 'team', recipes: TEAM_RECIPES },
  { cmd: 'trust', recipes: TRUST_RECIPES },
  { cmd: 'webhook', recipes: WEBHOOK_RECIPES },
];

/** Register every spec recipe as an MCP tool against the given
 *  client. Uses `runRecipe` so fanout semantics match the CLI exactly:
 *  parallel via Promise.all, paginate-walk on `paginate: true`,
 *  null-on-failure for `optional: true`. */
export function registerRecipeTools(
  server: McpServer,
  client: Record<string, (...a: unknown[]) => Promise<unknown>>,
): void {
  for (const { cmd, recipes } of ALL) {
    for (const recipe of recipes) {
      const toolName = mcpToolName(cmd, recipe.name);
      const schema: Record<string, z.ZodTypeAny> = {};
      for (const arg of recipe.args) {
        schema[arg.name] = z.string().describe(`${cmd} ${arg.name}`);
      }
      // Lead each MCP tool description with `OpenBox <cmd> <recipe>:`
      // so the LLM's tool-routing layer disambiguates from
      // unrelated "agent" / "session" tools (Claude Code transcripts,
      // VS Code sessions, etc.). Without this anchor, a prompt like
      // "describe agent 2e6cee17" can route at any tool with "agent"
      // in its name.
      const description = `OpenBox ${cmd} ${recipe.name}: ${recipe.description}`;
      server.tool(
        toolName,
        description,
        schema,
        async (args: Record<string, unknown>) => {
          try {
            const envelope = await runRecipe(recipe, args, client);
            return {
              content: [
                { type: 'text', text: JSON.stringify(envelope, null, 2) },
              ],
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: 'text', text: `Error: ${msg}` }] };
          }
        },
      );
    }
  }
}

/** Tool name = `<cmd>_<recipe>` with kebab → snake (`describe-foo` →
 *  `describe_foo`). Used by the MCP server registration; LLMs see
 *  `agent_describe`, `org_overview`, etc. */
function mcpToolName(cmd: string, recipe: string): string {
  return `${cmd.replace(/-/g, '_')}_${recipe.replace(/-/g, '_')}`;
}
