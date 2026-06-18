import type {
  GovernedPayload,
  N8nSession,
  WorkflowVerdict,
} from '../../core-client/index.js';
import type { LLMTokenUsage } from '../../governance/spans.js';
import {
  assistantOutputTelemetryFields,
  buildAssistantOutputSpan,
} from '../../governance/assistant-output.js';
import { stampSource } from '../../approvals/source.js';

export interface N8nUserPromptSignalOptions {
  nodeName?: string;
  sessionId?: string;
}

export interface N8nNodePreExecutePayloadInput {
  input?: Record<string, unknown>;
  nodeName?: string;
  sessionId?: string;
  prompt?: string;
}

export interface N8nLlmCompletionPayloadInput {
  text: string;
  model?: string;
  usage?: LLMTokenUsage;
  requestBody?: unknown;
  responseBody?: unknown;
  providerUrl?: string;
  actualProviderUrl?: string;
  provider?: string;
  nodeName?: string;
  sessionId?: string;
  startTime?: number;
  endTime?: number;
  durationNs?: number;
  hasToolCalls?: boolean;
}

type SignalCapableN8nSession = Pick<N8nSession, 'activity'>;
type NodePreExecuteCapableN8nSession = Pick<N8nSession, 'nodePreExecute'>;
type NodePostExecuteCapableN8nSession = Pick<N8nSession, 'nodePostExecute'>;

function cleanRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

export async function emitN8nUserPromptSignal(
  session: SignalCapableN8nSession,
  prompt: string | undefined,
  options: N8nUserPromptSignalOptions = {},
): Promise<WorkflowVerdict | undefined> {
  const signalArgs = prompt?.trim();
  if (!signalArgs) return undefined;
  return session.activity('SignalReceived', 'user_prompt', {
    input: [
      stampSource(
        cleanRecord({
          prompt: signalArgs,
          event_category: 'agent_goal',
          node_name: options.nodeName,
        }),
        'n8n',
      ),
    ],
    signalName: 'user_prompt',
    signalArgs,
    sessionId: options.sessionId,
    prompt: signalArgs,
  });
}

export function buildN8nNodePreExecutePayload(
  input: N8nNodePreExecutePayloadInput,
): GovernedPayload {
  const prompt = input.prompt?.trim();
  return {
    input: [
      stampSource(
        cleanRecord({
          ...(input.input ?? {}),
          event_category: 'node_pre_execute',
          node_name: input.nodeName,
          prompt,
        }),
        'n8n',
      ),
    ],
    sessionId: input.sessionId,
    prompt,
  };
}

export async function emitN8nNodePreExecute(
  session: NodePreExecuteCapableN8nSession,
  input: N8nNodePreExecutePayloadInput,
): Promise<WorkflowVerdict> {
  return session.nodePreExecute(buildN8nNodePreExecutePayload(input));
}

export function buildN8nLlmCompletionPayload(
  input: N8nLlmCompletionPayloadInput,
): GovernedPayload {
  const content = input.text.trim();
  const telemetry = assistantOutputTelemetryFields({
    source: 'n8n',
    sessionId: input.sessionId,
    content,
    model: input.model,
    usage: input.usage,
    hasToolCalls: input.hasToolCalls ?? false,
  });
  return {
    output: { text: input.text },
    ...telemetry,
    spans: buildAssistantOutputSpan({
      source: 'n8n',
      content,
      name: 'openbox.n8n.assistant_output',
      model: input.model,
      provider: input.provider,
      usage: input.usage,
      hasToolCalls: input.hasToolCalls ?? false,
      requestBody: input.requestBody,
      responseBody: input.responseBody,
      providerUrl: input.providerUrl,
      startTime: input.startTime,
      endTime: input.endTime,
      durationNs: input.durationNs,
      attributes: cleanRecord({
        'openbox.n8n.node_name': input.nodeName,
        'openbox.provider': input.provider,
        'openbox.provider.url': input.actualProviderUrl,
      }),
      data: cleanRecord({
        source: 'n8n',
        node_name: input.nodeName,
        provider: input.provider,
        provider_url: input.actualProviderUrl,
      }),
    }),
  };
}

export async function emitN8nLlmCompletion(
  session: NodePostExecuteCapableN8nSession,
  input: N8nLlmCompletionPayloadInput,
): Promise<WorkflowVerdict> {
  return session.nodePostExecute(buildN8nLlmCompletionPayload(input));
}
