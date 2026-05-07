// LIVE view-contribution coverage. Asserts the extension's profile
// + history surfaces correctly resolve against a live backend +
// bootstrapped agent, not just against mock fixtures. Activation
// gate is the same OPENBOX_E2E_LIVE + agent + runtime key trio the
// other live suites read.

import { expect } from '@wdio/globals';

// File is named live-* so wdio's spec selector only picks it when
// OPENBOX_E2E_LIVE=1 + the agent + runtime-key env are set; no
// describe-level guard needed.

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
  await new Promise((r) => setTimeout(r, 2000));
}

async function bootSnapshot(): Promise<{
  orgId?: string;
  email?: string;
  sub?: string;
  keyId?: string;
  isApiKeyAuth?: boolean;
  env?: string;
  agentId?: string;
  mockAuth?: boolean;
} | null> {
  return browser.executeWorkbench(async (vscode: any) => {
    return vscode.commands.executeCommand('openbox.__diag.boot');
  }) as Promise<{
    orgId?: string;
    email?: string;
    sub?: string;
    keyId?: string;
    isApiKeyAuth?: boolean;
    env?: string;
    agentId?: string;
    mockAuth?: boolean;
  } | null>;
}

describe('LIVE views — local backend, real session', () => {
  before(async () => {
    await activate();
  });

  it('boot snapshot resolves orgId + agentId from the live local stack', async () => {
    let snap: Awaited<ReturnType<typeof bootSnapshot>> = null;
    await browser.waitUntil(
      async () => {
        snap = await bootSnapshot();
        return !!snap?.orgId;
      },
      { timeout: 15_000, timeoutMsg: 'boot snapshot never resolved orgId' },
    );
    expect(snap?.mockAuth).toBe(false);
    expect(snap?.env).toBe('local');
    expect(snap?.orgId).toBe('openbox.local');
    expect(snap?.agentId).toBe(process.env.OPENBOX_E2E_AGENT_ID);
    // Bootstrap mints with X-API-Key, so the active session is api-key authed.
    expect(snap?.isApiKeyAuth).toBe(true);
  });

  it('history view resolves without throwing against the live backend', async () => {
    // The bootstrap planted 4 behavior rules; they may or may not
    // have matched events yet, so history count is 0..N. The
    // assertion is that the diag command resolves cleanly (i.e. the
    // history ViewSession booted, polling didn't 401, etc.).
    const count = (await browser.executeWorkbench(async (vscode: any) => {
      return vscode.commands.executeCommand('openbox.__diag.historyCount');
    })) as number;
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('refresh diag does not throw against the live backend', async () => {
    // Sanity: a manual refresh of the active session should round-
    // trip cleanly. Silent network errors here would mask broken
    // polling on real builds.
    const after = (await browser.executeWorkbench(async (vscode: any) => {
      return vscode.commands.executeCommand('openbox.__diag.refresh');
    })) as number;
    expect(typeof after).toBe('number');
    expect(after).toBeGreaterThanOrEqual(0);
  });
});
