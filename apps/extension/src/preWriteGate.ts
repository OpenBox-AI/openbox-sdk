// Pre-write gate. Cursor's `afterFileEdit` hook is observe-only; by
// the time it fires, the buffer is already mutated. For Composer
// multi-file edits and inline edits that don't route through the
// agent's `Write` tool (so they bypass `preToolUse`), the only
// remaining surface is VS Code's `workspace.onWillSaveTextDocument`,
// which can asynchronously veto a save.
//
// Two modes:
//
//   1. Reactive (always on): the polling layer feeds in pending halt
//      verdicts via recordDeny()/clearDeny(); on save we check the
//      map and prompt to override.
//
//   2. Active (openbox.preWriteGate.active=true + openbox.agentId):
//      every save calls check_governance(file_write); allow proceeds,
//      require_approval blocks until decided, deny cancels with a
//      notification.
//
// Heads-up: this is a coarse veto. We can't undo the buffer change;
// we can only block the save. Users who really want to commit a
// flagged change can hit "Override"; the audit trail records both
// the verdict and the override.
import * as vscode from 'vscode';
import { GovernanceClient } from './governanceClient';

export interface PendingDeny {
  uri: string;
  reason: string;
  /** Approval ID the user can reference if they want to reroute via OpenBox. */
  approvalId?: string;
  /** When the deny landed; we GC entries older than 1h. */
  at: number;
}

const STALENESS_MS = 60 * 60 * 1000;

export class PreWriteGate {
  private pending = new Map<string, PendingDeny>();
  private subscription?: vscode.Disposable;
  private governance: GovernanceClient;

  constructor(governance?: GovernanceClient) {
    this.governance = governance ?? new GovernanceClient();
  }

  /** Mark `uri` as having a pending deny verdict. Called by the
   *  approvals polling layer when a verdict comes back as halt. */
  recordDeny(deny: PendingDeny): void {
    this.pending.set(deny.uri, deny);
  }

  /** Drop a pending deny (e.g. when a follow-up approval flips it). */
  clearDeny(uri: string): void {
    this.pending.delete(uri);
  }

  attach(context: vscode.ExtensionContext): void {
    this.subscription = vscode.workspace.onWillSaveTextDocument((event) => {
      this.gc();
      event.waitUntil(this.handleSave(event.document));
    });
    context.subscriptions.push(this.subscription);
  }

  dispose(): void {
    this.subscription?.dispose();
    this.subscription = undefined;
    this.pending.clear();
  }

  private async handleSave(doc: vscode.TextDocument): Promise<vscode.TextEdit[]> {
    const uri = doc.uri.toString();

    // Reactive path: pre-existing halt verdict from the polling layer.
    const deny = this.pending.get(uri);
    if (deny) return this.confirm(uri, deny);

    // Active path: every save calls check_governance when
    // openbox.preWriteGate.active=true and an agent ID is set.
    const active = vscode.workspace
      .getConfiguration('openbox')
      .get<boolean>('preWriteGate.active', false);
    if (!active) return [];
    if (!this.governance.agentId()) return [];

    const filePath = doc.uri.scheme === 'file' ? doc.uri.fsPath : doc.uri.toString();
    const raw = await this.governance.check({
      spanType: 'file_write',
      activityInput: { file_path: filePath, content: doc.getText() },
    });
    const result = this.governance.applyFailMode(raw);

    if (result.outcome === 'allow') return [];
    if (result.outcome === 'deny') {
      vscode.window.showErrorMessage(
        `OpenBox blocked save of ${doc.fileName}: ${result.reason ?? 'denied by policy'}`,
      );
      throw new Error('OpenBox: save denied by policy');
    }
    // require_approval: surface the pending approval and block the save.
    return this.confirm(uri, {
      uri,
      reason: result.reason ?? 'Approval required for this save',
      approvalId: result.approvalId,
      at: Date.now(),
    });
  }

  private async confirm(uri: string, deny: PendingDeny): Promise<vscode.TextEdit[]> {
    const choice = await vscode.window.showWarningMessage(
      `OpenBox flagged this file's last edit: ${deny.reason}\n\nSave anyway?`,
      { modal: true },
      'Save anyway',
      'Open in OpenBox',
    );
    if (choice === 'Save anyway') {
      // Clear so a subsequent save isn't re-prompted. The user has
      // accepted the override; OpenBox records that decision separately
      // via its own audit trail.
      this.pending.delete(uri);
      return [];
    }
    if (choice === 'Open in OpenBox' && deny.approvalId) {
      vscode.commands.executeCommand('openbox.openDetail', deny.approvalId);
    }
    // Throwing from a `waitUntil` thenable is the documented way to
    // cancel the save: see vscode.d.ts on TextDocumentWillSaveEvent.
    throw new Error('OpenBox: save cancelled');
  }

  private gc(): void {
    const cutoff = Date.now() - STALENESS_MS;
    for (const [uri, deny] of this.pending) {
      if (deny.at < cutoff) this.pending.delete(uri);
    }
  }
}

/**
 * Pull the target document URI out of an approval's `input` payload,
 * if any. The backend's `Approval.input` is freeform per action type;
 * for file-touching actions (FileEdit, Write, MultiEdit) the path
 * lives at `input[0].file_path` (canonical), with `filePath` and
 * `path` accepted as fallbacks for older/alternate adapters. Returns
 * the path coerced to a `file://` URI string so it matches what
 * `vscode.Uri.toString()` produces on open editors.
 *
 * Returns undefined when the input has no recognizable file path; the
 * caller should treat that as "no gating possible for this approval".
 */
export function extractTargetUri(input: unknown): string | undefined {
  if (!input) return undefined;
  // Approvals carry `input` as either an array (the wire-side norm,
  // matching the SDK's activity adapters) or a bare object (legacy).
  // Normalize to the first record either way.
  const first =
    Array.isArray(input) && input.length > 0
      ? (input[0] as Record<string, unknown>)
      : (input as Record<string, unknown>);
  if (!first || typeof first !== 'object') return undefined;
  const raw = (first.file_path ?? first.filePath ?? first.path) as unknown;
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  // Already a URI? Pass through. Otherwise coerce a filesystem path
  // to file:// so it lines up with `vscode.Uri.file(p).toString()`.
  if (raw.startsWith('file://') || raw.includes('://')) return raw;
  // Encode each segment so spaces/unicode round-trip safely; matches
  // `vscode.Uri.file(p).toString()` output for ASCII paths and is at
  // worst slightly more aggressive on non-ASCII (still parses).
  const segments = raw.split('/').map((s) => (s ? encodeURIComponent(s) : s));
  const joined = segments.join('/');
  // Absolute (POSIX) paths start with '/'; preserve that as the
  // host-less form `file:///abs`. Relative paths get the same
  // triple-slash anchor; matching them against open editor tabs
  // depends on workspace resolution which is the caller's job, but we
  // still emit a parseable URI rather than a bare path.
  return raw.startsWith('/') ? `file://${joined}` : `file:///${joined}`;
}
