import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import {
  buildBeforeReadFilePayload,
  BEFORE_READ_FILE_ACTIVITY_TYPE,
  buildBeforeTabFileReadPayload,
  BEFORE_TAB_FILE_READ_ACTIVITY_TYPE,
} from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { EVENT } from '../activity-types.js';
import { buildSpan } from '../../../governance/spans.js';
import { isInsideAnyRoot, isSensitivePath, isSkipped } from '../../../governance/skip-patterns.js';
import {
  buildActionKey,
  claimAction,
  awaitClaimDecision,
  publishClaimDecision,
} from '../dedup.js';
import { stampSource } from '../../../approvals/source.js';

/**
 * beforeReadFile: govern an agent-initiated file read before Cursor
 * delivers the content. Coordinates with preToolUse(Read) via the
 * shared filesystem claim; whichever subprocess wins runs the gate;
 * the loser waits for and mirrors the winner's decision. See
 * cursor/dedup.ts for why we wait instead of skipping.
 */
export async function handleBeforeReadFile(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<WorkflowVerdict | undefined> {
  const filePath = env.file_path ?? '';
  if (!filePath) return undefined;
  if (isSkipped(filePath)) return undefined;
  // In-workspace reads are routine agent activity (source files,
  // package.json, configs). Skip evaluate so the user's `file_read`
  // approval rule fires only for reads OUTSIDE the project; the
  // actual security boundary the user cares about.
  if (isInsideAnyRoot(filePath, env.workspace_roots, env.cwd)) return undefined;

  const key = buildActionKey({
    generation_id: env.generation_id,
    conversation_id: env.conversation_id,
    kind: 'read',
    arg: filePath,
  });
  const claim = claimAction(key);
  if (!claim.won) {
    const decision = await awaitClaimDecision(claim, cfg.hitlMaxWait * 1000);
    if (!decision) return undefined;
    if (decision.arm === 'allow' || decision.arm === 'constrain') return undefined;
    if (decision.arm === 'halt') markHalted(env.conversation_id, cfg);
    return { arm: decision.arm, reason: decision.reason, riskScore: 0 };
  }

  const payload = buildBeforeReadFilePayload(env);
  const span = buildSpan('cursor', 'file_read', { file_path: filePath });
  try {
    const verdict = await session.activity(
      EVENT.START,
      BEFORE_READ_FILE_ACTIVITY_TYPE,
      { input: [stampSource(payload, 'cursor')], spans: [span] },
    );
    publishClaimDecision(claim, { arm: verdict.arm, reason: verdict.reason ?? '' });
    if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
    return verdict;
  } catch (err) {
    publishClaimDecision(claim, { arm: 'block', reason: '[OpenBox] gate failed' });
    throw err;
  }
}

/**
 * beforeTabFileRead: same gate as beforeReadFile but triggered by the
 * user opening a tab (not by an agent tool call). Cursor's validator
 * for this event accepts only allow/deny (no ask), and uses the same
 * envelope fields (file_path, content). We reuse the file_read span
 * + activity type so behavior rules written against agent file_reads
 * also catch tab-driven reads of sensitive paths.
 *
 * Routine in-workspace source reads are skipped, but sensitive
 * in-workspace paths stay governed because tab-opening `.env`,
 * token, credential, or key material is materially different from
 * opening package/source files.
 */
export async function handleBeforeTabFileRead(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<WorkflowVerdict | undefined> {
  const filePath = env.file_path ?? '';
  if (!filePath) return undefined;
  if (isSkipped(filePath)) return undefined;
  if (isInsideAnyRoot(filePath, env.workspace_roots, env.cwd) && !isSensitivePath(filePath)) {
    return undefined;
  }

  const payload = buildBeforeTabFileReadPayload(env);
  const span = buildSpan('cursor', 'file_read', { file_path: filePath });
  const verdict = await session.activity(
    EVENT.START,
    BEFORE_TAB_FILE_READ_ACTIVITY_TYPE,
    { input: [stampSource(payload, 'cursor')], spans: [span] },
  );
  if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
  return verdict;
}
