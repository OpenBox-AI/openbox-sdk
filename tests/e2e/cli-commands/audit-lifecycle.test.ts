// Audit log lifecycle e2e: list with empty results on a fresh org is fine,
// preview is cheap (no writes), export creates an export job that we clean up.

import { describe, it, expect, afterAll } from 'vitest';
import { runCli } from '../helpers/cli-runner.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

const CAN_RUN = existsSync(resolve(__dirname, '../../../dist/index.js'))
  && existsSync(resolve(__dirname, '../../../.tokens'))
  && !!process.env.OPENBOX_ORG_ID;

const describeOrSkip = CAN_RUN ? describe : describe.skip;

describeOrSkip('audit lifecycle (e2e, real backend)', () => {
  const stamp = Date.now();
  let exportId: string | undefined;

  afterAll(() => {
    if (exportId) runCli(['audit', 'delete-export', exportId]);
  });

  it('`audit list` returns a paginated list (may be empty)', () => {
    const res = runCli(['audit', 'list', '--limit', '10']);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });

  it('`audit preview` returns a preview payload', () => {
    const res = runCli(['audit', 'preview']);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });

  it('`audit exports` returns the exports list (may be empty)', () => {
    const res = runCli(['audit', 'exports', '--limit', '10']);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });

  it('`audit export` creates an export job', () => {
    const res = runCli([
      'audit', 'export',
      '-n', `audit-lc-${stamp}`,
    ]);
    expect(res.status, res.stderr).toBe(0);
    const body = JSON.parse(res.stdout);
    exportId = body.exportId ?? body.id ?? body.data?.exportId ?? body.data?.id;
    expect(exportId).toBeTruthy();
  });
});
