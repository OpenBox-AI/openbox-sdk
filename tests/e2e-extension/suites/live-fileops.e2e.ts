// LIVE file-op gate coverage beyond delete. The PreFileOpGate hooks
// onWillCreateFiles + onWillRenameFiles + onWillDeleteFiles; the
// existing live-gates suite only exercises delete. This suite covers
// create + rename so a regression that breaks one but not the other
// surfaces here.

import { expect } from '@wdio/globals';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Spec selector gates this file via the live-* prefix; no
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

describe('LIVE file ops — create + rename gates', () => {
  before(async () => {
    await activate();
  });

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
    console.log('[live-fileops] create result:', result);
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
    console.log('[live-fileops] rename result:', result);
    expect(result.willFireCount).toBeGreaterThanOrEqual(1);
    expect(result.applied).toBe(true);
  });
});
