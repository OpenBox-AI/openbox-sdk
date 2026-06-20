import { randomUUID } from 'node:crypto';
import {
  AgentHooks as OpenAIAgentHooks,
  run as openaiAgentsRun,
  tool as openaiAgentsTool,
} from '@openai/agents';
import type { WorkflowVerdict } from '../core-client/index.js';
import {
  DEFAULT_OPENAI_AGENTS_TASK_QUEUE,
  DEFAULT_OPENAI_AGENTS_WORKFLOW_TYPE,
  OpenBoxAgentsSDKError,
  createOpenBoxAgentsRuntimeContext,
  verifyOpenBoxAgentsSDKConfig,
} from './config.js';
import { OpenBoxAgentsSessionManager } from './session-manager.js';
import type {
  AgentsRunFunction,
  AgentsToolFactory,
  OpenBoxAgentsToolCallDetails,
  OpenBoxAgentsAgentHooksOptions,
  OpenBoxAgentsGuardrailOptions,
  OpenBoxAgentsRunOptions,
  OpenBoxAgentsSDKConfig,
  OpenBoxAgentsTracingProcessorOptions,
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
import { normalizeOpenBoxUsage } from '../governance/usage.js';
import { USAGE_NORMALIZATION_SURFACE } from '../governance/generated/capability-matrix.js';

export {
  DEFAULT_OPENAI_AGENTS_TASK_QUEUE,
  DEFAULT_OPENAI_AGENTS_WORKFLOW_TYPE,
  OpenBoxAgentsSDKError,
  createOpenBoxAgentsRuntimeContext,
  resolveProjectConfigDir,
  verifyOpenBoxAgentsSDKConfig,
} from './config.js';
export type {
  OpenBoxAgentsSDKDiagnosticCheck,
  OpenBoxAgentsSDKDiagnosticStatus,
} from './config.js';
export type {
  AgentsRunFunction,
  AgentsToolFactory,
  OpenBoxAgentsApprovalMode,
  OpenBoxAgentsAgentHooksOptions,
  OpenBoxAgentsGuardrailOptions,
  OpenBoxAgentsRunOptions,
  OpenBoxAgentsSDKConfig,
  OpenBoxAgentsTracingProcessorOptions,
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

export function createOpenBoxAgentHooks(
  options: OpenBoxAgentsAgentHooksOptions = {},
): unknown {
  const hooks = new OpenAIAgentHooks() as any;
  const context = createOpenBoxAgentsRuntimeContext(options);
  if (!context.enabled) return hooks;
  const manager = new OpenBoxAgentsSessionManager(context);
  const sessionId = sessionIdFor(options, 'agent-hooks');

  const handlers = {
    async onAgentStart(_runContext: unknown, _agent: unknown, turnInput?: unknown) {
      await manager.startRun(sessionId, turnInput);
    },
    async onAgentEnd(_runContext: unknown, _agentOrOutput: unknown, maybeOutput?: unknown) {
      const output = maybeOutput ?? _agentOrOutput;
      await manager.complete(sessionId, output, runTelemetryFields(output));
    },
    async onAgentHandoff(_runContext: unknown, fromAgent: unknown, toAgent?: unknown) {
      await manager.observeHandoff(
        sessionId,
        agentName(fromAgent),
        agentName(toAgent),
      );
    },
    async onAgentToolStart(
      _runContext: unknown,
      _agentOrTool: unknown,
      maybeToolOrDetails?: unknown,
      maybeDetails?: unknown,
    ) {
      const { tool, details } = normalizeToolHookArgs(
        _agentOrTool,
        maybeToolOrDetails,
        maybeDetails,
      );
      const toolName = toolNameFrom(tool, details);
      const call = toolCallContextFrom(details);
      await manager.openTool(sessionId, toolName, toolInputFromDetails(details), call);
    },
    async onAgentToolEnd(
      _runContext: unknown,
      _agentOrTool: unknown,
      maybeToolOrResult?: unknown,
      maybeResultOrDetails?: unknown,
      maybeDetails?: unknown,
    ) {
      const { tool, result, details } = normalizeToolEndHookArgs(
        _agentOrTool,
        maybeToolOrResult,
        maybeResultOrDetails,
        maybeDetails,
      );
      const toolName = toolNameFrom(tool, details);
      const call = toolCallContextFrom(details);
      await manager.completeTool(
        sessionId,
        toolName,
        toolInputFromDetails(details),
        result,
        call,
      );
    },
  };

  hooks.on('agent_start', handlers.onAgentStart);
  hooks.on('agent_end', handlers.onAgentEnd);
  hooks.on('agent_handoff', handlers.onAgentHandoff);
  hooks.on('agent_tool_start', handlers.onAgentToolStart);
  hooks.on('agent_tool_end', handlers.onAgentToolEnd);
  return Object.assign(hooks, handlers);
}

export function createOpenBoxTracingProcessor(
  options: OpenBoxAgentsTracingProcessorOptions = {},
) {
  const context = createOpenBoxAgentsRuntimeContext(options);
  const manager = new OpenBoxAgentsSessionManager(context);
  const sessionTelemetry = new Map<string, ReturnType<typeof runTelemetryFields>>();

  const sessionIdForTrace = (traceOrSpan: unknown) =>
    sessionIdFor(
      {
        ...options,
        sessionId:
          options.sessionId ??
          firstStringFromRecord(traceOrSpan, 'traceId', 'trace_id', 'id'),
      },
      'trace',
    );

  return {
    start() {
      // OpenBox does not run an exporter loop; the SDK calls lifecycle hooks.
    },
    async onTraceStart(trace: unknown) {
      if (!context.enabled) return;
      await manager.startRun(sessionIdForTrace(trace), tracePayload(trace));
    },
    async onTraceEnd(trace: unknown) {
      if (!context.enabled) return;
      const sessionId = sessionIdForTrace(trace);
      await manager.complete(
        sessionId,
        tracePayload(trace),
        sessionTelemetry.get(sessionId) ?? {},
      );
      sessionTelemetry.delete(sessionId);
    },
    async onSpanStart(_span: unknown) {
      // Start events are observed at span end so completed trace data is available.
    },
    async onSpanEnd(span: unknown) {
      if (!context.enabled) return;
      const spanData = spanDataFrom(span);
      const sessionId = sessionIdForTrace(span);
      if (spanData.type === 'handoff') {
        await manager.observeHandoff(
          sessionId,
          stringFrom(spanData.from_agent),
          stringFrom(spanData.to_agent),
        );
        return;
      }
      if (spanData.type === 'guardrail') {
        await manager.observeGuardrail(sessionId, {
          span_type: 'guardrail',
          name: spanData.name,
          triggered: spanData.triggered,
        });
        return;
      }
      if (spanData.type === 'generation') {
        sessionTelemetry.set(sessionId, generationTelemetry(spanData));
        return;
      }
      if (spanData.type === 'function' || spanData.type === 'mcp_tools') {
        const toolName =
          stringFrom(spanData.name) ??
          (spanData.type === 'mcp_tools' ? 'MCPListTools' : 'FunctionTool');
        const input = functionSpanInput(spanData);
        const call = { callId: spanIdFrom(span) };
        await manager.openTool(sessionId, toolName, input, call);
        await manager.completeTool(
          sessionId,
          toolName,
          input,
          functionSpanOutput(spanData),
          call,
        );
      }
    },
    async shutdown(_timeout?: number) {
      sessionTelemetry.clear();
    },
    async forceFlush() {
      // No local buffer; OpenBox Core receives events as hooks fire.
    },
  };
}

export function openBoxInputGuardrail(
  options: OpenBoxAgentsGuardrailOptions = {},
) {
  return {
    name: options.name ?? 'openbox-input-guardrail',
    runInParallel: false,
    execute: async (args: { input?: unknown; [key: string]: unknown }) => {
      const verdict = await observeGuardrail(options, 'input', args.input ?? args);
      return nativeGuardrailOutput(verdict);
    },
  };
}

export function openBoxOutputGuardrail(
  options: OpenBoxAgentsGuardrailOptions = {},
) {
  return {
    name: options.name ?? 'openbox-output-guardrail',
    execute: async (args: { agentOutput?: unknown; [key: string]: unknown }) => {
      const verdict = await observeGuardrail(options, 'output', args.agentOutput ?? args);
      return nativeGuardrailOutput(verdict);
    },
  };
}

export function openBoxToolInputGuardrail(
  options: OpenBoxAgentsGuardrailOptions = {},
) {
  return {
    type: 'tool_input' as const,
    name: options.name ?? 'openbox-tool-input-guardrail',
    run: async (data: { toolCall?: unknown; [key: string]: unknown }) => {
      const verdict = await observeGuardrail(options, 'tool_input', data.toolCall ?? data);
      return nativeToolGuardrailOutput(verdict, 'OpenBox rejected tool input');
    },
  };
}

export function openBoxToolOutputGuardrail(
  options: OpenBoxAgentsGuardrailOptions = {},
) {
  return {
    type: 'tool_output' as const,
    name: options.name ?? 'openbox-tool-output-guardrail',
    run: async (data: { output?: unknown; toolCall?: unknown; [key: string]: unknown }) => {
      const verdict = await observeGuardrail(options, 'tool_output', {
        toolCall: data.toolCall,
        output: data.output,
      });
      return nativeToolGuardrailOutput(verdict, 'OpenBox rejected tool output');
    },
  };
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

function normalizeToolHookArgs(
  agentOrTool: unknown,
  maybeToolOrDetails?: unknown,
  maybeDetails?: unknown,
): { tool: unknown; details: unknown } {
  return maybeDetails === undefined
    ? { tool: agentOrTool, details: maybeToolOrDetails }
    : { tool: maybeToolOrDetails, details: maybeDetails };
}

function normalizeToolEndHookArgs(
  agentOrTool: unknown,
  maybeToolOrResult?: unknown,
  maybeResultOrDetails?: unknown,
  maybeDetails?: unknown,
): { tool: unknown; result: unknown; details: unknown } {
  return maybeDetails === undefined
    ? {
        tool: agentOrTool,
        result: maybeToolOrResult,
        details: maybeResultOrDetails,
      }
    : {
        tool: maybeToolOrResult,
        result: maybeResultOrDetails,
        details: maybeDetails,
      };
}

function agentName(agent: unknown): string | undefined {
  const record = objectRecord(agent);
  return firstString(
    record.name,
    record.id,
    record.agentId,
    record.agent_id,
  );
}

function toolNameFrom(tool: unknown, details: unknown): string {
  const toolRecord = objectRecord(tool);
  const toolCall = objectRecord(objectRecord(details).toolCall);
  return (
    firstString(
      toolRecord.name,
      toolRecord.type,
      toolCall.name,
      toolCall.type,
    ) ?? 'OpenAIAgentsTool'
  );
}

function toolCallContextFrom(details: unknown): {
  callId: string;
  details?: OpenBoxAgentsToolCallDetails;
} {
  const detailsRecord = objectRecord(details);
  const toolCall = objectRecord(detailsRecord.toolCall);
  return {
    callId:
      firstString(
        toolCall.callId,
        toolCall.call_id,
        toolCall.id,
        detailsRecord.callId,
        detailsRecord.id,
      ) ?? randomUUID(),
    details: Object.keys(detailsRecord).length > 0
      ? (detailsRecord as OpenBoxAgentsToolCallDetails)
      : undefined,
  };
}

function toolInputFromDetails(details: unknown): Record<string, unknown> {
  const toolCall = objectRecord(objectRecord(details).toolCall);
  const parsed = parseMaybeJson(
    toolCall.arguments ?? toolCall.args ?? toolCall.input,
  );
  if (Object.keys(objectRecord(parsed)).length > 0) return objectRecord(parsed);
  return Object.keys(toolCall).length > 0 ? toolCall : {};
}

async function observeGuardrail(
  options: OpenBoxAgentsGuardrailOptions,
  stage: string,
  payload: unknown,
): Promise<WorkflowVerdict> {
  const context = createOpenBoxAgentsRuntimeContext({
    approvalMode: 'error',
    ...options,
  });
  if (!context.enabled) return { arm: 'allow' } as WorkflowVerdict;
  const manager = new OpenBoxAgentsSessionManager(context);
  return manager.observeGuardrail(sessionIdFor(options, stage), {
    stage,
    payload,
  });
}

function nativeGuardrailOutput(verdict: WorkflowVerdict) {
  return {
    tripwireTriggered: verdict.arm !== 'allow',
    outputInfo: openBoxVerdictInfo(verdict),
  };
}

function nativeToolGuardrailOutput(
  verdict: WorkflowVerdict,
  fallbackMessage: string,
) {
  const outputInfo = openBoxVerdictInfo(verdict);
  if (verdict.arm === 'allow') {
    return {
      behavior: { type: 'allow' as const },
      outputInfo,
    };
  }
  if (verdict.arm === 'constrain') {
    return {
      behavior: {
        type: 'rejectContent' as const,
        message: brandedReason(verdict.reason) || fallbackMessage,
      },
      outputInfo,
    };
  }
  return {
    behavior: { type: 'throwException' as const },
    outputInfo,
  };
}

function openBoxVerdictInfo(verdict: WorkflowVerdict): Record<string, unknown> {
  return {
    openbox: {
      arm: verdict.arm,
      reason: verdict.reason,
      guardrailsResult: verdict.guardrailsResult,
    },
  };
}

function tracePayload(trace: unknown): Record<string, unknown> {
  const record = objectRecord(trace);
  const toJSON = (trace as { toJSON?: () => unknown } | null)?.toJSON;
  return {
    trace_id: firstString(record.traceId, record.trace_id, record.id),
    name: firstString(record.name),
    group_id: firstString(record.groupId, record.group_id),
    metadata: objectRecord(record.metadata),
    json: typeof toJSON === 'function' ? toJSON.call(trace) : undefined,
  };
}

function spanDataFrom(span: unknown): Record<string, unknown> {
  const record = objectRecord(span);
  return objectRecord(record.spanData ?? record.data);
}

function spanIdFrom(span: unknown): string {
  const record = objectRecord(span);
  return firstString(record.spanId, record.span_id, record.id) ?? randomUUID();
}

function generationTelemetry(
  spanData: Record<string, unknown>,
): ReturnType<typeof runTelemetryFields> {
  const usage = normalizeOpenBoxUsage(spanData);
  return {
    llmModel: firstStringForFields(
      spanData,
      USAGE_NORMALIZATION_SURFACE.providerModelFields,
    ),
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    totalTokens: usage?.totalTokens,
    hasToolCalls: arrayFrom(spanData.output).some((item) => {
      const itemType = firstString(objectRecord(item).type)?.toLowerCase();
      return itemType === 'function_call' || itemType?.includes('tool') === true;
    }),
    finishReason: firstStringForFields(
      spanData,
      USAGE_NORMALIZATION_SURFACE.providerFinishReasonFields,
    ),
  };
}

function functionSpanInput(spanData: Record<string, unknown>): Record<string, unknown> {
  const input = parseMaybeJson(spanData.input);
  const mcpData = parseMaybeJson(spanData.mcp_data);
  const mcpToolsInput =
    spanData.type === 'mcp_tools' && firstString(spanData.server)
      ? { server: firstString(spanData.server) }
      : {};
  return {
    ...mcpToolsInput,
    ...objectRecord(input),
    ...(Object.keys(objectRecord(mcpData)).length > 0
      ? { mcp_data: objectRecord(mcpData) }
      : {}),
  };
}

function functionSpanOutput(spanData: Record<string, unknown>): unknown {
  if (spanData.type === 'mcp_tools' && Array.isArray(spanData.result)) {
    return { tools: spanData.result };
  }
  return parseMaybeJson(spanData.output);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return { value };
  }
}

function firstStringFromRecord(
  value: unknown,
  ...keys: string[]
): string | undefined {
  const record = objectRecord(value);
  return firstString(...keys.map((key) => record[key]));
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0)
      return value.trim();
  }
  return undefined;
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function firstStringForFields(
  record: Record<string, unknown>,
  fields: readonly string[],
): string | undefined {
  return firstString(...fields.map((field) => valueAtPath(record, field)));
}

function valueAtPath(record: Record<string, unknown>, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(record, path)) return record[path];
  if (!path.includes('.')) return record[path];
  let current: unknown = record;
  for (const part of path.split('.')) {
    const currentRecord = objectRecord(current);
    if (!Object.prototype.hasOwnProperty.call(currentRecord, part)) {
      return undefined;
    }
    current = currentRecord[part];
  }
  return current;
}

function arrayFrom(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function inputForVerdict(
  input: unknown,
  verdict: WorkflowVerdict,
  approvalMode: 'wait' | 'error',
): unknown {
  if (verdict.arm === 'allow') return input;
  if (verdict.arm === 'constrain') {
    const redacted = redactedRecord(verdict.guardrailsResult?.redactedInput);
    if (redacted) return redacted;
    if (hasInputRedaction(verdict)) {
      throw new OpenBoxAgentsSDKError(
        brandedReason(verdict.reason) ||
          '[OpenBox] redacted this tool input but did not provide replacement input',
      );
    }
    return input;
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
      redactedOutputValue(
        verdict.guardrailsResult?.redactedOutput ??
          verdict.guardrailsResult?.redactedInput,
        output,
      ) ??
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

function hasInputRedaction(verdict: WorkflowVerdict): boolean {
  const guardrails = verdict.guardrailsResult;
  const hasRedactedField = guardrails?.fieldResults?.some(
    (field) => field.status === 'redacted' || field.status === 'transformed',
  );
  return Boolean(
    guardrails &&
      (guardrails.inputType === 'activity_input' ||
        guardrails.inputType === 'signal_args') &&
      (hasRedactedField ||
        guardrails.redactedInput !== undefined &&
        guardrails.redactedInput !== null),
  );
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
