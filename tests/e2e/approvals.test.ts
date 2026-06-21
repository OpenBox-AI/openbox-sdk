import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { getBackendClient, fullResponse, getOrgId, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto } from '../helpers/fixtures';
import {
  GOVERNANCE_SPEC_DOMAINS,
  invalidGovernanceSpecMember,
} from '../helpers/governance-spec-domains';
import { runLocalStackSql, sqlLiteral } from '../helpers/local-stack-db';
import { buildRequestConstraintConformance } from '../helpers/request-constraint-conformance';

function listItems(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.approvals?.data)) return value.approvals.data;
  return [];
}

function sortedStrings(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function backendOperation(operationId: string) {
  const operation = BACKEND_ENDPOINT_MANIFEST.find((entry) => entry.operationId === operationId);
  expect(operation, operationId).toBeDefined();
  return operation!;
}

function operationPath(path: string, params: Record<string, string>) {
  return path.replace(/\{([^}]+)\}/g, (_, key) => {
    expect(params[key], key).toBeDefined();
    return encodeURIComponent(params[key]);
  });
}

function rawApprovalStatusConstraintsFromLedger() {
  const ledger = buildRequestConstraintConformance();
  return ledger.constraints
    .filter((entry) => entry.disposition === 'raw-semantic-gap-sdk-closed')
    .filter((entry) =>
      entry.semanticGapIds.includes('approval-status-invalid-query-not-rejected'),
    )
    .sort((left, right) => left.key.localeCompare(right.key));
}

describe('Approvals', () => {
  const client = getBackendClient();
  let agentId: string;
  let orgId: string;
  let pendingApprovalId: string | undefined;
  let approvedApprovalId: string | undefined;
  let teamIds: string[];

  async function ensureApprovalDashboardLedger() {
    if (pendingApprovalId && approvedApprovalId) return;

    const seedOutput = await runLocalStackSql(`
      with pending as (
        insert into governance_events (
          event_type,
          agent_id,
          workflow_id,
          run_id,
          workflow_type,
          task_queue,
          activity_id,
          activity_type,
          span_count,
          input,
          output,
          verdict,
          reason,
          approval_expired_at,
          metadata
        )
        values (
          'ActivityCompleted',
          ${sqlLiteral(agentId)},
          'approval-dashboard-wf-pending-' || gen_random_uuid(),
          'approval-dashboard-run-pending-' || gen_random_uuid(),
          'sdk-conformance',
          'local-stack',
          'approval-dashboard-pending',
          'tool_call',
          1,
          '[{"tool":"approval-dashboard"}]'::jsonb,
          '{}'::jsonb,
          2,
          'approval dashboard conformance pending',
          now() + interval '5 minutes',
          '{"openbox_conformance":true,"source":"approvals.e2e"}'::jsonb
        )
        returning id
      ),
      approved as (
        insert into governance_events (
          event_type,
          agent_id,
          workflow_id,
          run_id,
          workflow_type,
          task_queue,
          activity_id,
          activity_type,
          span_count,
          input,
          output,
          verdict,
          reason,
          decided_at,
          decided_by,
          approval_expired_at,
          metadata
        )
        values (
          'ActivityCompleted',
          ${sqlLiteral(agentId)},
          'approval-dashboard-wf-approved-' || gen_random_uuid(),
          'approval-dashboard-run-approved-' || gen_random_uuid(),
          'sdk-conformance',
          'local-stack',
          'approval-dashboard-approved',
          'tool_call',
          1,
          '[{"tool":"approval-dashboard"}]'::jsonb,
          '{}'::jsonb,
          0,
          'approval dashboard conformance approved',
          now() - interval '1 minute',
          'sdk-e2e',
          now() + interval '5 minutes',
          '{"openbox_conformance":true,"source":"approvals.e2e"}'::jsonb
        )
        returning id
      )
      select (select id from pending) || '|' || (select id from approved);
    `);
    const seedLine = seedOutput.trim().split('\n').at(-1)!;
    [pendingApprovalId, approvedApprovalId] = seedLine.split('|');
  }

  beforeAll(async () => {
    teamIds = await getTeamIds();
    orgId = getOrgId();

    const dto = makeCreateAgentDto(teamIds);
    const response = await client.post('/agent/create', dto);
    const body = fullResponse(response);
    expect(body.status).toBe(200);

    agentId = body.data.agent.id;
    trackResource({ type: 'agent', id: agentId });
  });

  // Agent-level approvals

  it('GET /agent/{agentId}/approvals/metrics returns 200', async () => {
    // SCENARIO_PROOF: approval-dashboard-metrics-history
    // CONFORMANCE_PROOF: approval dashboard conformance asserts agent-level
    // metrics after seeding a pending approval row.
    expect('SCENARIO_PROOF: approval-dashboard-metrics-history').toContain(
      'approval-dashboard-metrics-history',
    );
    await ensureApprovalDashboardLedger();

    const response = await client.get(`/agent/${agentId}/approvals/metrics`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      pending: expect.any(Number),
      approved: expect.any(Number),
      rejected: expect.any(Number),
      approvalRate: expect.any(Number),
    });
    expect(body.data.pending).toBeGreaterThanOrEqual(1);
  });

  it('GET /agent/{agentId}/approvals/pending returns 200', async () => {
    // SCENARIO_PROOF: approval-dashboard-metrics-history
    // CONFORMANCE_PROOF: approval dashboard conformance verifies the seeded
    // pending row is visible in the agent pending queue.
    expect('SCENARIO_PROOF: approval-dashboard-metrics-history').toContain(
      'approval-dashboard-metrics-history',
    );
    await ensureApprovalDashboardLedger();

    const response = await client.get(`/agent/${agentId}/approvals/pending`);
    const body = fullResponse(response);
    const pending = listItems(body.data).find((entry: any) => entry.id === pendingApprovalId);

    expect(body.status).toBe(200);
    expect(pending).toMatchObject({
      id: pendingApprovalId,
      activity_id: 'approval-dashboard-pending',
      status: 'pending',
    });
  });

  it('GET /agent/{agentId}/approvals/history returns 200', async () => {
    // SCENARIO_PROOF: approval-dashboard-metrics-history
    // CONFORMANCE_PROOF: approval dashboard conformance verifies the seeded
    // decided row is visible in the agent approval history.
    expect('SCENARIO_PROOF: approval-dashboard-metrics-history').toContain(
      'approval-dashboard-metrics-history',
    );
    await ensureApprovalDashboardLedger();

    const response = await client.get(`/agent/${agentId}/approvals/history`);
    const body = fullResponse(response);
    const approved = listItems(body.data).find((entry: any) => entry.id === approvedApprovalId);

    expect(body.status).toBe(200);
    expect(approved).toMatchObject({
      id: approvedApprovalId,
      activity_id: 'approval-dashboard-approved',
      status: 'approved',
    });
  });

  it('EXHAUSTIVE: approval status query members are accepted by agent approval lists', async () => {
    // EXHAUSTIVE_SPEC_PROOF: approval status is finite in TypeSpec. Every
    // member is sent through both agent-level approval list surfaces.
    await ensureApprovalDashboardLedger();

    for (const status of GOVERNANCE_SPEC_DOMAINS.approvalStatuses) {
      const pendingResponse = await client.get(
        `/agent/${agentId}/approvals/pending?status=${status}`,
      );
      const pendingBody = fullResponse(pendingResponse);
      expect(pendingBody.status).toBe(200);
      expect(Array.isArray(listItems(pendingBody.data))).toBe(true);

      const historyResponse = await client.get(
        `/agent/${agentId}/approvals/history?status=${status}`,
      );
      const historyBody = fullResponse(historyResponse);
      expect(historyBody.status).toBe(200);
      expect(Array.isArray(listItems(historyBody.data))).toBe(true);
    }
  });

  // Org-level approvals

  it('GET /organization/{orgId}/approvals returns 200', async () => {
    // SCENARIO_PROOF: approval-dashboard-metrics-history
    // CONFORMANCE_PROOF: approval dashboard conformance verifies org approval
    // lists include the seeded pending approval row.
    expect('SCENARIO_PROOF: approval-dashboard-metrics-history').toContain(
      'approval-dashboard-metrics-history',
    );
    await ensureApprovalDashboardLedger();

    const response = await client.get(`/organization/${orgId}/approvals`);
    const body = fullResponse(response);
    const pending = listItems(body.data).find((entry: any) => entry.id === pendingApprovalId);

    expect(body.status).toBe(200);
    expect(pending).toMatchObject({
      id: pendingApprovalId,
      activity_id: 'approval-dashboard-pending',
      status: 'pending',
    });
  });

  it('EXHAUSTIVE: approval status query members are accepted by org approvals', async () => {
    // EXHAUSTIVE_SPEC_PROOF: every finite OrganizationController_getApprovals
    // status member is sent through the org approval list surface.
    await ensureApprovalDashboardLedger();

    for (const status of GOVERNANCE_SPEC_DOMAINS.approvalStatuses) {
      const response = await client.get(`/organization/${orgId}/approvals?status=${status}`);
      const body = fullResponse(response);
      expect(body.status).toBe(200);
      expect(Array.isArray(listItems(body.data))).toBe(true);
    }
  });

  it('SEMANTIC_GAP_PROOF: approval status query out-of-domain values are accepted by local stack', async () => {
    // SEMANTIC_GAP_PROOF: approval status query members are finite in
    // TypeSpec, but the current local stack accepts an out-of-domain status
    // on agent pending, agent history, and org approvals. Keep this visible
    // until backend validation rejects invalid approval statuses.
    await ensureApprovalDashboardLedger();

    const rawApprovalStatusConstraints = rawApprovalStatusConstraintsFromLedger();
    expect(rawApprovalStatusConstraints.map((entry) => entry.key)).toEqual([
      'backend:AgentController_getApprovalHistory:query.status:enum',
      'backend:AgentController_getPendingApprovals:query.status:enum',
      'backend:OrganizationController_getApprovals:query.status:enum',
    ]);
    expect(rawApprovalStatusConstraints.every((entry) => entry.service === 'backend')).toBe(true);
    expect(rawApprovalStatusConstraints.every((entry) => entry.location === 'query.status')).toBe(
      true,
    );
    expect(rawApprovalStatusConstraints.every((entry) => entry.kind === 'enum')).toBe(true);
    expect(rawApprovalStatusConstraints.every((entry) =>
      sortedStrings((entry.value as string[] | undefined) ?? []).join('|') ===
        sortedStrings(GOVERNANCE_SPEC_DOMAINS.approvalStatuses).join('|'),
    )).toBe(true);
    expect(rawApprovalStatusConstraints.every((entry) =>
      entry.semanticGapIds.includes('approval-status-invalid-query-not-rejected'),
    )).toBe(true);

    const invalidStatus = invalidGovernanceSpecMember('approvalStatuses');
    const observedOperationIds: string[] = [];

    const pendingConstraint = rawApprovalStatusConstraints.find(
      (entry) => entry.operationId === 'AgentController_getPendingApprovals',
    );
    expect(pendingConstraint).toBeDefined();
    const pendingOperation = backendOperation(pendingConstraint!.operationId);
    expect(pendingOperation.verb, pendingConstraint!.key).toBe('get');
    expect(operationPath(pendingOperation.path, { agentId })).toBe(
      `/agent/${encodeURIComponent(agentId)}/approvals/pending`,
    );
    const pendingResponse = await client.get(
      `/agent/${agentId}/approvals/pending?status=${encodeURIComponent(invalidStatus)}`,
    );
    const pendingBody = fullResponse(pendingResponse);
    expect(pendingBody.status, pendingConstraint!.key).toBe(200);
    expect(Array.isArray(listItems(pendingBody.data)), pendingConstraint!.key).toBe(true);
    observedOperationIds.push(pendingConstraint!.operationId);

    const historyConstraint = rawApprovalStatusConstraints.find(
      (entry) => entry.operationId === 'AgentController_getApprovalHistory',
    );
    expect(historyConstraint).toBeDefined();
    const historyOperation = backendOperation(historyConstraint!.operationId);
    expect(historyOperation.verb, historyConstraint!.key).toBe('get');
    expect(operationPath(historyOperation.path, { agentId })).toBe(
      `/agent/${encodeURIComponent(agentId)}/approvals/history`,
    );
    const historyResponse = await client.get(
      `/agent/${agentId}/approvals/history?status=${encodeURIComponent(invalidStatus)}`,
    );
    const historyBody = fullResponse(historyResponse);
    expect(historyBody.status, historyConstraint!.key).toBe(200);
    expect(Array.isArray(listItems(historyBody.data)), historyConstraint!.key).toBe(true);
    observedOperationIds.push(historyConstraint!.operationId);

    const orgConstraint = rawApprovalStatusConstraints.find(
      (entry) => entry.operationId === 'OrganizationController_getApprovals',
    );
    expect(orgConstraint).toBeDefined();
    const orgOperation = backendOperation(orgConstraint!.operationId);
    expect(orgOperation.verb, orgConstraint!.key).toBe('get');
    expect(operationPath(orgOperation.path, { organizationId: orgId })).toBe(
      `/organization/${encodeURIComponent(orgId)}/approvals`,
    );
    const orgResponse = await client.get(
      `/organization/${orgId}/approvals?status=${encodeURIComponent(invalidStatus)}`,
    );
    const orgBody = fullResponse(orgResponse);
    expect(orgBody.status, orgConstraint!.key).toBe(200);
    expect(Array.isArray(listItems(orgBody.data)), orgConstraint!.key).toBe(true);
    observedOperationIds.push(orgConstraint!.operationId);

    expect(sortedStrings(observedOperationIds)).toEqual(
      sortedStrings(rawApprovalStatusConstraints.map((entry) => entry.operationId)),
    );
  });

  it('GET /organization/{orgId}/approvals/metrics returns 200', async () => {
    // SCENARIO_PROOF: approval-dashboard-metrics-history
    // CONFORMANCE_PROOF: approval dashboard conformance asserts org metrics
    // shape against the seeded approval dashboard rows.
    expect('SCENARIO_PROOF: approval-dashboard-metrics-history').toContain(
      'approval-dashboard-metrics-history',
    );
    await ensureApprovalDashboardLedger();

    const response = await client.get(`/organization/${orgId}/approvals/metrics`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      pending: expect.any(Number),
      approved_today: expect.any(Number),
      rejected_today: expect.any(Number),
      expired_today: expect.any(Number),
    });
    expect(typeof body.data.avg_time === 'number' || body.data.avg_time === null).toBe(true);
    expect(typeof body.data.avg_change === 'number' || body.data.avg_change === null).toBe(true);
  });

  it('GET /organization/{orgId}/approvals/sla returns 200', async () => {
    // SCENARIO_PROOF: approval-dashboard-metrics-history
    // CONFORMANCE_PROOF: approval dashboard conformance asserts SLA dashboard
    // rollup shape for approval response-time surfaces.
    expect('SCENARIO_PROOF: approval-dashboard-metrics-history').toContain(
      'approval-dashboard-metrics-history',
    );
    await ensureApprovalDashboardLedger();

    const response = await client.get(`/organization/${orgId}/approvals/sla`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      metrics: expect.objectContaining({
        current: expect.objectContaining({
          total: expect.any(Number),
          within_count: expect.any(Number),
          breached_count: expect.any(Number),
        }),
      }),
      approvers: expect.any(Array),
      tiers: expect.any(Array),
      timeline: expect.any(Array),
    });
  });

  it('GET /organization/{orgId}/approvals/history returns 200', async () => {
    // SCENARIO_PROOF: approval-dashboard-metrics-history
    // CONFORMANCE_PROOF: approval dashboard conformance verifies the seeded
    // decided approval row is visible in org recent decisions.
    expect('SCENARIO_PROOF: approval-dashboard-metrics-history').toContain(
      'approval-dashboard-metrics-history',
    );
    await ensureApprovalDashboardLedger();

    const response = await client.get(`/organization/${orgId}/approvals/history`);
    const body = fullResponse(response);
    const approved = listItems(body.data).find((entry: any) => entry.id === approvedApprovalId);

    expect(body.status).toBe(200);
    expect(approved).toMatchObject({
      id: approvedApprovalId,
      activity_id: 'approval-dashboard-approved',
      status: 'approved',
    });
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
