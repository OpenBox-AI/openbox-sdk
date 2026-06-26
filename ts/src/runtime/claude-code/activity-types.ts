// Claude Code-specific activity_type vocabulary. Values are sourced from
// the generated TypeSpec preset manifest so host runtime mappers cannot
// drift from the shared SDK contract.
//
// EVENT (ActivityStarted/Completed/SignalReceived) is shared across
// adapters; it's re-exported from `governance/events.ts`.

import { PRESET_ACTIVITY_TYPES } from '../../core-client/generated/govern.js';

export { EVENT } from '../../governance/events.js';

const defaultActivity = PRESET_ACTIVITY_TYPES.default;
const claudeCodeActivity = PRESET_ACTIVITY_TYPES['claude-code'];

export const ACTIVITY_TYPES = {
  PROMPT: defaultActivity.prompt,
  FILE_READ: defaultActivity.read,
  FILE_EDIT: defaultActivity.write,
  FILE_DELETE: defaultActivity.fileDelete,
  SHELL: defaultActivity.shell,
  HTTP_REQUEST: defaultActivity.httpRequest,
  DB_QUERY: defaultActivity.databaseQuery,
  MCP_CALL: defaultActivity.mcpToolCall,
  AGENT_SPAWN: defaultActivity.agentSpawn,
  AGENT_ACTION: defaultActivity.agentAction,
  GOAL_SIGNAL: defaultActivity.goalSignal,
  SESSION: claudeCodeActivity.sessionActivityStarted,
  CONFIG_CHANGE: claudeCodeActivity.configChangeActivity,
  WORKSPACE_CHANGE: claudeCodeActivity.workspaceChangeSignal,
  MCP_ELICITATION: claudeCodeActivity.mcpElicitationStarted,
  TASK: claudeCodeActivity.taskActivityStarted,
  MESSAGE: claudeCodeActivity.messageActivityStarted,
  USAGE_SIGNAL: claudeCodeActivity.claudeUsageSignal,
} as const;
