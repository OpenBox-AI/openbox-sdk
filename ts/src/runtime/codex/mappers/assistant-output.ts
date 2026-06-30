import type { GovernedPayload, SpanData } from '../../../core-client/index.js';
import type { CodexEnvelope } from '../../../core-client/generated/runtime/codex.js';
import {
  assistantOutputTelemetryFields,
  buildAssistantOutputSpan,
} from '../../../governance/assistant-output.js';
import { stableCodexSessionKey } from '../session-resolver.js';
import { firstTrimmed as firstText } from '../../../internal/strings.js';

function codexAssistantText(env: CodexEnvelope): string | undefined {
  return firstText(env.content, env.response);
}

export function buildCodexAssistantOutputSpan(
  env: CodexEnvelope,
): SpanData[] | undefined {
  const content = codexAssistantText(env);
  if (!content) return undefined;
  return buildAssistantOutputSpan({
    source: 'codex',
    content,
    span: { module: 'codex' },
    name: 'openbox.codex.assistant_output',
    model: env.model,
    attributes: {
      'openbox.codex.event': env.hook_event_name,
    },
    data: {
      source: 'codex',
      event: env.hook_event_name,
      session_id: env.session_id,
      conversation_id: env.conversation_id,
      turn_id: env.turn_id,
      hook_event_name: env.hook_event_name,
    },
  });
}

export function codexAssistantTelemetryFields(
  env: CodexEnvelope,
): Pick<
  GovernedPayload,
  | 'sessionId'
  | 'llmModel'
  | 'inputTokens'
  | 'outputTokens'
  | 'totalTokens'
  | 'hasToolCalls'
  | 'completion'
> {
  return assistantOutputTelemetryFields({
    source: 'codex',
    sessionId: stableCodexSessionKey(env),
    content: codexAssistantText(env),
    model: env.model,
  });
}
