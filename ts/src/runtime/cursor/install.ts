// Installer for Cursor hooks. Spec-driven: target file, JSON key, hook
// command all come from `INSTALL_SPEC` (generated from @installTarget
// in adapters.tsp). All JSON-merge work lives in runtime/_shared/install.ts.
import { INSTALL_SPEC } from '../../core-client/generated/runtime/cursor.js';
import { installAdapter, uninstallAdapter } from '../_shared/install.js';

export function installCursor(): void {
  installAdapter(INSTALL_SPEC);
}

export function uninstallCursor(): void {
  uninstallAdapter(INSTALL_SPEC);
}
