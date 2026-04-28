// Sub-path: `import { createClaudeHooksAdapter } from 'openbox-sdk/runtime/claude-hooks';`
//
// Spec-driven adapter generated from specs/typespec/govern/adapters.tsp -
// reads stdin, dispatches by hook_event_name, calls the user-supplied
// handler bound to a ClaudeCodeSession, and writes the verdict-mapped
// stdout JSON Claude Code expects.
export {
  createClaudeHooksAdapter,
  type ClaudeHookEnvelope,
  type ClaudeHooksAdapterConfig,
  type ClaudeHooksAdapterHandlers,
} from '@openbox/core-client';
