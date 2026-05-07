// Mock-auth settings + filter coverage. The extension reads several
// workspace settings live (openbox.environment, agentId, mockAuth,
// notifyOnNewApprovals, gates), and rebooting the polling layer
// when those change is part of the contract. The mock fixtures let
// us exercise that without a backend in the loop.

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

async function bootSnapshot(): Promise<{ agentId?: string; env?: string; mockAuth?: boolean } | null> {
  return browser.executeWorkbench(async (vscode: any) => {
    return vscode.commands.executeCommand('openbox.__diag.boot');
  }) as Promise<{ agentId?: string; env?: string; mockAuth?: boolean } | null>;
}

describe('OpenBox settings — mock auth', () => {
  before(async () => {
    await activate();
    await browser.waitUntil(async () => (await approvalsCount()) === 6, {
      timeout: 10_000,
      timeoutMsg: 'pending fixtures never reached 6',
    });
  });

  it('boot snapshot reflects the configured environment', async () => {
    const snap = await bootSnapshot();
    expect(snap?.env).toBe('staging');  // wdio config sets staging in non-LIVE mode
    expect(snap?.mockAuth).toBe(true);
  });

  it('updating openbox.agentId reaches the governance client', async () => {
    const newAgentId = 'mock-agent-updated-' + Date.now();
    await browser.executeWorkbench(async (vscode: any, id: string) => {
      await vscode.workspace
        .getConfiguration('openbox')
        .update('agentId', id, vscode.ConfigurationTarget.Workspace);
    }, newAgentId);
    // Allow the config-change subscriber to propagate.
    await new Promise((r) => setTimeout(r, 500));
    const snap = await bootSnapshot();
    expect(snap?.agentId).toBe(newAgentId);
    // Restore so other suites running later don't see the override.
    await browser.executeWorkbench(async (vscode: any) => {
      await vscode.workspace
        .getConfiguration('openbox')
        .update('agentId', undefined, vscode.ConfigurationTarget.Workspace);
    });
  });

  it('refresh diag round-trips against the mock client', async () => {
    const before = await approvalsCount();
    const after = (await browser.executeWorkbench(async (vscode: any) => {
      return vscode.commands.executeCommand('openbox.__diag.refresh');
    })) as number;
    expect(typeof after).toBe('number');
    // Refresh shouldn't lose existing rows; only decide can drop them.
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
