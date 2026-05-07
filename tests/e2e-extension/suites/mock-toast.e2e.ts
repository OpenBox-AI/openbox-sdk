// Mock-auth toast / notification coverage. The polling layer emits
// 'newApprovals' for every fresh row; the extension turns that into
// a vscode.window.showWarningMessage with Approve/Reject/View
// buttons. We can't dismiss the modal from wdio's executeWorkbench,
// so this suite uses a diag bypass that fires the same notification
// path and reports whether the call resolved.

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

async function simulate(rows: { id: string; agent_id?: string; activity_type?: string; reason?: string }[]) {
  return browser.executeWorkbench(
    async (vscode: any, approvals: typeof rows) => {
      return vscode.commands.executeCommand('openbox.__diag.simulateNewApprovals', approvals);
    },
    rows,
  ) as Promise<{ fired: boolean; count: number }>;
}

describe('OpenBox notifications — newApprovals path', () => {
  before(async () => {
    await activate();
  });

  it('fires showWarningMessage for one new approval without throwing', async () => {
    const r = await simulate([
      { id: 'sim-1', agent_id: 'mock-agent', activity_type: 'FileEdit', reason: 'sim test' },
    ]);
    expect(r.fired).toBe(true);
    expect(r.count).toBe(1);
  });

  it('handles a batch of three new approvals without throwing', async () => {
    const r = await simulate([
      { id: 'sim-2', agent_id: 'mock-agent', activity_type: 'ShellExecution', reason: 'a' },
      { id: 'sim-3', agent_id: 'mock-agent', activity_type: 'HTTPRequest', reason: 'b' },
      { id: 'sim-4', agent_id: 'mock-agent', activity_type: 'FileDelete', reason: 'c' },
    ]);
    expect(r.fired).toBe(true);
    expect(r.count).toBe(3);
  });

  it('survives an empty batch (degenerate but possible from polling)', async () => {
    const r = await simulate([]);
    expect(r.fired).toBe(true);
    expect(r.count).toBe(0);
  });
});
