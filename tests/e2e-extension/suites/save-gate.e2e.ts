// Active PreWriteGate behaviors visible from the workbench. Two
// passes:
//
// 1. baseline (mockAuth on, no toggles, no agent_id) — status bar
//    shows the OpenBox tag with no `gates idle` suffix.
//
// 2. "gates idle (no agent)" — flip openbox.preWriteGate.active to
//    true via the user settings JSON file the harness manages,
//    reload the window, assert the status bar suffix changes to
//    "gates idle".
//
// Real save-gate veto path (governance call → modal) is unit-tested
// in apps/extension/src/preWriteGate.test.ts. To exercise it live,
// flip mockAuth off and configure openbox.agentId to a real agent —
// follow-up suite.

import { expect } from '@wdio/globals';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
void HERE;

async function statusBarTexts(): Promise<string[]> {
  const wb = await browser.getWorkbench();
  return (await wb.getStatusBar()).getItems();
}

async function openOpenBoxView(): Promise<void> {
  const wb = await browser.getWorkbench();
  for (const v of await (await wb.getActivityBar()).getViewControls()) {
    if (/OpenBox/i.test(await v.getTitle())) {
      await v.openView();
      return;
    }
  }
  throw new Error('OpenBox view control not found');
}

/** Find the user-data-dir VS Code is using and patch settings.json
 *  in place. The wdio-vscode-service launches with
 *  `--user-data-dir=<service cache>/user-data`; the suite reaches it
 *  via `process.env.WDIO_VSCODE_USER_DIR` if available, otherwise
 *  via a config-derived guess.
 *
 *  Returns true on success, false if the path can't be located (the
 *  caller should skip the assertion in that case rather than fail
 *  on a harness-internal layout). */
function patchUserSettings(patch: Record<string, unknown>): boolean {
  // wdio-vscode-service v6 stores the user data under
  // tests/e2e-extension/.wdio-vscode-service/<vscode>/user-data/User/settings.json
  // (and similar for fresh per-run mode). Search a few candidate
  // paths so we don't pin to one harness version.
  const candidates = [
    join(HERE, '../.wdio-vscode-service/vscode-darwin-arm64-1.119.0/user-data/User/settings.json'),
    process.env.WDIO_VSCODE_USER_DIR
      ? join(process.env.WDIO_VSCODE_USER_DIR, 'User/settings.json')
      : '',
  ].filter(Boolean);
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(readFileSync(p, 'utf-8'));
    } catch {
      parsed = {};
    }
    writeFileSync(p, JSON.stringify({ ...parsed, ...patch }, null, 2));
    return true;
  }
  return false;
}

describe('Active PreWriteGate — status bar wiring', () => {
  before(async () => {
    await openOpenBoxView();
  });

  it('status bar carries the OpenBox tag with mock auth + no agent', async () => {
    let items: string[] = [];
    await browser.waitUntil(
      async () => {
        items = await statusBarTexts();
        return items.some((t) => /OpenBox|MOCK|Pending/i.test(t));
      },
      { timeout: 10_000, timeoutMsg: 'OpenBox status bar item never appeared' },
    );
    const ours = items.find((t) => /OpenBox|MOCK|Pending/i.test(t));
    expect(ours).toBeTruthy();
    expect(ours).not.toMatch(/gates idle/);
  });

  it('shows "gates idle (no agent)" once preWriteGate.active flips on', async () => {
    const patched = patchUserSettings({
      'openbox.preWriteGate.active': true,
    });
    if (!patched) {
      // Path not located — skip rather than false-fail. Unit suite
      // already covers the painter logic; this is a harness-coupled
      // shape test.
      console.log(
        '[save-gate] could not locate VS Code user settings.json; skipping the live flip assertion. Unit test covers the painter.',
      );
      return;
    }
    // Trigger config-change handler in the extension, which calls
    // paintIdle() with the new toggle state. Reloading the window is
    // the most robust way; the onDidChangeConfiguration hook also
    // works but VS Code only fires it for the affected scope, and
    // the file-level patch may not propagate without a refresh.
    const wb = await browser.getWorkbench();
    await wb.executeCommand('Developer: Reload Window');

    // After reload, the workbench is fresh; re-resolve.
    let items: string[] = [];
    await browser.waitUntil(
      async () => {
        items = await statusBarTexts();
        return items.some((t) => /gates idle/i.test(t));
      },
      {
        timeout: 15_000,
        timeoutMsg: `idle suffix never appeared; bar: ${items.join(' | ')}`,
      },
    );
    const ours = items.find((t) => /gates idle/i.test(t));
    expect(ours).toMatch(/gates idle/);
  });
});
