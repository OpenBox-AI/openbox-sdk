// Pre-write gate. Cursor's `afterFileEdit` hook is observe-only; by
// the time it fires, the buffer is already mutated. For Composer
// multi-file edits and inline edits that don't route through the
// agent's `Write` tool (so they bypass `preToolUse`), the only
// remaining surface is VS Code's `workspace.onWillSaveTextDocument`,
// which can asynchronously veto a save.
//
// The gate keeps a small in-memory map of files with pending halt
// verdicts (populated by the polling layer when an approval comes
// back as denied). On save, it consults the map and either lets the
// save proceed or shows a modal asking the user whether to override.
//
// Heads-up: this is a coarse veto. We can't undo the buffer change;
// we can only block the save. Users who really want to commit a
// flagged change can hit "Override"; the audit trail records both
// the verdict and the override.
import * as vscode from 'vscode';

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
      const uri = event.document.uri.toString();
      const deny = this.pending.get(uri);
      if (!deny) return;
      // Returning a thenable from the event handler blocks the save
      // until the promise resolves; rejecting cancels the save.
      event.waitUntil(this.confirm(uri, deny));
    });
    context.subscriptions.push(this.subscription);
  }

  dispose(): void {
    this.subscription?.dispose();
    this.subscription = undefined;
    this.pending.clear();
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
