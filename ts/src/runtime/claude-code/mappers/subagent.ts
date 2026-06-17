import type { ClaudeCodeSession, WorkflowVerdict } from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
import {
  buildSubagentStartPayload,
  buildSubagentStopPayload,
  buildTaskCompletedPayload,
  buildTaskCreatedPayload,
  buildTeammateIdlePayload,
} from '../../../core-client/generated/runtime/claude-code.js';
import type { ClaudeCodeConfig } from '../config.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';
import { stampSource } from '../../../approvals/source.js';
import { markHalted } from '../session-resolver.js';
import { buildSpan } from '../../../governance/spans.js';
import { readLatestAssistantUsage } from '../transcript-usage.js';

/** Pinned per-subagent activity_type so START/STOP balance. Activity name
 *  carries identity that the spec-driven payload doesn't (the activity_type
 *  string itself is what the dashboard charts; payload fields are for
 *  guardrail scanning). */
function subAgentActivityType(env: ClaudeCodeEnvelope): string {
  return `SubAgent:${env.agent_type || env.agent_id || 'unknown'}`;
}

/** SubagentStart: opens a SubAgent activity. Observe-only. */
export async function handleSubagentStart(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  _cfg: ClaudeCodeConfig,
): Promise<undefined> {
  try {
    await session.activity(EVENT.START, subAgentActivityType(env), {
      input: [stampSource(buildSubagentStartPayload(env), 'claude-code')],
    });
  } catch {
    // best-effort observability
  }
  return undefined;
}

/** SubagentStop: closes the SubAgent activity. Pairs with SubagentStart. */
export async function handleSubagentStop(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const usage = readLatestAssistantUsage(env);
  const verdict = await session.activity(EVENT.COMPLETE, subAgentActivityType(env), {
    input: [stampSource(buildSubagentStopPayload(env), 'claude-code')],
    spans: usage
      ? [
          buildSpan('claude-code', 'llm', {
            response: env.last_assistant_message ?? '',
            model: usage.model,
            usage: usage.usage,
          }),
        ]
      : undefined,
  });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}

export async function handleTaskCreated(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.TASK, {
    input: [stampSource(buildTaskCreatedPayload(env), 'claude-code')],
  });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}

export async function handleTaskCompleted(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const verdict = await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.TASK, {
    input: [stampSource(buildTaskCompletedPayload(env), 'claude-code')],
  });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}

export async function handleTeammateIdle(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const verdict = await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.TASK, {
    input: [stampSource(buildTeammateIdlePayload(env), 'claude-code')],
  });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}
