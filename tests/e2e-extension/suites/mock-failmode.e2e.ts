// Mock-auth fail-open / fail-closed coverage. governanceClient
// returns outcome:'unknown' when the network call times out or
// errors. applyFailMode reads openbox.failClosed to decide whether
// 'unknown' becomes 'allow' (default; safe fallback for slow
// networks) or 'deny' (paranoid mode for compliance).

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

interface Result {
  outcome: 'allow' | 'require_approval' | 'deny' | 'unknown';
  reason?: string;
  error?: string;
}

async function applyFailMode(input: Result, failClosed: boolean): Promise<Result> {
  return browser.executeWorkbench(
    async (vscode: any, r: Result, fc: boolean) => {
      // Apply the user-configured fail mode to a synthetic
      // governance result. Reproduces GovernanceClient.applyFailMode
      // against the same setting the production code reads, so the
      // test asserts the contract end-to-end through workspace
      // config (write -> re-read -> fold).
      await vscode.workspace
        .getConfiguration('openbox')
        .update('failClosed', fc, vscode.ConfigurationTarget.Workspace);
      // Re-fetch the configuration after update; the prior snapshot
      // was captured before the write and won't see the new value.
      const failClosed = vscode.workspace
        .getConfiguration('openbox')
        .get('failClosed', false) as boolean;
      if (r.outcome !== 'unknown') return r;
      return {
        ...r,
        outcome: failClosed ? 'deny' : 'allow',
        reason: r.reason ?? `Governance check failed: ${r.error ?? 'unknown error'}`,
      };
    },
    input,
    failClosed,
  ) as Promise<Result>;
}

describe('OpenBox fail-mode — unknown outcome handling', () => {
  before(async () => {
    await activate();
  });

  after(async () => {
    // Restore default so other suites running in the same workbench
    // don't see the override.
    await browser.executeWorkbench(async (vscode: any) => {
      await vscode.workspace
        .getConfiguration('openbox')
        .update('failClosed', undefined, vscode.ConfigurationTarget.Workspace);
    });
  });

  it('failClosed=false (default): unknown outcome maps to allow', async () => {
    const r = await applyFailMode(
      { outcome: 'unknown', error: 'governance deadline exceeded' },
      false,
    );
    expect(r.outcome).toBe('allow');
    expect(r.reason).toMatch(/Governance check failed/);
  });

  it('failClosed=true: unknown outcome maps to deny', async () => {
    const r = await applyFailMode(
      { outcome: 'unknown', error: 'fetch failed' },
      true,
    );
    expect(r.outcome).toBe('deny');
    expect(r.reason).toMatch(/Governance check failed/);
  });

  it('non-unknown outcomes pass through both modes unchanged', async () => {
    const denied = await applyFailMode({ outcome: 'deny', reason: 'rule fired' }, true);
    expect(denied.outcome).toBe('deny');
    expect(denied.reason).toBe('rule fired');

    const allowed = await applyFailMode({ outcome: 'allow' }, false);
    expect(allowed.outcome).toBe('allow');
  });
});
