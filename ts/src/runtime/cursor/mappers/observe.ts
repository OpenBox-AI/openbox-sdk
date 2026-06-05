import type { CursorSession } from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { clearSession } from '../session-resolver.js';

// Cursor's `after*` events are observe-only; they fire AFTER the
// action has happened, and verdictShape "cursor-observe" renders {}
// regardless of any rule outcome. So the mappers are no-ops; we
// don't round-trip to the backend.
//
// Why: a backend evaluate on an after-event hits the same rule
// engine as the before-event, which would match the same span and
// emit a second require_approval row; a phantom the user can never
// resolve (no UI surfaces an after-event approval). Telemetry loss
// is acceptable; phantom approvals are not. If after-event telemetry
// is wanted later, route through a separate observability endpoint
// that doesn't share the rule engine.

export function handleAfterAgentResponse(
  _env: CursorEnvelope,
  _session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return Promise.resolve(undefined);
}

export function handleAfterAgentThought(
  _env: CursorEnvelope,
  _session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return Promise.resolve(undefined);
}

export function handleAfterShellExecution(
  _env: CursorEnvelope,
  _session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return Promise.resolve(undefined);
}

export function handleAfterFileEdit(
  _env: CursorEnvelope,
  _session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return Promise.resolve(undefined);
}

// Lifecycle: still fire workflowStarted / workflowCompleted so the
// SDK's session lifecycle is bookended properly (Temporal workflow
// open/close), but no activity emission alongside.
export async function handleSessionStart(
  _env: CursorEnvelope,
  session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  try {
    await session.workflowStarted();
  } catch {
    /* best-effort */
  }
  return undefined;
}

export async function handleStop(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<undefined> {
  try {
    await session.workflowCompleted();
  } catch {
    /* best-effort */
  }
  clearSession(env.conversation_id, cfg);
  return undefined;
}

// sessionEnd is distinct from `stop` (`stop` is per-turn, sessionEnd
// is per-conversation). Mirror handleStop so either signal closes
// the workflow cleanly.
export async function handleSessionEnd(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<undefined> {
  try {
    await session.workflowCompleted();
  } catch {
    /* best-effort */
  }
  clearSession(env.conversation_id, cfg);
  return undefined;
}

// KNOWN GAP; afterFileEdit (and its tab/MCP siblings) do not fire
// `ActivityCompleted` to the backend. preToolUse(Write) emits
// `ActivityStarted FileEdit`; the matching Completed event for an
// audit trail / dashboard metrics is missing. Adding it here is
// tempting but re-introduces the phantom-approval bug (the backend's
// behavior rule engine re-evaluates on Completed and creates a new
// require_approval row if the rule matches). The clean fix is a
// backend-side "Completed is a finalize, never a gate" signal, which
// is out of scope for the SDK. Documented here so a future change
// doesn't bring back the round-trip without also handling the rule
// engine.

// Observe-only siblings for the tab-driven file ops and pre-compact /
// subagent-stop signals. Same reasoning as the other after* mappers:
// the action either already happened or carries no governance value,
// so skip the backend round-trip.
export function handleAfterTabFileEdit(
  _env: CursorEnvelope,
  _session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return Promise.resolve(undefined);
}

export function handlePreCompact(
  _env: CursorEnvelope,
  _session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return Promise.resolve(undefined);
}

export function handleSubagentStop(
  _env: CursorEnvelope,
  _session: CursorSession,
  _cfg: CursorConfig,
): Promise<undefined> {
  return Promise.resolve(undefined);
}
