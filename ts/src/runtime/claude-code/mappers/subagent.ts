import type { ClaudeCodeSession } from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
import type { ClaudeCodeConfig } from '../config.js';
import { EVENT } from '../activity-types.js';

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
      input: [{
        agent_id: env.agent_id,
        agent_type: env.agent_type,
        event_category: 'agent_action',
      }],
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
      input: [{
        agent_id: env.agent_id,
        agent_type: env.agent_type,
        status: 'completed',
        event_category: 'agent_observation',
      }],
    });
  } catch {
    // best-effort observability
  }
  return undefined;
}
