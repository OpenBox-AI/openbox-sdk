// Smoke: extension activates, status bar paints, OpenBox panel
// renders, mock-auth fixtures show up. No backend required (mockAuth
// is set in wdio.conf.ts → userSettings).

import { expect } from '@wdio/globals';

async function statusBarTexts(): Promise<string[]> {
  const workbench = await browser.getWorkbench();
  const sb = await workbench.getStatusBar();
  return sb.getItems();
}

describe('OpenBox panel — mock auth', () => {
  before(async () => {
    // Force extension activation before any test by opening the
    // OpenBox view container. activationEvents is "onStartupFinished"
    // but the wdio session reaches the test before the deferred
    // activation always lands; clicking the view container triggers
    // the lazy-activation path immediately.
    const workbench = await browser.getWorkbench();
    const activityBar = await workbench.getActivityBar();
    for (const v of await activityBar.getViewControls()) {
      if (/OpenBox/i.test(await v.getTitle())) {
        await v.openView();
        break;
      }
    }
  });

  it('activates and renders the OpenBox status bar item', async () => {
    // Poll status bar; dump the final visible items if we time out.
    let items: string[] = [];
    let ours: string | undefined;
    try {
      await browser.waitUntil(
        async () => {
          items = await statusBarTexts();
          ours = items.find((t) => /OpenBox|MOCK|Pending/i.test(t));
          return !!ours;
        },
        { timeout: 15_000, timeoutMsg: '' },
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log('STATUS BAR DUMP:', JSON.stringify(items, null, 2));
      throw err;
    }
    expect(ours).toMatch(/MOCK|OpenBox|Pending/i);
  });

  it('shows the OpenBox view container in the activity bar', async () => {
    const workbench = await browser.getWorkbench();
    const activityBar = await workbench.getActivityBar();
    const controls = await activityBar.getViewControls();
    const titles = await Promise.all(controls.map((v) => v.getTitle()));
    const found = titles.some((t) => /OpenBox/i.test(t));
    if (!found) throw new Error(`activity bar: ${titles.join(', ')}`);
    expect(found).toBe(true);
  });

  it('Pending Approvals panel lists the mock fixture rows', async () => {
    const workbench = await browser.getWorkbench();
    const activityBar = await workbench.getActivityBar();
    const controls = await activityBar.getViewControls();
    let openbox;
    for (const v of controls) {
      if (/OpenBox/i.test(await v.getTitle())) {
        openbox = v;
        break;
      }
    }
    if (!openbox) throw new Error('OpenBox view control not found');
    const view = await openbox.openView();
    const sections = await view.getContent().getSections();
    expect(sections.length).toBeGreaterThan(0);
    // getVisibleItems() returns every visible row including any
    // expanded tree children. The fixture seeds 6 top-level
    // approvals; if children expand, the count is a multiple. Just
    // assert the count is a positive multiple of 6 (loose enough to
    // tolerate UI tree-shape changes; tight enough to catch "panel
    // is empty" regressions).
    const items = await sections[0].getVisibleItems();
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items.length % 6).toBe(0);
  });
});
