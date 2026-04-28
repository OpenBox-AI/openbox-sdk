import type { ClaudeCodeSession } from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
import {
  buildSubagentStartPayload,
  buildSubagentStopPayload,
} from '../../../core-client/generated/runtime/claude-code.js';
import type { ClaudeCodeConfig } from '../config.js';
import { EVENT } from '../activity-types.js';

/** Pinned per-subagent activity_type so START/STOP balance. Activity name
 *  carries identity that the spec-driven payload doesn't (the activity_type
 *  string itself is what the dashboard charts; payload fields are for
 *  guardrail scanning). */
function subAgentActivityType(env: ClaudeCodeEnvelope): string {
  return `SubAgent:${env.agent_type || env.agent_id || 'unknown'}`;
}

/** SubagentStart: opens a SubAgent activity. Observe-only. */
export async function handleSubagentStart(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  _cfg: ClaudeCodeConfig,
): Promise<undefined> {
  try {
    await session.activity(EVENT.START, subAgentActivityType(env), {
      input: [buildSubagentStartPayload(env)],
    });
  } catch {
    // best-effort observability
  }
  return undefined;
}

/** SubagentStop: closes the SubAgent activity. Pairs with SubagentStart. */
export async function handleSubagentStop(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  _cfg: ClaudeCodeConfig,
): Promise<undefined> {
  try {
    await session.activity(EVENT.COMPLETE, subAgentActivityType(env), {
      input: [buildSubagentStopPayload(env)],
    });
  } catch {
    // best-effort observability
  }
  return undefined;
}
