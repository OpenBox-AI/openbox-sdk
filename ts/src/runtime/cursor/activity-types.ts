/**
 * Per-tool activity_type strings cursor-hooks fires. These match
 * Cursor's hook-feature mapping where production governance rules
 * (guardrails, policies, behavior rules) target.
 */
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

export const EVENT = {
  START: 'ActivityStarted',
  COMPLETE: 'ActivityCompleted',
  SIGNAL: 'SignalReceived',
} as const;
