// Public sub-path: `import { ... } from 'openbox-sdk/test-utils'`.
//
// Tooling helpers useful for testing governance integrations end-to-end
// without standing up a full agent run. Currently exports the
// span-builder used by `core evaluate --type` plus consumers building
// their own governance smoke tests.
export {
  buildTestPayload,
  SPAN_TYPES,
  type SpanType,
  type SpanOptions,
} from './span-builder.js';
