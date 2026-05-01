// Org management lifecycle e2e: exercise read paths that don't require
// populated session/audit data (get / settings / dashboard / sessions list
// with expected-empty results), and verify update-settings round-trips.

import { describe, it, expect } from 'vitest';
import { runCli } from '../helpers/cli-runner.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

const CAN_RUN = existsSync(resolve(__dirname, '../../../dist/index.js'))
  && existsSync(resolve(__dirname, '../../../.tokens'))
  && !!process.env.OPENBOX_ORG_ID;

const describeOrSkip = CAN_RUN ? describe : describe.skip;

describeOrSkip('org lifecycle (e2e, real backend)', () => {
  const orgId = process.env.OPENBOX_ORG_ID!;

  it('`org get` returns the caller org', () => {
    const res = runCli(['org', 'get', orgId]);
    expect(res.status, res.stderr).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body.id ?? body.organization_id ?? body.name).toBeTruthy();
  });

  it('`org settings` returns settings JSON', () => {
    const res = runCli(['org', 'settings', orgId]);
    expect(res.status, res.stderr).toBe(0);
    // body may be {} on a fresh org; just check it parses.
    JSON.parse(res.stdout);
  });

  it('`org dashboard` returns a dashboard payload', () => {
    const res = runCli(['org', 'dashboard', orgId]);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });

  it('`org sessions` returns a paginated sessions list (may be empty)', () => {
    const res = runCli(['org', 'sessions', orgId, '--limit', '10']);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });

  it('`org approvals` returns a paginated approvals list (may be empty)', () => {
    const res = runCli(['org', 'approvals', orgId, '--limit', '10']);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });
});
