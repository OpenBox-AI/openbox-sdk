import type {
  CodexSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CodexEnvelope } from '../../../core-client/generated/runtime/codex.js';
import { buildStopPayload } from '../../../core-client/generated/runtime/codex.js';
import { stampSource } from '../../../approvals/source.js';
import { EVENT } from '../../../governance/events.js';
import type { CodexConfig } from '../config.js';
import { CODEX_ACTIVITY_TYPES } from '../activity-types.js';
import { clearSession, codexSessionKey, markHalted } from '../session-resolver.js';
import {
  buildCodexAssistantOutputSpan,
  codexAssistantTelemetryFields,
} from './assistant-output.js';

export async function handleStop(
  env: CodexEnvelope,
  session: CodexSession,
  cfg: CodexConfig,
): Promise<WorkflowVerdict | undefined> {
  const payload = buildStopPayload(env);
  const spans = buildCodexAssistantOutputSpan(env);
  const verdict = await session.activity(EVENT.COMPLETE, CODEX_ACTIVITY_TYPES.SESSION, {
    input: [stampSource(payload, 'codex')],
    output: stampSource(payload, 'codex'),
    sessionId: codexSessionKey(env),
    ...codexAssistantTelemetryFields(env),
    spans,
    hookSpanParentEventType: spans ? EVENT.START : undefined,
    ensureHookSpanParent: spans ? true : undefined,
  });
  if (verdict.arm === 'halt') {
    markHalted(env, cfg);
    return verdict;
  }
  if (verdict.arm === 'allow' || verdict.arm === 'constrain') {
    try {
      await session.workflowCompleted();
      clearSession(env, cfg);
    } catch {
      return {
        arm: 'block',
        reason: 'OpenBox Core was unavailable while completing Codex workflow',
        riskScore: 1,
      };
    }
  }
  return verdict;
}
