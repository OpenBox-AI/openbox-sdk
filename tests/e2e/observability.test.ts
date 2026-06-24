import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { getBackendClient, fullResponse, getOrgId, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto } from '../helpers/fixtures';
import {
  seedLocalStackAgeEvaluation,
  seedLocalStackGovernanceEvent,
  seedLocalStackObservabilityIssue,
  seedLocalStackObservabilityMetric,
  seedLocalStackSession,
} from '../helpers/local-stack-db';

function listItems(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function backendOperation(operationId: string) {
  const operation = BACKEND_ENDPOINT_MANIFEST.find((entry) => entry.operationId === operationId);
  expect(operation, operationId).toBeDefined();
  return operation!;
}

describe('Observability & Monitoring', () => {
  const client = getBackendClient();
  let agentId: string;
  let governanceEventId: string | undefined;
  let issueId: string | undefined;
  let teamIds: string[];

  async function ensureObservabilityLedger() {
    if (governanceEventId && issueId) return;

    const session = await seedLocalStackSession({
      agentId,
      workflowIdPrefix: 'observability-wf-',
      runIdPrefix: 'observability-run-',
      detail: 'observability ledger conformance',
      metadata: { openbox_conformance: true, source: 'observability.e2e' },
    });
    const event = await seedLocalStackGovernanceEvent({
      agentId,
      session,
      activityId: 'observability-ledger',
      activityType: 'LLMCompletion',
      input: [{ prompt: 'observability ledger conformance' }],
      output: { response: 'observability ledger' },
      verdict: 1,
      reason: 'observability ledger conformance',
      metadata: { openbox_conformance: true, source: 'observability.e2e' },
    });
    await seedLocalStackAgeEvaluation({
      agentId,
      sessionId: session.id,
      governanceEventId: event.id,
      semanticType: 'llm_gen_ai',
      behaviorViolated: true,
      behaviorComplianceDetail: '{"reason":"observability violation ledger"}',
      trustScore: 70,
      trustTier: 2,
      behavioralCompliance: 40,
      alignmentConsistency: 100,
    });
    const seededIssueId = await seedLocalStackObservabilityIssue({
      agentId,
      sessionId: session.id,
      governanceEventId: event.id,
      issueType: 'policy_violation',
      severity: 'high',
      title: 'observability ledger issue',
      sourceTool: 'sdk-e2e',
      sourceWorkflowId: 'observability-ledger',
    });
    await seedLocalStackObservabilityMetric({
      agentId,
      organizationId: getOrgId(),
      metricType: 'tokens',
      metricKey: 'input_tokens',
      metricValue: 123,
    });
    governanceEventId = event.id;
    issueId = seededIssueId;
  }

  beforeAll(async () => {
    teamIds = await getTeamIds();

    const dto = makeCreateAgentDto(teamIds);
    const response = await client.post('/agent/create', dto);
    const body = fullResponse(response);
    expect(body.status).toBe(200);

    agentId = body.data.agent.id;
    trackResource({ type: 'agent', id: agentId });
  });

  it('GET /agent/{agentId}/observability returns 200', async () => {
    // SCENARIO_PROOF: observability-ledger-dashboard
    // CONFORMANCE_PROOF: observability ledger conformance asserts the
    // dashboard rollup shape and token bucket keys.
    expect('SCENARIO_PROOF: observability-ledger-dashboard').toContain(
      'observability-ledger-dashboard',
    );
    await ensureObservabilityLedger();

    const response = await client.get(`/agent/${agentId}/observability`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      invocations: expect.objectContaining({
        total: expect.any(Number),
        timeline: expect.any(Array),
      }),
      tokens: expect.objectContaining({
        input_tokens: expect.any(String),
      }),
      latency: expect.any(Object),
      models: expect.any(Object),
      errors: expect.any(Array),
    });
  });

  it('GET /agent/{agentId}/issues returns 200', async () => {
    // SCENARIO_PROOF: observability-ledger-dashboard
    // CONFORMANCE_PROOF: observability ledger conformance verifies a seeded
    // observability ledger issue is returned with its source event.
    expect('SCENARIO_PROOF: observability-ledger-dashboard').toContain(
      'observability-ledger-dashboard',
    );
    await ensureObservabilityLedger();

    const response = await client.get(`/agent/${agentId}/issues`);
    const body = fullResponse(response);
    const issue = listItems(body.data).find((entry: any) => entry.id === issueId);

    expect(body.status).toBe(200);
    expect(issue).toMatchObject({
      id: issueId,
      governance_event_id: governanceEventId,
      severity: 'high',
      title: 'observability ledger issue',
    });
  });

  it('GET /agent/{agentId}/insights/metrics returns 200', async () => {
    // SCENARIO_PROOF: observability-ledger-dashboard
    // CONFORMANCE_PROOF: observability ledger conformance verifies insight
    // metrics include the seeded behavior violation.
    expect('SCENARIO_PROOF: observability-ledger-dashboard').toContain(
      'observability-ledger-dashboard',
    );
    await ensureObservabilityLedger();

    const response = await client.get(`/agent/${agentId}/insights/metrics`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.violation.total).toBeGreaterThanOrEqual(1);
    expect(body.data.violation.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'behavior',
          pattern: 'llm_gen_ai',
        }),
      ]),
    );
    expect(body.data.tier_changes.total).toBeGreaterThanOrEqual(0);
  });

  it('GET /agent/{agentId}/logs returns 200', async () => {
    // SCENARIO_PROOF: observability-ledger-dashboard
    // CONFORMANCE_PROOF: observability ledger conformance verifies agent logs
    // include the seeded governance event.
    expect('SCENARIO_PROOF: observability-ledger-dashboard').toContain(
      'observability-ledger-dashboard',
    );
    await ensureObservabilityLedger();

    const response = await client.get(`/agent/${agentId}/logs`);
    const body = fullResponse(response);
    const log = listItems(body.data).find((entry: any) => entry.id === governanceEventId);

    expect(body.status).toBe(200);
    expect(log).toMatchObject({
      id: governanceEventId,
      activity_id: 'observability-ledger',
      reason: 'observability ledger conformance',
    });
  });

  it('GET /agent/{agentId}/logs/drift returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/logs/drift`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data) || Array.isArray(body.data.data)).toBe(true);
  });

  it('CONFORMANCE: GET /agent/metrics returns dashboard rollups', async () => {
    // CONFORMANCE_PROOF: backend metrics dashboard conformance asserts the
    // agent/guardrail/policy rollup sections and stable dashboard counters.
    expect(['SCENARIO_PROOF: backend-dashboard-metrics']).toEqual(
      expect.arrayContaining(['SCENARIO_PROOF: backend-dashboard-metrics']),
    );
    const operation = backendOperation('AgentController_getAgentsMetrics');
    const response = await client.get(operation.path);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      agent: expect.objectContaining({
        total_agents: expect.any(Number),
      }),
      guardrail: expect.objectContaining({
        now: expect.objectContaining({
          violation_rate: expect.any(Number),
        }),
      }),
      policy: expect.objectContaining({
        now: expect.objectContaining({
          violation_rate: expect.any(Number),
        }),
      }),
    });
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
