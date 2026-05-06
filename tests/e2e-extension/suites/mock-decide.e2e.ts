// Mock-auth approve/reject. Drives via vscode.commands +
// __diag.approvalsCount so the suite is editor-fork-agnostic
// (works on VS Code AND Cursor). The fixture seeds 6 pending rows
// with stable ids (mock-appr-001..006).

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

async function dispatch(action: 'approve' | 'reject', ordinal: number): Promise<void> {
  const id = `mock-appr-00${ordinal}`;
  await browser.executeWorkbench(
    async (vscode: any, command: string, approval: { id: string; agent_id: string }) => {
      await vscode.commands.executeCommand(command, approval);
    },
    `openbox.${action}`,
    { id, agent_id: 'mock-agent' },
  );
}

describe('OpenBox panel — mock decide flow', () => {
  before(async () => {
    await activate();
  });

  it('starts with 6 fixture rows', async () => {
    // Wait for the mock feed's first 'changed' emit (50ms timer +
    // a bit of jitter on cold-start).
    await browser.waitUntil(async () => (await approvalsCount()) === 6, {
      timeout: 10_000,
      timeoutMsg: 'mock fixture never reached 6 rows',
    });
    expect(await approvalsCount()).toBe(6);
  });

  it('approving mock-appr-001 removes it', async () => {
    const start = await approvalsCount();
    await dispatch('approve', 1);
    await browser.waitUntil(async () => (await approvalsCount()) < start, {
      timeout: 10_000,
      timeoutMsg: 'count did not drop after approve',
    });
    expect(await approvalsCount()).toBeLessThan(start);
  });

  it('rejecting mock-appr-002 removes it too', async () => {
    const start = await approvalsCount();
    if (start === 0) return;
    await dispatch('reject', 2);
    await browser.waitUntil(async () => (await approvalsCount()) < start, {
      timeout: 10_000,
      timeoutMsg: 'count did not drop after reject',
    });
    expect(await approvalsCount()).toBeLessThan(start);
  });
});
