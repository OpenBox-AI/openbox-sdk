// Commander integration over the optional public maturity gate. The
// lean CLI defaults active commands to stable; generated tables only
// constrain commands that explicitly opt in.
//
// Path syntax: space-separated command path from the program root.
//   'auth set-api-key' → `openbox auth set-api-key`
//   'api list'         → `openbox api list`

import type { Command } from 'commander';
import {
  COMMAND_MATURITY,
  isMaturityVisible,
  currentMaturityLevel,
  setMaturityLevel,
  type Maturity,
} from '../maturity/index.js';

export type { Maturity };
export { COMMAND_MATURITY, isMaturityVisible, currentMaturityLevel };

/** Set by the CLI's top-level `--experimental` flag handler. Forwards
 *  to the public override so library consumers see the same level. */
export function setMaturityOverride(level: Maturity | null): void {
  setMaturityLevel(level);
}

/** Subtrees the gate may tag but never remove. The hook + serve
 *  endpoints are spawned by other processes that don't pass
 *  `--experimental`; the install/uninstall trees need to resolve on
 *  a fresh shell. */
const ALWAYS_RESOLVABLE_ROOTS = new Set([
  'claude-code',
  'cursor',
  'mcp',
  'install',
  'uninstall',
  'skill',
]);

const HAND_CODED_MATURITY: Record<string, Maturity> = {
  'cursor plugin export': 'stable',
  'cursor plugin install': 'stable',
  'cursor plugin uninstall': 'stable',
};

/**
 * Walk the program's full command tree. For each command:
 *  - look up its full path's maturity (default: stable)
 *  - if invisible at the current level, REMOVE it from the parent
 *    (UNLESS its top-level root is in ALWAYS_RESOLVABLE_ROOTS)
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
      const target: Maturity =
        HAND_CODED_MATURITY[key] ?? COMMAND_MATURITY[key] ?? 'stable';
      const alwaysResolvable = ALWAYS_RESOLVABLE_ROOTS.has(subPath[0]);

      if (!alwaysResolvable && !isMaturityVisible(target, current)) {
        const idx = parent.commands.indexOf(sub);
        if (idx >= 0) (parent.commands as Command[]).splice(idx, 1);
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
