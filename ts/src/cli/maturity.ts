// Commander integration over the public maturity gate. The pure
// query functions (isMaturityVisible, currentMaturityLevel, etc) live
// in `openbox-sdk/maturity` so non-CLI consumers (UI dashboards, IDE
// plugins) can gate their own surfaces against the same spec-driven
// COMMAND_MATURITY table.
//
// Path syntax: space-separated command path from the program root.
//   'auth login'      → `openbox auth login`
//   'agent list'      → `openbox agent list`

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
