import type {
  CursorSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { CursorEnvelope } from '../../../core-client/generated/runtime/cursor.js';
import {
  PRE_TOOL_USE_ROUTING,
  PRE_TOOL_USE_VARIANTS,
  applyActivityVariant,
  buildPreToolUsePayload,
} from '../../../core-client/generated/runtime/cursor.js';
import type { CursorConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { EVENT } from '../activity-types.js';
import {
  isInsideAnyRoot,
  shouldRedactPathContent,
} from '../../../governance/skip-patterns.js';
import { sideEffects } from '../side-effects.js';
import { buildSpan, type SpanType } from '../../../governance/spans.js';
import {
  buildActionKey,
  claimAction,
  awaitClaimDecision,
  publishClaimDecision,
} from '../dedup.js';
import { stampSource } from '../../../approvals/source.js';

/**
 * preToolUse: Cursor 3.x's primary agent-action hook. Activity routing,
 * payload shape, AND the Shell→file_delete predicate reroute all come
 * from spec (@activityRouting + @payloadShape + @activityVariant on
 * adapters.tsp).
 *
 * Coordination with the specialized before* hook for the same tool:
 * whichever subprocess wins the filesystem claim runs the gate; the
 * other waits for the winner to publish its verdict, then mirrors
 * it. See cursor/dedup.ts for why dedup-skip would be incorrect
 * (subagent first-call timing).
 */
export async function handlePreToolUse(
  env: CursorEnvelope,
  session: CursorSession,
  cfg: CursorConfig,
): Promise<WorkflowVerdict | undefined> {
  const toolName = env.tool_name ?? '';
  const baseActivity = PRE_TOOL_USE_ROUTING[toolName];
  if (!baseActivity) return undefined;

  const toolInput = (env.tool_input ?? {}) as Record<string, unknown>;
  const filePath = (toolInput.file_path ?? toolInput.filePath ?? '') as string;
  const command = (toolInput.command ?? '') as string;
  // For file-touching tools (Read/Write), in-workspace operations are
  // routine. Skip evaluate so the user's file_read / file_write rules
  // fire only on out-of-project paths. Metadata and secret-like paths
  // are governed even when they live inside the project.
  if (
    filePath &&
    (toolName === 'Read' || toolName === 'Write') &&
    isInsideAnyRoot(filePath, env.workspace_roots, env.cwd) &&
    !shouldRedactPathContent(filePath)
  ) {
    return undefined;
  }

  // Coordinate with the specialized before* hook for this tool.
  // Key must match the one that mapper uses.
  const claimKind =
    toolName === 'Shell' ? 'shell' :
    toolName === 'Read' ? 'read' :
    toolName === 'Write' ? 'write' : null;
  const claim = claimKind
    ? claimAction(buildActionKey({
        generation_id: env.generation_id,
        conversation_id: env.conversation_id,
        kind: claimKind,
        arg: claimKind === 'shell' ? command : filePath,
      }))
    : null;
  if (claim && !claim.won) {
    const decision = await awaitClaimDecision(claim, cfg.hitlMaxWait * 1000);
    if (!decision) {
      return {
        arm: 'block',
        reason: '[OpenBox] no governance decision was published for duplicate Cursor tool hook',
        riskScore: 1,
      };
    }
    if (decision.arm === 'allow' || decision.arm === 'constrain') return undefined;
    if (decision.arm === 'halt') markHalted(env.conversation_id, cfg);
    return { arm: decision.arm, reason: decision.reason, riskScore: 0 };
  }

  const payload = buildPreToolUsePayload(env, toolName, sideEffects);
  const override = applyActivityVariant(PRE_TOOL_USE_VARIANTS, toolName, env);
  const activityType = override?.activityType ?? baseActivity;
  if (override?.eventCategory) payload.event_category = override.eventCategory;

  // Spans are what the backend classifier reads to assign behavior triggers
  // (file_read / file_write / file_delete / internal). Tool name decides
  // which span shape we emit; the @activityVariant override (rm/unlink
  // patterns on Shell) reroutes to file_delete.
  const spanType: SpanType =
    override?.activityType === 'FileDelete'
      ? 'file_delete'
      : toolName === 'Read'
        ? 'file_read'
        : toolName === 'Write'
          ? 'file_write'
          : 'shell';
  const span = buildSpan('cursor', spanType, {
    file_path: filePath || undefined,
    command: (toolInput.command as string) || undefined,
    cwd: (toolInput.cwd as string) || (env.cwd as string) || undefined,
  });

  try {
    const verdict = await session.activity(EVENT.START, activityType, {
      input: [stampSource(payload, 'cursor')],
      spans: [span],
    });
    if (claim?.won) {
      publishClaimDecision(claim, { arm: verdict.arm, reason: verdict.reason ?? '' });
    }
    if (verdict.arm === 'halt') markHalted(env.conversation_id, cfg);
    return verdict;
  } catch (err) {
    if (claim?.won) {
      publishClaimDecision(claim, { arm: 'block', reason: '[OpenBox] gate failed' });
    }
    throw err;
  }
}
