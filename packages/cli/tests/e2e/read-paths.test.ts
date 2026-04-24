// Backend-only read paths: session/violation/trust/approval/observability
// list endpoints with no upstream data. These validate CLI → backend
// contract (URL + auth + envelope unwrap) with expected-empty results on a
// brand-new agent. They do NOT validate core-produced analytics; that
// requires a running openbox-core + SDK test agent, tracked separately.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCli } from '../helpers/cli-runner.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

const CAN_RUN = existsSync(resolve(__dirname, '../../dist/index.js'))
  && existsSync(resolve(__dirname, '../../.tokens'))
  && !!process.env.OPENBOX_ORG_ID;

const describeOrSkip = CAN_RUN ? describe : describe.skip;

describeOrSkip('backend-only read paths (e2e, real backend)', () => {
  const orgId = process.env.OPENBOX_ORG_ID!;
  const stamp = Date.now();
  let teamId: string | undefined;
  let agentId: string | undefined;

  beforeAll(() => {
    const t = runCli(['team', 'create', orgId, '--name', `read-lc-${stamp}`, '--icon', 'https://ex/x.png']);
    expect(t.status, t.stderr).toBe(0);
    teamId = JSON.parse(t.stdout).id;
    const a = runCli(['agent', 'create', '-n', `read-lc-${stamp}`, '-t', teamId!, '--icon', 'robot']);
    expect(a.status, a.stderr).toBe(0);
    agentId = (JSON.parse(a.stdout).agent ?? JSON.parse(a.stdout).data?.agent ?? JSON.parse(a.stdout)).id;
  });

  afterAll(() => {
    if (agentId) runCli(['agent', 'delete', agentId]);
    if (teamId) runCli(['team', 'delete', orgId, '--ids', teamId]);
  });

  // --- session -----------------------------------------------------------

  it('`session list` returns an empty page for a fresh agent', () => {
    const res = runCli(['session', 'list', agentId!, '--limit', '10']);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });

  it('`session active` returns an empty list for a fresh agent', () => {
    const res = runCli(['session', 'active', agentId!]);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });

  // --- violation ---------------------------------------------------------

  it('`violation list` returns a response', () => {
    const res = runCli(['violation', 'list']);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });

  it('`violation agent` returns an empty list for a fresh agent', () => {
    const res = runCli(['violation', 'agent', agentId!, '--limit', '10']);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });

  // --- trust -------------------------------------------------------------

  it('`trust histories` returns a response', () => {
    const res = runCli(['trust', 'histories', agentId!]);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });

  it('`trust events` returns a response', () => {
    const res = runCli(['trust', 'events', agentId!]);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });

  it('`trust tier-changes` returns a response', () => {
    const res = runCli(['trust', 'tier-changes', agentId!]);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });

  // --- approval ----------------------------------------------------------

  it('`approval pending` returns an empty list for a fresh agent', () => {
    const res = runCli(['approval', 'pending', agentId!]);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });

  it('`approval history` returns an empty list for a fresh agent', () => {
    const res = runCli(['approval', 'history', agentId!]);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });

  it('`approval metrics` returns a metrics payload', () => {
    const res = runCli(['approval', 'metrics', agentId!]);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });

  // --- observe -----------------------------------------------------------

  it('`observe data` returns a response', () => {
    const res = runCli(['observe', 'data', agentId!]);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });

  it('`observe issues` returns a response', () => {
    const res = runCli(['observe', 'issues', agentId!]);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });

  it('`observe metrics` returns a response', () => {
    const res = runCli(['observe', 'metrics']);
    expect(res.status, res.stderr).toBe(0);
    JSON.parse(res.stdout);
  });
});
