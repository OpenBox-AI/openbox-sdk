import { randomUUID } from 'node:crypto';
import { OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY } from './constants.js';
import {
  errorOutput,
  isRecord,
  modelInput,
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
  agentSessionForState,
  createWorkflowSession,
  finishStoppedWorkflow,
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
  return deps.createMiddleware({
    name: 'openbox_copilotkit',
    stateSchema: undefined,
    beforeAgent: async () => {
      if (!adapter.isEnabled()) return;
      const ids = {
        openboxWorkflowId: randomUUID(),
        openboxRunId: randomUUID(),
      };
      const session = createWorkflowSession(
        adapter,
        { workflowId: ids.openboxWorkflowId, runId: ids.openboxRunId },
        workflowType,
        taskQueue,
      );
      await swallow(() => session.workflowStarted());
      await swallow(() =>
        (session as any).onChainStart({
          input: [{ runtime: 'copilotkit', framework: 'langchain' }],
        }),
      );
      return {
        ...ids,
        openboxSession: {
          status: 'active',
          workflowId: ids.openboxWorkflowId,
          runId: ids.openboxRunId,
        },
      };
    },
    wrapModelCall: async (
      request: any,
      handler: (request: any) => Promise<unknown>,
    ) => {
      if (!adapter.isEnabled()) return handler(request);
      const session = agentSessionForState(
        adapter,
        request.state,
        workflowType,
        taskQueue,
      );
      const key = sessionKeyFromConfig(request);
      const runtimePromptGoverned =
        isRecord(request.state) &&
        request.state[OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY] === true;
      if (!runtimePromptGoverned) {
        const promptGate = await adapter.governPrompt({
          payload: modelInput(request),
          sessionKey: key,
          workflowId: workflowIdFromState(request.state),
          runId: runIdFromState(request.state),
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
          workflowId: workflowIdFromState(request.state),
          runId: runIdFromState(request.state),
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
      const session = agentSessionForState(
        adapter,
        request.state,
        workflowType,
        taskQueue,
      );
      const key = sessionKeyFromConfig(request);
      const inputGate = await adapter.governToolInput({
        payload: toolCallInput(request),
        sessionKey: key,
        workflowId: workflowIdFromState(request.state),
        runId: runIdFromState(request.state),
        activityType: 'on_tool_start',
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
          workflowId: workflowIdFromState(request.state),
          runId: runIdFromState(request.state),
          activityType: 'on_tool_end',
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
    afterAgent: async (state: any) => {
      if (!adapter.isEnabled()) return;
      const workflowId = workflowIdFromState(state);
      const runId = runIdFromState(state);
      if (!workflowId || !runId) return;
      if (
        isRecord(state) &&
        state[OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY] === true
      ) {
        const session = createWorkflowSession(
          adapter,
          { workflowId, runId },
          workflowType,
          taskQueue,
        );
        await swallow(() => session.workflowCompleted());
        return;
      }
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
