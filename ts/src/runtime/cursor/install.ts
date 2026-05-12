// Installer for Cursor hooks. Spec-driven: target file, JSON key,
// and hook command all come from `INSTALL_SPEC` (generated from
// `@installTarget` in `adapters.tsp`). All JSON-merge work lives in
// `install/from-spec.ts`.

import { INSTALL_SPEC } from '../../core-client/generated/runtime/cursor.js';
import {
  installAdapter,
  uninstallAdapter,
  type InstallOptions,
  type InstallSpec,
} from '../../install/from-spec.js';

export interface InstallCursorOptions extends InstallOptions {
  /**
   * Per-event Cursor hook matcher regexes. Cursor evaluates the
   * matcher before invoking the hook command, so a properly-scoped
   * matcher cuts process spawns by an order of magnitude for
   * shell-heavy sessions.
   *
   * Map keys are event names from the cursor adapter spec
   * (`beforeShellExecution`, `beforeReadFile`, `preToolUse`, etc.);
   * values are regex strings. Events not present in the map fire on
   * every occurrence.
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
  const { matchers, ...installOpts } = opts;
  installAdapter(specWithMatchers(matchers), installOpts);
}

export function uninstallCursor(opts: InstallOptions = {}): void {
  uninstallAdapter(INSTALL_SPEC, opts);
}
