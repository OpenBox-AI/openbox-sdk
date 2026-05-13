import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import {
  buildBeforeShellExecutionPayload,
  BEFORE_SHELL_EXECUTION_ACTIVITY_TYPE,
} from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { EVENT } from '../activity-types.js';
import { buildSpan } from '../../../governance/spans.js';
import {
  buildActionKey,
  claimAction,
  awaitClaimDecision,
  publishClaimDecision,
  isFileDeleteCommand,
} from '../dedup.js';
import { stampSource } from '../../../approvals/source.js';

/**
 * beforeShellExecution: govern shell command before Cursor runs it.
 *
 * Cursor fires `preToolUse` AND `beforeShellExecution` for the same
 * shell tool invocation. Whichever subprocess wins the filesystem
 * claim runs the gate; the loser waits for the winner's decision and
 * mirrors it. This stops Cursor from proceeding on a fast "allow"
 * from one event while the other is still showing the user a toast
 *; see cursor/dedup.ts for the rationale.
 *
 * FileDelete reroute (mirrors preToolUse's @activityVariant): when
 * the command starts with rm/unlink/rmdir/shred, classify the
 * activity as FileDelete instead of ShellExecution so behavior rules
 * targeting deletion fire. Duplicated here so subagent first-call
 * (where only beforeShellExecution fires) still classifies right.
 */
export async function handleBeforeShellExecution(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<WorkflowVerdict | undefined> {
  const command = env.command ?? '';
  if (!command) return undefined;

  const key = buildActionKey({
    generation_id: env.generation_id,
    conversation_id: env.conversation_id,
    kind: 'shell',
    arg: command,
  });
  const claim = claimAction(key);
  if (!claim.won) {
    const decision = await awaitClaimDecision(claim, cfg.hitlMaxWait * 1000);
    if (!decision) return undefined; // timeout; fail open
    if (decision.arm === 'allow' || decision.arm === 'constrain') return undefined;
    if (decision.arm === 'halt') markHalted(env.conversation_id, cfg);
    return { arm: decision.arm, reason: decision.reason };
  }

  const payload = buildBeforeShellExecutionPayload(env);
  const isDelete = isFileDeleteCommand(command);
  const activityType = isDelete ? 'FileDelete' : BEFORE_SHELL_EXECUTION_ACTIVITY_TYPE;
  const span = buildSpan('cursor', isDelete ? 'file_delete' : 'shell', {
    command,
    cwd: env.cwd,
  });
  if (isDelete) payload.event_category = 'file_delete';
  try {
    const verdict = await session.activity(EVENT.START, activityType, {
      input: [stampSource(payload, 'cursor')],
      spans: [span],
    });
    publishClaimDecision(claim, { arm: verdict.arm, reason: verdict.reason ?? '' });
    if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
    return verdict;
  } catch (err) {
    // Publish a synthetic deny so the loser doesn't hang waiting on
    // a winner that's about to crash with no verdict.
    publishClaimDecision(claim, { arm: 'block', reason: '[OpenBox] gate failed' });
    throw err;
  }
}
