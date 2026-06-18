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
import { withOpenBoxSubagentActivityMetadata } from '../../../governance/spans.js';
import { markHalted } from '../session-resolver.js';
import {
  buildClaudeAssistantOutputSpan,
  claudeAssistantTelemetryFields,
} from './assistant-output.js';

/** Pinned per-subagent activity_type so START/STOP balance. Activity name
 *  carries identity that the spec-driven payload doesn't (the activity_type
 *  string itself is what the dashboard charts; payload fields are for
 *  guardrail scanning). */
function subAgentActivityType(env: ClaudeCodeEnvelope): string {
  return `SubAgent:${env.agent_type || env.agent_id || 'unknown'}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function subagentName(env: ClaudeCodeEnvelope): string | undefined {
  return (
    stringValue(env.agent_type) ??
    stringValue(env.teammate_name) ??
    stringValue(env.team_name) ??
    stringValue(env.agent_id) ??
    stringValue(env.task_subject)
  );
}

function subagentInput(input: unknown[], env: ClaudeCodeEnvelope): unknown[] {
  return withOpenBoxSubagentActivityMetadata(input, subagentName(env)) as unknown[];
}

/** SubagentStart: opens a SubAgent activity. Observe-only. */
export async function handleSubagentStart(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  _cfg: ClaudeCodeConfig,
): Promise<undefined> {
  try {
    await session.activity(EVENT.START, subAgentActivityType(env), {
      input: subagentInput(
        [stampSource(buildSubagentStartPayload(env), 'claude-code')],
        env,
      ),
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
  const verdict = await session.activity(EVENT.COMPLETE, subAgentActivityType(env), {
    input: subagentInput(
      [stampSource(buildSubagentStopPayload(env), 'claude-code')],
      env,
    ),
    ...claudeAssistantTelemetryFields(env, {
      fallbackText: env.last_assistant_message,
    }),
    spans: buildClaudeAssistantOutputSpan(env, {
      event: 'SubagentStop',
      fallbackText: env.last_assistant_message,
    }),
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
    input: subagentInput(
      [stampSource(buildTaskCreatedPayload(env), 'claude-code')],
      env,
    ),
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
    input: subagentInput(
      [stampSource(buildTaskCompletedPayload(env), 'claude-code')],
      env,
    ),
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
    input: subagentInput(
      [stampSource(buildTeammateIdlePayload(env), 'claude-code')],
      env,
    ),
  });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}
