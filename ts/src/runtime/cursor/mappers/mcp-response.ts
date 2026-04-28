import type { CursorSession } from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import { buildAfterMCPExecutionPayload } from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';
import { sideEffects } from '../side-effects.js';

/**
 * afterMCPExecution: post-execution telemetry on an MCP tool's response.
 * Observe-only (verdictShape: cursor-observe). Spec-driven payload pulls
 * `result_json` (or `tool_output`) and pipes it through the
 * `extractMcpText` side effect to peel `{content:[{type:'text',text}]}`.
 */
export async function handleAfterMCPExecution(
  env: CursorEnvelope,
  session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  try {
    await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.AGENT_OBSERVATION, {
      input: [buildAfterMCPExecutionPayload(env, sideEffects)],
    });
  } catch {
    /* observe-only */
  }
  return undefined;
}
