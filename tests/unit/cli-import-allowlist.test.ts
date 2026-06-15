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
  '../../client/generated/endpoint-manifest.js':
    'generated backend operation manifest for the compact api command.',
  '../../core-client/generated/endpoint-manifest.js':
    'generated core operation manifest for the compact api command.',
  // Hand-written CLI helpers.
  '../output.js': 'output / outputList renderers.',
  '../../validators/index.js': 'public @openbox-ai/openbox-sdk/validators surface; reportAndExit + named validators + parseJsonInput.',
  '../../test-utils/index.js': 'public @openbox-ai/openbox-sdk/test-utils surface; buildTestPayload, SPAN_TYPES.',
  '../features.js': 'isFeatureEnabled gate.',
  '../maturity.js': 'CLI maturity gate (gateCommands).',
  '../exit-codes.js': 'EXIT taxonomy + bailWith; exit-code contract.',
  '../../file-tokens/agent-keys.js':
    'recordAgentKey / recallAgentKey; local 0o600 cache for runtime API keys shared between cli and runtime/mcp.',
  '../../file-tokens/index.js':
    'saveApiKey; local 0o600 cache for org API keys captured by openbox connect.',
  '../../config/index.js':
    'shared persistent config store for CLI commands and runtime adapters.',
  '../colors.ts': 'useColor-aware ANSI helpers; color discipline.',
  '../colors.js': 'useColor-aware ANSI helpers; color discipline.',
  '../non-interactive.js':
    'isNonInteractive / assumeYes / useColor / isQuiet; non-interactive contract.',
  // Host installers delegate to skill.ts's installSkill(); install.ts
  // is the only commander module that imports a sibling command module.
  './skill.js': 'host installers delegate to installSkill().',
  // Generated manifest imports are not allowed in live command modules;
  // they remain contract artifacts for tests and codegen drift only.
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
    'low-level claude-code hook installer remains import-allowed for custom command coverage.',
  '../../runtime/claude-code/index.js':
    'claude-code plugin/install commands use the public claude-code runtime surface.',
  '../../runtime/claude-code/hook-handler.js':
    'claude-code hook command runs the runtime hook handler.',
  '../../runtime/cursor/install.js':
    'cursor doctor verifies the plugin and hook runtime surface.',
  '../../runtime/cursor/index.js':
    'cursor plugin/install commands use the public cursor runtime surface.',
  '../../runtime/cursor/hook-handler.js':
    'cursor hook command runs the runtime hook handler.',
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
