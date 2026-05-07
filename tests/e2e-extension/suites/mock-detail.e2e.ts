// Mock-auth detail-panel coverage. The detail panel is a webview
// the extension opens when the user clicks an approval row or fires
// `openbox.openDetail`. We can't easily inspect webview innerHTML
// from wdio, but we CAN assert the command resolves cleanly + the
// webview-panel registration succeeds.

import { expect } from '@wdio/globals';

async function activate(): Promise<void> {
  await browser.executeWorkbench(async (vscode: any) => {
    try {
      await vscode.commands.executeCommand('workbench.view.extension.openbox');
    } catch {
      /* ignore */
    }
    const ext = vscode.extensions.getExtension('openbox.openbox');
    if (ext && !ext.isActive) await ext.activate();
  });
  await new Promise((r) => setTimeout(r, 1500));
}

async function approvalsCount(): Promise<number> {
  return browser.executeWorkbench(async (vscode: any) => {
    return vscode.commands.executeCommand('openbox.__diag.approvalsCount');
  }) as Promise<number>;
}

async function openDetail(id: string): Promise<{ ok: boolean; error?: string }> {
  return browser.executeWorkbench(
    async (vscode: any, approvalId: string) => {
      return vscode.commands.executeCommand('openbox.__diag.openDetail', approvalId);
    },
    id,
  ) as Promise<{ ok: boolean; error?: string }>;
}

describe('OpenBox detail panel — open + dispose', () => {
  before(async () => {
    await activate();
    await browser.waitUntil(async () => (await approvalsCount()) >= 1, {
      timeout: 10_000,
      timeoutMsg: 'pending fixtures never loaded',
    });
  });

  it('openDetail resolves cleanly for an existing approval', async () => {
    const r = await openDetail('mock-appr-001');
    expect(r.ok).toBe(true);
  });

  it('openDetail accepts a string id (not just a tree-node arg)', async () => {
    // The user-facing flow can hand openDetail either an Approval
    // object (from a tree click) or a bare id (from a slash command
    // / preWriteGate deny modal). The string-id path is the one
    // detailPanel had to handle separately.
    const r = await openDetail('mock-appr-002');
    expect(r.ok).toBe(true);
  });

  it('openDetail handles an unknown id without throwing', async () => {
    const r = await openDetail('mock-appr-does-not-exist');
    // The command resolves cleanly even when the id misses; the
    // panel surfaces "not found" inside its own webview rather than
    // throwing back to the caller.
    expect(r.ok).toBe(true);
  });
});
