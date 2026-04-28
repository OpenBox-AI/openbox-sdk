// CLI maturity gate. Each command path - top-level OR sub-command -
// has a maturity label declared in `specs/typespec/cli/main.tsp` via
// `@cli_maturity(...)`. The user opts in to higher maturity bands via
// `OPENBOX_EXPERIMENTAL_LEVEL=experimental` (env) or `--experimental`
// (flag).
//
// Path syntax: space-separated command path from the program root.
//   'auth login'        → `openbox auth login`
//   'agent list'        → `openbox agent list`
//   'audit forensics'   → `openbox audit forensics` (sub-of-stable)
//
// CONSERVATIVE DEFAULT: any path NOT in the spec-emitted table is
// treated as `experimental` here. To make a command visible without
// `--experimental`, add `@cli_maturity("stable")` to the interface or
// operation in the spec.

import type { Command } from 'commander';
import { ENV_VAR_BINDINGS } from '../env/generated/env-bindings.js';
import { COMMAND_MATURITY, type Maturity } from './generated/cli-maturity.js';

export type { Maturity };
export { COMMAND_MATURITY };

const LEVEL: Record<Maturity, number> = {
  stable: 0,
  beta: 1,
  experimental: 2,
};

let cliOverride: Maturity | null = null;

/** Set by the CLI's top-level `--experimental` flag handler. */
export function setMaturityOverride(level: Maturity | null): void {
  cliOverride = level;
}

/** What level the user is currently asking for. CLI flag > env var > default 'stable'. */
export function currentMaturityLevel(): Maturity {
  if (cliOverride) return cliOverride;
  const envName = ENV_VAR_BINDINGS.experimentalLevel.name;
  const env = (process.env[envName] ?? '').toLowerCase();
  if (env === 'experimental' || env === 'beta' || env === 'stable') return env;
  return 'stable';
}

/** True if a command at the target maturity is visible at the current level. */
export function isMaturityVisible(target: Maturity, current = currentMaturityLevel()): boolean {
  return LEVEL[target] <= LEVEL[current];
}

/**
 * Walk the program's full command tree. For each command:
 *  - look up its full path's maturity (default: experimental)
 *  - if invisible at the current level, REMOVE it from the parent
 *  - if visible but non-stable, prefix its description with [experimental]/[beta]
 *
 * Call this AFTER all `register<X>Commands(program)` calls and BEFORE
 * `program.parseAsync(argv)`.
 */
export function gateCommands(program: Command): void {
  const current = currentMaturityLevel();

  function walk(parent: Command, path: string[]): void {
    const snapshot = [...parent.commands];
    for (const sub of snapshot) {
      const subPath = [...path, sub.name()];
      const key = subPath.join(' ');
      const target: Maturity = COMMAND_MATURITY[key] ?? 'experimental';

      if (!isMaturityVisible(target, current)) {
        const idx = parent.commands.indexOf(sub);
        if (idx >= 0) parent.commands.splice(idx, 1);
        continue;
      }

      if (target !== 'stable') {
        const tag = target === 'experimental' ? '[experimental] ' : '[beta] ';
        const desc = sub.description() ?? '';
        if (!desc.startsWith('[experimental]') && !desc.startsWith('[beta]')) {
          sub.description(tag + desc);
        }
      }
      walk(sub, subPath);
    }
  }

  walk(program, []);
}
