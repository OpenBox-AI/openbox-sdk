// Installer for Claude Code hooks. Spec-driven: target file path,
// JSON key, per-event timeouts, and the hook command all come from
// `HOOK_SPEC` (generated from `@hookTarget` in
// `adapters.tsp`). All JSON-merge work lives in
// `install/from-spec.ts`.

import { HOOK_SPEC } from '../../core-client/generated/runtime/claude-code.js';
import {
  installAdapter,
  uninstallAdapter,
  type InstallOptions,
} from '../../install/from-spec.js';

export function installClaudeCode(opts: InstallOptions = {}): void {
  installAdapter(HOOK_SPEC, opts);
}

export function uninstallClaudeCode(opts: InstallOptions = {}): void {
  uninstallAdapter(HOOK_SPEC, opts);
}
