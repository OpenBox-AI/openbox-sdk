import type {
  CursorSession,
} from '../../../core-client/index.js';
import type { CursorHookEnvelope } from '../../cursor-hooks.js';
import type { CursorHooksConfig } from '../config.js';
import { clearSession } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';

/**
 * Cursor's `after*` events are observe-only - they fire telemetry into
 * OpenBox without gating Cursor's behavior. The runtime adapter's
 * `cursor-observe` verdict shape returns `{}` for them; these handlers
 * just emit the underlying activity (best-effort, swallow errors).
 */

async function fireSafe(
  fn: () => Promise<unknown>,
): Promise<undefined> {
  try {
    await fn();
  } catch {
    /* observe-only; never block on failures */
  }
  return undefined;
}

export function handleAfterAgentResponse(
  env: CursorHookEnvelope,
  session: CursorSession,
  _cfg: CursorHooksConfig,
): Promise<undefined> {
  const responseText = env.response ?? '';
  return fireSafe(() =>
    session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.COMPLETION, {
      input: [{
        response: responseText,
        generation_id: env.generation_id,
        event_category: 'llm_completion',
      }],
    }),
  );
}

export function handleAfterAgentThought(
  env: CursorHookEnvelope,
  session: CursorSession,
  _cfg: CursorHooksConfig,
): Promise<undefined> {
  const thought = env.thought ?? '';
  return fireSafe(() =>
    session.activity(EVENT.SIGNAL, ACTIVITY_TYPES.AGENT_DECISION, {
      input: [{
        thought,
        generation_id: env.generation_id,
        event_category: 'agent_decision',
      }],
    }),
  );
}

export function handleAfterShellExecution(
  env: CursorHookEnvelope,
  session: CursorSession,
  _cfg: CursorHooksConfig,
): Promise<undefined> {
  return fireSafe(() =>
    session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.AGENT_OBSERVATION, {
      input: [{
        command: env.command,
        generation_id: env.generation_id,
        event_category: 'agent_observation',
      }],
    }),
  );
}

export function handleAfterFileEdit(
  env: CursorHookEnvelope,
  session: CursorSession,
  _cfg: CursorHooksConfig,
): Promise<undefined> {
  return fireSafe(() =>
    session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.FILE_WRITE, {
      input: [{
        file_path: env.file_path,
        generation_id: env.generation_id,
        event_category: 'file_write',
      }],
    }),
  );
}

export async function handleSessionStart(
  env: CursorHookEnvelope,
  session: CursorSession,
  _cfg: CursorHooksConfig,
): Promise<undefined> {
  try {
    await session.workflowStarted();
    await session.activity(EVENT.START, ACTIVITY_TYPES.WORKFLOW_START, {
      input: [{ status: 'started', event_category: 'workflow_start' }],
    });
  } catch {
    /* best-effort */
  }
  return undefined;
}

/**
 * `stop` fires when Cursor is about to wind down. We close the workflow
 * envelope, then clear the session-store entry. Observe-only - no
 * decision returned (verdictShape: "none").
 */
export async function handleStop(
  env: CursorHookEnvelope,
  session: CursorSession,
  cfg: CursorHooksConfig,
): Promise<undefined> {
  try {
    await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.WORKFLOW_COMPLETE, {
      input: [{ status: 'completed', event_category: 'workflow_complete' }],
    });
    await session.workflowCompleted();
  } catch {
    /* best-effort */
  }
  clearSession(env.conversation_id, cfg);
  return undefined;
}
