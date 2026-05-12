// Installer for Claude Code hooks. Spec-driven: target file path, JSON
// key, per-event timeouts, and the hook command all come from
// `INSTALL_SPEC` (generated from @installTarget in adapters.tsp). All
// JSON-merge work lives in install/from-spec.ts.
import { INSTALL_SPEC } from '../../core-client/generated/runtime/claude-code.js';
import { installAdapter, uninstallAdapter } from '../../install/from-spec.js';

export function installClaudeCode(): void {
  installAdapter(INSTALL_SPEC);
}

export function uninstallClaudeCode(): void {
  uninstallAdapter(INSTALL_SPEC);
}
