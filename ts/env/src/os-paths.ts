// Per-OS path resolver - implements the OsPathResolver contract from
// specs/typespec/env/main.tsp. Hand-written because the call uses
// platform-specific APIs (`os.homedir()`, `process.platform`, env
// vars `XDG_DATA_HOME` / `APPDATA`), but the OUTPUT shape is
// deterministic given the platform - pinned by tests/unit/os-paths.test.ts.
//
// Layout per OS:
//
//   Linux   $XDG_DATA_HOME/openbox/<scope>  (default: ~/.openbox/<scope>)
//   macOS   ~/.openbox/<scope>
//   Windows %APPDATA%\openbox\<scope>       (default: ~\AppData\Roaming\openbox\<scope>)
//
// Why ~/.openbox on macOS instead of ~/Library/Application Support/openbox:
// the file is intended to be findable + editable from a terminal, and
// hiding it under Library makes that worse. Same rationale as e.g. the
// AWS CLI's ~/.aws and gcloud's ~/.config/gcloud.

import { homedir } from 'os';
import { join } from 'path';
import type { OsPathResolver, OsPathScope } from './generated/env-bindings.js';
export type { OsPathResolver, OsPathScope } from './generated/env-bindings.js';

/**
 * Returns the openbox user-data root for the current platform. Honors
 * `OPENBOX_HOME` as a hard override (testing, CI, sandboxes).
 */
export function openboxDataRoot(): string {
  const override = process.env.OPENBOX_HOME;
  if (override) return override;
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'openbox');
  }
  // Linux honors XDG_DATA_HOME per the freedesktop.org spec; macOS does
  // not have an equivalent, so we fall back to ~/.openbox there too.
  if (process.platform === 'linux') {
    const xdg = process.env.XDG_DATA_HOME;
    if (xdg) return join(xdg, 'openbox');
  }
  return join(homedir(), '.openbox');
}

/**
 * Resolves a per-OS subpath under the openbox data root. Conforms to
 * the `OsPathResolver` interface from the spec - drift between this
 * implementation and the spec's `resolveOsPath(scope)` signature is a
 * `tsc --noEmit` failure (the const annotation below performs the
 * structural check).
 */
export const resolveOsPath: OsPathResolver['resolveOsPath'] = (scope) => {
  return join(openboxDataRoot(), scope);
};
