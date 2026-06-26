import type { GovernedPayload, SpanData } from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
import {
  assistantOutputTelemetryFields,
  buildAssistantOutputSpan,
} from '../../../governance/assistant-output.js';
import { readLatestAssistantTurn } from '../transcript-usage.js';

function firstText(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function buildClaudeAssistantOutputSpan(
  env: ClaudeCodeEnvelope,
  options: {
    event: string;
    defaultText?: string;
    preferTranscriptContent?: boolean;
  },
): SpanData[] | undefined {
  const transcript = readLatestAssistantTurn(env);
  const content = options.preferTranscriptContent
    ? firstText(transcript?.content, options.defaultText)
    : firstText(options.defaultText, transcript?.content);
  if (!content && !transcript?.usage) return undefined;
  return buildAssistantOutputSpan({
    source: 'claude-code',
    content,
    span: { module: 'claude-code' },
    name: 'openbox.claude-code.assistant_output',
    model: transcript?.model,
    usage: transcript?.usage,
    hasToolCalls: transcript?.hasToolCalls ?? false,
    providerUrl: 'https://api.anthropic.com/v1/messages',
    attributes: {
      'openbox.claude_code.event': options.event,
    },
    data: {
      source: 'claude-code',
      event: options.event,
      session_id: env.session_id,
      hook_event_name: env.hook_event_name,
    },
  });
}

export function claudeAssistantTelemetryFields(
  env: ClaudeCodeEnvelope,
  options: {
    defaultText?: string;
    preferTranscriptContent?: boolean;
  } = {},
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
  const transcript = readLatestAssistantTurn(env);
  const content = options.preferTranscriptContent
    ? firstText(transcript?.content, options.defaultText)
    : firstText(options.defaultText, transcript?.content);
  const usage = transcript?.usage;
  return {
    ...assistantOutputTelemetryFields({
      source: 'claude-code',
      sessionId: env.session_id,
      content,
      model: transcript?.model,
      usage,
      hasToolCalls: transcript?.hasToolCalls ?? false,
    }),
  };
}
