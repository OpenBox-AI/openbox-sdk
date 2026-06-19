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
import {
  rememberLifecycleActivity,
  takeLifecycleActivity,
} from '../tool-activity-store.js';

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

function lifecycleKey(prefix: string, env: ClaudeCodeEnvelope): string {
  const source = env as unknown as Record<string, unknown>;
  const taskId = stringValue(source.task_id) ?? stringValue(source.taskId);
  return [
    prefix,
    env.session_id,
    taskId ?? subagentName(env) ?? subAgentActivityType(env),
  ].join(':');
}

function subagentInput(input: unknown[], env: ClaudeCodeEnvelope): unknown[] {
  return withOpenBoxSubagentActivityMetadata(input, subagentName(env)) as unknown[];
}

/** SubagentStart: opens a SubAgent activity. Observe-only. */
export async function handleSubagentStart(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<undefined> {
  try {
    const activityType = subAgentActivityType(env);
    const startTime = Date.now();
    const opened = await session.openActivity(activityType, {
      input: subagentInput(
        [stampSource(buildSubagentStartPayload(env), 'claude-code')],
        env,
      ),
      startTime,
    });
    if (
      opened.verdict.arm === 'allow' ||
      opened.verdict.arm === 'constrain' ||
      opened.verdict.arm === 'require_approval'
    ) {
      rememberLifecycleActivity(lifecycleKey('subagent', env), cfg, {
        activityId: opened.activityId,
        activityType,
        startTime,
      });
    }
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
  const pending = takeLifecycleActivity(lifecycleKey('subagent', env), cfg);
  const verdict = await session.activity(
    EVENT.COMPLETE,
    pending?.activityType ?? subAgentActivityType(env),
    {
      activityId: pending?.activityId,
      startTime: pending?.startTime,
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
    },
  );
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}

export async function handleTaskCreated(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const startTime = Date.now();
  const opened = await session.openActivity(ACTIVITY_TYPES.TASK, {
    input: subagentInput(
      [stampSource(buildTaskCreatedPayload(env), 'claude-code')],
      env,
    ),
    startTime,
  });
  const verdict = opened.verdict;
  if (
    verdict.arm === 'allow' ||
    verdict.arm === 'constrain' ||
    verdict.arm === 'require_approval'
  ) {
    rememberLifecycleActivity(lifecycleKey('task', env), cfg, {
      activityId: opened.activityId,
      activityType: ACTIVITY_TYPES.TASK,
      startTime,
    });
  }
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}

export async function handleTaskCompleted(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const pending = takeLifecycleActivity(lifecycleKey('task', env), cfg);
  const verdict = await session.activity(
    EVENT.COMPLETE,
    pending?.activityType ?? ACTIVITY_TYPES.TASK,
    {
      activityId: pending?.activityId,
      startTime: pending?.startTime,
      input: subagentInput(
        [stampSource(buildTaskCompletedPayload(env), 'claude-code')],
        env,
      ),
    },
  );
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}

export async function handleTeammateIdle(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const pending = takeLifecycleActivity(lifecycleKey('task', env), cfg);
  const verdict = await session.activity(
    EVENT.COMPLETE,
    pending?.activityType ?? ACTIVITY_TYPES.TASK,
    {
      activityId: pending?.activityId,
      startTime: pending?.startTime,
      input: subagentInput(
        [stampSource(buildTeammateIdlePayload(env), 'claude-code')],
        env,
      ),
    },
  );
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}
