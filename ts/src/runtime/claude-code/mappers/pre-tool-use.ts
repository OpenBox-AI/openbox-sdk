import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
import {
  PRE_TOOL_USE_ROUTING,
  buildPreToolUsePayload,
} from '../../../core-client/generated/runtime/claude-code.js';
import type { ClaudeCodeConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';
import { isSkipped } from '../../../governance/skip-patterns.js';
import { buildSpan, type SpanType } from '../../../governance/spans.js';
import { stampSource } from '../../../approvals/source.js';
import { sideEffects } from '../side-effects.js';
import { rememberToolActivity } from '../tool-activity-store.js';

/** Activity-type lookup. Spec-driven for the standard tools; mcp__* tools
 *  fall through to MCP_CALL because their names are dynamic. */
function activityTypeFor(toolName: string): string | null {
  const direct = PRE_TOOL_USE_ROUTING[toolName];
  if (direct) return direct;
  if (toolName.startsWith('mcp__')) return ACTIVITY_TYPES.MCP_CALL;
  return ACTIVITY_TYPES.AGENT_ACTION;
}

/** Map a tool name to the span type behavior rules will match on.
 *  Returns null for tools without a recognized span shape (the span
 *  is omitted; rules that need spans silently won't match). */
function spanTypeFor(toolName: string): SpanType | null {
  if (toolName === 'Read' || toolName === 'NotebookRead' || toolName === 'Glob' || toolName === 'Grep') return 'file_read';
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') return 'file_write';
  if (toolName === 'Delete') return 'file_delete';
  if (toolName === 'Bash' || toolName === 'PowerShell') return 'shell';
  if (toolName === 'WebFetch' || toolName === 'WebSearch') return 'http';
  if (toolName.startsWith('mcp__')) return 'mcp';
  return null;
}

/**
 * PreToolUse: agent is about to call a tool. Activity routing comes from
 * @activityRouting; payload field shape comes from @payloadShape; both
 * generated. This file is just the platform shell: skip-pattern check,
 * span build, fire, halt-mark on halt verdict.
 */
export async function handlePreToolUse(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  const toolInput = (env.tool_input ?? {}) as Record<string, unknown>;
  if ((cfg.skipTools ?? []).includes(toolName)) return undefined;

  const activityType = activityTypeFor(toolName);
  if (!activityType) return undefined;
  if ((cfg.skipActivityTypes ?? []).includes(activityType)) return undefined;

  // Skip-pattern guard for the file-touching tools; paths inside
  // SKIP_PATTERNS (.claude/, .git/, .ssh/, etc.) bypass governance to
  // avoid PII false-HALTs on IDE metadata.
  const filePath = (toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? toolInput.notebook_path ?? '') as string;
  if (filePath && isSkipped(filePath)) return undefined;

  const payload = buildPreToolUsePayload(env, toolName, sideEffects);

  // Build a span so behavior rules can match; see
  // governance/spans.ts. Without spans, every rule silently
  // no-ops (Activity type alone is not a behavior trigger; see
  // skill/references/span-reference.md).
  const spanType = spanTypeFor(toolName);
  const spans = spanType
    ? [
        buildSpan('claude-code', spanType, {
          file_path: filePath || undefined,
          command: (toolInput.command as string) || undefined,
          cwd: (toolInput.cwd as string) || undefined,
          tool_name: toolName,
          tool_input: toolInput,
          url: (toolInput.url as string) || (toolInput.query as string) || undefined,
          method: 'GET',
        }),
      ]
    : undefined;

  const startTime = Date.now();
  const opened = await session.openActivity(activityType, {
    input: [stampSource(payload, 'claude-code')],
    startTime,
    spans,
  });
  const verdict = opened.verdict;
  if (
    verdict.arm === 'allow' ||
    verdict.arm === 'constrain' ||
    verdict.arm === 'require_approval'
  ) {
    rememberToolActivity(env, cfg, {
      activityId: opened.activityId,
      activityType,
      startTime,
    });
  }
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}
