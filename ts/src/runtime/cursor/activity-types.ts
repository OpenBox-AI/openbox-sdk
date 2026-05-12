// Cursor-specific activity_type vocabulary. snake_case strings
// matching Cursor's hook-feature mapping where production governance
// rules target.
//
// Why this isn't generated: the *standard* per-event activity-type
// constants ARE generated (e.g. `BEFORE_SUBMIT_PROMPT_ACTIVITY_TYPE`
// in core-client/generated/runtime/cursor). This file names the
// activity-types we fire for *non-event* uses — workflow signals,
// out-of-band telemetry — so mappers reference symbolic constants
// instead of bare strings.
//
// EVENT (ActivityStarted/Completed/SignalReceived) is shared across
// adapters; it's re-exported from `governance/events.ts`.

export { EVENT } from '../../governance/events.js';

export const ACTIVITY_TYPES = {
  PROMPT: 'llm_prompt',
  COMPLETION: 'llm_completion',
  FILE_READ: 'file_read',
  FILE_WRITE: 'file_write',
  AGENT_ACTION: 'agent_action',
  AGENT_OBSERVATION: 'agent_observation',
  AGENT_DECISION: 'agent_decision',
  AGENT_GOAL: 'agent_goal',
  API_CALL: 'api_call',
  WORKFLOW_START: 'workflow_start',
  WORKFLOW_COMPLETE: 'workflow_complete',
} as const;
