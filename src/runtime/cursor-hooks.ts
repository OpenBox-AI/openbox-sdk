// Sub-path: `import { createCursorHooksAdapter } from 'openbox-sdk/runtime/cursor-hooks';`
//
// Spec-driven adapter generated from specs/typespec/govern/adapters.tsp -
// reads stdin, dispatches by hook_event_name, calls the user-supplied
// handler bound to a CursorSession, and writes the verdict-mapped
// stdout JSON Cursor expects (`{ permission, userMessage?, ... }`).
export {
  createCursorHooksAdapter,
  type CursorHookEnvelope,
  type CursorHooksAdapterConfig,
  type CursorHooksAdapterHandlers,
} from '@openbox/core-client';
