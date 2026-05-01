import type { CursorSession } from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import {
  buildAfterAgentResponsePayload,
  buildAfterAgentThoughtPayload,
  buildAfterShellExecutionPayload,
  buildAfterFileEditPayload,
  buildSessionStartPayload,
  buildStopPayload,
} from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { clearSession } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';

/**
 * Cursor's `after*` events are observe-only; they fire telemetry into
 * OpenBox without gating Cursor's behavior. The `cursor-observe` verdict
 * shape returns `{}`; these handlers just emit the underlying activity.
 */

async function fireSafe(fn: () => Promise<unknown>): Promise<undefined> {
  try {
    await fn();
  } catch {
    /* observe-only; never block on failures */
  }
  return undefined;
}

export function handleAfterAgentResponse(
  env: CursorEnvelope,
  session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return fireSafe(() =>
    session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.COMPLETION, {
      input: [buildAfterAgentResponsePayload(env)],
    }),
  );
}

export function handleAfterAgentThought(
  env: CursorEnvelope,
  session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return fireSafe(() =>
    session.activity(EVENT.SIGNAL, ACTIVITY_TYPES.AGENT_DECISION, {
      input: [buildAfterAgentThoughtPayload(env)],
    }),
  );
}

export function handleAfterShellExecution(
  env: CursorEnvelope,
  session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return fireSafe(() =>
    session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.AGENT_OBSERVATION, {
      input: [buildAfterShellExecutionPayload(env)],
    }),
  );
}

export function handleAfterFileEdit(
  env: CursorEnvelope,
  session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return fireSafe(() =>
    session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.FILE_WRITE, {
      input: [buildAfterFileEditPayload(env)],
    }),
  );
}

export async function handleSessionStart(
  env: CursorEnvelope,
  session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  try {
    await session.workflowStarted();
    await session.activity(EVENT.START, ACTIVITY_TYPES.WORKFLOW_START, {
      input: [buildSessionStartPayload(env)],
    });
  } catch {
    /* best-effort */
  }
  return undefined;
}

/**
 * `stop` fires when Cursor is about to wind down. Close the workflow
 * envelope, then clear the session-store entry. Observe-only; no
 * decision returned (verdictShape: "none").
 */
export async function handleStop(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<undefined> {
  try {
    await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.WORKFLOW_COMPLETE, {
      input: [buildStopPayload(env)],
    });
    await session.workflowCompleted();
  } catch {
    /* best-effort */
  }
  clearSession(env.conversation_id, cfg);
  return undefined;
}
