// Workflow event names shared across host adapters. These constants
// belong at the transport layer; every adapter fires the same events
// for activity start, complete, and signal regardless of which host
// invoked the action. Host-specific activity-type vocabularies (such
// as cursor's snake_case `llm_prompt` or claude-code's PascalCase
// `PromptSubmission`) live alongside each adapter in its own
// `activity-types.ts`.

import { CANONICAL_EVENT_TYPE } from '../core-client/generated/govern.js';

export const EVENT = {
  START: CANONICAL_EVENT_TYPE.ACTIVITY_STARTED,
  COMPLETE: CANONICAL_EVENT_TYPE.ACTIVITY_COMPLETED,
  SIGNAL: CANONICAL_EVENT_TYPE.SIGNAL_RECEIVED,
} as const;
