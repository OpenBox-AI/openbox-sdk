import { b as OsPathResolver } from '../env-bindings-CCaolEHB.js';
export { c as OsPathScope } from '../env-bindings-CCaolEHB.js';

/**
 * Returns the OpenBox data root. Defaults to the current project's
 * `.openbox/` directory. Honors `OPENBOX_HOME` as a hard override
 * for tests, CI, sandboxes, or callers that intentionally need an
 * external data root.
 */
declare function openboxDataRoot(): string;
/**
 * Resolves a per-OS subpath under the openbox data root. Conforms to
 * the `OsPathResolver` interface from the spec; drift between this
 * implementation and the spec's `resolveOsPath(scope)` signature is a
 * `tsc --noEmit` failure (the const annotation below performs the
 * structural check).
 */
declare const resolveOsPath: OsPathResolver['resolveOsPath'];

export { OsPathResolver, openboxDataRoot, resolveOsPath };
