// File-operation gate for create / delete / rename. Each VS Code
// onWill*Files event accepts a `waitUntil(thenable)` that can throw
// to cancel the op - same shape as the save gate.
//
// We call check_governance once per file in the op, treating any
// non-allow verdict as cancel. The gate is opt-in via
// openbox.fileOpGate.enabled and requires openbox.agentId.
//
// Span mapping:
//   create → file_write (with event_category=file_create)
//   delete → file_write (with event_category=file_delete)
//   rename → file_write (with event_category=file_rename, both paths)
//
// Why file_write for all three: core's adapter spec puts file deletes
// under the file_write bucket too (see `@activityVariant("Shell",
// {... activityType: "file_write", eventCategory: "file_delete"})` in
// adapters.tsp), so the policies that gate writes also gate ops.

import * as vscode from 'vscode';
import { GovernanceClient } from './governanceClient';

export class PreFileOpGate {
  private subs: vscode.Disposable[] = [];
  private governance: GovernanceClient;

  constructor(governance?: GovernanceClient) {
    this.governance = governance ?? new GovernanceClient();
  }

  attach(context: vscode.ExtensionContext): void {
    this.subs.push(
      vscode.workspace.onWillCreateFiles((event) =>
        event.waitUntil(this.handleBatch('file_create', event.files.map((u) => u.fsPath))),
      ),
      vscode.workspace.onWillDeleteFiles((event) =>
        event.waitUntil(this.handleBatch('file_delete', event.files.map((u) => u.fsPath))),
      ),
      vscode.workspace.onWillRenameFiles((event) =>
        event.waitUntil(
          this.handleBatch(
            'file_rename',
            event.files.map((f) => `${f.oldUri.fsPath} → ${f.newUri.fsPath}`),
          ),
        ),
      ),
    );
    for (const s of this.subs) context.subscriptions.push(s);
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
    this.subs = [];
  }

  private async handleBatch(category: 'file_create' | 'file_delete' | 'file_rename', items: string[]): Promise<void> {
    const enabled = vscode.workspace
      .getConfiguration('openbox')
      .get<boolean>('fileOpGate.enabled', false);
    if (!enabled) return;
    if (!this.governance.agentId()) return;

    for (const item of items) {
      const raw = await this.governance.check({
        spanType: 'file_write',
        activityInput: { file_path: item, event_category: category },
      });
      const result = this.governance.applyFailMode(raw);
      if (result.outcome === 'allow') continue;

      const verb = category.replace('file_', '');
      const reason = result.reason ?? 'denied by policy';
      vscode.window.showErrorMessage(`OpenBox blocked ${verb}: ${item} - ${reason}`);
      // Throwing from a `waitUntil` thenable cancels the file op the
      // same way a rejected save promise cancels a save.
      throw new Error(`OpenBox: ${verb} cancelled by policy`);
    }
  }
}
