import type {
  SDKAssistantMessage,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
  presets,
  type AnthropicAgentSdkSession,
  type WorkflowVerdict,
} from '../core-client/index.js';
import { EVENT } from '../governance/events.js';
import type { OpenBoxAnthropicRuntimeContext } from './config.js';
import {
  ANTHROPIC_AGENT_ACTIVITY_TYPES,
  assistantContentAndUsage,
  assistantOutputTelemetry,
  assistantOutputSpan,
  compactPayload,
  modelUsageSpansFromResult,
  resultAssistantOutput,
  usagePayloadFromResult,
} from './payloads.js';

interface ManagedSession {
  session: AnthropicAgentSdkSession;
  started: boolean;
  terminal: boolean;
  latestAssistant?: ReturnType<typeof assistantContentAndUsage>;
}

type OpenedActivity = Awaited<
  ReturnType<AnthropicAgentSdkSession['openActivity']>
>;

interface PendingToolActivity {
  activityType: string;
  complete: OpenedActivity['complete'];
}

export class AnthropicAgentSessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly toolActivities = new Map<string, PendingToolActivity>();

  constructor(private readonly context: OpenBoxAnthropicRuntimeContext) {}

  async get(sessionId: string): Promise<ManagedSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const managed = {
      session: new presets.anthropicAgentSdk({
        core: this.context.getCoreClient(),
        workflowId: sessionId,
        runId: sessionId,
        workflowType: this.context.workflowType,
        taskQueue: this.context.taskQueue,
        registerExitHandlers: false,
        attached: true,
        inlineApproval: true,
      }),
      started: false,
      terminal: false,
    } satisfies ManagedSession;
    this.sessions.set(sessionId, managed);
    return managed;
  }

  async ensureStarted(sessionId: string): Promise<ManagedSession> {
    const managed = await this.get(sessionId);
    if (!managed.started) {
      await managed.session.workflowStarted();
      managed.started = true;
    }
    return managed;
  }

  rememberAssistant(message: SDKAssistantMessage): void {
    const managed = this.sessions.get(message.session_id);
    if (!managed) return;
    managed.latestAssistant = assistantContentAndUsage(message);
  }

  latestAssistant(sessionId: string): ManagedSession['latestAssistant'] {
    return this.sessions.get(sessionId)?.latestAssistant;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async complete(sessionId: string): Promise<void> {
    const managed = await this.ensureStarted(sessionId);
    if (managed.terminal) return;
    try {
      await managed.session.workflowCompleted();
      managed.terminal = true;
    } finally {
      this.sessions.delete(sessionId);
      this.deleteToolActivities(sessionId);
    }
  }

  async fail(sessionId: string, reason: unknown): Promise<void> {
    const managed = await this.ensureStarted(sessionId);
    if (managed.terminal) return;
    try {
      await managed.session.workflowFailed(
        reason instanceof Error ? reason : new Error(String(reason)),
      );
      managed.terminal = true;
    } finally {
      this.sessions.delete(sessionId);
      this.deleteToolActivities(sessionId);
    }
  }

  async failOpenSessions(reason: unknown): Promise<void> {
    await Promise.all(
      [...this.sessions.keys()].map((sessionId) =>
        this.fail(sessionId, reason).catch(() => undefined),
      ),
    );
  }

  async observeResult(message: SDKResultMessage): Promise<void> {
    const managed = await this.ensureStarted(message.session_id);
    const usagePayload = usagePayloadFromResult(message);
    await managed.session.activity(EVENT.SIGNAL, ANTHROPIC_AGENT_ACTIVITY_TYPES.USAGE_SIGNAL, {
      input: [usagePayload],
      signalName: ANTHROPIC_AGENT_ACTIVITY_TYPES.USAGE_SIGNAL,
      signalArgs: [usagePayload],
    });

    const assistant = resultAssistantOutput(message);
    const assistantEvent = {
      content: assistant.content,
      model: assistant.model,
      usage: assistant.usage,
      hasToolCalls: assistant.hasToolCalls,
      sessionId: message.session_id,
      event: 'result',
    };
    const modelUsageSpans = modelUsageSpansFromResult(message);
    const contentSpans = assistantOutputSpan({
      content: assistantEvent.content,
      model: assistantEvent.model,
      usage:
        modelUsageSpans.length > 0 && !assistantEvent.model
          ? undefined
          : assistantEvent.usage,
      hasToolCalls: assistantEvent.hasToolCalls,
      sessionId: assistantEvent.sessionId,
      event: assistantEvent.event,
    }) ?? [];
    const spans = [...contentSpans, ...modelUsageSpans];
    if (spans.length > 0) {
      await managed.session.observeActivity(EVENT.COMPLETE, ANTHROPIC_AGENT_ACTIVITY_TYPES.ASSISTANT_OUTPUT, {
        input: [
          compactPayload(
            {
              session_id: message.session_id,
              result_subtype: message.subtype,
              stop_reason: message.stop_reason,
            },
            'assistant_output',
          ),
        ],
        output: message.subtype === 'success' ? message.result : undefined,
        ...assistantOutputTelemetry(assistantEvent),
        spans,
      });
    }

    if (message.subtype === 'success' && !message.is_error) {
      await this.complete(message.session_id);
      return;
    }
    const errorText =
      message.subtype === 'success'
        ? message.stop_reason ?? 'Anthropic Agent SDK result reported an error'
        : message.errors.join('; ');
    await this.fail(message.session_id, errorText);
  }

  async activity(
    sessionId: string,
    eventType: typeof EVENT.START | typeof EVENT.COMPLETE | typeof EVENT.SIGNAL,
    activityType: string,
    payload: Parameters<AnthropicAgentSdkSession['activity']>[2],
  ): Promise<WorkflowVerdict> {
    const managed = await this.ensureStarted(sessionId);
    return managed.session.activity(eventType, activityType, payload);
  }

  async observeActivity(
    sessionId: string,
    eventType: typeof EVENT.START | typeof EVENT.COMPLETE | typeof EVENT.SIGNAL,
    activityType: string,
    payload: Parameters<AnthropicAgentSdkSession['activity']>[2],
  ): Promise<WorkflowVerdict> {
    const managed = await this.ensureStarted(sessionId);
    return managed.session.observeActivity(eventType, activityType, payload);
  }

  async openActivity(
    sessionId: string,
    activityType: string,
    payload: Parameters<AnthropicAgentSdkSession['openActivity']>[1],
  ): Promise<Awaited<ReturnType<AnthropicAgentSdkSession['openActivity']>>> {
    const managed = await this.ensureStarted(sessionId);
    return managed.session.openActivity(activityType, payload);
  }

  rememberToolActivity(
    sessionId: string,
    toolUseId: string | undefined,
    opened: OpenedActivity,
    activityType: string,
  ): void {
    if (!toolUseId) return;
    if (
      opened.verdict.arm !== 'allow' &&
      opened.verdict.arm !== 'constrain' &&
      opened.verdict.arm !== 'require_approval'
    ) {
      return;
    }
    this.toolActivities.set(this.toolKey(sessionId, toolUseId), {
      activityType,
      complete: opened.complete,
    });
  }

  async completeToolActivity(
    sessionId: string,
    toolUseId: string | undefined,
    activityType: string,
    payload: Parameters<PendingToolActivity['complete']>[0],
  ): Promise<WorkflowVerdict | undefined> {
    if (!toolUseId) return undefined;
    const key = this.toolKey(sessionId, toolUseId);
    const pending = this.toolActivities.get(key);
    if (!pending) return undefined;
    this.toolActivities.delete(key);
    return pending.complete(payload, activityType);
  }

  private toolKey(sessionId: string, toolUseId: string): string {
    return `${sessionId}:${toolUseId}`;
  }

  private deleteToolActivities(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of this.toolActivities.keys()) {
      if (key.startsWith(prefix)) this.toolActivities.delete(key);
    }
  }
}
