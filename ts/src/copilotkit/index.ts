import {
  createOpenBoxCopilotRuntime as createOpenBoxCopilotRuntimeImpl,
  createOpenBoxGovernedRunner as createOpenBoxGovernedRunnerImpl,
  createOpenBoxRuntimeHooks as createOpenBoxRuntimeHooksImpl,
} from './runtime.js';
import { createOpenBoxCopilotKitAdapter } from './adapter.js';
import type {
  OpenBoxCopilotAgentRunnerLike,
  OpenBoxCopilotKitAdapter,
  OpenBoxCopilotRunInputLike,
  OpenBoxCopilotRuntime,
  OpenBoxCopilotRuntimeConfig,
} from './types.js';

export { createOpenBoxCopilotKitAdapter } from './adapter.js';
export { createOpenBoxAGUIAdapter } from './agui-adapter.js';
export { createGovernedCopilotTool } from './governed-tool.js';
export {
  fileReadSpan,
  databaseSelectSpan,
} from './workflow-session.js';
export { createOpenBoxApprovalRoute } from './approval-route.js';
export { createOpenBoxHeadlessApprovalClient } from './headless-approval.js';
export { createOpenBoxReadinessCheck } from './readiness.js';
export { resolveProjectConfigDir } from './config-utils.js';
export { OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION } from './constants.js';
export { parseToolResult } from './internal-utils.js';
export {
  registerOpenBoxOtel,
  createCapturingFetch,
  runWithLLMCapture,
  latestCapturedLLMExchange,
  capturedLLMExchanges,
  type CapturedLLMExchange,
} from './otel-capture.js';
export { OpenBoxCopilotKitError } from './types.js';
export type {
  GovernedCopilotTool,
  GovernedCopilotToolDefinition,
  OpenBoxAGUIActivity,
  OpenBoxAGUIActivityKind,
  OpenBoxAGUIAdapter,
  OpenBoxAGUIAdapterConfig,
  OpenBoxAGUIEvent,
  OpenBoxApprovalDecisionRequest,
  OpenBoxApprovalDecisionResult,
  OpenBoxCopilotActionInput,
  OpenBoxCopilotActionResult,
  OpenBoxCopilotAgentRunnerLike,
  OpenBoxCopilotGateInput,
  OpenBoxCopilotGateKind,
  OpenBoxCopilotKitAdapter,
  OpenBoxCopilotKitConfig,
  OpenBoxCopilotLangChainMiddlewareDeps,
  OpenBoxCopilotObservableLike,
  OpenBoxCopilotPromptRoute,
  OpenBoxCopilotResumeInput,
  OpenBoxCopilotRunInputLike,
  OpenBoxCopilotRunnerRunRequest,
  OpenBoxCopilotRuntime,
  OpenBoxCopilotRuntimeConfig,
  OpenBoxCopilotRuntimeErrorHookContext,
  OpenBoxCopilotRuntimeHookContext,
  OpenBoxCopilotRuntimeResponseHookContext,
  OpenBoxCopilotSessionState,
  OpenBoxCopilotTimingEvent,
  OpenBoxCopilotTimingKind,
  OpenBoxCopilotTimingStep,
  OpenBoxCopilotTimings,
  OpenBoxCopilotVerdictStatus,
  OpenBoxHeadlessApprovalClient,
  OpenBoxHeadlessApprovalRequest,
  OpenBoxSafePayload,
} from './types.js';

export function createOpenBoxCopilotRuntime(
  config: OpenBoxCopilotRuntimeConfig,
): OpenBoxCopilotRuntime {
  return createOpenBoxCopilotRuntimeImpl(config, () =>
    createOpenBoxCopilotKitAdapter(),
  );
}

export function createOpenBoxGovernedRunner(
  runner: OpenBoxCopilotAgentRunnerLike,
  config: {
    adapter?: OpenBoxCopilotKitAdapter;
    agents?: string[];
    sessionKey?: (input: OpenBoxCopilotRunInputLike) => string;
  } = {},
): OpenBoxCopilotAgentRunnerLike {
  return createOpenBoxGovernedRunnerImpl(runner, config, () =>
    createOpenBoxCopilotKitAdapter(),
  );
}

export function createOpenBoxRuntimeHooks(
  config: {
    adapter?: OpenBoxCopilotKitAdapter;
    agents?: string[];
  } = {},
) {
  return createOpenBoxRuntimeHooksImpl(config, () =>
    createOpenBoxCopilotKitAdapter(),
  );
}
