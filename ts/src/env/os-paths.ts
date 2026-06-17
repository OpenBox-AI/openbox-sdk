// Project-local path resolver; implements the OsPathResolver contract
// from specs/typespec/env/main.tsp. Hand-written because Node's current
// working directory is runtime-specific. The default is intentionally
// project-local so SDK calls do not read or write user/global OpenBox
// state. `OPENBOX_HOME` remains a hard override for tests and explicit
// non-project deployments.
//
// Layout per OS:
//
//   default       <process.cwd()>/.openbox/<scope>
//   OPENBOX_HOME  <OPENBOX_HOME>/<scope>
//
import { join, resolve } from 'path';
import type { OsPathResolver, OsPathScope } from './generated/env-bindings.js';
export type { OsPathResolver, OsPathScope } from './generated/env-bindings.js';

/**
 * Returns the OpenBox data root. Defaults to the current project's
 * `.openbox/` directory. Honors `OPENBOX_HOME` as a hard override
 * for tests, CI, sandboxes, or callers that intentionally need an
 * external data root.
 */
export function openboxDataRoot(): string {
  const override = process.env.OPENBOX_HOME;
  if (override) return resolve(override);
  return resolve(process.cwd(), '.openbox');
}

/**
 * Resolves a per-OS subpath under the openbox data root. Conforms to
 * the `OsPathResolver` interface from the spec; drift between this
 * implementation and the spec's `resolveOsPath(scope)` signature is a
 * `tsc --noEmit` failure (the const annotation below performs the
 * structural check).
 */
export const resolveOsPath: OsPathResolver['resolveOsPath'] = (scope) => {
  return join(openboxDataRoot(), scope);
};
