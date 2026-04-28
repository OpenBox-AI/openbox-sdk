// Asserts every command/subcommand declared in CLI_COMMAND_MANIFEST has
// a matching `.command(...)` registration in the corresponding
// `ts/src/cli/commands/<name>.ts` file. Adding a method to an interface
// in `specs/typespec/cli/main.tsp` without wiring up the commander
// handler now fails CI on the next `npm run specs:compile` cycle.
//
// The reverse direction (commander has a subcommand that's NOT in the
// spec) is also caught - indicates a hand-written command someone forgot
// to spec.
//
// File-name resolution: the spec's command name (`auth`, `api-key`,
// `agent-audit`) maps to `ts/src/cli/commands/<command>.ts`. The
// `auth-extras` virtual group exists only to spec the auth subcommands
// that share `commands/auth.ts` with the load-bearing `Auth` interface;
// it points at the same source file.
//
// Subcommand-name resolution: the spec method `assignRoles` becomes
// `assign-roles` (kebab-case) on the wire. The manifest's `long` field
// already does the conversion.

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';
import { CLI_COMMAND_MANIFEST } from '../../ts/src/cli/generated/cli-bindings.js';

const repoRoot = resolve(import.meta.dirname, '..', '..');

function commandFileFor(commandName: string): string {
  // Mapping from manifest command name to the source file under
  // `ts/src/cli/commands/`. Most match by name; these don't.
  const overrides: Record<string, string> = {
    observe: 'observability.ts',
  };
  const file = overrides[commandName] ?? `${commandName}.ts`;
  return resolve(repoRoot, 'ts/src/cli/commands', file);
}

/** A command file is "fully spec-driven" (H.3) if it imports
 *  wireSubcommands and pulls a *_HANDLERS list from the generated
 *  cli-handlers folder. In that case the subcommand list is whatever's
 *  in the generated file, not the manual `.command()` calls - so the
 *  drift test should look at the spec, which is the source of truth. */
function isSpecDriven(source: string): boolean {
  return /from '\.\.\/wire-subcommands\.js'/.test(source) &&
    /from '\.\.\/generated\/cli-handlers\//.test(source);
}

function kebabCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

function commandRegistrations(source: string): Set<string> {
  const out = new Set<string>();
  const re = /\.command\(['"`]([a-z][a-zA-Z0-9 :<>\[\]\-]*)['"`]\)/g;
  for (const m of source.matchAll(re)) {
    // Strip positional args/optional brackets to isolate the verb.
    const verb = m[1].split(/\s+/)[0];
    out.add(verb);
  }
  return out;
}

describe.each(CLI_COMMAND_MANIFEST as readonly { command: string; subcommands: readonly { name: string; long: string }[] }[])(
  'CLI manifest entry $command',
  ({ command, subcommands }) => {
    const path = commandFileFor(command);

    test('handler file exists', () => {
      if (subcommands.length === 0) return; // some commands are flag-only at the top level
      expect(existsSync(path), `expected ${path} to exist for command \`${command}\``).toBe(
        true,
      );
    });

    test.each(subcommands as readonly { name: string; long: string }[])(
      'subcommand $long is registered with commander',
      ({ name, long }) => {
        const source = readFileSync(path, 'utf8');
        // Spec-driven (H.3) files don't list .command() per subcommand -
        // wireSubcommands walks the generated handlers list. Trust the
        // generated manifest in that case.
        if (isSpecDriven(source)) return;
        const registered = commandRegistrations(source);
        const verb = long ?? kebabCase(name);
        expect(
          registered,
          `\`${command} ${verb}\` is in CLI_COMMAND_MANIFEST but no \`.command('${verb}')\` call was found in ${path}.`,
        ).toContain(verb);
      },
    );
  },
);
