import type {
  CodexSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CodexEnvelope } from '../../../core-client/generated/runtime/codex.js';
import { buildUserPromptSubmitPayload } from '../../../core-client/generated/runtime/codex.js';
import { EVENT } from '../../../governance/events.js';
import { stampSource } from '../../../approvals/source.js';
import type { CodexConfig } from '../config.js';
import { CODEX_ACTIVITY_TYPES } from '../activity-types.js';
import { codexSessionKey, markHalted } from '../session-resolver.js';

export async function handleUserPromptSubmit(
  env: CodexEnvelope,
  session: CodexSession,
  cfg: CodexConfig,
): Promise<WorkflowVerdict | undefined> {
  const prompt = (env.prompt ?? '').trim();
  if (!prompt) return undefined;
  const sessionId = codexSessionKey(env);

  await session.activity(EVENT.SIGNAL, 'user_prompt', {
    input: [stampSource({ prompt, event_category: 'agent_goal' }, 'codex')],
    signalName: 'user_prompt',
    signalArgs: prompt,
    sessionId,
    prompt,
  });

  const payload = buildUserPromptSubmitPayload(env);
  const verdict = await session.activity(EVENT.START, CODEX_ACTIVITY_TYPES.PROMPT, {
    input: [stampSource(payload, 'codex')],
    sessionId,
    llmModel: env.model,
    prompt,
  });
  if (verdict.arm === 'halt') markHalted(env, cfg);
  return verdict;
}
