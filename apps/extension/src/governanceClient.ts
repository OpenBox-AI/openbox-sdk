// Extension-side wrapper around openbox-sdk/governance. Reads the
// agent ID from workspace config, applies the network deadline, and
// folds the verdict into a tri-state outcome:
//   "allow"            → proceed
//   "require_approval" → block until the approval is decided externally
//   "deny"             → cancel the action with a reason
//
// Network errors / timeouts return `unknown`; the caller decides
// whether `unknown` should fail open or closed (controlled by the
// openbox.failClosed setting).

import * as vscode from 'vscode';
import { checkGovernance, type SpanType } from 'openbox-sdk/governance';
import type { EnvName } from 'openbox-sdk/env';

export type GovernanceOutcome = 'allow' | 'require_approval' | 'deny' | 'unknown';

export interface GovernanceResult {
  outcome: GovernanceOutcome;
  reason?: string;
  approvalId?: string;
  /** Set when outcome === 'unknown' so callers can log/debug. */
  error?: string;
}

const DEFAULT_DEADLINE_MS = 4_000;

// Backend verdict numerics:
//   0 = Allow
//   1 = ScoreLowered (allow but trust impacted)
//   2 = RequireApproval
//   3 = Block (alias for Deny on some surfaces)
//   4 = Halt (deny + cancel chain)
function verdictToOutcome(v: number | undefined): GovernanceOutcome {
  if (v === 0 || v === 1 || v === undefined) return 'allow';
  if (v === 2) return 'require_approval';
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

  envName(): EnvName {
    const v = vscode.workspace.getConfiguration('openbox').get<string>('environment', 'production');
    return v === 'staging' || v === 'local' ? v : 'production';
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
          envName: this.envName(),
        }),
        new Promise<never>((_, rej) =>
          aborter.signal.addEventListener('abort', () => rej(new Error('governance deadline exceeded'))),
        ),
      ]);
      // GovernanceVerdictResponse fields: verdict (number), reason?, approval_id?
      const r = result as { verdict?: number; reason?: string; approval_id?: string };
      return {
        outcome: verdictToOutcome(r.verdict),
        reason: r.reason,
        approvalId: r.approval_id,
      };
    } catch (err: any) {
      return { outcome: 'unknown', error: String(err?.message ?? err) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Apply fail-open vs fail-closed per workspace config. Returns the
   *  effective outcome treating `unknown` as either `allow` or `deny`. */
  applyFailMode(result: GovernanceResult): GovernanceResult {
    if (result.outcome !== 'unknown') return result;
    const failClosed = vscode.workspace
      .getConfiguration('openbox')
      .get<boolean>('failClosed', false);
    return {
      ...result,
      outcome: failClosed ? 'deny' : 'allow',
      reason: result.reason ?? `Governance check failed: ${result.error ?? 'unknown error'}`,
    };
  }
}
