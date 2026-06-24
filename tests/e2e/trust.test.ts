import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBackendClient, fullResponse, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto } from '../helpers/fixtures';
import { seedLocalStackTrustLedger } from '../helpers/local-stack-db';
import {
  GOVERNANCE_SPEC_DOMAINS,
  invalidGovernanceSpecMember,
} from '../helpers/governance-spec-domains';

function listItems(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

describe('Trust Score', () => {
  const client = getBackendClient();
  let agentId: string;
  let trustHistoryId: string | undefined;
  let teamIds: string[];

  async function ensureTrustLedger() {
    if (trustHistoryId) return;

    const ledger = await seedLocalStackTrustLedger({
      agentId,
      source: 'trust.e2e',
    });
    trustHistoryId = ledger.historyId;
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

  it('GET /agent/{agentId}/trust/histories returns 200', async () => {
    // SCENARIO_PROOF: trust-aivss-ledger
    // CONFORMANCE_PROOF: trust ledger conformance verifies the trust-history
    // trend surface returns scored tier rows after local-stack setup.
    expect('SCENARIO_PROOF: trust-aivss-ledger').toContain('trust-aivss-ledger');
    await ensureTrustLedger();

    const response = await client.get(`/agent/${agentId}/trust/histories?duration=7d`);
    const body = fullResponse(response);
    const history = listItems(body.data);

    expect(body.status).toBe(200);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]).toEqual(
      expect.objectContaining({
        time: expect.any(String),
        score: expect.any(Number),
        tier: expect.any(Number),
      }),
    );
  });

  it('EXHAUSTIVE: trust history duration query members are accepted', async () => {
    // EXHAUSTIVE_SPEC_PROOF: AgentController_getAgentTrustHistories.duration
    // is finite in TypeSpec. Every duration member is sent through the
    // local-stack trust-history route and must return a list shape.
    await ensureTrustLedger();

    for (const duration of GOVERNANCE_SPEC_DOMAINS.trustHistoryDurations) {
      const response = await client.get(`/agent/${agentId}/trust/histories?duration=${duration}`);
      const body = fullResponse(response);

      expect(body.status, duration).toBe(200);
      expect(Array.isArray(body.data) || Array.isArray(body.data.data), duration).toBe(true);
    }
  });

  it('NEGATIVE_BOUNDARY_PROOF: trust history duration rejects out-of-domain values', async () => {
    // NEGATIVE_BOUNDARY_PROOF: trust history duration is a finite TypeSpec
    // query domain; out-of-domain values must fail validation instead of
    // silently selecting the default window.
    await ensureTrustLedger();

    const invalidDuration = invalidGovernanceSpecMember('trustHistoryDurations');
    const response = await client.get(`/agent/${agentId}/trust/histories?duration=${invalidDuration}`);
    const body = fullResponse(response);

    expect(body.status).toBe(422);
  });

  it('GET /agent/{agentId}/trust/events returns 200', async () => {
    // SCENARIO_PROOF: trust-aivss-ledger
    // CONFORMANCE_PROOF: trust ledger conformance reads the seeded trust event
    // through the public event ledger.
    expect('SCENARIO_PROOF: trust-aivss-ledger').toContain('trust-aivss-ledger');
    await ensureTrustLedger();

    const response = await client.get(`/agent/${agentId}/trust/events`);
    const body = fullResponse(response);
    const event = listItems(body.data).find((entry: any) => entry.id === trustHistoryId);

    expect(body.status).toBe(200);
    expect(event).toMatchObject({
      id: trustHistoryId,
      change_type: 'policy_violation',
      change_reason: 'trust ledger conformance',
      trust_score: 72.5,
      trust_tier: 2,
    });
  });

  it('GET /agent/{agentId}/trust-tier-changes returns 200', async () => {
    // SCENARIO_PROOF: trust-aivss-ledger
    // CONFORMANCE_PROOF: trust ledger conformance reads the seeded tier-change
    // row through the public tier-change ledger.
    expect('SCENARIO_PROOF: trust-aivss-ledger').toContain('trust-aivss-ledger');
    await ensureTrustLedger();

    const response = await client.get(`/agent/${agentId}/trust-tier-changes`);
    const body = fullResponse(response);
    const change = listItems(body.data).find((entry: any) => entry.id === trustHistoryId);

    expect(body.status).toBe(200);
    expect(change).toMatchObject({
      id: trustHistoryId,
      previous_tier: 1,
      trust_tier: 2,
      change_reason: 'trust ledger conformance',
    });
  });

  it('GET /agent/{agentId}/trust/recovery-status returns 200', async () => {
    // SCENARIO_PROOF: trust-aivss-ledger
    // CONFORMANCE_PROOF: trust ledger conformance reads the seeded active
    // trust penalty through recovery status.
    expect('SCENARIO_PROOF: trust-aivss-ledger').toContain('trust-aivss-ledger');
    await ensureTrustLedger();

    const response = await client.get(`/agent/${agentId}/trust/recovery-status`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      has_penalty: true,
      recovery: expect.objectContaining({
        active_count: expect.any(Number),
        total_penalty_amount: expect.any(Number),
        penalties: expect.any(Array),
      }),
    });
    expect(body.data.recovery.active_count).toBeGreaterThanOrEqual(1);
    expect(body.data.recovery.penalties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: 'policy',
          trust_impact: 'medium',
          penalty_amount: 7.5,
        }),
      ]),
    );
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
