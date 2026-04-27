// Goal alignment lifecycle e2e: update goal settings on a fresh agent and
// read back trends/drifts (expected empty for a brand-new agent). Just
// exercises the CLI → backend contract, not meaningful analytics.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCli } from '../helpers/cli-runner.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

const CAN_RUN = existsSync(resolve(__dirname, '../../dist/index.js'))
  && existsSync(resolve(__dirname, '../../.tokens'))
  && !!process.env.OPENBOX_ORG_ID;

const describeOrSkip = CAN_RUN ? describe : describe.skip;

describeOrSkip('goal lifecycle (e2e, real backend)', () => {
  const orgId = process.env.OPENBOX_ORG_ID!;
  const stamp = Date.now();
  let teamId: string | undefined;
  let agentId: string | undefined;

  beforeAll(() => {
    const t = runCli(['team', 'create', orgId, '--name', `goal-lc-${stamp}`, '--icon', 'https://ex/x.png']);
    expect(t.status, t.stderr).toBe(0);
    teamId = JSON.parse(t.stdout).id;
    const a = runCli(['agent', 'create', '-n', `goal-lc-${stamp}`, '-t', teamId!, '--icon', 'robot']);
    expect(a.status, a.stderr).toBe(0);
    agentId = (JSON.parse(a.stdout).agent ?? JSON.parse(a.stdout).data?.agent ?? JSON.parse(a.stdout)).id;
  });

  afterAll(() => {
    if (agentId) runCli(['agent', 'delete', agentId]);
    if (teamId) runCli(['team', 'delete', orgId, '--ids', teamId]);
  });

  it('`goal update --threshold --action alert_only` succeeds', () => {
    const res = runCli([
      'goal', 'update', agentId!,
      '--threshold', '70',
      '--action', 'alert_only',
      '--frequency', 'every_10_actions',
      '--model', 'gpt-4o-mini',
    ]);
    expect(res.status, res.stderr).toBe(0);
  });

  it('`goal trend` returns a response (empty for fresh agent is fine)', () => {
    const res = runCli(['goal', 'trend', agentId!]);
    expect(res.status, res.stderr).toBe(0);
  });

  it('`goal drifts` returns a response (empty for fresh agent is fine)', () => {
    const res = runCli(['goal', 'drifts', agentId!, '--limit', '10']);
    expect(res.status, res.stderr).toBe(0);
  });
});
