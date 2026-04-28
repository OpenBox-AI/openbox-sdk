/**
 * Per-tool activity_type strings claude-hooks fires. These match the
 * `default` preset's vocabulary in openbox-sdk and are what production
 * governance rules (guardrails, policies, behavior rules) target.
 *
 * The runtime adapter binds to the `claude-code` preset (so hook events
 * route correctly) but per-tool granularity comes from these strings,
 * fired via session.activity() rather than session.preToolUse().
 */
export const ACTIVITY_TYPES = {
  PROMPT: 'PromptSubmission',
  FILE_READ: 'FileRead',
  FILE_EDIT: 'FileEdit',
  FILE_DELETE: 'FileDelete',
  SHELL: 'ShellExecution',
  HTTP_REQUEST: 'HTTPRequest',
  MCP_CALL: 'MCPToolCall',
  AGENT_SPAWN: 'AgentSpawn',
  SESSION: 'ClaudeCodeSession',
} as const;

export const EVENT = {
  START: 'ActivityStarted',
  COMPLETE: 'ActivityCompleted',
  SIGNAL: 'SignalReceived',
} as const;
