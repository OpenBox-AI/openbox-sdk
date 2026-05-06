// Installer for Cursor hooks. Spec-driven: target file, JSON key, hook
// command all come from `INSTALL_SPEC` (generated from @installTarget
// in adapters.tsp). All JSON-merge work lives in runtime/_shared/install.ts.
import { INSTALL_SPEC } from '../../core-client/generated/runtime/cursor.js';
import { installAdapter, uninstallAdapter, type InstallSpec } from '../_shared/install.js';

export interface InstallCursorOptions {
  /**
   * Per-event Cursor hook matcher regexes. Cursor evaluates the
   * matcher BEFORE invoking the hook command, so a properly-scoped
   * matcher cuts process spawns ~10× for shell-heavy sessions.
   *
   * Map keys are event names from the cursor adapter spec
   * (`beforeShellExecution`, `beforeReadFile`, `preToolUse`, etc.);
   * values are regex strings. Events not in the map fire on every
   * occurrence (current default behavior).
   *
   * Example:
   *   { beforeShellExecution: '\\b(rm|sudo|curl|wget|unlink|shred)\\b' }
   */
  matchers?: Record<string, string>;
}

function specWithMatchers(matchers?: Record<string, string>): InstallSpec {
  if (!matchers || Object.keys(matchers).length === 0) return INSTALL_SPEC;
  return {
    ...INSTALL_SPEC,
    events: INSTALL_SPEC.events.map((evt) =>
      matchers[evt.name] ? { ...evt, matcher: matchers[evt.name] } : evt,
    ),
  };
}

export function installCursor(opts: InstallCursorOptions = {}): void {
  installAdapter(specWithMatchers(opts.matchers));
}

export function uninstallCursor(): void {
  uninstallAdapter(INSTALL_SPEC);
}
