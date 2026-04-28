import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';

/** beforeSubmitPrompt: fire goal signal + govern the prompt as input. */
export async function handleBeforeSubmitPrompt(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<WorkflowVerdict | undefined> {
  const prompt = (env.prompt ?? '').trim();
  if (!prompt) return undefined;

  // Goal signal - best-effort, never blocks.
  void session.activity(EVENT.SIGNAL, ACTIVITY_TYPES.AGENT_GOAL, {
    input: [{ goal: prompt, event_category: 'agent_goal' }],
  }).catch(() => undefined);

  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.PROMPT, {
    input: [{
      prompt,
      generation_id: env.generation_id,
      event_category: 'llm_prompt',
    }],
  });
  if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
  return verdict;
}
