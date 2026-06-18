// Extension-side wrapper around @openbox-ai/openbox-sdk/governance. Reads the
// agent ID from workspace config, applies the network deadline, and
// folds the verdict into a tri-state outcome:
//   "allow"            → proceed
//   "require_approval" → block until the approval is decided externally
//   "deny"             → cancel the action with a reason
//
// Network errors / timeouts return `unknown`; active gates fold unknown to
// deny so unavailable governance fails closed.

import * as vscode from 'vscode';
import { checkGovernance, type SpanType } from '@openbox-ai/openbox-sdk/governance';

export type GovernanceOutcome = 'allow' | 'require_approval' | 'deny' | 'unknown';

export interface GovernanceResult {
  outcome: GovernanceOutcome;
  reason?: string;
  approvalId?: string;
  /** Set when outcome === 'unknown' so callers can log/debug. */
  error?: string;
}

const DEFAULT_DEADLINE_MS = 4_000;

// Verdicts from core's evaluate endpoint come back in two shapes
// depending on the path that produced them:
//
//   Numeric (the spec's BehaviorVerdict enum, used by the backend's
//   approval rows + the extension's polling layer):
//     0 = Allow
//     1 = ScoreLowered (allow but trust impacted)
//     2 = RequireApproval
//     3 = Block (alias for Deny)
//     4 = Halt (deny + cancel chain)
//
//   String (the live response shape from /api/v1/governance/evaluate):
//     "allow", "require_approval", "block", "halt", "deny"
//
// Both paths reach this function, so it handles either by unifying
// to the tri-state outcome the gates consume.
function verdictToOutcome(v: number | string | undefined): GovernanceOutcome {
  if (v === undefined || v === null) return 'allow';
  if (typeof v === 'number') {
    if (v === 0 || v === 1) return 'allow';
    if (v === 2) return 'require_approval';
    return 'deny';
  }
  const s = String(v).toLowerCase();
  if (s === 'allow' || s === 'allow_with_score_lowered' || s === 'score_lowered') return 'allow';
  if (s === 'require_approval' || s === 'requires_approval') return 'require_approval';
  // 'block', 'deny', 'halt', anything else → deny
  return 'deny';
}

export interface CheckOpts {
  spanType: SpanType;
  activityInput: Record<string, unknown>;
  deadlineMs?: number;
}

export class GovernanceClient {
  /** Returns the configured agent ID, or undefined when the user
   *  hasn't set one (active gates should no-op). */
  agentId(): string | undefined {
    const id = vscode.workspace.getConfiguration('openbox').get<string>('agentId', '').trim();
    return id || undefined;
  }

  async check(opts: CheckOpts): Promise<GovernanceResult> {
    const agentId = this.agentId();
    if (!agentId) return { outcome: 'allow' }; // no agent → no governance, treat as allow

    const deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;
    const aborter = new AbortController();
    const timer = setTimeout(() => aborter.abort(), deadlineMs);
    try {
      const result = await Promise.race([
        checkGovernance({
          agentId,
          spanType: opts.spanType,
          activityInput: opts.activityInput,
        }),
        new Promise<never>((_, rej) =>
          aborter.signal.addEventListener('abort', () => rej(new Error('governance deadline exceeded'))),
        ),
      ]);
      // GovernanceVerdictResponse: verdict can be number (spec) or
      // string (live core response). reason / approval_id sit at the
      // top level either way.
      const r = result as {
        verdict?: number | string;
        action?: number | string;
        reason?: string;
        approval_id?: string;
      };
      return {
        outcome: verdictToOutcome(r.verdict ?? r.action),
        reason: r.reason,
        approvalId: r.approval_id,
      };
    } catch (err: any) {
      return { outcome: 'unknown', error: String(err?.message ?? err) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Return the effective outcome, treating `unknown` as `deny`. */
  applyFailMode(result: GovernanceResult): GovernanceResult {
    if (result.outcome !== 'unknown') return result;
    return {
      ...result,
      outcome: 'deny',
      reason: result.reason ?? `Governance check failed: ${result.error ?? 'unknown error'}`,
    };
  }
}
