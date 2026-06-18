// Compatibility wrappers for older SDK consumers that called
// `installClaudeCode()` directly. Claude Code governance now installs
// through the native project-local plugin surface, not by writing
// project `.claude/settings.json` directly.

import type { InstallOptions } from '../../install/from-spec.js';
import {
  installClaudeCodePlugin,
  uninstallClaudeCodePlugin,
} from './plugin.js';

export function installClaudeCode(opts: InstallOptions = {}): void {
  installClaudeCodePlugin({ scope: opts.scope, cwd: opts.cwd });
}

export function uninstallClaudeCode(opts: InstallOptions = {}): void {
  uninstallClaudeCodePlugin({ scope: opts.scope, cwd: opts.cwd });
}
