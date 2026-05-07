// Mock-auth status bar paint coverage. The status bar is painted by
// paintIdle() on every approvals-feed 'changed' emit; the text +
// tooltip carry distinct shapes per state and the user reads them
// to know whether the gate is doing anything.

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

async function statusBar(): Promise<{ text: string; tooltip: string }> {
  return browser.executeWorkbench(async (vscode: any) => {
    return vscode.commands.executeCommand('openbox.__diag.statusBar');
  }) as Promise<{ text: string; tooltip: string }>;
}

async function approvalsCount(): Promise<number> {
  return browser.executeWorkbench(async (vscode: any) => {
    return vscode.commands.executeCommand('openbox.__diag.approvalsCount');
  }) as Promise<number>;
}

describe('OpenBox status bar — paint variations', () => {
  before(async () => {
    await activate();
    await browser.waitUntil(async () => (await approvalsCount()) === 6, {
      timeout: 10_000,
      timeoutMsg: 'pending fixtures never reached 6',
    });
  });

  it('shows the pending count + MOCK suffix when fixtures are loaded', async () => {
    const sb = await statusBar();
    // 6 fixtures + mock auth: "6 Pending · MOCK · staging"
    expect(sb.text).toMatch(/6 Pending/);
    expect(sb.text).toMatch(/MOCK/);
  });

  it('drops to the no-pending shape after every fixture is decided', async () => {
    // Decide the remaining 5 fixtures (mock-appr-002..006). The
    // mock-decide suite already approved mock-appr-001, but suite
    // ordering doesn't guarantee state so we walk the full 6.
    for (let i = 1; i <= 6; i++) {
      const id = `mock-appr-${String(i).padStart(3, '0')}`;
      await browser.executeWorkbench(
        async (vscode: any, approvalId: string) => {
          await vscode.commands.executeCommand(
            'openbox.__diag.decide',
            { id: approvalId, agent_id: 'mock-agent' },
            'approve',
          );
        },
        id,
      );
    }
    await browser.waitUntil(async () => (await approvalsCount()) === 0, {
      timeout: 15_000,
      timeoutMsg: 'pending count never drained to 0',
    });
    const sb = await statusBar();
    // No-pending shape: "OpenBox · MOCK · staging" (no "N Pending"
    // prefix). The shield icon stays prefixed via $(shield).
    expect(sb.text).toMatch(/OpenBox/);
    expect(sb.text).not.toMatch(/Pending/);
  });
});
