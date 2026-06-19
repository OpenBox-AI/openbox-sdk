import {
  buildSpan,
  type SpanInput,
  type SpanType,
} from '../../governance/spans.js';

export function buildMcpGovernanceSpan(
  spanType: SpanType,
  input: Record<string, unknown>,
): Record<string, unknown> {
  return buildSpan('mcp', spanType, input as SpanInput);
}

// Canonical activity_type values the skill emits for observability and
// approvals. Legacy guardrail activity bindings are compatibility-only no-ops;
// backend/Core apply guardrails by processing stage.
export const MCP_ACTIVITY_TYPE_MAP: Record<string, string> = {
  llm: 'PromptSubmission',
  file_read: 'FileRead',
  file_write: 'FileEdit',
  file_delete: 'FileDelete',
  shell: 'ShellExecution',
  http: 'HTTPRequest',
  db: 'DatabaseQuery',
  mcp: 'MCPToolCall',
};
