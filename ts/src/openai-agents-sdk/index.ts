import { randomUUID } from 'node:crypto';
import {
  run as openaiAgentsRun,
  tool as openaiAgentsTool,
} from '@openai/agents';
import type { WorkflowVerdict } from '../core-client/index.js';
import {
  DEFAULT_OPENAI_AGENTS_TASK_QUEUE,
  DEFAULT_OPENAI_AGENTS_WORKFLOW_TYPE,
  OpenBoxAgentsSDKError,
  createOpenBoxAgentsRuntimeContext,
} from './config.js';
import { OpenBoxAgentsSessionManager } from './session-manager.js';
import type {
  AgentsRunFunction,
  AgentsToolFactory,
  OpenBoxAgentsToolCallDetails,
  OpenBoxAgentsRunOptions,
  OpenBoxAgentsSDKConfig,
  OpenBoxAgentsToolConfig,
  OpenBoxAgentsToolOptions,
} from './types.js';
import {
  brandedReason,
  objectRecord,
  redactedOutputValue,
  redactedRecord,
  runTelemetryFields,
} from './payloads.js';

export {
  DEFAULT_OPENAI_AGENTS_TASK_QUEUE,
  DEFAULT_OPENAI_AGENTS_WORKFLOW_TYPE,
  OpenBoxAgentsSDKError,
  createOpenBoxAgentsRuntimeContext,
  resolveProjectConfigDir,
} from './config.js';
export type {
  AgentsRunFunction,
  AgentsToolFactory,
  OpenBoxAgentsApprovalMode,
  OpenBoxAgentsRunOptions,
  OpenBoxAgentsSDKConfig,
  OpenBoxAgentsToolCallDetails,
  OpenBoxAgentsToolConfig,
  OpenBoxAgentsToolOptions,
} from './types.js';

export function createOpenBoxAgentsTool(
  toolConfig: OpenBoxAgentsToolConfig,
  options: OpenBoxAgentsToolOptions = {},
): unknown {
  const context = createOpenBoxAgentsRuntimeContext(options);
  if (!context.enabled) {
    const toolFactory = (options.toolFactory ??
      openaiAgentsTool) as AgentsToolFactory;
    return toolFactory(toolConfig as unknown as Record<string, unknown>);
  }
  const manager = new OpenBoxAgentsSessionManager(context);
  const toolFactory = (options.toolFactory ??
    openaiAgentsTool) as AgentsToolFactory;
  const originalExecute = toolConfig.execute;
  const wrappedConfig = {
    ...toolConfig,
    execute: async (...args: unknown[]) => {
      const input = args[0];
      const runContext = args[1];
      const details = toolCallDetailsFrom(args[2]);
      const call = {
        callId: toolCallIdFromDetails(details) ?? randomUUID(),
        details,
      };
      const sessionId = sessionIdFor(options, toolConfig.name);
      const opened = await manager.openTool(
        sessionId,
        toolConfig.name,
        input,
        call,
      );
      const governedInput = inputForVerdict(
        input,
        opened.verdict,
        context.approvalMode,
      );
      try {
        const output = await originalExecute(
          governedInput,
          runContext,
          details,
        );
        const completionVerdict = await manager.completeTool(
          sessionId,
          toolConfig.name,
          governedInput,
          output,
          call,
        );
        return outputForVerdict(
          output,
          completionVerdict,
          context.approvalMode,
        );
      } catch (error) {
        await manager.completeTool(
          sessionId,
          toolConfig.name,
          governedInput,
          {
            error: error instanceof Error ? error.message : String(error),
          },
          call,
        );
        throw error;
      }
    },
  };
  return toolFactory(wrappedConfig as unknown as Record<string, unknown>);
}

export async function runWithOpenBox(
  agent: unknown,
  input: unknown,
  options: OpenBoxAgentsRunOptions = {},
): Promise<unknown> {
  const context = createOpenBoxAgentsRuntimeContext(options);
  const runFunction = (options.runFunction ??
    openaiAgentsRun) as AgentsRunFunction;
  if (!context.enabled) return runFunction(agent, input, runOptions(options));
  const manager = new OpenBoxAgentsSessionManager(context);
  const sessionId = sessionIdFor(options, 'run');
  const startVerdict = await manager.startRun(sessionId, input);
  const governedInput = inputForVerdict(
    input,
    startVerdict,
    context.approvalMode,
  );
  try {
    const result = await runFunction(agent, governedInput, runOptions(options));
    await manager.complete(sessionId, result, runTelemetryFields(result));
    return result;
  } catch (error) {
    await manager.fail(sessionId, error);
    throw error;
  }
}

export function createOpenBoxAgentsSDK(config: OpenBoxAgentsSDKConfig = {}) {
  return {
    tool: (
      toolConfig: OpenBoxAgentsToolConfig,
      options: OpenBoxAgentsToolOptions = {},
    ) => createOpenBoxAgentsTool(toolConfig, { ...config, ...options }),
    run: (
      agent: unknown,
      input: unknown,
      options: OpenBoxAgentsRunOptions = {},
    ) => runWithOpenBox(agent, input, { ...config, ...options }),
  };
}

function inputForVerdict(
  input: unknown,
  verdict: WorkflowVerdict,
  approvalMode: 'wait' | 'error',
): unknown {
  if (verdict.arm === 'allow') return input;
  if (verdict.arm === 'constrain') {
    return redactedRecord(verdict.guardrailsResult?.redactedInput) ?? input;
  }
  const reason = brandedReason(verdict.reason);
  if (verdict.arm === 'require_approval') {
    throw new OpenBoxAgentsSDKError(
      approvalMode === 'error'
        ? reason || '[OpenBox] approval required'
        : reason ||
            '[OpenBox] approval was not resolved before the tool deadline',
    );
  }
  throw new OpenBoxAgentsSDKError(reason || '[OpenBox] blocked by policy');
}

function outputForVerdict(
  output: unknown,
  verdict: WorkflowVerdict | undefined,
  approvalMode: 'wait' | 'error',
): unknown {
  if (!verdict || verdict.arm === 'allow') return output;
  if (verdict.arm === 'constrain') {
    return (
      redactedOutputValue(verdict.guardrailsResult?.redactedInput, output) ??
      output
    );
  }
  const reason = brandedReason(verdict.reason);
  if (verdict.arm === 'require_approval') {
    throw new OpenBoxAgentsSDKError(
      approvalMode === 'error'
        ? reason || '[OpenBox] approval required for tool output'
        : reason ||
            '[OpenBox] tool output approval was not resolved before the deadline',
    );
  }
  throw new OpenBoxAgentsSDKError(reason || '[OpenBox] blocked tool output');
}

function sessionIdFor(
  options: Pick<OpenBoxAgentsSDKConfig, 'workflowId' | 'runId'> & {
    sessionId?: string;
  },
  suffix: string,
): string {
  return (
    options.sessionId ??
    options.workflowId ??
    options.runId ??
    `openai-agents-sdk:${suffix}:${randomUUID()}`
  );
}

function runOptions(
  options: OpenBoxAgentsRunOptions,
): Record<string, unknown> | undefined {
  const record = objectRecord(options);
  const blocked = new Set([
    'apiKey',
    'core',
    'coreTimeoutMs',
    'coreUrl',
    'cwd',
    'enabled',
    'agentIdentity',
    'approvalMode',
    'input',
    'runFunction',
    'sessionId',
    'taskQueue',
    'workflowId',
    'workflowType',
  ]);
  const passThrough: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!blocked.has(key) && value !== undefined) passThrough[key] = value;
  }
  return Object.keys(passThrough).length > 0 ? passThrough : undefined;
}

function toolCallDetailsFrom(
  value: unknown,
): OpenBoxAgentsToolCallDetails | undefined {
  return Object.keys(objectRecord(value)).length > 0
    ? (value as OpenBoxAgentsToolCallDetails)
    : undefined;
}

function toolCallIdFromDetails(
  details: OpenBoxAgentsToolCallDetails | undefined,
): string | undefined {
  const callId = details?.toolCall?.callId ?? details?.toolCall?.id;
  return typeof callId === 'string' && callId.trim().length > 0
    ? callId.trim()
    : undefined;
}
