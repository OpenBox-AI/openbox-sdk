// Live approval decide e2e: drives the full policy → OPA → approval path.
//
// Requires the full local stack from openbox-dev-setup:
//   - backend, keycloak, postgres, redis  (up.sh)
//   - postgres-backed temporal             (docker-compose.temporal.yml)
//   - core server + 3 workers              (scripts/core-up.sh)
//   - motoserver (KMS + S3 + STS)          (docker-compose.aws.yml)
//   - OPA on :8181 pulling bundles from moto S3 (scripts/opa-up.sh)
//
// Skips gracefully if core or OPA isn't reachable.
//
// Flow per case:
//   1. Create team + agent (CLI).
//   2. Attach a policy whose Rego returns REQUIRE_APPROVAL for any
//      ActivityCompleted event. Backend rewrites the package to
//      org.openbox_local.policy_<id>, uploads a bundle to moto S3; OPA
//      polls and exposes /v1/data/org/openbox_local/policy_<id>.
//   3. Emit WorkflowStarted to core (creates a session) then
//      ActivityCompleted; OPA returns REQUIRE_APPROVAL, core stores the
//      governance event with verdict=REQUIRE_APPROVAL and returns
//      {verdict: "require_approval"} to the caller.
//   4. `approval pending <agentId>` lists the event.
//   5. `approval decide <agentId> <eventId> <approve|reject>` flips the
//      DB verdict to ALLOW or HALT.
//   6. `approval history <agentId>` shows it in the appropriate bucket.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCli } from '../helpers/cli-runner.js';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

const CORE_URL = process.env.OPENBOX_CORE_URL || 'http://localhost:8086';
const OPA_URL = process.env.OPA_URL || 'http://localhost:8181';
// How long OPA takes to pick up a new bundle. opa-up.sh polls every 3-5s,
// so 8s gives us one full cycle plus headroom. Bumpable via env.
const OPA_PULL_WAIT_MS = Number(process.env.OPA_PULL_WAIT_MS || 8000);

// This test needs the local stack (moto S3 for OPA bundles + opa-up.sh
// pulling them). Staging/prod don't expose a bundle-pull surface, so the
// test gates strictly on a localhost API URL plus the usual CLI setup.
const apiUrl = process.env.OPENBOX_API_URL || 'https://api.openbox.ai';
const isLocalStack =
  apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1');
const CAN_RUN =
  existsSync(resolve(__dirname, '../../../dist/index.js')) &&
  existsSync(resolve(__dirname, '../../../.tokens')) &&
  !!process.env.OPENBOX_ORG_ID &&
  isLocalStack;

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
    workflow_type: 'LiveApprovalTest',
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
  const m = cliOut.match(/"token":\s*"(obx_(?:live|test)_[a-f0-9]+)"/);
  if (!m) throw new Error(`no obx_(live|test)_ token in output: ${cliOut.slice(0, 200)}`);
  return m[1];
}

// Wait until OPA serves the just-attached policy. Without this we race the
// bundle-pull poll and the ActivityCompleted event returns "allow" (OPA
// still has the previous bundle, where this policy doesn't exist).
async function waitForOpaPolicy(
  policyIdNoDashes: string,
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
      if (body?.result?.result?.decision === 'REQUIRE_APPROVAL') return;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(
    `OPA didn't serve policy ${policyIdNoDashes} after ${timeoutMs}ms - ` +
      'check opa-up.sh is pulling the bundle from moto S3',
  );
}

const REGO = `package org.openbox_ai.live_approval_test

default result := {"decision": "CONTINUE", "reason": "default"}

result := {"decision": "REQUIRE_APPROVAL", "reason": "live-approval-e2e"} if {
  input.event_type == "ActivityCompleted"
}`;

let canRunLive = false;

describe('live approval decide (e2e, real stack with OPA + moto)', () => {
  const orgId = process.env.OPENBOX_ORG_ID!;
  const stamp = Date.now();

  // Shared across cases: new agent+policy per case, so each has a fresh
  // pending approval to decide.
  let teamId: string | undefined;

  beforeAll(async () => {
    if (!CAN_RUN) return;
    canRunLive =
      (await reachable(`${CORE_URL}/api/v1/auth/validate`)) &&
      (await reachable(`${OPA_URL}/health`));
    if (!canRunLive) {
      console.warn(
        `[live-approval] core (${CORE_URL}) or OPA (${OPA_URL}) not reachable - skipping suite. ` +
          'Run scripts/core-up.sh + scripts/opa-up.sh from openbox-dev-setup.',
      );
      return;
    }
    const t = runCli(['team', 'create', orgId, '--name', `appr-${stamp}`, '--icon', 'https://ex/x.png']);
    expect(t.status, t.stderr).toBe(0);
    teamId = JSON.parse(t.stdout).id;
  }, 30000);

  afterAll(() => {
    if (!canRunLive) return;
    if (teamId) runCli(['team', 'delete', orgId, '--ids', teamId]);
  });

  async function runCase(decision: 'approve' | 'reject') {
    if (!canRunLive) return;
    const suffix = `${decision}-${Date.now()}`;
    // Fresh agent + policy per case
    const a = runCli(['agent', 'create', '-n', `appr-${suffix}`, '-t', teamId!, '--icon', 'robot']);
    expect(a.status, a.stderr).toBe(0);
    const agentId = extractId(a.stdout);
    const token = extractToken(a.stdout);

    try {
      const p = runCli(['policy', 'create', agentId, '-n', `appr-policy-${suffix}`, '--rego', REGO]);
      expect(p.status, p.stderr).toBe(0);
      const policyId = extractId(p.stdout);
      const policyIdNoDashes = policyId.replace(/-/g, '');

      await waitForOpaPolicy(policyIdNoDashes, OPA_PULL_WAIT_MS);

      const wf = `live-appr-${suffix}`;
      const run = randomUUID();
      await emitEvent(token, 'WorkflowStarted', wf, run);
      const verdict = await emitEvent(token, 'ActivityCompleted', wf, run);
      expect(verdict.verdict).toBe('require_approval');
      const eventId = verdict.governance_event_id as string;

      const pending = runCli(['approval', 'pending', agentId]);
      expect(pending.status, pending.stderr).toBe(0);
      const pendingList = jsonAfterHeader(pending.stdout) as Array<{ id: string; verdict: number }>;
      const hit = pendingList.find((e) => e.id === eventId);
      expect(hit, 'event should be in pending list').toBeTruthy();
      expect(hit!.verdict).toBe(2); // REQUIRE_APPROVAL

      const decide = runCli(['approval', 'decide', agentId, eventId, decision]);
      expect(decide.status, decide.stderr).toBe(0);

      // Decision updates DB verdict immediately (it's not signal-based).
      const hist = runCli(['approval', 'history', agentId]);
      expect(hist.status, hist.stderr).toBe(0);
      const histList = jsonAfterHeader(hist.stdout) as Array<{ id: string; verdict: number }>;
      const decided = histList.find((e) => e.id === eventId);
      expect(decided, 'event should be in history').toBeTruthy();
      // 0 = ALLOW (approve), 4 = HALT (reject). See governance-event.service.ts.
      const expectedVerdict = decision === 'approve' ? 0 : 4;
      expect(decided!.verdict).toBe(expectedVerdict);
    } finally {
      runCli(['agent', 'delete', agentId]);
    }
  }

  // SKIP: depends on `policy create` reaching S3 - blocked by the same
  // upstream backend fix (S3Service path-style for moto). Patch ready on
  // openbox-backend bug/s3-force-path-style; re-enable once that lands.
  // Verified locally with patch loaded: 2/2 pass.
  it.skip('`approval decide approve` flips verdict to ALLOW', async () => {
    await runCase('approve');
  }, 60000);

  it.skip('`approval decide reject` flips verdict to HALT', async () => {
    await runCase('reject');
  }, 60000);
});
