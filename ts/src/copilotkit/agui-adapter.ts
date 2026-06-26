import { randomUUID } from 'node:crypto';
import { createOpenBoxCopilotKitAdapter } from './adapter.js';
import { objectRecord } from './internal-utils.js';
import type {
  OpenBoxAGUIActivity,
  OpenBoxAGUIActivityKind,
  OpenBoxAGUIAdapter,
  OpenBoxAGUIAdapterConfig,
  OpenBoxAGUIEvent,
  OpenBoxCopilotKitAdapter,
} from './types.js';

export function createOpenBoxAGUIAdapter(
  config: OpenBoxAGUIAdapterConfig = {},
): OpenBoxAGUIAdapter {
  const adapter = config.adapter ?? createOpenBoxCopilotKitAdapter();
  const sessionKey = config.sessionKey ?? defaultSessionKey;
  const workflowIdFor = config.workflowId ?? defaultWorkflowId;
  const runIdFor = config.runId ?? defaultRunId;

  return {
    async handleEvent(event) {
      const eventType = eventTypeOf(event);
      const kind = kindForEvent(eventType);
      const session = sessionKey(event);
      const workflowId = workflowIdFor(event) ?? `copilotkit-agui:${session}`;
      const runId = runIdFor(event) ?? stringValue(event.runId) ?? workflowId;
      const activityId =
        stringValue(event.toolCallId) ??
        stringValue(event.messageId) ??
        stringValue(event.activityId) ??
        randomUUID();
      const result = await governAGUIEvent(adapter, kind, event, {
        eventType,
        sessionKey: session,
        workflowId,
        runId,
        activityId,
      });
      return {
        kind,
        eventType,
        sessionKey: session,
        workflowId,
        runId,
        activityId,
        result,
      };
    },
    async *handleStream(events) {
      for await (const event of events) {
        yield this.handleEvent(event);
      }
    },
  };
}

async function governAGUIEvent(
  adapter: OpenBoxCopilotKitAdapter,
  kind: OpenBoxAGUIActivityKind,
  event: OpenBoxAGUIEvent,
  ids: {
    eventType: string;
    sessionKey: string;
    workflowId: string;
    runId: string;
    activityId: string;
  },
) {
  const input = {
    payload: payloadForEvent(event),
    sessionKey: ids.sessionKey,
    workflowId: ids.workflowId,
    runId: ids.runId,
    activityId: ids.activityId,
    activityType: `CopilotKitAGUI:${ids.eventType}`,
    ensureWorkflowStarted: kind === 'run',
  };
  if (kind === 'run') return adapter.governPrompt(input);
  if (kind === 'tool_input' || kind === 'interrupt') {
    return adapter.governToolInput(input);
  }
  if (kind === 'tool_output') return adapter.governToolOutput(input);
  return adapter.governAssistantOutput(input);
}

function kindForEvent(eventType: string): OpenBoxAGUIActivityKind {
  const normalized = eventType.toLowerCase();
  if (normalized.includes('interrupt') || normalized.includes('approval')) {
    return 'interrupt';
  }
  if (normalized.includes('tool') && (normalized.includes('result') || normalized.includes('end'))) {
    return 'tool_output';
  }
  if (normalized.includes('tool')) return 'tool_input';
  if (normalized.includes('state')) return 'state';
  if (normalized.includes('error')) return 'error';
  if (normalized.includes('message') || normalized.includes('text')) return 'message';
  if (
    normalized.includes('run') &&
    (normalized.includes('finish') ||
      normalized.includes('complete') ||
      normalized.includes('end'))
  ) {
    return 'message';
  }
  return 'run';
}

function payloadForEvent(event: OpenBoxAGUIEvent): Record<string, unknown> {
  const nestedPayload = objectRecord(event.payload);
  return {
    event_type: eventTypeOf(event),
    thread_id: stringValue(event.threadId),
    run_id: stringValue(event.runId),
    tool_call_id: stringValue(event.toolCallId),
    tool_name: stringValue(event.toolName),
    message_id: stringValue(event.messageId),
    payload: event.payload,
    input: event.input,
    output: event.output ?? event.result,
    content: firstValue(
      event.content,
      event.output,
      event.result,
      event.delta,
      nestedPayload.content,
    ),
    delta: event.delta,
    state: event.state,
    error: errorPayload(event.error),
    model: firstValue(event.model, nestedPayload.model),
    modelName: firstValue(event.modelName, nestedPayload.modelName),
    model_name: firstValue(event.model_name, nestedPayload.model_name),
    usage: firstValue(event.usage, nestedPayload.usage),
    usageMetadata: firstValue(event.usageMetadata, nestedPayload.usageMetadata),
    usage_metadata: firstValue(event.usage_metadata, nestedPayload.usage_metadata),
    responseMetadata: firstValue(event.responseMetadata, nestedPayload.responseMetadata),
    response_metadata: firstValue(event.response_metadata, nestedPayload.response_metadata),
    raw: event,
  };
}

function defaultSessionKey(event: OpenBoxAGUIEvent): string {
  return (
    stringValue(event.threadId) ??
    stringValue(objectRecord(event.payload).threadId) ??
    'copilotkit-agui'
  );
}

function defaultWorkflowId(event: OpenBoxAGUIEvent): string | undefined {
  return stringValue(event.workflowId) ?? stringValue(objectRecord(event.payload).workflowId);
}

function defaultRunId(event: OpenBoxAGUIEvent): string | undefined {
  return stringValue(event.runId) ?? stringValue(objectRecord(event.payload).runId);
}

function eventTypeOf(event: OpenBoxAGUIEvent): string {
  return (
    stringValue(event.type) ??
    stringValue(event.event) ??
    stringValue(event.name) ??
    'unknown'
  );
}

function errorPayload(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function firstValue(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}
