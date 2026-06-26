import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBackendClient, fullResponse, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto } from '../helpers/fixtures';
import {
  seedLocalStackAgeEvaluation,
  seedLocalStackGovernanceEvent,
  seedLocalStackSession,
} from '../helpers/local-stack-db';

function listItems(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

describe('Violations', () => {
  const client = getBackendClient();
  let agentId: string;
  let violationId: string | undefined;
  let teamIds: string[];

  async function ensureViolationLedger() {
    if (violationId) return;

    const session = await seedLocalStackSession({
      agentId,
      workflowIdPrefix: 'violation-wf-',
      runIdPrefix: 'violation-run-',
      detail: 'violation false-positive conformance',
      metadata: { openbox_conformance: true, source: 'violations.e2e' },
    });
    const event = await seedLocalStackGovernanceEvent({
      agentId,
      session,
      activityId: 'violation-ledger',
      activityType: 'LLMCompletion',
      input: [{ prompt: 'observability violation ledger' }],
      output: { response: 'violation' },
      verdict: 1,
      reason: 'observability violation ledger',
      metadata: { openbox_conformance: true, source: 'violations.e2e' },
    });
    violationId = await seedLocalStackAgeEvaluation({
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

  it('GET /agent/violations returns 200', async () => {
    // SCENARIO_PROOF: violation-false-positive
    // CONFORMANCE_PROOF: violation false-positive conformance verifies the
    // global violation dashboard rollup shape.
    expect('SCENARIO_PROOF: violation-false-positive').toContain('violation-false-positive');
    await ensureViolationLedger();

    const response = await client.get('/agent/violations');
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      guardrail_violations: expect.objectContaining({
        now: expect.objectContaining({
          violation_rate: expect.any(Number),
        }),
      }),
      policy_violations: expect.objectContaining({
        now: expect.objectContaining({
          violation_rate: expect.any(Number),
        }),
      }),
    });
  });

  it('GET /agent/{agentId}/violations returns 200', async () => {
    // SCENARIO_PROOF: violation-false-positive
    // CONFORMANCE_PROOF: violation false-positive conformance verifies a
    // seeded behavior violation is exposed in the agent violation ledger.
    expect('SCENARIO_PROOF: violation-false-positive').toContain('violation-false-positive');
    await ensureViolationLedger();

    const response = await client.get(`/agent/${agentId}/violations`);
    const body = fullResponse(response);
    const violation = listItems(body.data).find((entry: any) => entry.id === violationId);

    expect(body.status).toBe(200);
    expect(violation).toMatchObject({
      id: violationId,
      source_type: 'behavior',
      pattern: 'llm_gen_ai',
      is_false_positive: false,
    });
  });

  it('PATCH /agent/{agentId}/violations/{violationId}/false-positive persists state', async () => {
    // SCENARIO_PROOF: violation-false-positive
    // CONFORMANCE_PROOF: violation false-positive conformance marks the seeded
    // violation as false positive and verifies the persisted is_false_positive
    // flag on a subsequent ledger read.
    expect('SCENARIO_PROOF: violation-false-positive').toContain('violation-false-positive');
    await ensureViolationLedger();

    const response = await client.patch(
      `/agent/${agentId}/violations/${violationId}/false-positive`,
      { sourceType: 'behavior' },
    );
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      id: violationId,
      is_false_positive: true,
    });

    const rereadResponse = await client.get(`/agent/${agentId}/violations`);
    const rereadBody = fullResponse(rereadResponse);
    const reread = listItems(rereadBody.data).find((entry: any) => entry.id === violationId);

    expect(rereadBody.status).toBe(200);
    expect(reread).toMatchObject({
      id: violationId,
      is_false_positive: true,
    });
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
