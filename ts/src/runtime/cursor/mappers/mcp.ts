import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';

/** beforeMCPExecution: govern an MCP tool call before Cursor invokes it. */
export async function handleBeforeMCPExecution(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  if (!toolName) return undefined;
  // Stringify tool_input so guardrails (PII, toxicity, ban words) can scan it.
  const rawInput = (env.tool_input ?? {}) as unknown;
  const toolInputStr =
    typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput);

  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.API_CALL, {
    input: [{
      tool_name: toolName,
      tool_input: toolInputStr,
      generation_id: env.generation_id,
      event_category: 'api_call',
    }],
  });
  if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
  return verdict;
}
