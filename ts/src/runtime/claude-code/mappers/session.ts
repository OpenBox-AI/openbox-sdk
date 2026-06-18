import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
import {
  buildPostCompactPayload,
  buildPreCompactPayload,
  buildSessionStartPayload,
  buildSessionEndPayload,
  buildSetupPayload,
  buildStopPayload,
  buildStopFailurePayload,
} from '../../../core-client/generated/runtime/claude-code.js';
import type { ClaudeCodeConfig } from '../config.js';
import {
  clearSession,
  lastResolveCreatedFreshSession,
  markHalted,
} from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';
import { stampSource } from '../../../approvals/source.js';
import {
  buildClaudeAssistantOutputSpan,
  claudeAssistantTelemetryFields,
} from './assistant-output.js';
import { readLatestAssistantUsage } from '../transcript-usage.js';

function hasPendingClaudeWork(env: ClaudeCodeEnvelope): boolean {
  return (
    (Array.isArray(env.background_tasks) && env.background_tasks.length > 0) ||
    (Array.isArray(env.session_crons) && env.session_crons.length > 0)
  );
}

function isStopHookRetry(env: ClaudeCodeEnvelope): boolean {
  return (env as unknown as { stop_hook_active?: unknown }).stop_hook_active === true;
}

function failClosedStopVerdict(
  env: ClaudeCodeEnvelope,
  _cfg: ClaudeCodeConfig,
  reason: string,
): WorkflowVerdict | undefined {
  if (isStopHookRetry(env)) {
    return undefined;
  }
  return {
    arm: 'block',
    reason,
    riskScore: 1,
  };
}

async function emitClaudeUsageSignal(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
): Promise<void> {
  const usage = readLatestAssistantUsage(env);
  if (!usage?.usage) return;
  try {
    const usagePayload = stampSource({
      event_category: 'llm_usage',
      model: usage.model,
      usage: usage.usage,
    }, 'claude-code');
    await session.activity(EVENT.SIGNAL, 'claude_usage', {
      input: [usagePayload],
      signalName: 'claude_usage',
      signalArgs: [usagePayload],
    });
  } catch {
    // best-effort usage side channel; the Stop gate verdict is authoritative.
  }
}

/**
 * SessionStart: opens the workflow envelope + records the session boundary.
 *
 * The runtime adapter uses govern.attach(), which DOESN'T auto-fire
 * WorkflowStarted. We fire it explicitly here on the first hook of a
 * session. Subsequent hooks find `opened === true` and the call is a no-op.
 */
export async function handleSessionStart(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  _cfg: ClaudeCodeConfig,
): Promise<undefined> {
  await session.workflowStarted();
  await session.activity(EVENT.START, ACTIVITY_TYPES.SESSION, {
    input: [stampSource(buildSessionStartPayload(env), 'claude-code')],
  });
  return undefined; // verdictShape is "none"; no stdout
}

/**
 * Stop is decision-capable: we fire the final assistant-output activity and
 * forward any non-allow verdict back as `decision-block` (block/halt → keep
 * Claude going with a reason).
 */
export async function handleStop(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  let verdict: WorkflowVerdict;
  try {
    verdict = await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.SESSION, {
      input: [stampSource(buildStopPayload(env), 'claude-code')],
      ...claudeAssistantTelemetryFields(env, {
        fallbackText: env.last_assistant_message,
      }),
      spans: buildClaudeAssistantOutputSpan(env, {
        event: 'Stop',
        fallbackText: env.last_assistant_message,
      }),
    });
  } catch {
    return failClosedStopVerdict(
      env,
      cfg,
      'OpenBox Core was unavailable while governing Claude Code stop',
    );
  }
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  await emitClaudeUsageSignal(env, session);
  if (
    (verdict.arm === 'allow' || verdict.arm === 'constrain') &&
    !hasPendingClaudeWork(env)
  ) {
    try {
      await session.workflowCompleted();
    } catch {
      const failClosed = failClosedStopVerdict(
        env,
        cfg,
        'OpenBox Core was unavailable while completing Claude Code workflow',
      );
      if (failClosed) return failClosed;
    }
    clearSession(env.session_id, cfg);
  }
  return verdict;
}

export async function handleSetup(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  _cfg: ClaudeCodeConfig,
): Promise<undefined> {
  try {
    await session.activity(EVENT.START, ACTIVITY_TYPES.SESSION, {
      input: [stampSource(buildSetupPayload(env), 'claude-code')],
    });
  } catch {
    // best-effort
  }
  return undefined;
}

export async function handlePreCompact(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.SESSION, {
    input: [stampSource(buildPreCompactPayload(env), 'claude-code')],
  });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}

export async function handlePostCompact(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  _cfg: ClaudeCodeConfig,
): Promise<undefined> {
  try {
    await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.SESSION, {
      input: [stampSource(buildPostCompactPayload(env), 'claude-code')],
    });
  } catch {
    // best-effort
  }
  return undefined;
}

export async function handleStopFailure(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<undefined> {
  try {
    await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.SESSION, {
      input: [stampSource(buildStopFailurePayload(env), 'claude-code')],
    });
  } catch {
    // best-effort
  }
  try {
    await session.workflowFailed(
      new Error(String(env.error ?? env.reason ?? 'Claude Code StopFailure')),
    );
  } catch {
    // best-effort terminal telemetry; StopFailure cannot safely block Claude Code.
  } finally {
    clearSession(env.session_id, cfg);
  }
  return undefined;
}

/**
 * SessionEnd: observe-only. Closes the SESSION activity, completes the
 * workflow, and clears the session-store entry so disk doesn't grow.
 *
 * Phantom-session short-circuit: if no prior on-disk record existed
 * before this hook (e.g. `claude update` fired SessionEnd without any
 * preceding SessionStart / tool hook), there's nothing to observe and
 * the parent process is already exiting; making HTTP calls just gets
 * us cancelled mid-flight ("Hook cancelled" in the user's terminal).
 * Skip cleanly.
 */
export async function handleSessionEnd(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<undefined> {
  if (lastResolveCreatedFreshSession()) {
    clearSession(env.session_id, cfg);
    return undefined;
  }
  try {
    await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.SESSION, {
      input: [stampSource(buildSessionEndPayload(env), 'claude-code')],
    });
  } catch {
    // best-effort
  }
  try {
    await session.workflowCompleted();
  } catch {
    // best-effort
  }
  clearSession(env.session_id, cfg);
  return undefined;
}
