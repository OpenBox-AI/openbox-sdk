import {
  buildSpan,
  type SpanInput,
  type SpanType,
} from '../../governance/spans.js';
import { PRESET_ACTIVITY_TYPES } from '../../core-client/generated/govern.js';

export function buildMcpGovernanceSpan(
  spanType: SpanType,
  input: Record<string, unknown>,
): Record<string, unknown> {
  return buildSpan('mcp', spanType, input as SpanInput);
}

// Canonical activity_type values the skill emits for observability and
// approvals. Source these from the generated default preset so the MCP
// check tool cannot drift from the SDK runtime vocabulary.
const defaultActivity = PRESET_ACTIVITY_TYPES.default;

export const MCP_ACTIVITY_TYPE_MAP: Record<string, string> = {
  llm: defaultActivity.prompt,
  file_read: defaultActivity.read,
  file_write: defaultActivity.write,
  file_delete: defaultActivity.fileDelete,
  shell: defaultActivity.shell,
  http: defaultActivity.httpRequest,
  db: defaultActivity.databaseQuery,
  mcp: defaultActivity.mcpToolCall,
};
