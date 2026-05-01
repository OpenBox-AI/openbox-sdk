import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
import {
  buildSessionStartPayload,
  buildSessionEndPayload,
  buildStopPayload,
} from '../../../core-client/generated/runtime/claude-code.js';
import type { ClaudeCodeConfig } from '../config.js';
import { clearSession, markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';

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
    input: [buildSessionStartPayload(env)],
  });
  return undefined; // verdictShape is "none"; no stdout
}

/**
 * Stop is decision-capable: we fire an observe activity and forward
 * any non-allow verdict back as `decision-block` (block/halt → keep
 * Claude going with a reason).
 */
export async function handleStop(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<WorkflowVerdict | undefined> {
  let verdict: WorkflowVerdict;
  try {
    verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.SESSION, {
      input: [buildStopPayload(env)],
    });
  } catch {
    return undefined; // Stop must never block Claude on errors
  }
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return verdict;
}

/**
 * SessionEnd: observe-only. Closes the SESSION activity, completes the
 * workflow, and clears the session-store entry so disk doesn't grow.
 */
export async function handleSessionEnd(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
): Promise<undefined> {
  try {
    await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.SESSION, {
      input: [buildSessionEndPayload(env)],
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
