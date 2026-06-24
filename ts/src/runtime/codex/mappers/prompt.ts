import type {
  CodexSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CodexEnvelope } from '../../../core-client/generated/runtime/codex.js';
import { buildUserPromptSubmitPayload } from '../../../core-client/generated/runtime/codex.js';
import { EVENT } from '../../../governance/events.js';
import {
  buildSpan,
  withOpenBoxActivityMetadata,
} from '../../../governance/spans.js';
import { stampSource } from '../../../approvals/source.js';
import type { CodexConfig } from '../config.js';
import { CODEX_ACTIVITY_TYPES } from '../activity-types.js';
import {
  codexSessionKey,
  isStarted,
  markHalted,
  markStarted,
  recordGoal,
} from '../session-resolver.js';

export async function handleUserPromptSubmit(
  env: CodexEnvelope,
  session: CodexSession,
  cfg: CodexConfig,
): Promise<WorkflowVerdict | undefined> {
  const prompt = (env.prompt ?? '').trim();
  if (!prompt) return undefined;
  const sessionId = codexSessionKey(env);

  if (!isStarted(env, cfg)) {
    await session.workflowStarted();
    markStarted(env, cfg);
  }

  await session.activity(EVENT.SIGNAL, CODEX_ACTIVITY_TYPES.GOAL_SIGNAL, {
    input: [stampSource({ prompt, event_category: 'agent_goal' }, 'codex')],
    signalName: CODEX_ACTIVITY_TYPES.GOAL_SIGNAL,
    signalArgs: prompt,
    sessionId,
    prompt,
  });
  recordGoal(env, cfg, prompt, 'prompt');

  const payload = buildUserPromptSubmitPayload(env);
  const span = buildSpan('codex', 'llm', {
    prompt,
    model: env.model,
    stage: 'started',
  });
  const verdict = await session.activity(EVENT.START, CODEX_ACTIVITY_TYPES.PROMPT, {
    input: withOpenBoxActivityMetadata(
      [stampSource(payload, 'codex')],
      { toolType: 'llm' },
    ),
    sessionId,
    llmModel: env.model,
    prompt,
    toolType: 'llm',
    spans: [span],
  });
  if (verdict.arm === 'halt') markHalted(env, cfg);
  return verdict;
}
