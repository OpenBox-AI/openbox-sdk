// Public sub-path: `import { ... } from 'openbox-sdk/runtime/claude-code'`
//
// Two surfaces in this folder:
//
//  1. Adapter primitive (spec-emitted) - `createClaudeHooksAdapter`,
//     plus its config + handlers + envelope types. Generic transport:
//     stdin JSON → dispatch by hook_event_name → verdict-mapped stdout.
//     Use this if you're building your own Claude Code integration on
//     top of the OpenBox SDK.
//
//  2. Platform integration - the OpenBox SDK's own pre-built integration
//     for Claude Code. Used by `openbox claude-code {install,hook}`. The
//     entry points (runHook, install, uninstall) are exposed for
//     contributors but the primary surface is the CLI.
//
// Most consumers want #1. #2 is here for parity with the standalone
// platform repo before it was merged in.

// ─── Adapter primitive (spec-emitted) ───────────────────────────────
export {
  createClaudeHooksAdapter,
  type ClaudeHookEnvelope,
  type ClaudeHooksAdapterConfig,
  type ClaudeHooksAdapterHandlers,
} from '../../core-client/generated/runtime/claude-hooks.js';

// ─── Platform integration (called from the CLI) ─────────────────────
export { runClaudeHook } from './hook-handler.js';
export { installClaudeHooks, uninstallClaudeHooks } from './install.js';
