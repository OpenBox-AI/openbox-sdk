// Claude Code-specific activity_type vocabulary. PascalCase strings
// matching the `default` preset in openbox-sdk; production governance
// rules (guardrails, policies, behavior rules) target these names.
//
// Why this isn't generated: the *standard* tool routing IS generated
// (see PRE_TOOL_USE_ROUTING in core-client/generated/runtime/claude-code).
// This file names the activity-types we fire for non-routed
// events (session lifecycle, prompts, and the `mcp__*` fallback)
// so mappers reference symbolic constants instead of bare strings.
//
// EVENT (ActivityStarted/Completed/SignalReceived) is shared across
// adapters; it's re-exported from `governance/events.ts`.

export { EVENT } from '../../governance/events.js';

export const ACTIVITY_TYPES = {
  PROMPT: 'PromptSubmission',
  FILE_READ: 'FileRead',
  FILE_EDIT: 'FileEdit',
  FILE_DELETE: 'FileDelete',
  SHELL: 'ShellExecution',
  HTTP_REQUEST: 'HTTPRequest',
  MCP_CALL: 'MCPToolCall',
  AGENT_SPAWN: 'AgentSpawn',
  AGENT_ACTION: 'AgentAction',
  SESSION: 'ClaudeCodeSession',
  CONFIG_CHANGE: 'ClaudeCodeConfigChange',
  WORKSPACE_CHANGE: 'ClaudeCodeWorkspaceChange',
  MCP_ELICITATION: 'MCPElicitation',
  TASK: 'ClaudeCodeTask',
  MESSAGE: 'ClaudeCodeMessage',
} as const;
