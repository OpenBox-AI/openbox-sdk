import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
import { buildUserPromptSubmitPayload } from '../../../core-client/generated/runtime/claude-code.js';
import type { ClaudeCodeConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';

/**
 * UserPromptSubmit: user typed something into Claude Code. We govern the
 * prompt (input guardrails - PII, toxicity, ban words) AND fire a
 * SignalReceived(goal) so the goal-alignment service captures the user's
 * intent for drift detection later in the session.
 */
export async function handleUserPromptSubmit(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const prompt = (env.prompt ?? '').trim();
  if (!prompt) return undefined;

  // Best-effort goal signal - never blocks the prompt path.
  void session.activity(EVENT.SIGNAL, 'goal', {
    input: [{ goal: prompt, event_category: 'agent_goal' }],
  }).catch(() => undefined);

  const payload = buildUserPromptSubmitPayload(env);
  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.PROMPT, { input: [payload] });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}
