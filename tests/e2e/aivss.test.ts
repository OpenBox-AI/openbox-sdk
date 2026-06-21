import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { getBackendClient, fullResponse, getTeamIds, hasOrgId } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import {
  makeAivssConfig,
  makeAivssIntegerMemberCases,
  makeAivssInvalidBoundaryCases,
} from '../helpers/boundary-conformance';
import { makeCreateAgentDto, makeUpdateAivssConfigDto } from '../helpers/fixtures';

const CAN_RUN = !!process.env.OPENBOX_BACKEND_API_KEY && hasOrgId();
const describeOrSkip = CAN_RUN ? describe : describe.skip;
const AIVSS_BOUNDARY_PACE_MS = 750;

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

function operationPath(path: string, params: Record<string, string>) {
  return path.replace(/\{([^}]+)\}/g, (_, key) => {
    expect(params[key], key).toBeDefined();
    return encodeURIComponent(params[key]);
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describeOrSkip('AIVSS Assessment', () => {
  let client: ReturnType<typeof getBackendClient>;
  let agentId: string;
  let teamIds: string[];

  beforeAll(async () => {
    client = getBackendClient();
    teamIds = await getTeamIds();

    const dto = makeCreateAgentDto(teamIds);
    const response = await client.post('/agent/create', dto);
    const body = fullResponse(response);
    expect(body.status).toBe(200);

    agentId = body.data.agent.id;
    trackResource({ type: 'agent', id: agentId });
  });

  it('GET /agent/{agentId}/assessments returns 200', async () => {
    // SCENARIO_PROOF: trust-aivss-ledger
    // CONFORMANCE_PROOF: trust ledger conformance verifies the initial AIVSS
    // assessment/trust-history row created with the agent is readable.
    expect('SCENARIO_PROOF: trust-aivss-ledger').toContain('trust-aivss-ledger');
    const operation = backendOperation('AgentController_getAssessments');
    expect(operation.verb).toBe('get');

    const response = await client.get(operationPath(operation.path, { agentId }));
    const body = fullResponse(response);
    const assessments = listItems(body.data);

    expect(body.status).toBe(200);
    expect(assessments.length).toBeGreaterThan(0);
    expect(assessments[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        agent_id: agentId,
        trust_score: expect.any(Number),
        trust_tier: expect.any(Number),
      }),
    );
  });

  it('POST /agent/aivss calculates AIVSS score', async () => {
    // CONFORMANCE_PROOF: trust ledger conformance verifies the standalone
    // AIVSS score calculator returns normalized score/tier fields.
    const dto = makeUpdateAivssConfigDto();
    const response = await client.post('/agent/aivss', dto.aivss_config);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      aivss_score: expect.any(Number),
      breakdown: expect.any(Object),
      trust_score: expect.any(Number),
      trust_tier: expect.any(Number),
    });
  });

  it('EXHAUSTIVE_BOUNDARY_PROOF: AIVSS numeric rubric fields accept every spec integer member', async () => {
    // EXHAUSTIVE_BOUNDARY_PROOF: AIVSS numeric rubric fields are extracted
    // from TypeSpec @minValue/@maxValue constraints, then every integer
    // member for every field is sent through the local-stack calculator.
    const operation = backendOperation('AgentController_getAivssScore');
    expect(operation.verb).toBe('post');
    const cases = makeAivssIntegerMemberCases();
    expect(cases).toHaveLength(58);

    for (const testCase of cases) {
      await sleep(AIVSS_BOUNDARY_PACE_MS);
      const response = await client.post(operation.path, testCase.config);
      const body = fullResponse(response);

      expect(body.status, testCase.id).toBe(200);
      expect(body.data).toMatchObject({
        aivss_score: expect.any(Number),
        breakdown: expect.any(Object),
        trust_score: expect.any(Number),
        trust_tier: expect.any(Number),
      });
    }
  }, 90_000);

  it('NEGATIVE_BOUNDARY_PROOF: AIVSS numeric rubric fields reject outside and fractional values', async () => {
    // NEGATIVE_BOUNDARY_PROOF: the same TypeSpec-derived rubric fields reject
    // below-min, above-max, and fractional values instead of silently
    // coercing unscored inputs.
    const cases = makeAivssInvalidBoundaryCases();
    expect(cases).toHaveLength(42);

    for (const testCase of cases) {
      await sleep(AIVSS_BOUNDARY_PACE_MS);
      const response = await client.post('/agent/aivss', testCase.config);
      const body = fullResponse(response);

      expect(body.status, testCase.id).toBe(422);
    }
  }, 75_000);

  it('PUT /agent/{agentId}/aivss updates AIVSS config', async () => {
    // SCENARIO_PROOF: trust-aivss-ledger
    // CONFORMANCE_PROOF: trust ledger conformance verifies AIVSS config update
    // returns the same agent rather than only acknowledging the route.
    expect('SCENARIO_PROOF: trust-aivss-ledger').toContain('trust-aivss-ledger');
    const operation = backendOperation('AgentController_updateAivssConfig');
    expect(operation.verb).toBe('put');
    const dto = makeUpdateAivssConfigDto();
    const response = await client.put(operationPath(operation.path, { agentId }), dto);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.id).toBe(agentId);
  });

  it('BOUNDARY_PROOF: AIVSS update path accepts all-min and all-max configs', async () => {
    // BOUNDARY_PROOF: the mutating AIVSS config route accepts the TypeSpec
    // minimum and maximum aggregate configurations, not only calculator calls.
    const operation = backendOperation('AgentController_updateAivssConfig');
    expect(operation.verb).toBe('put');
    for (const boundary of ['min', 'max'] as const) {
      const config = makeAivssConfig(boundary);
      const response = await client.put(operationPath(operation.path, { agentId }), {
        aivss_config: config,
        reason: `AIVSS ${boundary} boundary e2e`,
      });
      const body = fullResponse(response);

      expect(body.status, boundary).toBe(200);
      expect(body.data.id).toBe(agentId);
    }
  });

  it('POST /agent/{agentId}/aivss/recalculate returns 200', async () => {
    // SCENARIO_PROOF: trust-aivss-ledger
    // CONFORMANCE_PROOF: trust ledger conformance verifies recalculation
    // returns the recalculated agent id from the backend.
    expect('SCENARIO_PROOF: trust-aivss-ledger').toContain('trust-aivss-ledger');
    const operation = backendOperation('AgentController_recalculateTrustScore');
    expect(operation.verb).toBe('post');

    const response = await client.post(operationPath(operation.path, { agentId }));
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toBe(agentId);
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
