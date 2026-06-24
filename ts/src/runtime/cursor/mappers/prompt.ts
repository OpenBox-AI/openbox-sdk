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
import {
  isStarted,
  markHalted,
  markStarted,
  recordGoal,
} from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';
import { stampSource } from '../../../approvals/source.js';
import { withOpenBoxActivityMetadata } from '../../../governance/spans.js';
import { buildCursorSpan } from './spans.js';

/** beforeSubmitPrompt: fire goal signal + govern the prompt as input. */
export async function handleBeforeSubmitPrompt(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<WorkflowVerdict | undefined> {
  const prompt = (env.prompt ?? '').trim();
  if (!prompt) return undefined;

  if (!isStarted(env.conversation_id, cfg)) {
    await session.workflowStarted();
    markStarted(env.conversation_id, cfg);
  }

  await session.activity(EVENT.SIGNAL, ACTIVITY_TYPES.GOAL_SIGNAL, {
    input: [stampSource({ prompt, event_category: 'agent_goal' }, 'cursor')],
    signalName: ACTIVITY_TYPES.GOAL_SIGNAL,
    signalArgs: prompt,
    sessionId: env.conversation_id,
    prompt,
  });
  recordGoal(env.conversation_id, cfg, prompt, 'prompt');

  const payload = buildBeforeSubmitPromptPayload(env);
  const span = buildCursorSpan('llm', {
    prompt,
    model: env.model,
    stage: 'started',
  });
  const verdict = await session.activity(
    EVENT.START,
    BEFORE_SUBMIT_PROMPT_ACTIVITY_TYPE,
    {
      input: withOpenBoxActivityMetadata(
        [stampSource(payload, 'cursor')],
        { toolType: 'llm' },
      ),
      sessionId: env.conversation_id,
      prompt,
      llmModel: env.model,
      toolType: 'llm',
      spans: [span],
    },
  );
  if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
  return verdict;
}
