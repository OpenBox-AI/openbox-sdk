import { PRESET_ACTIVITY_TYPES } from '../../core-client/generated/govern.js';

const defaultActivity = PRESET_ACTIVITY_TYPES.default;
const codexActivity = PRESET_ACTIVITY_TYPES.codex;

export const CODEX_ACTIVITY_TYPES = {
  PROMPT: defaultActivity.prompt,
  GOAL_SIGNAL: defaultActivity.goalSignal,
  SESSION: codexActivity.sessionCompleted,
  TOOL_INPUT: codexActivity.preToolUse,
  TOOL_OUTPUT: codexActivity.postToolUse,
  AGENT_ACTION: defaultActivity.agentAction,
  FILE_READ: defaultActivity.read,
  FILE_EDIT: defaultActivity.write,
  FILE_DELETE: defaultActivity.fileDelete,
  SHELL: defaultActivity.shell,
  HTTP: defaultActivity.httpRequest,
  MCP_CALL: defaultActivity.mcpToolCall,
  SUBAGENT: defaultActivity.agentSpawn,
  DB_QUERY: defaultActivity.databaseQuery,
} as const;
