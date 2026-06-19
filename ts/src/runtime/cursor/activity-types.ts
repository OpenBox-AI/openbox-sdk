// Cursor-specific activity_type vocabulary. Values are sourced from the
// generated TypeSpec preset manifest. The snake_case Cursor event
// categories (`file_read`, `llm_prompt`, ...) remain inside generated
// payload builders as `event_category` metadata, not as Core activity_type
// values.
//
// EVENT (ActivityStarted/Completed/SignalReceived) is shared across
// adapters; it's re-exported from `governance/events.ts`.

import { PRESET_ACTIVITY_TYPES } from '../../core-client/generated/govern.js';

export { EVENT } from '../../governance/events.js';

const defaultActivity = PRESET_ACTIVITY_TYPES.default;
const cursorActivity = PRESET_ACTIVITY_TYPES.cursor;

export const ACTIVITY_TYPES = {
  PROMPT: cursorActivity.beforeSubmitPrompt,
  COMPLETION: cursorActivity.afterAgentResponse,
  FILE_READ: cursorActivity.beforeReadFile,
  FILE_WRITE: cursorActivity.afterFileEdit,
  AGENT_ACTION: defaultActivity.agentAction,
  AGENT_OBSERVATION: defaultActivity.agentAction,
  AGENT_DECISION: defaultActivity.agentAction,
  API_CALL: defaultActivity.httpRequest,
  WORKFLOW_START: defaultActivity.sessionStart,
  WORKFLOW_COMPLETE: defaultActivity.stop,
} as const;
