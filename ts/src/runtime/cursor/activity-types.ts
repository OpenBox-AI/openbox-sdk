// Cursor-specific activity_type vocabulary. Values use the canonical
// OpenBox activity_type strings declared in TypeSpec. The snake_case
// Cursor event categories (`file_read`, `llm_prompt`, ...) remain inside
// generated payload builders as `event_category` metadata, not as Core
// activity_type values.
//
// Why this isn't generated: the *standard* per-event activity-type
// constants ARE generated (e.g. `BEFORE_SUBMIT_PROMPT_ACTIVITY_TYPE`
// in core-client/generated/runtime/cursor). This file names the
// activity-types we fire for *non-event* uses; workflow signals,
// out-of-band telemetry; so mappers reference symbolic constants
// instead of bare strings.
//
// EVENT (ActivityStarted/Completed/SignalReceived) is shared across
// adapters; it's re-exported from `governance/events.ts`.

export { EVENT } from '../../governance/events.js';

export const ACTIVITY_TYPES = {
  PROMPT: 'PromptSubmission',
  COMPLETION: 'LLMCompleted',
  FILE_READ: 'FileRead',
  FILE_WRITE: 'FileEdit',
  AGENT_ACTION: 'AgentAction',
  AGENT_OBSERVATION: 'AgentAction',
  AGENT_DECISION: 'AgentAction',
  API_CALL: 'HTTPRequest',
  WORKFLOW_START: 'SessionStart',
  WORKFLOW_COMPLETE: 'Stop',
} as const;
