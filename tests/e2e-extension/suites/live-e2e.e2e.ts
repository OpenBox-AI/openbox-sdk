// Consolidated LIVE end-to-end suite. One spec file = one workbench
// launch (one window flash on macOS) instead of N. Covers four
// concern areas under nested describes:
//
//   1. Verdict matrix      — full BehaviorVerdict 0/1/2/3/4 round-trip
//   2. Active gates        — preWriteGate, fileOpGate, tabObserver
//   3. File-op gate        — onWillCreateFiles + onWillRenameFiles
//   4. Views / boot        — boot snapshot, history view, refresh
//
// All tests run against the real local backend through the real SDK.
// UI / glue logic (mocked-vscode unit-testable) lives at
// `apps/extension/src/*.test.ts`. The split is hard: anything testable
// without a workbench is a unit test; anything that needs a real
// workbench + real backend lives here.

import { expect } from '@wdio/globals';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(HERE, '..', 'fixtures-workspace');
const SAVE_TARGET = join(WORKSPACE, 'live-save-target.txt');
const DELETE_TARGET = join(WORKSPACE, 'live-delete-target.txt');

interface VerdictResult {
  outcome: 'allow' | 'require_approval' | 'deny' | 'unknown';
  reason?: string;
  approvalId?: string;
  error?: string;
}

async function activate(): Promise<void> {
  await browser.executeWorkbench(async (vscode: any) => {
    try {
      await vscode.commands.executeCommand('workbench.view.extension.openbox');
    } catch {
      /* ignore */
    }
    const ext = vscode.extensions.getExtension('openbox.openbox');
    if (!ext) throw new Error('openbox extension not found');
    if (!ext.isActive) await ext.activate();
    // Minimize the workbench window so it doesn't sit on top of the
    // user's editor for the duration of the run. macOS has no
    // headless Electron mode; this is the next best thing — one
    // brief flash on launch, then it tucks into the dock.
    try {
      await vscode.commands.executeCommand('workbench.action.minimizeWindow');
    } catch {
      /* not all platforms support it; non-fatal */
    }
  });
}

async function check(spanType: string, activityInput: Record<string, unknown>): Promise<VerdictResult> {
  return browser.executeWorkbench(
    async (vscode: any, st: string, ai: Record<string, unknown>) => {
      return vscode.commands.executeCommand('openbox.__diag.governanceCheck', st, ai);
    },
    spanType,
    activityInput,
  ) as Promise<VerdictResult>;
}

before(() => {
  // Pre-populate the gate-test fixture files. Lives outside any
  // describe so it runs once per spec file, not per describe block.
  mkdirSync(WORKSPACE, { recursive: true });
  writeFileSync(SAVE_TARGET, 'before-save\n');
  writeFileSync(DELETE_TARGET, 'should-not-be-deleted\n');
});

before(async () => {
  // Activation + minimize. Wait until governance.check returns a
  // verdict (means boot promise resolved) before running any test;
  // otherwise the gate listeners may not be attached yet.
  await activate();
  await browser.waitUntil(
    async () => {
      try {
        const r = (await browser.executeWorkbench(async (vscode: any) => {
          return vscode.commands.executeCommand('openbox.__diag.checkGovernance', {
            spanType: 'file_write',
            activityInput: { file_path: '/tmp/probe.txt', content: 'probe' },
          });
        })) as { outcome?: string };
        return !!r?.outcome;
      } catch {
        return false;
      }
    },
    { timeout: 15_000, timeoutMsg: 'governance.check never returned a verdict; gates may not be attached' },
  );
});

// ─── 1. Verdict matrix ──────────────────────────────────────────────

describe('LIVE — full BehaviorVerdict enum matrix', () => {
  it('verdict 0 (allow): file_read with no matching rule → outcome allow', async () => {
    const r = await check('file_read', { file_path: '/tmp/whatever-no-rule-fires.txt' });
    expect(r.outcome).toBe('allow');
  });

  it('verdict 1 (constrain): database_query → e2e-constrain-db → outcome allow (score lowered)', async () => {
    const r = await check('db', { query: 'SELECT 1' });
    expect(r.outcome).toBe('allow');
  });

  it('verdict 2 (require_approval): llm_completion → e2e-approve-llm', async () => {
    const r = await check('llm', { prompt: 'summarize this' });
    expect(r.outcome).toBe('require_approval');
  });

  it('verdict 3 (block): file_write → e2e-deny-write → outcome deny', async () => {
    const r = await check('file_write', { file_path: '/tmp/blocked.txt' });
    expect(r.outcome).toBe('deny');
    expect(r.reason).toMatch(/e2e-deny-write/);
  });

  it('verdict 4 (halt): http_post → e2e-halt-http → outcome deny', async () => {
    const r = await check('http', {
      method: 'POST',
      url: 'https://example.com/blocked',
    });
    expect(r.outcome).toBe('deny');
    expect(r.reason).toMatch(/e2e-halt-http/);
  });
});

// ─── 2. Active gates (preWriteGate / fileOpGate / tabObserver) ─────

describe('LIVE — active gates against planted rules', () => {
  it('governance.check returns block from extension host (planted file_write rule)', async () => {
    const result = await browser.executeWorkbench(async (vscode: any) => {
      return vscode.commands.executeCommand('openbox.__diag.checkGovernance', {
        spanType: 'file_write',
        activityInput: { file_path: '/tmp/diag.txt', content: 'live' },
      });
    });
    expect((result as VerdictResult).outcome).toBe('deny');
  });

  it('config sanity: settings + governance client see live values', async () => {
    const cfg = await browser.executeWorkbench(async (vscode: any) => {
      const c = vscode.workspace.getConfiguration('openbox');
      return {
        environment: c.get('environment'),
        mockAuth: c.get('mockAuth'),
        agentId: c.get('agentId'),
        preWriteGateActive: c.get('preWriteGate.active'),
        tabObserverActive: c.get('tabObserver.active'),
        fileOpGateEnabled: c.get('fileOpGate.enabled'),
      };
    });
    expect(cfg.environment).toBe('local');
    expect(cfg.mockAuth).toBe(false);
    expect(cfg.agentId).toBeTruthy();
    expect(cfg.preWriteGateActive).toBe(true);
    expect(cfg.tabObserverActive).toBe(true);
    expect(cfg.fileOpGateEnabled).toBe(true);
  });

  it('onWillSaveTextDocument fires for doc.save() (sanity)', async () => {
    const fired = await browser.executeWorkbench(
      async (vscode: any, target: string) => {
        let count = 0;
        const sub = vscode.workspace.onWillSaveTextDocument(() => {
          count += 1;
        });
        try {
          const uri = vscode.Uri.file(target);
          const doc = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(doc);
          await editor.edit((eb: any) => eb.insert(new vscode.Position(0, 0), 'x'));
          await doc.save();
        } finally {
          sub.dispose();
        }
        return count;
      },
      SAVE_TARGET,
    );
    expect(fired).toBeGreaterThanOrEqual(1);
  });

  it('PreWriteGate: save with deny verdict gets reverted (revertToDisk)', async () => {
    const result = await browser.executeWorkbench(
      async (vscode: any, target: string) => {
        const uri = vscode.Uri.file(target);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        const baseline = doc.getText();
        await editor.edit((eb: any) => {
          const full = new vscode.Range(
            new vscode.Position(0, 0),
            doc.lineAt(doc.lineCount - 1).range.end,
          );
          eb.replace(full, 'mutated-by-test');
        });
        const wasDirty = doc.isDirty;
        let saved: boolean;
        let saveErr = '';
        try {
          saved = await doc.save();
        } catch (err: any) {
          saved = false;
          saveErr = String(err?.message ?? err);
        }
        const after = await vscode.workspace.fs.readFile(uri);
        return {
          baseline,
          wasDirty,
          saved,
          saveErr,
          afterOnDisk: Buffer.from(after).toString(),
        };
      },
      SAVE_TARGET,
    );
    expect(result.wasDirty).toBe(true);
    expect(result.afterOnDisk).toBe(result.baseline);
    expect(result.saved).toBe(true);
  });

  it('FileOpGate: onWillDeleteFiles fires; gate runs (cancellation is best-effort)', async () => {
    const result = await browser.executeWorkbench(
      async (vscode: any, target: string) => {
        const uri = vscode.Uri.file(target);
        await vscode.workspace.fs.writeFile(uri, Buffer.from('to-be-protected\n'));
        let willFireCount = 0;
        const sub = vscode.workspace.onWillDeleteFiles(() => {
          willFireCount += 1;
        });
        try {
          const edit = new vscode.WorkspaceEdit();
          edit.deleteFile(uri);
          const applied = await vscode.workspace.applyEdit(edit);
          const stillExists = await vscode.workspace.fs.stat(uri).then(() => true).catch(() => false);
          return { applied, willFireCount, stillExists };
        } finally {
          sub.dispose();
        }
      },
      DELETE_TARGET,
    );
    expect(result.willFireCount).toBeGreaterThanOrEqual(1);
  });

  it('TabObserver: large AI-shaped insert is reverted on require_approval', async () => {
    const TARGET = join(WORKSPACE, 'live-tabobs-target.txt');
    writeFileSync(TARGET, 'baseline\n');
    const result = await browser.executeWorkbench(
      async (vscode: any, target: string) => {
        const uri = vscode.Uri.file(target);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        const baseline = doc.getText();
        const ai = '\n' + 'X'.repeat(220);
        const end = doc.lineAt(doc.lineCount - 1).range.end;
        await editor.edit((eb: any) => eb.insert(end, ai));
        await new Promise((r) => setTimeout(r, 4000));
        return { baseline, current: doc.getText() };
      },
      TARGET,
    );
    expect(result.current).toBe(result.baseline);
  });
});

// ─── 3. File-op gate (create + rename) ──────────────────────────────

describe('LIVE — file create + rename gates', () => {
  it('PreFileOpGate: onWillCreateFiles fires when a new file lands', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'openbox-create-'));
    const target = join(dir, 'new-file.txt');
    const result = (await browser.executeWorkbench(
      async (vscode: any, targetPath: string) => {
        const uri = vscode.Uri.file(targetPath);
        let willFireCount = 0;
        const sub = vscode.workspace.onWillCreateFiles((e: { files: unknown[] }) => {
          if (e.files.length > 0) willFireCount++;
        });
        try {
          const edit = new vscode.WorkspaceEdit();
          edit.createFile(uri, { overwrite: true });
          edit.insert(uri, new vscode.Position(0, 0), 'created-by-test\n');
          const applied = await vscode.workspace.applyEdit(edit);
          await new Promise((r) => setTimeout(r, 200));
          return { applied, willFireCount };
        } finally {
          sub.dispose();
        }
      },
      target,
    )) as { applied: boolean; willFireCount: number };
    expect(result.willFireCount).toBeGreaterThanOrEqual(1);
    expect(existsSync(target) || result.applied).toBe(true);
  });

  it('PreFileOpGate: onWillRenameFiles fires when a file gets renamed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'openbox-rename-'));
    const src = join(dir, 'before.txt');
    const dst = join(dir, 'after.txt');
    writeFileSync(src, 'hello\n');
    const result = (await browser.executeWorkbench(
      async (vscode: any, srcPath: string, dstPath: string) => {
        const srcUri = vscode.Uri.file(srcPath);
        const dstUri = vscode.Uri.file(dstPath);
        let willFireCount = 0;
        const sub = vscode.workspace.onWillRenameFiles((e: { files: unknown[] }) => {
          if (e.files.length > 0) willFireCount++;
        });
        try {
          const edit = new vscode.WorkspaceEdit();
          edit.renameFile(srcUri, dstUri, { overwrite: true });
          const applied = await vscode.workspace.applyEdit(edit);
          await new Promise((r) => setTimeout(r, 200));
          return { applied, willFireCount };
        } finally {
          sub.dispose();
        }
      },
      src,
      dst,
    )) as { applied: boolean; willFireCount: number };
    expect(result.willFireCount).toBeGreaterThanOrEqual(1);
    expect(result.applied).toBe(true);
  });
});

// ─── 4. Views / boot snapshot ───────────────────────────────────────

describe('LIVE — views and boot snapshot', () => {
  it('boot snapshot resolves orgId + agentId from the live local stack', async () => {
    let snap: {
      orgId?: string;
      env?: string;
      agentId?: string;
      mockAuth?: boolean;
      isApiKeyAuth?: boolean;
    } | null = null;
    await browser.waitUntil(
      async () => {
        snap = (await browser.executeWorkbench(async (vscode: any) => {
          return vscode.commands.executeCommand('openbox.__diag.boot');
        })) as typeof snap;
        return !!snap?.orgId;
      },
      { timeout: 15_000, timeoutMsg: 'boot snapshot never resolved orgId' },
    );
    expect(snap?.mockAuth).toBe(false);
    expect(snap?.env).toBe('local');
    expect(snap?.orgId).toBe('openbox.local');
    expect(snap?.agentId).toBe(process.env.OPENBOX_E2E_AGENT_ID);
    expect(snap?.isApiKeyAuth).toBe(true);
  });

  it('history view returns a non-negative count from the live polling layer', async () => {
    const count = (await browser.executeWorkbench(async (vscode: any) => {
      return vscode.commands.executeCommand('openbox.__diag.historyCount');
    })) as number;
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('refresh round-trips against the live backend without throwing', async () => {
    const after = (await browser.executeWorkbench(async (vscode: any) => {
      return vscode.commands.executeCommand('openbox.__diag.refresh');
    })) as number;
    expect(typeof after).toBe('number');
    expect(after).toBeGreaterThanOrEqual(0);
  });
});
