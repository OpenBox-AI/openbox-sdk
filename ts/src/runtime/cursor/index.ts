// Public sub-path: `import { ... } from '@openbox-ai/openbox-sdk/runtime/cursor'`
//
// Mirrors runtime/claude-code/index.ts. Two surfaces:
//
//  1. Adapter primitive; `createCursorAdapter` (spec-emitted).
//     For consumers building their own Cursor integration on top of
//     the OpenBox SDK.
//
//  2. Platform integration; the OpenBox SDK's pre-built Cursor
//     integration. Used by `openbox cursor {plugin,hook}`.

// ─── Adapter primitive (spec-emitted) ───────────────────────────────
export {
  createCursorAdapter,
  type CursorEnvelope,
  type CursorAdapterConfig,
  type CursorAdapterHandlers,
} from '../../core-client/generated/runtime/cursor.js';

// ─── Platform integration ───────────────────────────────────────────
export { runCursorHook } from './hook-handler.js';
export {
  verifyCursorInstall,
  type CursorInstallCheck,
  type CursorInstallCheckStatus,
  type VerifyCursorInstallOptions,
} from './install.js';
export {
  cursorPluginTargetDir,
  cursorRepoSkillTargetDir,
  exportCursorPlugin,
  installCursorRepoMode,
  installCursorPlugin,
  uninstallCursorRepoMode,
  uninstallCursorPlugin,
  verifyCursorRepoMode,
  verifyCursorPlugin,
  type CursorPluginCheck,
  type CursorPluginCheckStatus,
  type ExportCursorPluginOptions,
  type InstallCursorRepoOptions,
  type InstallCursorPluginOptions,
  type UninstallCursorRepoOptions,
  type UninstallCursorPluginOptions,
  type VerifyCursorRepoOptions,
  type VerifyCursorPluginOptions,
} from './plugin.js';

import { makeHookLog } from '../../logging/hook-log.js';
/** Path of the JSONL log written by the cursor hook subprocess.
 *  Kept as a public symbol because the extension's OutputChannel
 *  tails this file. */
export const HOOK_LOG_PATH = makeHookLog('cursor').path;
