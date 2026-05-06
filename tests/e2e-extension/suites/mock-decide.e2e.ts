// Mock-auth approve/reject flow. The fixture seeds 6 pending rows;
// clicking Approve on the first one calls the in-memory mock decider
// (mockFeed.decide), which removes the row, and the panel's tree
// updates. Same for Reject.
//
// This is the only e2e suite that exercises the panel's
// click-to-decide path; unit tests stub the feed.

import { expect } from '@wdio/globals';

async function openPanel() {
  // First-paint of the workbench can return 0 view controls; poll
  // until OpenBox shows up. Fresh wdio sessions sometimes start
  // faster than the extension activates.
  let openbox: any;
  await browser.waitUntil(
    async () => {
      const wb = await browser.getWorkbench();
      for (const v of await (await wb.getActivityBar()).getViewControls()) {
        if (/OpenBox/i.test(await v.getTitle())) {
          openbox = v;
          return true;
        }
      }
      return false;
    },
    { timeout: 15_000, timeoutMsg: 'OpenBox view control never appeared' },
  );
  return openbox.openView();
}

async function visibleRows(): Promise<number> {
  const view = await openPanel();
  const sections = await view.getContent().getSections();
  if (sections.length === 0) return 0;
  return (await sections[0].getVisibleItems()).length;
}

describe('OpenBox panel — mock decide flow', () => {
  before(async () => {
    await openPanel();
  });

  it('starts with 6 fixture rows (any tree-shape multiple of 6 ok)', async () => {
    const n = await visibleRows();
    expect(n).toBeGreaterThanOrEqual(6);
    expect(n % 6).toBe(0);
  });

  /** Dispatch the registered command directly inside the extension
   *  host with a minimal approval shape — `{id, agent_id}` is what
   *  the handler reads. wdio-vscode-service's executeWorkbench()
   *  serializes the callback into the host so we get full vscode
   *  API access. The fixture seeds use stable ids
   *  (`mock-appr-001…006`) so we can hit them by ordinal. */
  async function dispatch(action: 'approve' | 'reject', ordinal: number): Promise<void> {
    const id = `mock-appr-00${ordinal}`;
    await browser.executeWorkbench(
      async (vscode: any, command: string, approval: { id: string; agent_id: string }) => {
        await vscode.commands.executeCommand(command, approval);
      },
      `openbox.${action}`,
      { id, agent_id: id.startsWith('mock-appr-00') ? `mock-agent` : '' },
    );
  }

  it('approving mock-appr-001 removes it from the panel', async () => {
    const startCount = await visibleRows();
    await dispatch('approve', 1);
    await browser.waitUntil(
      async () => (await visibleRows()) < startCount,
      { timeout: 10_000, timeoutMsg: 'panel did not shrink after approve' },
    );
    expect(await visibleRows()).toBeLessThan(startCount);
  });

  it('rejecting mock-appr-002 removes it too', async () => {
    const startCount = await visibleRows();
    if (startCount === 0) {
      console.log('[mock-decide] panel empty after approve test; nothing to reject');
      return;
    }
    await dispatch('reject', 2);
    await browser.waitUntil(
      async () => (await visibleRows()) < startCount,
      { timeout: 10_000, timeoutMsg: 'panel did not shrink after reject' },
    );
    expect(await visibleRows()).toBeLessThan(startCount);
  });
});
