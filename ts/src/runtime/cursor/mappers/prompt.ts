import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import {
  buildBeforeSubmitPromptPayload,
  BEFORE_SUBMIT_PROMPT_ACTIVITY_TYPE,
} from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { EVENT } from '../activity-types.js';
import { buildSpan } from '../../../governance/spans.js';
import { stampSource } from '../../../approvals/source.js';

/** beforeSubmitPrompt: fire goal signal + govern the prompt as input. */
export async function handleBeforeSubmitPrompt(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<WorkflowVerdict | undefined> {
  const prompt = (env.prompt ?? '').trim();
  if (!prompt) return undefined;

  // Goal signal; best-effort, never blocks.
  void session.activity(EVENT.SIGNAL, 'user_prompt', {
    input: [stampSource({ prompt, event_category: 'agent_goal' }, 'cursor')],
    signalName: 'user_prompt',
    signalArgs: prompt,
    spans: [buildSpan('cursor', 'llm', { prompt })],
  }).catch(() => undefined);

  const payload = buildBeforeSubmitPromptPayload(env);
  const span = buildSpan('cursor', 'llm', { prompt });
  const verdict = await session.activity(
    EVENT.START,
    BEFORE_SUBMIT_PROMPT_ACTIVITY_TYPE,
    { input: [stampSource(payload, 'cursor')], spans: [span] },
  );
  if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
  return verdict;
}
