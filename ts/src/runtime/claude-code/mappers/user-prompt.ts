import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
import {
  buildUserPromptExpansionPayload,
  buildUserPromptSubmitPayload,
} from '../../../core-client/generated/runtime/claude-code.js';
import type { ClaudeCodeConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';
import { buildSpan } from '../../../governance/spans.js';
import { stampSource } from '../../../approvals/source.js';

/**
 * UserPromptSubmit: user typed something into Claude Code. We govern the
 * prompt (input guardrails; PII, toxicity, ban words) AND fire a
 * SignalReceived(user_prompt) so the goal-alignment service captures the
 * user's intent for drift detection later in the session.
 */
export async function handleUserPromptSubmit(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const prompt = (env.prompt ?? '').trim();
  if (!prompt) return undefined;

  // Best-effort goal signal; never blocks the prompt path.
  void session.activity(EVENT.SIGNAL, 'user_prompt', {
    input: [stampSource({ prompt, event_category: 'agent_goal' }, 'claude-code')],
    signalName: 'user_prompt',
    signalArgs: prompt,
    spans: [buildSpan('claude-code', 'llm', { prompt })],
  }).catch(() => undefined);

  const payload = buildUserPromptSubmitPayload(env);
  const span = buildSpan('claude-code', 'llm', { prompt });
  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.PROMPT, {
    input: [stampSource(payload, 'claude-code')],
    spans: [span],
  });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}

export async function handleUserPromptExpansion(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const prompt = (env.expanded_prompt ?? env.prompt ?? '').trim();
  if (!prompt) return undefined;
  const payload = buildUserPromptExpansionPayload(env);
  const span = buildSpan('claude-code', 'llm', { prompt });
  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.PROMPT, {
    input: [stampSource(payload, 'claude-code')],
    spans: [span],
  });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}
