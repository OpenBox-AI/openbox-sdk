import type { SpanData } from '../../../core-client/index.js';
import {
  buildSpan,
  withServerComputedSemantic,
  type SpanInput,
  type SpanType,
} from '../../../governance/spans.js';
import { buildAssistantOutputSpan } from '../../../governance/assistant-output.js';
import type { AssistantOutputTelemetryInput } from '../../../governance/assistant-output.js';

export function buildCursorSpan(
  type: SpanType,
  input: SpanInput,
): Record<string, unknown> {
  return withServerComputedSemantic(
    buildSpan('cursor', type, input),
    type,
    input,
  );
}

export function buildCursorAssistantOutputSpan(
  input: AssistantOutputTelemetryInput,
): SpanData[] | undefined {
  return buildAssistantOutputSpan(input)?.map((span) =>
    withServerComputedSemantic(
      span as unknown as Record<string, unknown>,
      'llm',
      {},
    ) as unknown as SpanData,
  );
}
