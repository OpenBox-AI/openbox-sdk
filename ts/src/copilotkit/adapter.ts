import {
  DEFAULT_AGENT_WORKFLOW_TYPE,
  DEFAULT_TASK_QUEUE,
} from './constants.js';
import { createCoreClientResolver } from './config-utils.js';
import { createOpenBoxApprovalRoute } from './approval-route.js';
import { createGovernedCopilotTool } from './governed-tool.js';
import { parseToolResult } from './internal-utils.js';
import { createOpenBoxLangChainMiddleware } from './langchain-middleware.js';
import { governPipelineGate } from './pipeline.js';
import {
  applyOpenBoxTransform,
  safePayloadToCopilotResult,
} from './results.js';
import type {
  OpenBoxCopilotKitAdapter,
  OpenBoxCopilotKitConfig,
  OpenBoxCopilotSessionState,
} from './types.js';

export function createOpenBoxCopilotKitAdapter(
  config: OpenBoxCopilotKitConfig = {},
): OpenBoxCopilotKitAdapter {
  const getCoreClient = createCoreClientResolver(config);
  const strict = config.strict ?? true;
  const governanceMode = config.governanceMode ?? 'enforce';
  const failClosed = config.failClosed ?? true;
  const redactionMode = config.redactionMode ?? 'transformed-only';
  const workflowType = config.agentWorkflowType ?? DEFAULT_AGENT_WORKFLOW_TYPE;
  const taskQueue = config.taskQueue ?? DEFAULT_TASK_QUEUE;
  const haltedSessions = new Map<
    string,
    Extract<OpenBoxCopilotSessionState, { status: 'halted' }>
  >();
  const selfGovernedToolNames = new Set([
    'openbox_governed_action',
    'openbox_governed_approval_action',
    'openbox_resume_governed_action',
    ...(config.selfGovernedToolNames ?? []),
  ]);

  const adapter: OpenBoxCopilotKitAdapter = {
    isEnabled: () =>
      config.enabled ??
      Boolean(config.core),
    getCoreClient,
    wrapAgent: (agent) => agent,
    createLangChainMiddleware: (deps) =>
      createOpenBoxLangChainMiddleware({
        adapter,
        deps,
        workflowType,
        taskQueue,
        selfGovernedToolNames,
        strict,
        governanceMode,
        failClosed,
      }),
    governPrompt: (input) =>
      governPipelineGate(adapter, {
        kind: 'prompt',
        workflowType,
        taskQueue,
        haltedSessions,
        strict,
        governanceMode,
        failClosed,
        redactionMode,
        ...input,
      }),
    governToolInput: (input) =>
      governPipelineGate(adapter, {
        kind: 'tool_input',
        workflowType,
        taskQueue,
        haltedSessions,
        strict,
        governanceMode,
        failClosed,
        redactionMode,
        ...input,
      }),
    governToolOutput: (input) =>
      governPipelineGate(adapter, {
        kind: 'tool_output',
        workflowType,
        taskQueue,
        haltedSessions,
        strict,
        governanceMode,
        failClosed,
        redactionMode,
        ...input,
      }),
    governAssistantOutput: (input) =>
      governPipelineGate(adapter, {
        kind: 'assistant_output',
        workflowType,
        taskQueue,
        haltedSessions,
        strict,
        governanceMode,
        failClosed,
        redactionMode,
        ...input,
      }),
    applyOpenBoxTransform: (original, verdict) =>
      applyOpenBoxTransform(original, verdict),
    toOpenBoxCopilotResult: (verdict, safePayload) =>
      safePayloadToCopilotResult(verdict, safePayload),
    haltSession: (sessionKey, session) => {
      haltedSessions.set(sessionKey, session);
    },
    isSessionHalted: (sessionKey) => haltedSessions.get(sessionKey),
    governTool: (definition) =>
      createGovernedCopilotTool({
        adapter,
        ...definition,
      }),
    approvalRoute: createOpenBoxApprovalRoute(config),
    rendering: {
      governedToolNames: [
        'openbox_governed_action',
        'openbox_governed_approval_action',
        'openbox_resume_governed_action',
      ],
      approvalToolName: 'openboxApprovalReview',
      interactiveToolName: 'openboxInteractiveReview',
      isGovernedToolResult: (value) => {
        const parsed = parseToolResult(value);
        return (
          typeof parsed.status === 'string' &&
          typeof parsed.verdict === 'string'
        );
      },
      parseToolResult,
    },
  };

  Object.defineProperty(adapter, '__openboxCopilotRuntimeConfig', {
    value: { workflowType, taskQueue },
    enumerable: false,
    configurable: false,
  });

  return adapter;
}
