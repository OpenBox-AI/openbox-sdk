import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { ClaudeHookEnvelope } from '../../../core-client/generated/runtime/claude-hooks.js';
import type { ClaudeHooksConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';

/**
 * UserPromptSubmit: user typed something into Claude Code. We govern the
 * prompt as PromptSubmission (input guardrails - PII, toxicity, ban
 * words) AND fire a SignalReceived(goal) so the goal-alignment service
 * captures the user's intent for drift detection later in the session.
 *
 * Verdict shape on output: `decision-block` (block/halt → {decision:"block",
 * reason}, allow → {}). The adapter handles the translation.
 */
export async function handleUserPromptSubmit(
  env: ClaudeHookEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeHooksConfig,
): Promise<WorkflowVerdict | undefined> {
  const prompt = (env.prompt ?? '').trim();
  if (!prompt) return undefined;

  // Best-effort goal signal - never blocks the prompt path.
  void session.activity(EVENT.SIGNAL, 'goal', {
    input: [{ goal: prompt, event_category: 'agent_goal' }],
  }).catch(() => undefined);

  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.PROMPT, {
    input: [{
      text: prompt,
      prompt,
      model: env.model,
      event_category: 'llm_prompt',
    }],
  });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}
