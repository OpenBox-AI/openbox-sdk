// Smoke: extension activates, status bar paints, OpenBox panel
// renders, mock-auth fixtures show up. No backend required (mockAuth
// is set in wdio.conf.ts → userSettings).
//
// Imports `browser` and `$` as ambient globals (set up by
// @wdio/cli + wdio-vscode-service).

import { expect } from '@wdio/globals';

describe('OpenBox panel — mock auth', () => {
  it('activates and renders the status bar item', async () => {
    const workbench = await browser.getWorkbench();
    const statusBar = await workbench.getStatusBar();
    const items = await statusBar.getItems();
    const ours = items.find((t) => /OpenBox/.test(t));
    expect(ours, `status bar items: ${items.join(' | ')}`).toBeDefined();
    // Mock auth is on, so the tag should include MOCK · staging.
    expect(ours).toMatch(/MOCK/);
  });

  it('shows the OpenBox view container in the activity bar', async () => {
    const workbench = await browser.getWorkbench();
    const activityBar = await workbench.getActivityBar();
    const viewControls = await activityBar.getViewControls();
    const titles = await Promise.all(viewControls.map((v) => v.getTitle()));
    expect(titles.some((t) => /OpenBox/i.test(t)), `activity bar: ${titles.join(', ')}`).toBe(true);
  });

  it('Pending Approvals panel lists the 6 fixture rows', async () => {
    const workbench = await browser.getWorkbench();
    const activityBar = await workbench.getActivityBar();
    const ours = (await activityBar.getViewControls()).find(async (v) => /OpenBox/i.test(await v.getTitle()));
    if (!ours) throw new Error('OpenBox view control not found');
    const view = await ours.openView();
    const sections = await view.getContent().getSections();
    expect(sections.length).toBeGreaterThan(0);
    // wdio-vscode-service exposes tree items per section; the count
    // should match the fixture seed length.
    const items = await sections[0].getVisibleItems();
    expect(items.length, `expected 6 mock approvals; got ${items.length}`).toBe(6);
  });
});
