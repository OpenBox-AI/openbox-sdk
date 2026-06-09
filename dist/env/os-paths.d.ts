import { b as OsPathResolver } from '../env-bindings--BxVwc6f.js';
export { c as OsPathScope } from '../env-bindings--BxVwc6f.js';

/**
 * Returns the openbox user-data root for the current platform. Honors
 * `OPENBOX_HOME` as a hard override (testing, CI, sandboxes).
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
