// Lock the "CLI is a pure backend and core consumer" property. Every
// import in `ts/src/cli/commands/**.ts` must come from a known
// allowlist: Node stdlib, Commander, the OpenBox client surface, the
// CLI's own helpers, or generated handlers. Direct fetch, axios, raw
// HTTP, or internal-service paths fail the test.
//
// To add a new module, such as a new shared helper, add it to
// ALLOWED_PREFIXES with a one-line reason. That conscious step is
// the whole point.

import { readdirSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { describe, expect, test } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const cmdDir = resolve(repoRoot, 'ts/src/cli/commands');

/**
 * Each prefix must match the *start* of an import specifier (or be the
 * full string for relative paths). Reasons are required; the act of
 * adding one forces a moment of intent.
 */
const ALLOWED_PREFIXES: Record<string, string> = {
  // Node stdlib; fs/path/url/etc.
  'node:': 'Node built-ins.',
  fs: 'Node fs (path-resolve, downloads, install primitives).',
  path: 'Node path joins.',
  os: 'Node os.homedir / arch / platform.',
  url: 'Node url for fileURLToPath in cli-runner.',
  // CLI command libs.
  commander: 'Commander; the only CLI argv parser.',
  // OpenBox public client surface.
  '../config.js': 'getClient / getCoreClient resolvers.',
  '../../client/index.js': 'OpenBoxClient (backend) for type imports.',
  '../../core-client/index.js': 'OpenBoxCoreClient (core) for type imports.',
  // Hand-written CLI helpers.
  '../output.js': 'output / outputList renderers.',
  '../../validators/index.js': 'public openbox-sdk/validators surface; reportAndExit + named validators + parseJsonInput.',
  '../wire-subcommands.js': 'spec-driven tier-1 subcommand interpreter.',
  '../recipes.js': 'spec-driven tier-2 recipe interpreter (composite ops).',
  '../../test-utils/index.js': 'public openbox-sdk/test-utils surface; buildTestPayload, SPAN_TYPES.',
  '../features.js': 'isFeatureEnabled gate.',
  '../maturity.js': 'CLI maturity gate (gateCommands).',
  '../exit-codes.js': 'EXIT taxonomy + bailWith; exit-code contract.',
  '../../file-tokens/agent-keys.js':
    'recordAgentKey / recallAgentKey; local 0o600 cache for runtime API keys captured by agent create + api-key rotate (shared between cli and runtime/mcp).',
  '../config-store.js':
    'setConfig / getConfig / unsetConfig / listConfig / configStorePath / applyConfigToProcessEnv; persistent per-env CLI config, layered into process.env at startup.',
  '../colors.ts': 'useColor-aware ANSI helpers; color discipline.',
  '../colors.js': 'useColor-aware ANSI helpers; color discipline.',
  '../non-interactive.js':
    'isNonInteractive / assumeYes / useColor / isQuiet; non-interactive contract.',
  // Per-command sibling modules; agent-audit is a separate report
  // module imported by both agent.ts (the action) and tests.
  './agent-audit.js': 'separate cross-session audit report module.',
  // Unified `openbox install skill` delegates to skill.ts's
  // installSkill(); install.ts is the only commander module that
  // imports a sibling command module.
  './skill.js': 'unified install command delegates to installSkill().',
  // Generated cli-handlers/<cmd>.ts manifests.
  '../generated/cli-handlers/': 'spec-driven SubcommandSpec[] manifests.',
  '../generated/cli-recipes/': 'spec-driven RecipeSpec[] manifests (tier-2 composites).',
  // Spec-driven canonical sets (CANONICAL_EVENT_TYPES,
  // CANONICAL_ACTIVITY_TYPES, CANONICAL_VERDICT_ARMS) used by session
  // inspect, agent audit, and verify for protocol-conformance checks.
  '../../core-client/generated/govern.js':
    'spec-driven canonical event_type / activity_type / verdict-arm sets.',
  // Env-binding constants (spec-driven, no HTTP).
  '../../env/index.js': 'ENV_VAR_BINDINGS for canonical env-var name lookups.',
  // Per-runtime adapter install/hook entrypoints; claude-code/cursor/
  // mcp commands wire `install`, `uninstall`, `hook`, or `serve` actions
  // on top of their runtime adapter.
  '../../runtime/claude-code/install.js':
    'claude-code install/uninstall delegates to runtime adapter.',
  '../../runtime/claude-code/hook-handler.js':
    'claude-code hook command runs the runtime hook handler.',
  '../../runtime/cursor/install.js':
    'cursor install/uninstall delegates to runtime adapter.',
  '../../runtime/cursor/hook-handler.js':
    'cursor hook command runs the runtime hook handler.',
  '../../runtime/cursor/enterprise.js':
    'cursor harden / unharden delegate to the enterprise-profile renderer.',
  '../../runtime/cursor/rules.js':
    'cursor sync-rules delegates to the .cursor/rules/*.mdc renderer.',
  '../../runtime/cursor/commands.js':
    'unified cursor install copies the bundled slash commands, rules, and plugin agents into ~/.cursor/{commands,rules,agents}.',
  '../../governance/rules-projection.js':
    'editor-agnostic guardrails+policies projection consumed by cursor sync-rules.',
  '../../runtime/mcp/index.js': 'mcp serve runs the MCP stdio server.',
  '../../runtime/mcp/install.js':
    'unified install command writes/removes the OpenBox MCP server entry across host configs.',
};

function isAllowed(spec: string): boolean {
  for (const prefix of Object.keys(ALLOWED_PREFIXES)) {
    if (spec === prefix || spec.startsWith(prefix)) return true;
  }
  return false;
}

function importsIn(source: string): string[] {
  // Match `import ... from 'X'` and `import('X')` forms.
  const out: string[] = [];
  const importRe = /\bimport\b[^'"`]*?from\s+['"`]([^'"`]+)['"`]/g;
  for (const m of source.matchAll(importRe)) out.push(m[1]);
  const dynRe = /\bimport\s*\(\s*['"`]([^'"`]+)['"`]/g;
  for (const m of source.matchAll(dynRe)) out.push(m[1]);
  return out;
}

const cmdFiles = readdirSync(cmdDir).filter((f) => f.endsWith('.ts'));

describe('cli/commands import-allowlist drift guard', () => {
  for (const file of cmdFiles) {
    test(`${file} only imports from the allowlist`, () => {
      const source = readFileSync(join(cmdDir, file), 'utf8');
      const specs = importsIn(source);
      const violations = specs.filter((s) => !isAllowed(s));
      expect(
        violations,
        `${file} imports non-allowlisted modules: ${violations.join(', ')}\n` +
          `  If genuinely needed, add the module to ALLOWED_PREFIXES with a one-line reason.\n` +
          `  Otherwise, the CLI must reach the network only via getClient() / getCoreClient().`,
      ).toEqual([]);
    });
  }
});
