// End-to-end team lifecycle: spawn the real openbox binary against a live
// backend (whichever $OPENBOX_API_URL points at) and exercise the full
// create → get → delete round-trip. Requires:
//   - `npm run build` has been run so dist/index.js exists
//   - flat .tokens file with a valid backend API key
//   - $OPENBOX_ORG_ID exported (the org to create teams under)
//
// Skips gracefully when prerequisites aren't in place so CI can run without
// backend access without failing.

import { describe, it, expect, beforeAll } from 'vitest';
import { runCli } from '../helpers/cli-runner.js';

import { CAN_RUN_CLI as CAN_RUN } from './can-run.js';

const describeOrSkip = CAN_RUN ? describe : describe.skip;

describeOrSkip('team lifecycle (e2e, real backend)', () => {
  const orgId = process.env.OPENBOX_ORG_ID!;
  const teamName = `ci-smoke-${Date.now()}`;
  let createdTeamId: string | undefined;

  beforeAll(() => {
    if (!CAN_RUN) {
      console.error(
        'skipping team-lifecycle e2e: need dist/index.js built + .tokens file + $OPENBOX_ORG_ID set',
      );
    }
  });

  it('creates a throwaway team via `team create`', () => {
    const res = runCli([
      'team',
      'create',
      orgId,
      '--name',
      teamName,
      '--desc',
      'e2e test',
      '--icon',
      'https://example.com/icon.png',
    ]);
    expect(res.status, res.stderr).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body.id).toBeTruthy();
    createdTeamId = body.id;
  });

  it('`team get` returns the just-created team', () => {
    if (!createdTeamId) throw new Error('create step must run first');
    const res = runCli(['team', 'get', orgId, createdTeamId]);
    expect(res.status, res.stderr).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body.id).toBe(createdTeamId);
    expect(body.name).toBe(teamName);
  });

  it('`team list` includes the new team somewhere in pagination', () => {
    if (!createdTeamId) throw new Error('create step must run first');
    // Bump perPage so we don't miss it under paging defaults.
    const res = runCli(['team', 'list', orgId, '--limit', '200']);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain(createdTeamId);
  });

  it('`team delete --ids` removes the team', () => {
    if (!createdTeamId) throw new Error('create step must run first');
    const res = runCli(['team', 'delete', orgId, '--ids', createdTeamId]);
    expect(res.status, res.stderr).toBe(0);
    // Delete returns { status: 200 } on success; good enough proof. We
    // don't assert `team get` 404s afterward because the backend soft-
    // deletes teams (the record is still retrievable by id post-delete).
  });
});
