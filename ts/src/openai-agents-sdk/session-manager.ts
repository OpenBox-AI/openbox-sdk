import { randomUUID } from 'node:crypto';
import {
  presets,
  type GovernedPayload,
  type OpenaiAgentsSdkSession,
  type WorkflowVerdict,
} from '../core-client/index.js';
import { EVENT } from '../governance/events.js';
import type { OpenBoxAgentsRuntimeContext } from './config.js';
import {
  OPENAI_AGENTS_ACTIVITY_TYPES,
  compactPayload,
  objectRecord,
  promptTextForRunInput,
  runPromptSpan,
  runAssistantOutputSpan,
  toolActivityInput,
  toolActivityType,
  toolCallFields,
  toolSpan,
  toolTelemetryFields,
  type OpenBoxAgentsToolCallContext,
} from './payloads.js';

interface ManagedSession {
  session: OpenaiAgentsSdkSession;
  started: boolean;
  goalSignaled: boolean;
  terminal: boolean;
  runActivity?: OpenedActivity;
}

type OpenedActivity = Awaited<
  ReturnType<OpenaiAgentsSdkSession['openActivity']>
>;

interface PendingToolActivity {
  activityId: string;
  activityType: string;
  complete: OpenedActivity['complete'];
}

type RunTelemetry = Pick<
  GovernedPayload,
  | 'llmModel'
  | 'inputTokens'
  | 'outputTokens'
  | 'totalTokens'
  | 'costUsd'
  | 'hasToolCalls'
  | 'finishReason'
>;

export class OpenBoxAgentsSessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly toolActivities = new Map<string, PendingToolActivity>();

  constructor(private readonly context: OpenBoxAgentsRuntimeContext) {}

  async get(sessionId: string): Promise<ManagedSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const managed = {
      session: new presets.openaiAgentsSdk({
        core: this.context.getCoreClient(),
        workflowId: sessionId,
        runId: sessionId,
        workflowType: this.context.workflowType,
        taskQueue: this.context.taskQueue,
        registerExitHandlers: false,
        attached: true,
        inlineApproval: this.context.approvalMode !== 'wait',
      }),
      started: false,
      goalSignaled: false,
      terminal: false,
    } satisfies ManagedSession;
    this.sessions.set(sessionId, managed);
    return managed;
  }

  async ensureStarted(
    sessionId: string,
    input?: unknown,
  ): Promise<ManagedSession> {
    const managed = await this.get(sessionId);
    if (!managed.started) {
      await managed.session.workflowStarted();
      managed.started = true;
    }
    return managed;
  }

  async startRun(sessionId: string, input?: unknown): Promise<WorkflowVerdict> {
    const managed = await this.ensureStarted(sessionId);
    await this.emitGoalSignal(managed, sessionId, input);
    if (!managed.runActivity) {
      managed.runActivity = await managed.session.openActivity(
        OPENAI_AGENTS_ACTIVITY_TYPES.RUN,
        {
          input: [
            compactPayload({ session_id: sessionId, input }, 'run_start'),
          ],
          sessionId,
          spans: runPromptSpan(input),
        },
      );
    }
    return managed.runActivity.verdict;
  }

  private async emitGoalSignal(
    managed: ManagedSession,
    sessionId: string,
    input: unknown,
  ): Promise<void> {
    if (managed.goalSignaled) return;
    const prompt = promptTextForRunInput(input) ?? this.context.defaultGoal?.trim();
    if (!prompt && this.context.requireGoalContext) {
      throw new Error(
        'OpenBox goal context is required for AGE alignment, but this OpenAI Agents SDK run has no prompt/query/workflow goal.',
      );
    }
    if (!prompt && input === undefined) return;
    await managed.session.activity(
      EVENT.SIGNAL,
      OPENAI_AGENTS_ACTIVITY_TYPES.GOAL_SIGNAL,
      {
        input: [
          compactPayload({ session_id: sessionId, input }, 'agent_goal'),
        ],
        signalName: OPENAI_AGENTS_ACTIVITY_TYPES.GOAL_SIGNAL,
        signalArgs: prompt || input,
        sessionId,
        ...(prompt ? { prompt } : {}),
      },
    );
    managed.goalSignaled = true;
  }

  async complete(
    sessionId: string,
    output?: unknown,
    telemetry: RunTelemetry = {},
  ): Promise<void> {
    const managed = await this.ensureStarted(sessionId);
    if (managed.terminal) return;
    try {
      const payload = {
        input: [compactPayload({ session_id: sessionId }, 'run_complete')],
        output,
        sessionId,
        ...telemetry,
        spans: runAssistantOutputSpan(output, sessionId),
      };
      if (managed.runActivity) {
        await managed.runActivity.complete(
          payload,
          OPENAI_AGENTS_ACTIVITY_TYPES.RUN,
        );
      } else {
        await managed.session.runCompleted(payload);
      }
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

  async openTool(
    sessionId: string,
    toolName: string,
    input: unknown,
    call: OpenBoxAgentsToolCallContext,
  ): Promise<OpenedActivity> {
    const toolInput = objectRecord(input);
    const activityType = toolActivityType(toolName, toolInput);
    const callFields = toolCallFields(call);
    const managed = await this.ensureStarted(sessionId);
    if (this.context.requireGoalContext && !managed.goalSignaled) {
      await this.emitGoalSignal(managed, sessionId, undefined);
    }
    const opened = await managed.session.openActivity(activityType, {
      activityId: call.callId,
      input: toolActivityInput(
        toolName,
        toolInput,
        compactPayload(
          { tool_name: toolName, tool_input: toolInput, ...callFields },
          'tool_input',
        ),
      ),
      sessionId,
      ...toolTelemetryFields(toolName, toolInput),
      spans: toolSpan(toolName, toolInput, undefined, undefined, call),
    });
    this.toolActivities.set(this.toolKey(sessionId, call.callId), {
      activityId: opened.activityId,
      activityType,
      complete: opened.complete,
    });
    return opened;
  }

  async completeTool(
    sessionId: string,
    toolName: string,
    input: unknown,
    output: unknown,
    call: OpenBoxAgentsToolCallContext,
  ): Promise<WorkflowVerdict | undefined> {
    const key = this.toolKey(sessionId, call.callId);
    const pending = this.toolActivities.get(key);
    this.toolActivities.delete(key);
    if (!pending) return undefined;
    const toolInput = objectRecord(input);
    const callFields = toolCallFields(call);
    return pending.complete(
      {
        input: toolActivityInput(
          toolName,
          toolInput,
          compactPayload(
            { tool_name: toolName, tool_input: toolInput, ...callFields },
            'tool_input',
          ),
        ),
        output,
        sessionId,
        ...toolTelemetryFields(toolName, toolInput),
        spans: toolSpan(toolName, toolInput, output, 'completed', call),
      },
      OPENAI_AGENTS_ACTIVITY_TYPES.TOOL_COMPLETED,
    );
  }

  async observeHandoff(
    sessionId: string,
    fromAgent: string | undefined,
    toAgent: string | undefined,
  ): Promise<WorkflowVerdict> {
    const managed = await this.ensureStarted(sessionId);
    return managed.session.handoff({
      input: [
        compactPayload({ from_agent: fromAgent, to_agent: toAgent }, 'handoff'),
      ],
      sessionId,
      fromAgentDid: fromAgent,
      activityId: randomUUID(),
    });
  }

  async observeGuardrail(
    sessionId: string,
    input: unknown,
  ): Promise<WorkflowVerdict> {
    const managed = await this.ensureStarted(sessionId);
    return managed.session.guardrail({
      input: [compactPayload({ input }, 'guardrail')],
      sessionId,
    });
  }

  private toolKey(sessionId: string, toolCallId: string): string {
    return `${sessionId}:${toolCallId}`;
  }

  private deleteToolActivities(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of this.toolActivities.keys()) {
      if (key.startsWith(prefix)) this.toolActivities.delete(key);
    }
  }
}
