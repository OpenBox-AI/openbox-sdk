// Public sub-path: `import { ... } from 'openbox-sdk/runtime/cursor'`
//
// Mirrors runtime/claude-code/index.ts. Two surfaces:
//
//  1. Adapter primitive - `createCursorHooksAdapter` (spec-emitted).
//     For consumers building their own Cursor integration on top of
//     the OpenBox SDK.
//
//  2. Platform integration - the OpenBox SDK's pre-built Cursor
//     integration. Used by `openbox cursor {install,hook}`.

// ─── Adapter primitive (spec-emitted) ───────────────────────────────
export {
  createCursorHooksAdapter,
  type CursorHookEnvelope,
  type CursorHooksAdapterConfig,
  type CursorHooksAdapterHandlers,
} from '../../core-client/generated/runtime/cursor-hooks.js';

// ─── Platform integration ───────────────────────────────────────────
export { runCursorHook } from './hook-handler.js';
export { installCursorHooks, uninstallCursorHooks } from './install.js';
