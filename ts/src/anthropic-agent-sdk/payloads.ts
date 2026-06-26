import type { SDKAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { GovernedPayload, SpanData, WorkflowVerdict } from '../core-client/index.js';
import { PRESET_ACTIVITY_TYPES } from '../core-client/generated/govern.js';
import { stampSource } from '../approvals/source.js';
import {
  buildLLMCompletionSpan,
  buildSpan,
  withOpenBoxActivityMetadata,
  withOpenBoxSubagentActivityMetadata,
  type LLMTokenUsage,
  type SpanType,
} from '../governance/spans.js';
import { normalizeOpenBoxUsage } from '../governance/usage.js';
import {
  assistantOutputTelemetryFields,
  buildAssistantOutputSpan,
} from '../governance/assistant-output.js';

const defaultActivity = PRESET_ACTIVITY_TYPES.default;
const anthropicAgentActivity = PRESET_ACTIVITY_TYPES['anthropic-agent-sdk'];

export const ANTHROPIC_AGENT_ACTIVITY_TYPES = {
  PROMPT: defaultActivity.prompt,
  TOOL_INPUT: anthropicAgentActivity.preToolUse,
  TOOL_OUTPUT: anthropicAgentActivity.postToolUse,
  TOOL_BATCH: anthropicAgentActivity.postToolBatch,
  TOOL_FAILURE: anthropicAgentActivity.postToolUseFailure,
  PERMISSION: anthropicAgentActivity.permissionRequest,
  SESSION: anthropicAgentActivity.sessionActivityStarted,
  ASSISTANT_OUTPUT: defaultActivity.llm,
  SUBAGENT: defaultActivity.agentSpawn,
  COMPACT: anthropicAgentActivity.preCompact,
  MESSAGE: anthropicAgentActivity.messageActivityStarted,
  CONFIG_CHANGE: anthropicAgentActivity.configChangeActivity,
  WORKSPACE_CHANGE: anthropicAgentActivity.workspaceChangeSignal,
  MCP_ELICITATION: anthropicAgentActivity.mcpElicitationStarted,
  TASK: anthropicAgentActivity.taskActivityStarted,
  USAGE_SIGNAL: anthropicAgentActivity.usageSignal,
  GOAL_SIGNAL: defaultActivity.goalSignal,
} as const;

export function objectRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function compactPayload(
  input: Record<string, unknown>,
  eventCategory: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { event_category: eventCategory };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) payload[key] = value;
  }
  return stampSource(payload, 'anthropic-agent-sdk');
}

export function toolActivityType(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Read' || toolName === 'NotebookRead' || toolName === 'Glob' || toolName === 'Grep') return defaultActivity.read;
  if ((toolName === 'Open' || toolName === 'FileOpen') && filePathFor(toolInput)) return defaultActivity.read;
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') return defaultActivity.write;
  if (toolName === 'Delete') return defaultActivity.fileDelete;
  if (toolName === 'Bash' || toolName === 'PowerShell' || toolName === 'Monitor') return defaultActivity.shell;
  if (toolName === 'WebFetch' || toolName === 'WebSearch') return defaultActivity.httpRequest;
  if (isDatabaseMcpTool(toolName, toolInput)) return defaultActivity.databaseQuery;
  if (toolName.startsWith('mcp__')) return defaultActivity.mcpToolCall;
  if (toolName === 'Agent' || toolName === 'Task') return defaultActivity.agentSpawn;
  return defaultActivity.agentAction;
}

export function toolSpan(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput?: unknown,
  stage: 'started' | 'completed' = 'started',
): SpanData[] | undefined {
  const spanType = spanTypeFor(toolName, toolInput);
  if (!spanType) return undefined;
  return [
    buildSpan('anthropic-agent-sdk', spanType, {
      stage,
      file_path: filePathFor(toolInput),
      command: stringFrom(toolInput.command),
      cwd: stringFrom(toolInput.cwd),
      tool_name: toolName,
      tool_input: toolInput,
      tool_output: toolOutput,
      url: httpTargetFor(toolInput),
      method: httpMethodFor(toolInput),
      db_system: dbSystemFor(toolName, toolInput),
      db_operation: dbOperationFor(toolInput),
      db_statement: dbStatementFor(toolInput),
    }) as unknown as SpanData,
  ];
}

export function toolActivityInput(
  toolName: string,
  toolInput: Record<string, unknown>,
  payload: Record<string, unknown>,
): unknown[] {
  const subagentName = subagentNameForTool(toolName, toolInput);
  if (toolName === 'Agent' || toolName === 'Task' || subagentName) {
    return withOpenBoxSubagentActivityMetadata([payload], subagentName) as unknown[];
  }
  return withOpenBoxActivityMetadata([payload], {
    toolType: spanTypeFor(toolName, toolInput),
  }) as unknown[];
}

export function toolTelemetryFields(
  toolName: string,
  toolInput: Record<string, unknown>,
): { toolName: string; toolType?: string } {
  const subagentName = subagentNameForTool(toolName, toolInput);
  const toolType =
    toolName === 'Agent' || toolName === 'Task' || subagentName
      ? 'a2a'
      : spanTypeFor(toolName, toolInput);
  return {
    toolName,
    ...(toolType ? { toolType } : {}),
  };
}

export function subagentActivityInput(
  env: Record<string, unknown>,
  payload: Record<string, unknown>,
): unknown[] {
  return withOpenBoxSubagentActivityMetadata(
    [payload],
    firstString(
      env.subagent_name,
      env.subagent_type,
      env.agent_type,
      env.agent_name,
      env.name,
      env.agent_id,
    ),
  ) as unknown[];
}

export function assistantOutputSpan(
  input: {
    content?: string;
    model?: string;
    usage?: LLMTokenUsage;
    sessionId?: string;
    event?: string;
    hasToolCalls?: boolean;
  },
): SpanData[] | undefined {
  return buildAssistantOutputSpan({
    source: 'anthropic-agent-sdk',
    content: input.content,
    span: { module: 'anthropic-agent-sdk' },
    name: 'openbox.anthropic-agent-sdk.assistant_output',
    model: input.model,
    usage: input.usage,
    hasToolCalls: input.hasToolCalls ?? false,
    providerUrl: 'https://api.anthropic.com/v1/messages',
    attributes: {
      'openbox.anthropic_agent_sdk.event': input.event ?? 'assistant',
    },
    data: {
      source: 'anthropic-agent-sdk',
      event: input.event ?? 'assistant',
      session_id: input.sessionId,
    },
  });
}

export function promptSpan(
  input: {
    prompt?: string;
  },
): SpanData[] {
  return [
    buildSpan('anthropic-agent-sdk', 'llm', {
      stage: 'started',
      prompt: input.prompt,
    }) as unknown as SpanData,
  ];
}

export function assistantOutputTelemetry(
  input: {
    content?: string;
    model?: string;
    usage?: LLMTokenUsage;
    sessionId?: string;
    hasToolCalls?: boolean;
  },
): Pick<
  GovernedPayload,
  | 'sessionId'
  | 'llmModel'
  | 'inputTokens'
  | 'outputTokens'
  | 'totalTokens'
  | 'hasToolCalls'
  | 'completion'
> {
  return assistantOutputTelemetryFields({
    source: 'anthropic-agent-sdk',
    sessionId: input.sessionId,
    content: input.content,
    model: input.model,
    usage: input.usage,
    hasToolCalls: input.hasToolCalls ?? false,
  });
}

export function assistantContentAndUsage(
  message: SDKAssistantMessage,
): {
  content?: string;
  model?: string;
  usage?: LLMTokenUsage;
  hasToolCalls?: boolean;
} {
  const apiMessage = message.message as unknown as {
    content?: unknown;
    model?: string;
    usage?: unknown;
  };
  return {
    content: textFromContent(apiMessage.content),
    model: apiMessage.model,
    usage: normalizeOpenBoxUsage(apiMessage.usage)?.raw,
    hasToolCalls: hasToolCallsFromContent(apiMessage.content),
  };
}

export function usagePayloadFromResult(
  message: SDKResultMessage,
): Record<string, unknown> {
  return stampSource({
    event_category: 'llm_usage',
    total_cost_usd: message.total_cost_usd,
    usage: message.usage,
    modelUsage: message.modelUsage,
    duration_ms: message.duration_ms,
    duration_api_ms: message.duration_api_ms,
    num_turns: message.num_turns,
    permission_denials: message.permission_denials,
    stop_reason: message.stop_reason,
    subtype: message.subtype,
  }, 'anthropic-agent-sdk');
}

export function modelUsageSpansFromResult(message: SDKResultMessage): SpanData[] {
  const entries = Object.entries(objectRecord(message.modelUsage))
    .map(([model, usage]) => {
      const normalizedUsage = normalizeOpenBoxUsage(usage);
      return {
        model: model.trim(),
        usage: normalizedUsage?.raw,
        costUsd: normalizedUsage?.costUsd,
      };
    })
    .filter(
      (
        entry,
      ): entry is { model: string; usage: LLMTokenUsage; costUsd: number | undefined } =>
        Boolean(entry.model && entry.usage),
    );

  if (entries.length <= 1) return [];

  return entries.map(({ model, usage, costUsd }) =>
    buildLLMCompletionSpan({
      content: '',
      name: 'openbox.synthetic.model_usage',
      system: 'anthropic-agent-sdk',
      model,
      usage,
      providerUrl: 'https://api.anthropic.com/v1/messages',
      span: { status: { code: 'OK' } },
      attributes: {
        'gen_ai.system': 'anthropic-agent-sdk',
        'openbox.synthetic': true,
        'openbox.anthropic_agent_sdk.event': 'result_model_usage',
      },
      data: {
        source: 'anthropic-agent-sdk',
        event: 'result_model_usage',
        session_id: message.session_id,
        model,
        ...(costUsd !== undefined ? { cost_usd: costUsd } : {}),
      },
    }),
  );
}

export function resultAssistantOutput(
  message: SDKResultMessage,
): {
  content?: string;
  model?: string;
  usage?: LLMTokenUsage;
  hasToolCalls?: boolean;
} {
  return {
    content: message.subtype === 'success' ? message.result : undefined,
    model: singleResultModel(message.modelUsage),
    usage: normalizeOpenBoxUsage(message.usage)?.raw,
    hasToolCalls: false,
  };
}

export function brandedReason(verdict?: WorkflowVerdict): string {
  const raw = verdict?.reason ?? '';
  const sanitized = raw.replace(/[\u2014\u2013]/g, ' - ').replace(/ {2,}/g, ' ').trim();
  if (!sanitized) return '';
  return sanitized.startsWith('[OpenBox]') ? sanitized : `[OpenBox] ${sanitized}`;
}

export function redactedRecord(verdict?: WorkflowVerdict): Record<string, unknown> | undefined {
  const redacted = unwrapInputRedaction(verdict?.guardrailsResult?.redactedInput);
  return redacted && typeof redacted === 'object' && !Array.isArray(redacted)
    ? (redacted as Record<string, unknown>)
    : undefined;
}

export function redactedValue(verdict?: WorkflowVerdict): unknown {
  return verdict?.guardrailsResult?.redactedInput;
}

export function redactedOutputValue(
  verdict?: WorkflowVerdict,
  originalOutput?: unknown,
): unknown {
  const guardrails = verdict?.guardrailsResult;
  const redactedOutput = guardrails?.redactedOutput ?? guardrails?.redactedInput;
  if (
    !guardrails ||
    guardrails.inputType !== 'activity_output' ||
    redactedOutput === null ||
    redactedOutput === undefined
  ) {
    return undefined;
  }
  return unwrapOutputRedaction(redactedOutput, originalOutput);
}

function unwrapInputRedaction(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 1) return value[0];
  if (!isPlainObject(value)) return value;
  if (Array.isArray(value.input) && value.input.length === 1) return value.input[0];
  if (Array.isArray(value.activity_input) && value.activity_input.length === 1) {
    return value.activity_input[0];
  }
  if (Array.isArray(value.activityInput) && value.activityInput.length === 1) {
    return value.activityInput[0];
  }
  return value;
}

function unwrapOutputRedaction(value: unknown, originalOutput: unknown): unknown {
  if (!isPlainObject(value) || hasOwnKey(originalOutput, 'output')) return value;
  if (Object.prototype.hasOwnProperty.call(value, 'output')) return value.output;
  if (Object.prototype.hasOwnProperty.call(value, 'activity_output')) return value.activity_output;
  if (Object.prototype.hasOwnProperty.call(value, 'activityOutput')) return value.activityOutput;
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasOwnKey(value: unknown, key: string): value is Record<string, unknown> {
  return isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function spanTypeFor(
  toolName: string,
  toolInput: Record<string, unknown>,
): SpanType | null {
  if (toolName === 'Agent' || toolName === 'Task') return null;
  if (toolName === 'Read' || toolName === 'NotebookRead' || toolName === 'Glob' || toolName === 'Grep') return 'file_read';
  if ((toolName === 'Open' || toolName === 'FileOpen') && filePathFor(toolInput)) return 'file_open';
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') return 'file_write';
  if (toolName === 'Delete') return 'file_delete';
  if (toolName === 'Bash' || toolName === 'PowerShell' || toolName === 'Monitor') return 'shell';
  if (toolName === 'WebFetch' || toolName === 'WebSearch') return 'http';
  if (isDatabaseMcpTool(toolName, toolInput)) return 'db';
  if (toolName.startsWith('mcp__')) return 'mcp';
  return 'llm_tool_call';
}

function subagentNameForTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): string | undefined {
  if (toolName !== 'Agent' && toolName !== 'Task') return undefined;
  return firstString(
    toolInput.subagent_name,
    toolInput.subagent_type,
    toolInput.agent_type,
    toolInput.agent_name,
    toolInput.name,
    toolInput.description,
  );
}

function textFromContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (!Array.isArray(value)) return undefined;
  const text = value
    .map((part) => {
      if (typeof part === 'string') return part;
      const record = objectRecord(part);
      return typeof record.text === 'string' ? record.text : '';
    })
    .join(' ')
    .trim();
  return text || undefined;
}

function hasToolCallsFromContent(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((part) => {
    const record = objectRecord(part);
    const type = typeof record.type === 'string' ? record.type : '';
    return type === 'tool_use' || type === 'tool_call' || type === 'function_call';
  });
}

function singleResultModel(value: unknown): string | undefined {
  const record = objectRecord(value);
  const models = Object.keys(record).filter((key) => key.trim());
  return models.length === 1 ? models[0] : undefined;
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const stringValue = stringFrom(value);
    if (stringValue) return stringValue;
  }
  return undefined;
}

function filePathFor(toolInput: Record<string, unknown>): string | undefined {
  return firstString(
    toolInput.file_path,
    toolInput.filePath,
    toolInput.path,
    toolInput.notebook_path,
  );
}

function httpTargetFor(toolInput: Record<string, unknown>): string | undefined {
  return firstString(toolInput.url, toolInput.uri, toolInput.href, toolInput.query);
}

function httpMethodFor(toolInput: Record<string, unknown>): string {
  return firstString(toolInput.method, toolInput.http_method, toolInput.httpMethod)?.toUpperCase() ?? 'GET';
}

function dbStatementFor(toolInput: Record<string, unknown>): string | undefined {
  return firstString(
    toolInput.db_statement,
    toolInput.dbStatement,
    toolInput.statement,
    toolInput.sql,
    toolInput.query,
  );
}

const SQL_VERBS = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'EXPLAIN',
] as const;

function dbOperationFromStatement(statement: string | undefined): string | undefined {
  if (!statement) return undefined;
  const normalized = statement.trim().toUpperCase();
  return SQL_VERBS.find((verb) => normalized.startsWith(verb));
}

function dbSystemFor(toolName: string, toolInput: Record<string, unknown>): string {
  const explicit = firstString(
    toolInput.db_system,
    toolInput.dbSystem,
    toolInput.system,
    toolInput.database_system,
  );
  if (explicit) return explicit;
  const lowerName = toolName.toLowerCase();
  if (lowerName.includes('sqlite')) return 'sqlite';
  if (lowerName.includes('mysql')) return 'mysql';
  if (lowerName.includes('postgres')) return 'postgresql';
  return 'postgresql';
}

function dbOperationFor(toolInput: Record<string, unknown>): string {
  const statementOperation = dbOperationFromStatement(dbStatementFor(toolInput));
  const explicitOperation = firstString(
    toolInput.db_operation,
    toolInput.dbOperation,
    toolInput.operation,
  )?.toUpperCase();
  if (
    explicitOperation &&
    explicitOperation !== 'QUERY' &&
    explicitOperation !== 'UNKNOWN'
  ) {
    return explicitOperation;
  }
  return statementOperation ?? explicitOperation ?? 'QUERY';
}

function isDatabaseMcpTool(toolName: string, toolInput: Record<string, unknown>): boolean {
  if (!toolName.startsWith('mcp__')) return false;
  const lowerName = toolName.toLowerCase();
  const nameLooksDatabase =
    lowerName.includes('db') ||
    lowerName.includes('sql') ||
    lowerName.includes('database') ||
    lowerName.includes('postgres') ||
    lowerName.includes('mysql') ||
    lowerName.includes('sqlite');
  if (!nameLooksDatabase) return false;
  return Boolean(dbStatementFor(toolInput)) ||
    lowerName.includes('query') ||
    lowerName.includes('execute') ||
    lowerName.includes('select');
}
