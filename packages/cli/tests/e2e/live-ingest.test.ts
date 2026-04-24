// Live ingest e2e: emit real governance events against openbox-core so the
// backend's session / observability / span rows get populated by workers
// (governance + observability on temporal), then exercise write-paths that
// can't be validated against seeded CSV data:
//
//   - session terminate (PATCH against a live pending session)
//
// Requires the full local stack: backend + keycloak + postgres + redis
// (from up.sh), plus postgres-backed temporal + openbox-core server +
// 3 workers (from scripts/core-up.sh). If CORE_URL isn't reachable the
// suite skips gracefully.
//
// NOT covered here (needs more services):
//   - approval decide - needs a REQUIRE_APPROVAL verdict, which comes from
//     OPA policy eval or AGE goal-alignment eval; both deliberately unset
//     in the local env, so no path produces a pending approval.
//   - violation false-positive - needs a guardrail/policy-driven
//     violation; same reason.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCli } from '../helpers/cli-runner.js';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

const CORE_URL = process.env.OPENBOX_CORE_URL || 'http://localhost:8086';

const CAN_RUN = existsSync(resolve(__dirname, '../../dist/index.js'))
  && existsSync(resolve(__dirname, '../../.tokens'))
  && !!process.env.OPENBOX_ORG_ID;

async function coreReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${CORE_URL}/api/v1/auth/validate`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    // /auth/validate returns 401 without a token; any response means the
    // core server is answering.
    return r.status >= 200 && r.status < 600;
  } catch {
    return false;
  }
}

async function emitGovernanceEvent(token: string, workflowId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${CORE_URL}/api/v1/governance/evaluate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-OpenBox-SDK-Version': '0.0.0-test',
    },
    body: JSON.stringify({
      source: 'workflow-telemetry',
      event_type: 'WorkflowStarted',
      workflow_id: workflowId,
      run_id: randomUUID(),
      workflow_type: 'LiveIngestTestWorkflow',
      task_queue: 'test-queue',
      timestamp: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`core /governance/evaluate ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

function extractToken(rotateStdout: string): string {
  const m = rotateStdout.match(/"obx_test_[a-f0-9]+"/);
  if (!m) throw new Error(`no obx_test_ token in rotate output: ${rotateStdout.slice(0, 300)}`);
  return m[0].replace(/"/g, '');
}

function jsonAfterHeader(stdout: string): unknown {
  // Several CLI list commands emit a header line like `N sessions\n[...]`
  // before the JSON payload. Strip to the first `[` or `{`.
  const i = Math.min(
    ...[stdout.indexOf('['), stdout.indexOf('{')].filter((n) => n >= 0),
  );
  return JSON.parse(stdout.slice(i));
}

let canRunLive = false;

describe('live ingest (e2e, real backend + core + temporal)', () => {
  const orgId = process.env.OPENBOX_ORG_ID!;
  const stamp = Date.now();
  const workflowId = `live-ingest-wf-${stamp}`;
  let teamId: string | undefined;
  let agentId: string | undefined;
  let agentToken: string | undefined;
  let sessionId: string | undefined;

  beforeAll(async () => {
    if (!CAN_RUN) return;
    canRunLive = await coreReachable();
    if (!canRunLive) {
      console.warn(
        `[live-ingest] core not reachable at ${CORE_URL} - skipping suite. ` +
          'Run `bash scripts/core-up.sh` from openbox-dev-setup to bring it up.',
      );
      return;
    }

    const t = runCli(['team', 'create', orgId, '--name', `live-${stamp}`, '--icon', 'https://ex/x.png']);
    expect(t.status, t.stderr).toBe(0);
    teamId = JSON.parse(t.stdout).id;

    const a = runCli(['agent', 'create', '-n', `live-${stamp}`, '-t', teamId!, '--icon', 'robot']);
    expect(a.status, a.stderr).toBe(0);
    const body = JSON.parse(a.stdout);
    agentId = (body.agent ?? body.data?.agent ?? body).id;
    agentToken = body.token ?? body.data?.token;
    expect(agentId && agentToken).toBeTruthy();

    // The token issued on create is the raw obx_test_... Use it directly.
    const verdict = await emitGovernanceEvent(agentToken!, workflowId);
    expect(verdict.verdict).toBe('allow');

    // Backend writes the session async during workflow; poll briefly.
    for (let i = 0; i < 20; i++) {
      const r = runCli(['session', 'list', agentId!, '--limit', '20']);
      if (r.status === 0) {
        const list = jsonAfterHeader(r.stdout) as Array<{ id: string; workflow_id: string }>;
        const hit = list.find((s) => s.workflow_id === workflowId);
        if (hit) {
          sessionId = hit.id;
          break;
        }
      }
      await new Promise((res) => setTimeout(res, 250));
    }
    expect(sessionId, 'session never appeared after live ingest').toBeTruthy();
  });

  afterAll(() => {
    if (!canRunLive) return;
    if (agentId) runCli(['agent', 'delete', agentId]);
    if (teamId) runCli(['team', 'delete', orgId, '--ids', teamId]);
  });

  it('`session list` shows the live session', () => {
    if (!canRunLive) return;
    const res = runCli(['session', 'list', agentId!, '--limit', '20']);
    expect(res.status, res.stderr).toBe(0);
    const list = jsonAfterHeader(res.stdout) as Array<{ id: string }>;
    expect(list.some((s) => s.id === sessionId)).toBe(true);
  });

  it('`session get` returns the live session', () => {
    if (!canRunLive) return;
    const res = runCli(['session', 'get', agentId!, sessionId!]);
    expect(res.status, res.stderr).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body.id).toBe(sessionId);
    expect(body.workflow_id).toBe(workflowId);
  });

  it('`session logs` returns the ingested WorkflowStarted event', () => {
    if (!canRunLive) return;
    const res = runCli(['session', 'logs', agentId!, sessionId!]);
    expect(res.status, res.stderr).toBe(0);
    const logs = jsonAfterHeader(res.stdout) as Array<{ event_type: string }>;
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.event_type === 'WorkflowStarted')).toBe(true);
  });

  it('`observe logs` surfaces the ingested event on the agent', () => {
    if (!canRunLive) return;
    const res = runCli(['observe', 'logs', agentId!]);
    expect(res.status, res.stderr).toBe(0);
    const logs = jsonAfterHeader(res.stdout) as Array<{ workflow_id: string }>;
    expect(logs.some((l) => l.workflow_id === workflowId)).toBe(true);
  });

  it('`session terminate` flips the live session off pending', () => {
    if (!canRunLive) return;
    const term = runCli(['session', 'terminate', agentId!, sessionId!]);
    expect(term.status, term.stderr).toBe(0);

    const after = runCli(['session', 'get', agentId!, sessionId!]);
    expect(after.status, after.stderr).toBe(0);
    const body = JSON.parse(after.stdout);
    expect(body.status).not.toBe('pending');
  });
});
