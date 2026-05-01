// CLI handler enforcement. Every subcommand declared in
// CLI_COMMAND_MANIFEST must satisfy two checks:
//   1. Registered with commander in the matching
//      `ts/src/cli/commands/<group>.ts` file. Covered by
//      cli-coverage.test.ts.
//   2. The registration must include either a
//      `getClient().<sdkMethod>(...)` call that actually invokes the
//      SDK, or a documented exception in the allowlist below, such as
//      `setup`, `doctor`, or `verify`, which are pure local-only
//      commands.
//
// This catches the "added a subcommand to the spec, registered it
// with commander, but the body is empty or doesn't call the SDK"
// failure mode. Adding a subcommand to the manifest now requires
// either a real implementation or an explicit allowlist entry with a
// reason.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';
import { CLI_COMMAND_MANIFEST } from '../../ts/src/cli/generated/cli-bindings.js';

const repoRoot = resolve(import.meta.dirname, '..', '..');

function commandFileFor(commandName: string): string {
  const overrides: Record<string, string> = {
    observe: 'observability.ts',
  };
  const file = overrides[commandName] ?? `${commandName}.ts`;
  return resolve(repoRoot, 'ts/src/cli/commands', file);
}

function kebabCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

/**
 * Local-only subcommands that don't (or shouldn't) call the SDK. Each
 * entry is `<command>:<subcommand>` and carries a one-line reason.
 *
 * The bar to add an entry: the subcommand must produce its result
 * entirely from local state (filesystem, git, env) without an HTTP
 * call to a backend. If you find yourself wanting to skip a
 * subcommand because "the call is buried in a helper", FIX the
 * helper to be findable; don't allowlist.
 */
const LOCAL_ONLY: Record<string, string> = {
  // The dedicated platform install commands replaced `openbox setup`.
  // They write local config files (settings.json / hooks.json / mcp.json,
  // plus skill markdown copies) without hitting the backend.
  'skill:install': 'Copies SKILL.md + references to ~/.claude/skills/openbox/. No SDK call.',
  'skill:path': 'Prints the bundled skill source path. No SDK call.',
  'claude-code:install': 'Writes hook block to ~/.claude/settings.json. No SDK call.',
  'claude-code:uninstall': 'Removes the hook block from ~/.claude/settings.json. No SDK call.',
  'claude-code:hook': 'Per-event hook handler; reads stdin, dispatches via runtime adapter, writes stdout.',
  'cursor:install': 'Writes hook block to ~/.cursor/hooks.json. No SDK call.',
  'cursor:uninstall': 'Removes the hook block from ~/.cursor/hooks.json. No SDK call.',
  'cursor:hook': 'Per-event hook handler; reads stdin, dispatches via runtime adapter, writes stdout.',
  'mcp:serve': 'Long-running MCP stdio server. The SDK call surface is covered by runtime/mcp.',
  'doctor:': 'Verifies local pre-flight: which/openbox, ~/.openbox/tokens, env vars. No SDK call.',
  'verify:': 'Static linter on a hand-written governance integration source file.',
  'versions:': 'Reads /version per service via static OpenBoxClient.getVersion (not a method).',
  'auth:setApiKey': 'Persists an org X-API-Key to ~/.openbox/tokens. No SDK call.',
  'auth:clearApiKey': 'Drops the X-API-Key entry from ~/.openbox/tokens. No SDK call.',
  'auth:status': 'Reads the persisted token store and prints per-env auth state. No SDK call.',
  'config:set': 'Writes to ~/.openbox/config (per-env KV store, mode 0o600). No SDK call.',
  'config:get': 'Reads from ~/.openbox/config. No SDK call.',
  'config:unset': 'Removes a key from ~/.openbox/config. No SDK call.',
  'config:list': 'Snapshots ~/.openbox/config for the active env. No SDK call.',
};

interface ManifestSubcommand {
  name: string;
}

interface ManifestCommand {
  command: string;
  subcommands: readonly ManifestSubcommand[];
}

function findSubcommandHandler(
  source: string,
  subcommandLong: string,
): { found: boolean; usesGetClient: boolean } {
  // Locate `.command('<sub>...` and capture from there to the next
  // `.command(` or end-of-file. That window is the handler's full
  // commander chain (description, options, action body).
  const re = new RegExp(
    `\\.command\\(['"\`]${subcommandLong}(?:\\s|['"\`])[\\s\\S]*?(?=\\.command\\(|$)`,
  );
  const match = source.match(re);
  if (!match) return { found: false, usesGetClient: false };
  // Match either `getClient()` (backend), `getCoreClient()` (core), or
  // a direct `<name>Client.<method>(` call. Captures the common patterns
  // the CLI uses to reach the SDK.
  return {
    found: true,
    usesGetClient: /(?:getClient|getCoreClient)\(\)|[A-Za-z]Client\./.test(match[0]),
  };
}

describe.each(CLI_COMMAND_MANIFEST as readonly ManifestCommand[])(
  'CLI handler coverage for $command',
  ({ command, subcommands }) => {
    if (subcommands.length === 0) {
      // Top-level commands without subcommands (doctor, goal, health,
      // verify, versions). Vitest needs at least one registered test
      // per describe block, so emit a no-op.
      test('no subcommands declared in spec', () => {
        expect(true).toBe(true);
      });
      return;
    }
    const path = commandFileFor(command);
    const source = readFileSync(path, 'utf8');
    // H.3 spec-driven files delegate registration to wireSubcommands +
    // a generated *_HANDLERS list. The handler list IS the source of
    // truth in that case; checking for `.command(verb)` would be a
    // tautology and a false negative.
    const isSpecDriven =
      /from '\.\.\/wire-subcommands\.js'/.test(source) &&
      /from '\.\.\/generated\/cli-handlers\//.test(source);

    test.each(subcommands)('$name handler exists and calls SDK', ({ name }) => {
      if (isSpecDriven) return;
      const verb = kebabCase(name);
      const allowKey = `${command}:${name}`;
      if (LOCAL_ONLY[allowKey]) return;

      const { found, usesGetClient } = findSubcommandHandler(source, verb);
      expect(
        found,
        `\`${command} ${verb}\` is in CLI_COMMAND_MANIFEST but no \`.command('${verb}')\` was found in ${path}.`,
      ).toBe(true);
      expect(
        usesGetClient,
        `\`${command} ${verb}\` is registered with commander but its handler doesn't call \`getClient()\` / a client method. Implement the handler or add an entry to the LOCAL_ONLY allowlist with a reason.`,
      ).toBe(true);
    });
  },
);
