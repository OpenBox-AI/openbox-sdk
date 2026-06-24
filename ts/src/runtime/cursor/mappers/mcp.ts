import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import {
  buildBeforeMCPExecutionPayload,
  BEFORE_MCPEXECUTION_ACTIVITY_TYPE,
} from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { sideEffects } from '../side-effects.js';
import { withOpenBoxActivityMetadata } from '../../../governance/spans.js';
import type { SpanType } from '../../../governance/spans.js';
import { buildCursorSpan } from './spans.js';
import { stampSource } from '../../../approvals/source.js';
import { rememberCompletionActivity } from '../dedup.js';
import { ACTIVITY_TYPES } from '../activity-types.js';
import {
  dbOperationFor,
  dbStatementFor,
  dbSystemFor,
  httpMethodFor,
  httpTargetFor,
  isDatabaseMcpTool,
  isHttpMcpTool,
} from '../../claude-code/mappers/tool-input.js';

function spanTypeForMcpTool(
  toolName: string,
  toolInput: Record<string, unknown>,
): SpanType {
  if (isDatabaseMcpTool(toolName, toolInput)) return 'db';
  if (isHttpMcpTool(toolName, toolInput)) return 'http';
  return 'mcp';
}

function activityTypeForSpan(spanType: SpanType): string {
  if (spanType === 'db') return ACTIVITY_TYPES.DB_QUERY;
  if (spanType === 'http') return ACTIVITY_TYPES.API_CALL;
  return BEFORE_MCPEXECUTION_ACTIVITY_TYPE;
}

function spanInputForMcpTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  spanType: SpanType,
): Record<string, unknown> {
  if (spanType === 'db') {
    return {
      tool_name: toolName,
      tool_input: toolInput,
      db_system: dbSystemFor(toolName, toolInput),
      db_operation: dbOperationFor(toolInput),
      db_statement: dbStatementFor(toolInput),
    };
  }
  if (spanType === 'http') {
    return {
      tool_name: toolName,
      tool_input: toolInput,
      url: httpTargetFor(toolInput),
      method: httpMethodFor(toolInput),
    };
  }
  return { tool_name: toolName, tool_input: toolInput };
}

/** beforeMCPExecution: govern an MCP tool call before Cursor invokes it. */
export async function handleBeforeMCPExecution(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  if (!toolName) return undefined;

  const toolInput = (env.tool_input ?? {}) as Record<string, unknown>;
  const spanType = spanTypeForMcpTool(toolName, toolInput);
  const activityType = activityTypeForSpan(spanType);
  const payload = buildBeforeMCPExecutionPayload(env, sideEffects);
  const span = buildCursorSpan(
    spanType,
    spanInputForMcpTool(toolName, toolInput, spanType),
  );
  const startTime = Date.now();
  const opened = await session.openActivity(activityType, {
    input: withOpenBoxActivityMetadata(
      [stampSource(payload, 'cursor')],
      { toolType: spanType },
    ),
    startTime,
    spans: [span],
  });
  const verdict = opened.verdict;
  if (
    verdict.arm === 'allow' ||
    verdict.arm === 'constrain' ||
    verdict.arm === 'require_approval'
  ) {
    rememberCompletionActivity(
      {
        generation_id: env.generation_id,
        conversation_id: env.conversation_id,
        kind: 'mcp',
        arg: toolName,
      },
      cfg,
      {
        activityId: opened.activityId,
        activityType,
        startTime,
      },
    );
  }
  if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
  return verdict;
}
