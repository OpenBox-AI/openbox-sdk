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

// DTO factories used by the e2e suite. Every shape matches a typed
// `BackendClient` body parameter; downstream "spin up a deterministic
// test agent" tooling consumes these instead of hand-rolling JSON.
export {
  makeCreateAgentDto,
  makeCreateGuardrailDto,
  makeCreatePolicyDto,
  makeCreateBehaviorRuleDto,
  makeUpdateAgentDto,
  makeGovernanceEvent,
  makeUpdateAivssConfigDto,
  makeGoalAlignmentConfigDto,
} from './fixtures.js';
