import { randomUUID } from 'node:crypto';
import {
  OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION,
  OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY,
} from './constants.js';
import {
  errorOutput,
  isRecord,
  modelInput,
  objectRecord,
  runIdFromState,
  sessionKeyFromConfig,
  shouldStopForGate,
  summarizeMessages,
  swallow,
  toPlain,
  toolCallInput,
  withGovernedAssistantOutput,
  withGovernedModelInput,
  withGovernedToolInput,
  workflowIdFromState,
} from './internal-utils.js';
import type {
  OpenBoxCopilotKitAdapter,
  OpenBoxCopilotLangChainMiddlewareDeps,
} from './types.js';
import {
  activeWorkflowFor,
  clearAllActiveWorkflows,
  clearActiveWorkflow,
  createWorkflowSession,
  finishStoppedWorkflow,
  registerActiveWorkflow,
} from './workflow-session.js';

export function createOpenBoxLangChainMiddleware({
  adapter,
  deps,
  workflowType,
  taskQueue,
  selfGovernedToolNames,
  strict,
  governanceMode,
  failClosed,
}: {
  adapter: OpenBoxCopilotKitAdapter;
  deps: OpenBoxCopilotLangChainMiddlewareDeps;
  workflowType: string;
  taskQueue: string;
  selfGovernedToolNames: Set<string>;
  strict: boolean;
  governanceMode: 'observe' | 'enforce';
  failClosed: boolean;
}) {
  const workflowKey = (...candidates: unknown[]) => {
    for (const candidate of candidates) {
      const key = sessionKeyFromConfig(candidate);
      if (key !== 'default') return key;
    }
    return 'default';
  };
  const workflowIdsFor = (key: string, state: unknown) => {
    const registered = activeWorkflowFor(adapter, key);
    return {
      workflowId: workflowIdFromState(state) ?? registered?.workflowId,
      runId: runIdFromState(state) ?? registered?.runId,
    };
  };
  const debugState = (hook: string, state: unknown) => {
    if (process.env.OPENBOX_COPILOTKIT_DEBUG !== 'true') return;
    const record = isRecord(state) ? state : {};
    console.error(
      `[openbox:${hook}] stateKeys=${JSON.stringify(Object.keys(record))} openboxSession=${JSON.stringify(record.openboxSession ?? null)} workflowId=${String(record.openboxWorkflowId ?? '')}`,
    );
  };
  // The CopilotKit runtime forwards its workflow IDs through the LangGraph
  // run config: AG-UI routes `forwardedProps.config.configurable` keys into
  // run context when the graph declares a context schema, and into
  // `runtime.configurable` otherwise. State is the in-process secondary source.
  const contextIds = (runtimeLike: unknown) => {
    const record = objectRecord(runtimeLike);
    const context = objectRecord(record.context);
    const configurable = objectRecord(record.configurable);
    const pick = (key: string) =>
      typeof context[key] === 'string'
        ? (context[key] as string)
        : typeof configurable[key] === 'string'
          ? (configurable[key] as string)
          : undefined;
    return {
      workflowId: pick('openboxWorkflowId'),
      runId: pick('openboxRunId'),
      promptGoverned:
        context.openboxPromptGoverned === true ||
        configurable.openboxPromptGoverned === true,
    };
  };
  // beforeAgent runs before LangGraph merges the run input into state, so
  // the CopilotKit runtime's workflow IDs are not visible there yet. The
  // task workflow is therefore resolved lazily at the first gate, where
  // state is real: adopt the runtime's workflow when its IDs are present,
  // otherwise open one owned by this process.
  const ensureTaskWorkflow = async (
    key: string,
    state: unknown,
    runtimeLike?: unknown,
  ) => {
    const fromContext = contextIds(runtimeLike);
    if (process.env.OPENBOX_COPILOTKIT_DEBUG === 'true') {
      console.error(
        `[openbox:ensure] key=${key} fromContext=${JSON.stringify(fromContext)} stateWorkflowId=${String(workflowIdFromState(state) ?? '')}`,
      );
    }
    // Run config is per-run truth, so it beats any registry entry left over
    // from a previous run in this process.
    if (fromContext.workflowId && fromContext.runId) {
      const adopted = {
        workflowId: fromContext.workflowId,
        runId: fromContext.runId,
        owned: false,
      };
      registerActiveWorkflow(adapter, key, adopted);
      return adopted;
    }
    const existing = activeWorkflowFor(adapter, key);
    if (existing) return existing;
    const runtimeWorkflowId = workflowIdFromState(state);
    const runtimeRunId = runIdFromState(state);
    if (runtimeWorkflowId && runtimeRunId) {
      const adopted = {
        workflowId: runtimeWorkflowId,
        runId: runtimeRunId,
        owned: false,
      };
      registerActiveWorkflow(adapter, key, adopted);
      return adopted;
    }
    const owned = {
      workflowId: randomUUID(),
      runId: randomUUID(),
      owned: true,
    };
    registerActiveWorkflow(adapter, key, owned);
    const session = createWorkflowSession(
      adapter,
      { workflowId: owned.workflowId, runId: owned.runId },
      workflowType,
      taskQueue,
    );
    await swallow(() => session.workflowStarted());
    await swallow(() =>
      (session as any).onChainStart({
        input: [{ runtime: 'copilotkit', framework: 'langchain' }],
      }),
    );
    return owned;
  };
  return deps.createMiddleware({
    name: 'openbox_copilotkit',
    stateSchema: deps.stateSchema,
    contextSchema: deps.contextSchema,
    wrapModelCall: async (
      request: any,
      handler: (request: any) => Promise<unknown>,
    ) => {
      if (!adapter.isEnabled()) return handler(request);
      debugState('wrapModelCall', request.state);
      const trailingToolResult = trailingToolContent(request.messages);
      const approvalResponse = openBoxApprovalResponse(trailingToolResult);
      if (approvalResponse) {
        return new deps.AIMessage({
          content: '',
          tool_calls: [
            {
              id: `openbox_resume_${randomUUID().replace(/-/g, '')}`,
              name: 'openbox_resume_governed_action',
              args: approvalResponse,
            },
          ],
        });
      }
      const trailingOpenBoxResult = openBoxResultFromContent(trailingToolResult);
      if (trailingOpenBoxResult) {
        if (isApprovalRequiredResult(trailingOpenBoxResult)) {
          return new deps.AIMessage({
            content: '',
            tool_calls: [
              {
                id: `openbox_approval_${randomUUID().replace(/-/g, '')}`,
                name: 'openboxApprovalReview',
                args: approvalReviewArgs(trailingOpenBoxResult),
              },
            ],
          });
        }
        return new deps.AIMessage({ content: '' });
      }
      const key = sessionKeyFromConfig(request);
      const gateIds = await ensureTaskWorkflow(
        key,
        request.state,
        request.runtime,
      );
      const session = createWorkflowSession(
        adapter,
        { workflowId: gateIds.workflowId, runId: gateIds.runId },
        workflowType,
        taskQueue,
      );
      const runtimePromptGoverned =
        (isRecord(request.state) &&
          request.state[OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY] === true) ||
        contextIds(request.runtime).promptGoverned;
      if (!runtimePromptGoverned) {
        const promptGate = await adapter.governPrompt({
          payload: modelInput(request),
          sessionKey: key,
          workflowId: gateIds.workflowId,
          runId: gateIds.runId,
          activityType: 'on_chat_model_start',
        });
        if (shouldStopForGate(promptGate, governanceMode)) {
          return new deps.AIMessage({
            content: JSON.stringify(
              adapter.toOpenBoxCopilotResult(promptGate.verdict, promptGate),
            ),
          });
        }
        request = withGovernedModelInput(
          request,
          promptGate.safe,
          promptGate.changed,
        );
      }
      const governedRoute = deps.routeLatestUserPrompt?.(request.messages);
      if (governedRoute) {
        return new deps.AIMessage({
          content: '',
          tool_calls: [
            {
              id: `openbox_preflight_${randomUUID().replace(/-/g, '')}`,
              name: governedRoute.toolName,
              args: governedRoute.args,
            },
          ],
        });
      }
      try {
        const response = await handler(request);
        if (runtimePromptGoverned) return response;
        const responseGate = await adapter.governAssistantOutput({
          payload: toPlain(response),
          sessionKey: key,
          workflowId: gateIds.workflowId,
          runId: gateIds.runId,
          activityType: 'on_llm_end',
        });
        if (shouldStopForGate(responseGate, governanceMode)) {
          return new deps.AIMessage({
            content: JSON.stringify(
              adapter.toOpenBoxCopilotResult(
                responseGate.verdict,
                responseGate,
              ),
            ),
          });
        }
        return withGovernedAssistantOutput(response, responseGate.safe);
      } catch (error) {
        await swallow(() =>
          (session as any).onLlmError({ output: errorOutput(error) }),
        );
        await swallow(() => session.workflowFailed(error));
        if (!failClosed) throw error;
        throw error;
      }
    },
    wrapToolCall: async (
      request: any,
      handler: (request: any) => Promise<unknown>,
    ) => {
      if (!adapter.isEnabled()) return handler(request);
      if (selfGovernedToolNames.has(String(request.toolCall?.name)))
        return handler(request);
      const key = sessionKeyFromConfig(request);
      const gateIds = await ensureTaskWorkflow(
        key,
        request.state,
        request.runtime,
      );
      const session = createWorkflowSession(
        adapter,
        { workflowId: gateIds.workflowId, runId: gateIds.runId },
        workflowType,
        taskQueue,
      );
      const inputGate = await adapter.governToolInput({
        payload: toolCallInput(request),
        sessionKey: key,
        workflowId: gateIds.workflowId,
        runId: gateIds.runId,
        activityType: toolActivityTypeFromRequest(request),
      });
      if (shouldStopForGate(inputGate, governanceMode)) {
        return JSON.stringify(
          adapter.toOpenBoxCopilotResult(inputGate.verdict, inputGate),
        );
      }
      request = withGovernedToolInput(request, inputGate.safe);
      try {
        const response = await handler(request);
        const outputGate = await adapter.governToolOutput({
          payload: toPlain(response),
          sessionKey: key,
          workflowId: gateIds.workflowId,
          runId: gateIds.runId,
          activityId: inputGate.activityId,
          activityType: toolActivityTypeFromRequest(request),
        });
        if (shouldStopForGate(outputGate, governanceMode)) {
          return JSON.stringify(
            adapter.toOpenBoxCopilotResult(outputGate.verdict, outputGate),
          );
        }
        return outputGate.safe;
      } catch (error) {
        await swallow(() =>
          (session as any).onToolError({
            output: { toolName: request.toolCall?.name, ...errorOutput(error) },
          }),
        );
        await swallow(() => session.workflowFailed(error));
        throw error;
      }
    },
    afterAgent: async (state: any, runtime: any) => {
      if (!adapter.isEnabled()) return;
      const key = workflowKey(runtime?.config, runtime, state);
      const fromContext = contextIds(runtime);
      const ids = workflowIdsFor(key, state);
      const workflowId = fromContext.workflowId ?? ids.workflowId;
      const runId = fromContext.runId ?? ids.runId;
      const active = activeWorkflowFor(adapter, key);
      // The CopilotKit runtime opened this workflow (IDs adopted from state
      // or registered as not-owned) and owns its terminal event; the agent
      // process must never close or double-gate it.
      const runtimeOwned =
        (active !== undefined &&
          active.workflowId === workflowId &&
          active.owned === false) ||
        fromContext.promptGoverned ||
        (isRecord(state) &&
          state[OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY] === true);
      // The run is over in this process; drop any registry entry so the next
      // run cannot pick up a stale workflow through the registry.
      clearAllActiveWorkflows(adapter);
      if (!workflowId || !runId) return;
      if (runtimeOwned) return;
      const session = createWorkflowSession(
        adapter,
        { workflowId, runId },
        workflowType,
        taskQueue,
      );
      const finishGate = await adapter.governAssistantOutput({
        payload: {
          messages: summarizeMessages(state?.messages),
          structuredResponse: toPlain(state?.structuredResponse),
        },
        sessionKey: sessionKeyFromConfig(state),
        workflowId,
        runId,
        activityType: 'on_agent_finish',
      });
      if (shouldStopForGate(finishGate, governanceMode) && strict) {
        await swallow(() =>
          finishStoppedWorkflow(
            adapter,
            { workflowId, runId },
            workflowType,
            taskQueue,
            finishGate.verdict,
          ),
        );
        return;
      }
      await swallow(() => session.workflowCompleted());
    },
  });
}

function toolActivityTypeFromRequest(request: any): string {
  const name = request?.toolCall?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : 'ToolCall';
}

const OPENBOX_RESULT_STATUSES = new Set([
  'executed',
  'constrained',
  'allowed',
  'blocked',
  'halted',
  'session_halted',
  'rejected',
  'error',
  'approval_required',
  'approval_pending',
]);

function hasOpenBoxToolResult(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = objectRecord(messages[index]);
    if (isHumanMessage(message)) return false;
    if (isOpenBoxResult(messageContent(message))) return true;
  }
  return false;
}

function isHumanMessage(message: Record<string, unknown>): boolean {
  const role = String(message.role ?? message.type ?? '').toLowerCase();
  return role === 'human' || role === 'user';
}

function trailingToolContent(messages: unknown): unknown {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  const message = objectRecord(messages[messages.length - 1]);
  const role = String(message.role ?? message.type ?? '').toLowerCase();
  if (role !== 'tool') return undefined;
  return messageContent(message);
}

function messageContent(message: Record<string, unknown>): unknown {
  if ('content' in message) return message.content;
  const kwargs = objectRecord(message.kwargs);
  if ('content' in kwargs) return kwargs.content;
  return undefined;
}

function isOpenBoxResult(content: unknown): boolean {
  const parsed = openBoxResultFromContent(content);
  return Boolean(parsed);
}

function openBoxResultFromContent(content: unknown): Record<string, unknown> | null {
  const parsed = parseContent(content);
  if (!isRecord(parsed)) return null;
  if (parsed.schemaVersion !== OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION)
    return null;
  return (
    OPENBOX_RESULT_STATUSES.has(String(parsed.status)) ||
    parsed.verdict === 'halt' ||
    parsed.verdict === 'block' ||
    parsed.verdict === 'error'
  )
    ? parsed
    : null;
}

function isApprovalRequiredResult(result: Record<string, unknown>): boolean {
  const status = String(result.status ?? '');
  const verdict = String(result.verdict ?? '');
  return (
    status === 'approval_required' ||
    status === 'approval_pending' ||
    verdict === 'require_approval'
  );
}

function approvalReviewArgs(
  result: Record<string, unknown>,
): Record<string, unknown> {
  return compactObject({
    action: stringValue(result.action),
    request: stringValue(result.request),
    destination: stringValue(result.destination),
    amountUsd:
      typeof result.amountUsd === 'number' ? result.amountUsd : undefined,
    riskReason: stringValue(result.reason ?? result.message),
    workflowId: stringValue(result.workflowId),
    runId: stringValue(result.runId),
    activityId: stringValue(result.activityId),
    approvalId: stringValue(result.approvalId),
    governanceEventId: stringValue(result.governanceEventId),
    expiresAt: stringValue(result.expiresAt),
  });
}

function openBoxApprovalResponse(content: unknown): Record<string, unknown> | null {
  const parsed = parseContent(content);
  if (!isRecord(parsed)) return null;
  const nextTool = String(parsed.nextTool ?? '');
  const mustResume = parsed.mustCallOpenBoxResumeGovernedAction === true;
  if (nextTool !== 'openbox_resume_governed_action' && !mustResume) {
    return null;
  }
  return compactObject({
    workflowId: stringValue(parsed.workflowId),
    runId: stringValue(parsed.runId),
    activityId: stringValue(parsed.activityId),
    approvalId: stringValue(parsed.approvalId),
    governanceEventId: stringValue(parsed.governanceEventId),
    approved:
      typeof parsed.approved === 'boolean' ? parsed.approved : undefined,
    action: stringValue(parsed.action),
    request: stringValue(parsed.request),
    destination: stringValue(parsed.destination),
    amountUsd:
      typeof parsed.amountUsd === 'number' ? parsed.amountUsd : undefined,
    fields: Array.isArray(parsed.fields) ? parsed.fields : undefined,
    audience: stringValue(parsed.audience),
    manualInput: stringValue(parsed.manualInput),
    sensitivity: stringValue(parsed.sensitivity),
    choiceId: stringValue(parsed.choiceId),
  });
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (typeof value === 'string' && value.length === 0) return false;
      return true;
    }),
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseContent(content: unknown): unknown {
  if (isRecord(content)) return content;
  if (typeof content === 'string') {
    try {
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(content)) {
    for (const part of content) {
      const record = objectRecord(part);
      const parsed = parseContent(record.text ?? record.content);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}
