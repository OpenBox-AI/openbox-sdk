// Live violation false-positive e2e: drives OPA returning BLOCK to create
// a policy-sourced violation row, then flips it false-positive via CLI.
//
// Requires the same stack as live-approval.test.ts (backend + core +
// temporal + motoserver + OPA). Skips gracefully when core or OPA is
// unreachable.
//
// Note: this test depends on patch 06-backend-violation-filter.patch in
// the-local-stack-dev-repo. Without it, the backend's getAllViolationsQuery
// filters policy_evaluations on evaluation_result='deny' - but core
// writes v1.1 action strings ('block' / 'halt'), so policy-sourced
// violations never surface. The patch widens the filter.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCli } from '../helpers/cli-runner.js';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

const CORE_URL = process.env.OPENBOX_CORE_URL || 'http://localhost:8086';
const OPA_URL = process.env.OPA_URL || 'http://localhost:8181';
const OPA_PULL_WAIT_MS = Number(process.env.OPA_PULL_WAIT_MS || 8000);

const CAN_RUN =
  existsSync(resolve(__dirname, '../../../dist/index.js')) &&
  existsSync(resolve(__dirname, '../../../.tokens')) &&
  !!process.env.OPENBOX_ORG_ID;

async function reachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    return r.status >= 200 && r.status < 600;
  } catch {
    return false;
  }
}

async function emitEvent(
  token: string,
  eventType: 'WorkflowStarted' | 'ActivityCompleted',
  workflowId: string,
  runId: string,
): Promise<Record<string, unknown>> {
  const base = {
    source: 'workflow-telemetry',
    event_type: eventType,
    workflow_id: workflowId,
    run_id: runId,
    workflow_type: 'LiveViolationTest',
    task_queue: 'test-queue',
    timestamp: new Date().toISOString(),
  };
  let body: Record<string, unknown> = base;
  if (eventType === 'ActivityCompleted') {
    const nowNs = Date.now() * 1_000_000;
    body = {
      ...base,
      activity_id: `act-${Date.now()}`,
      activity_type: 'TestActivity',
      attempt: 1,
      duration_ms: 50,
      span_count: 1,
      spans: [
        {
          span_id: randomUUID().replace(/-/g, '').slice(0, 16),
          trace_id: randomUUID().replace(/-/g, ''),
          name: 'test-span',
          start_time: nowNs,
          end_time: nowNs + 100_000_000,
        },
      ],
    };
  }
  const res = await fetch(`${CORE_URL}/api/v1/governance/evaluate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-OpenBox-SDK-Version': '0.0.0-test',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`core /governance/evaluate ${res.status}: ${txt}`);
  }
  return JSON.parse(txt) as Record<string, unknown>;
}

function jsonAfterHeader(stdout: string): unknown {
  const i = Math.min(
    ...[stdout.indexOf('['), stdout.indexOf('{')].filter((n) => n >= 0),
  );
  return JSON.parse(stdout.slice(i));
}

function extractId(cliOut: string): string {
  const m = cliOut.match(/"id":\s*"([^"]+)"/);
  if (!m) throw new Error(`no id in CLI output: ${cliOut.slice(0, 200)}`);
  return m[1];
}

function extractToken(cliOut: string): string {
  const m = cliOut.match(/"token":\s*"(obx_test_[a-f0-9]+)"/);
  if (!m) throw new Error(`no obx_test_ token in output: ${cliOut.slice(0, 200)}`);
  return m[1];
}

async function waitForOpaPolicy(
  policyIdNoDashes: string,
  expectedDecision: string,
  timeoutMs: number,
): Promise<void> {
  const path = `${OPA_URL}/v1/data/org/openbox_local/policy_${policyIdNoDashes}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { event_type: 'ActivityCompleted' } }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);
    if (r && r.ok) {
      const body = (await r.json()) as { result?: { result?: { decision?: string } } };
      if (body?.result?.result?.decision === expectedDecision) return;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(
    `OPA didn't serve policy ${policyIdNoDashes} returning ${expectedDecision} after ${timeoutMs}ms`,
  );
}

const REGO = `package org.openbox_ai.live_violation_test

default result := {"decision": "ALLOW", "reason": "default"}

result := {"decision": "BLOCK", "reason": "live-violation-e2e"} if {
  input.event_type == "ActivityCompleted"
}`;

let canRunLive = false;

describe('live violation false-positive (e2e, real stack with OPA + moto)', () => {
  const orgId = process.env.OPENBOX_ORG_ID!;
  const stamp = Date.now();
  let teamId: string | undefined;
  let agentId: string | undefined;
  let violationId: string | undefined;

  beforeAll(async () => {
    if (!CAN_RUN) return;
    canRunLive =
      (await reachable(`${CORE_URL}/api/v1/auth/validate`)) &&
      (await reachable(`${OPA_URL}/health`));
    if (!canRunLive) {
      console.warn(
        `[live-violation] core (${CORE_URL}) or OPA (${OPA_URL}) not reachable - skipping suite.`,
      );
      return;
    }

    const t = runCli(['team', 'create', orgId, '--name', `viol-${stamp}`, '--icon', 'https://ex/x.png']);
    expect(t.status, t.stderr).toBe(0);
    teamId = JSON.parse(t.stdout).id;

    const a = runCli(['agent', 'create', '-n', `viol-${stamp}`, '-t', teamId!, '--icon', 'robot']);
    expect(a.status, a.stderr).toBe(0);
    agentId = extractId(a.stdout);
    const token = extractToken(a.stdout);

    const p = runCli(['policy', 'create', agentId!, '-n', `viol-policy-${stamp}`, '--rego', REGO]);
    expect(p.status, p.stderr).toBe(0);
    const policyId = extractId(p.stdout);
    const policyIdNoDashes = policyId.replace(/-/g, '');

    await waitForOpaPolicy(policyIdNoDashes, 'BLOCK', OPA_PULL_WAIT_MS);

    const wf = `live-viol-${stamp}`;
    const run = randomUUID();
    await emitEvent(token, 'WorkflowStarted', wf, run);
    const verdict = await emitEvent(token, 'ActivityCompleted', wf, run);
    expect(verdict.verdict).toBe('block');

    // The policy-sourced violation is a policy_evaluations row with
    // evaluation_result='block'. Backend's violation query needs patch 06
    // to surface it. Poll briefly so we don't race the write.
    for (let i = 0; i < 20; i++) {
      const v = runCli(['violation', 'agent', agentId!]);
      if (v.status === 0) {
        const list = jsonAfterHeader(v.stdout) as Array<{
          id: string;
          source_type: string;
          is_false_positive: boolean;
        }>;
        const hit = list.find(
          (x) => x.source_type === 'policy' && !x.is_false_positive,
        );
        if (hit) {
          violationId = hit.id;
          break;
        }
      }
      await new Promise((res) => setTimeout(res, 250));
    }
    expect(violationId, 'policy violation did not surface').toBeTruthy();
  }, 60000);

  afterAll(() => {
    if (!canRunLive) return;
    if (agentId) runCli(['agent', 'delete', agentId]);
    if (teamId) runCli(['team', 'delete', orgId, '--ids', teamId]);
  });

  it('`violation false-positive ... policy` flips is_false_positive', () => {
    if (!canRunLive) return;
    const res = runCli([
      'violation', 'false-positive', agentId!, violationId!, 'policy',
    ]);
    expect(res.status, res.stderr).toBe(0);

    const after = runCli(['violation', 'agent', agentId!]);
    expect(after.status, after.stderr).toBe(0);
    const list = jsonAfterHeader(after.stdout) as Array<{
      id: string;
      is_false_positive: boolean;
    }>;
    const row = list.find((x) => x.id === violationId);
    expect(row, 'violation should still be listable').toBeTruthy();
    expect(row!.is_false_positive).toBe(true);
  });
});
