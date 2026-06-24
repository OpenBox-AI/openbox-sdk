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
import { withOpenBoxActivityMetadata } from '../../../governance/spans.js';
import { buildCursorSpan } from './spans.js';
import {
  isInsideAnyRoot,
  shouldRedactPathContent,
} from '../../../governance/skip-patterns.js';
import {
  buildActionKey,
  claimAction,
  awaitClaimDecision,
  publishClaimDecision,
  rememberCompletionActivity,
  verdictUsesGovernanceFallback,
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
  // In-project reads are routine agent activity (source files,
  // package.json, configs). Skip evaluate so the user's `file_read`
  // approval rule fires only for reads outside the project. Metadata
  // and secret-like paths are still governed by path/span data.
  if (
    isInsideAnyRoot(filePath, env.workspace_roots, env.cwd) &&
    !shouldRedactPathContent(filePath)
  ) {
    return undefined;
  }

  const key = buildActionKey({
    generation_id: env.generation_id,
    conversation_id: env.conversation_id,
    kind: 'read',
    arg: filePath,
  });
  const claim = claimAction(key);
  if (!claim.won) {
    const decision = await awaitClaimDecision(claim, cfg.hitlMaxWait * 1000);
    if (!decision) {
      return {
        arm: 'block',
        reason: '[OpenBox] no governance decision was published for duplicate Cursor file-read hook',
        riskScore: 1,
      };
    }
    if (
      decision.fallbackUsed &&
      decision.arm !== 'block' &&
      decision.arm !== 'halt'
    ) {
      return {
        arm: 'block',
        reason: '[OpenBox] OpenBox governance fallback used while processing Cursor file-read hook',
        riskScore: 1,
      };
    }
    if (decision.arm === 'allow' || decision.arm === 'constrain') return undefined;
    if (decision.arm === 'halt') markHalted(env.conversation_id, cfg);
    return { arm: decision.arm, reason: decision.reason, riskScore: 0 };
  }

  const payload = buildBeforeReadFilePayload(env);
  const span = buildCursorSpan('file_read', {
    file_path: filePath,
    tool_name: 'Read',
  });
  try {
    const startTime = Date.now();
    const opened = await session.openActivity(BEFORE_READ_FILE_ACTIVITY_TYPE, {
      input: withOpenBoxActivityMetadata(
        [stampSource(payload, 'cursor')],
        { toolType: 'file_read' },
      ),
      startTime,
      spans: [span],
    });
    const verdict = opened.verdict;
    if (
      verdict.arm === 'allow' ||
      verdict.arm === 'constrain' ||
      verdict.arm === 'require_approval'
    ) {
      rememberCompletionActivity(
        {
          generation_id: env.generation_id,
          conversation_id: env.conversation_id,
          kind: 'read',
          arg: filePath,
        },
        cfg,
        {
          activityId: opened.activityId,
          activityType: BEFORE_READ_FILE_ACTIVITY_TYPE,
          startTime,
        },
      );
    }
    publishClaimDecision(claim, {
      arm: verdict.arm,
      reason: verdict.reason ?? '',
      fallbackUsed: verdictUsesGovernanceFallback(verdict),
    });
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
 * envelope fields (file_path, content). The activity type remains
 * FileRead because that is Cursor's official event contract, while the
 * span is `file.open` so backend behavior rules can distinguish a tab
 * open from an agent file read.
 *
   * Routine in-project source reads are skipped, but metadata and
   * secret-like in-project paths stay governed.
 */
export async function handleBeforeTabFileRead(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<WorkflowVerdict | undefined> {
  const filePath = env.file_path ?? '';
  if (!filePath) return undefined;
  if (
    isInsideAnyRoot(filePath, env.workspace_roots, env.cwd) &&
    !shouldRedactPathContent(filePath)
  ) {
    return undefined;
  }

  const payload = buildBeforeTabFileReadPayload(env);
  const span = buildCursorSpan('file_open', {
    file_path: filePath,
    tool_name: 'TabRead',
  });
  const verdict = await session.activity(EVENT.START, BEFORE_TAB_FILE_READ_ACTIVITY_TYPE, {
    input: withOpenBoxActivityMetadata(
      [stampSource(payload, 'cursor')],
      { toolType: 'file_open' },
    ),
    spans: [span],
  });
  if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
  return verdict;
}
