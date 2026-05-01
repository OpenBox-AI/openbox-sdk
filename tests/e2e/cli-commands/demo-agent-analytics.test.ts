// Analytics read paths that need populated upstream data: sessions,
// violations, trust history, approvals, observability. Standing up
// the full stack just to produce this data is a multi-service
// orchestration job; instead we rely on the backend's built-in
// `seed-demo-agent` command, which inserts CSV-derived rows for a
// demo agent. This suite looks that agent up at runtime, skips
// gracefully when none exists, and re-seeds via
// `bash scripts/seed-demo.sh`.

import { describe, it, expect, beforeAll } from 'vitest';
import { runCli } from '../helpers/cli-runner.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

const CAN_RUN = existsSync(resolve(__dirname, '../../../dist/index.js'))
  && existsSync(resolve(__dirname, '../../../.tokens'))
  && !!process.env.OPENBOX_ORG_ID;

const describeOrSkip = CAN_RUN ? describe : describe.skip;

function findDemoAgentId(): string | undefined {
  const res = runCli(['agent', 'list', '--limit', '200']);
  if (res.status !== 0) return undefined;
  // output is "N agents\n[...]"; strip the header line
  const jsonStart = res.stdout.indexOf('[');
  if (jsonStart < 0) return undefined;
  const agents = JSON.parse(res.stdout.slice(jsonStart));
  const demo = agents.find(
    (a: { agent_type?: string }) => a.agent_type === 'demo',
  );
  return demo?.id;
}

describeOrSkip('demo-agent analytics (e2e, real backend with seeded data)', () => {
  let agentId: string | undefined;
  let sessionId: string | undefined;

  beforeAll(() => {
    agentId = findDemoAgentId();
    if (!agentId) {
      console.warn(
        '[demo-agent-analytics] No demo agent found; run `bash scripts/seed-demo.sh` from the local-stack dev repo to seed one. Skipping suite.',
      );
      return;
    }
    const res = runCli(['session', 'list', agentId, '--limit', '1']);
    expect(res.status, res.stderr).toBe(0);
    const jsonStart = res.stdout.indexOf('[');
    const list = JSON.parse(res.stdout.slice(jsonStart));
    sessionId = list[0]?.id;
  });

  // --- session read paths (populated) ------------------------------------

  it('`session list` returns non-empty sessions', () => {
    if (!agentId) return;
    const res = runCli(['session', 'list', agentId, '--limit', '10']);
    expect(res.status, res.stderr).toBe(0);
    const jsonStart = res.stdout.indexOf('[');
    const list = JSON.parse(res.stdout.slice(jsonStart));
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].agent_id).toBe(agentId);
  });

  it('`session get` returns the session detail', () => {
    if (!agentId || !sessionId) return;
    const res = runCli(['session', 'get', agentId, sessionId]);
    expect(res.status, res.stderr).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body.id).toBe(sessionId);
  });

  it('`session logs` returns non-empty logs for the session', () => {
    if (!agentId || !sessionId) return;
    const res = runCli(['session', 'logs', agentId, sessionId]);
    expect(res.status, res.stderr).toBe(0);
    const jsonStart = res.stdout.indexOf('[');
    const list = JSON.parse(res.stdout.slice(jsonStart));
    expect(list.length).toBeGreaterThan(0);
  });

  it('`session goal-stats` returns a stats payload', () => {
    if (!agentId || !sessionId) return;
    const res = runCli(['session', 'goal-stats', agentId, sessionId]);
    expect(res.status, res.stderr).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body).toHaveProperty('total_checked');
  });

  // --- violation (populated) ---------------------------------------------

  it('`violation agent` returns non-empty violations for the demo agent', () => {
    if (!agentId) return;
    const res = runCli(['violation', 'agent', agentId]);
    expect(res.status, res.stderr).toBe(0);
    const jsonStart = res.stdout.indexOf('[');
    const list = JSON.parse(res.stdout.slice(jsonStart));
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].agent_id).toBe(agentId);
  });

  // --- trust (populated) -------------------------------------------------

  it('`trust histories` returns daily score points', () => {
    if (!agentId) return;
    const res = runCli(['trust', 'histories', agentId]);
    expect(res.status, res.stderr).toBe(0);
    const list = JSON.parse(res.stdout);
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toHaveProperty('score');
  });

  it('`trust events` returns trust events', () => {
    if (!agentId) return;
    const res = runCli(['trust', 'events', agentId]);
    expect(res.status, res.stderr).toBe(0);
    const jsonStart = res.stdout.indexOf('[');
    const list = JSON.parse(res.stdout.slice(jsonStart));
    expect(list.length).toBeGreaterThan(0);
  });

  it('`trust tier-changes` returns tier-change events', () => {
    if (!agentId) return;
    const res = runCli(['trust', 'tier-changes', agentId]);
    expect(res.status, res.stderr).toBe(0);
    const jsonStart = res.stdout.indexOf('[');
    const list = JSON.parse(res.stdout.slice(jsonStart));
    expect(list.length).toBeGreaterThan(0);
  });

  // --- approval (populated) ----------------------------------------------

  it('`approval history` returns decided approvals', () => {
    if (!agentId) return;
    const res = runCli(['approval', 'history', agentId]);
    expect(res.status, res.stderr).toBe(0);
    const jsonStart = res.stdout.indexOf('[');
    const list = JSON.parse(res.stdout.slice(jsonStart));
    expect(list.length).toBeGreaterThan(0);
  });

  it('`approval metrics` returns counts', () => {
    if (!agentId) return;
    const res = runCli(['approval', 'metrics', agentId]);
    expect(res.status, res.stderr).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body).toHaveProperty('approved');
  });

  // --- observe (populated) -----------------------------------------------

  it('`observe data` returns invocation stats', () => {
    if (!agentId) return;
    const res = runCli(['observe', 'data', agentId]);
    expect(res.status, res.stderr).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body).toHaveProperty('invocations');
  });

  it('`observe issues` returns non-empty issues', () => {
    if (!agentId) return;
    const res = runCli(['observe', 'issues', agentId]);
    expect(res.status, res.stderr).toBe(0);
    const jsonStart = res.stdout.indexOf('[');
    const list = JSON.parse(res.stdout.slice(jsonStart));
    expect(list.length).toBeGreaterThan(0);
  });

  it('`observe logs` returns non-empty logs', () => {
    if (!agentId) return;
    const res = runCli(['observe', 'logs', agentId]);
    expect(res.status, res.stderr).toBe(0);
    const jsonStart = res.stdout.indexOf('[');
    const list = JSON.parse(res.stdout.slice(jsonStart));
    expect(list.length).toBeGreaterThan(0);
  });

  it('`observe insights` returns violation + trust summaries', () => {
    if (!agentId) return;
    const res = runCli(['observe', 'insights', agentId]);
    expect(res.status, res.stderr).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body).toHaveProperty('violation');
  });
});
