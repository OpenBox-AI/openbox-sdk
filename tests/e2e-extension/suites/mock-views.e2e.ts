// Mock-auth view-contribution coverage. The extension contributes
// approvals, history, profile, and (gated) onboard / debugControls
// views; this suite asserts every visible-by-default view actually
// renders content from the mock fixtures, not just that activation
// succeeded.

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
async function historyCount(): Promise<number> {
  return browser.executeWorkbench(async (vscode: any) => {
    return vscode.commands.executeCommand('openbox.__diag.historyCount');
  }) as Promise<number>;
}
async function bootSnapshot(): Promise<{ orgId?: string; email?: string; agentId?: string; mockAuth?: boolean; env?: string; isApiKeyAuth?: boolean } | null> {
  return browser.executeWorkbench(async (vscode: any) => {
    return vscode.commands.executeCommand('openbox.__diag.boot');
  }) as Promise<{ orgId?: string; email?: string; agentId?: string; mockAuth?: boolean; env?: string; isApiKeyAuth?: boolean } | null>;
}

describe('OpenBox views — mock auth', () => {
  before(async () => {
    await activate();
    // Wait for first poll to land so history-decided fixtures are
    // populated alongside pending. MockStore seeds 5 decided rows.
    await browser.waitUntil(async () => (await approvalsCount()) === 6, {
      timeout: 10_000,
      timeoutMsg: 'pending fixtures never reached 6',
    });
  });

  after(async () => {
    // The 'decide moves a row out of pending' test mutates state.
    // Reset back to the seeded baseline so anything that runs after
    // this spec in the same workbench sees the canonical fixture set.
    await browser.executeWorkbench(async (vscode: any) => {
      await vscode.commands.executeCommand('openbox.resetMockData');
    });
  });

  it('history view exposes the seeded decided rows', async () => {
    // MockStore.reset seeds 5 decided fixtures (2 approved + 1
    // rejected + 2 expired). The history scope uses status=undefined
    // by default so the bucket carries pending + decided combined;
    // assert the floor instead of an exact count to keep the test
    // resilient to default-filter changes.
    await browser.waitUntil(async () => (await historyCount()) >= 5, {
      timeout: 15_000,
      timeoutMsg: 'history bucket never reached at least 5 rows',
    });
    expect(await historyCount()).toBeGreaterThanOrEqual(5);
  });

  it('profile view: boot snapshot carries orgId + isApiKeyAuth from mock', async () => {
    const snap = await bootSnapshot();
    expect(snap).not.toBeNull();
    expect(snap?.mockAuth).toBe(true);
    expect(snap?.orgId).toBe('mock-org-001');
    expect(snap?.isApiKeyAuth).toBe(true);
  });

  it('decide moves a row out of pending', async () => {
    // History default-filter is status=undefined so the bucket
    // carries pending + decided combined; total stays constant
    // on decide (a row migrates between sub-buckets, doesn't
    // appear/disappear). The pending-count drop is the
    // observable signal the decide round-tripped.
    const startPending = await approvalsCount();
    await browser.executeWorkbench(async (vscode: any) => {
      await vscode.commands.executeCommand(
        'openbox.__diag.decide',
        { id: 'mock-appr-003', agent_id: 'mock-agent' },
        'approve',
      );
    });
    await browser.waitUntil(async () => (await approvalsCount()) === startPending - 1, {
      timeout: 10_000,
      timeoutMsg: 'pending count did not drop',
    });
    expect(await approvalsCount()).toBe(startPending - 1);
  });
});
