import type { SpanData } from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
import { buildLLMCompletionSpan } from '../../../governance/spans.js';
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
    fallbackText?: string;
    preferTranscriptContent?: boolean;
  },
): SpanData[] | undefined {
  const transcript = readLatestAssistantTurn(env);
  const content = options.preferTranscriptContent
    ? firstText(transcript?.content, options.fallbackText)
    : firstText(options.fallbackText, transcript?.content);
  if (!content && !transcript?.usage) return undefined;
  return [
    buildLLMCompletionSpan({
      content: content ?? '',
      span: { module: 'claude-code' },
      name: 'openbox.claude-code.assistant_output',
      kind: 'llm',
      system: 'claude-code',
      model: transcript?.model,
      usage: transcript?.usage,
      providerUrl: 'https://api.anthropic.com/v1/messages',
      attributes: {
        'gen_ai.system': 'claude-code',
        'openbox.claude_code.event': options.event,
      },
      data: {
        source: 'claude-code',
        event: options.event,
        session_id: env.session_id,
        hook_event_name: env.hook_event_name,
      },
    }),
  ];
}
