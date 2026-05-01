// Public sub-path: `import { ... } from 'openbox-sdk/runtime/cursor'`
//
// Mirrors runtime/claude-code/index.ts. Two surfaces:
//
//  1. Adapter primitive; `createCursorAdapter` (spec-emitted).
//     For consumers building their own Cursor integration on top of
//     the OpenBox SDK.
//
//  2. Platform integration; the OpenBox SDK's pre-built Cursor
//     integration. Used by `openbox cursor {install,hook}`.

// ─── Adapter primitive (spec-emitted) ───────────────────────────────
export {
  createCursorAdapter,
  type CursorEnvelope,
  type CursorAdapterConfig,
  type CursorAdapterHandlers,
} from '../../core-client/generated/runtime/cursor.js';

// ─── Platform integration ───────────────────────────────────────────
export { runCursorHook } from './hook-handler.js';
export { installCursor, uninstallCursor } from './install.js';
