import type {
  CursorSession,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';

/**
 * afterMCPExecution: post-execution telemetry on an MCP tool's response.
 * Observe-only (verdictShape: cursor-observe). Extracts text content
 * from the standard MCP response shape `{ content: [{ type, text }] }`
 * so output guardrails can scan it directly.
 */
export async function handleAfterMCPExecution(
  env: CursorEnvelope,
  session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  // Cursor delivers the response in either tool_output or a result_json
  // field. Pull either via permissive cast since the spec envelope lists
  // tool_output but legacy harness wire shapes vary.
  const raw =
    (env as unknown as { result_json?: unknown }).result_json ??
    env.tool_output;

  let outputText = '';
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as { content?: Array<{ type: string; text: string }> };
      if (Array.isArray(parsed.content)) {
        outputText = parsed.content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text)
          .join('\n');
      } else {
        outputText = JSON.stringify(parsed);
      }
    } catch {
      outputText = raw;
    }
  } else {
    outputText = JSON.stringify(raw ?? {});
  }

  try {
    await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.AGENT_OBSERVATION, {
      input: [{
        tool_name: env.tool_name,
        tool_output: outputText,
        generation_id: env.generation_id,
        event_category: 'agent_observation',
      }],
    });
  } catch {
    /* observe-only */
  }
  return undefined;
}
