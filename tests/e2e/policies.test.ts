import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBackendClient, fullResponse, getTeamIds, hasOrgId } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto, makeCreatePolicyDto } from '../helpers/fixtures';

const CAN_RUN = !!process.env.OPENBOX_BACKEND_API_KEY && hasOrgId();
const describeOrSkip = CAN_RUN ? describe : describe.skip;

describeOrSkip('Policies', () => {
  let client: ReturnType<typeof getBackendClient>;
  let agentId: string;
  let policyId: string;
  let policyName: string;
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

  it('creates policy', async () => {
    const dto = makeCreatePolicyDto();
    policyName = dto.name;

    const response = await client.post(`/agent/${agentId}/policies`, dto);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.id).toBeDefined();
    expect(body.data.name).toBe(policyName);
    expect(body.data.rego_code).toContain('package');
    expect(body.data.is_active).toBe(true);

    policyId = body.data.id;

    trackResource({ type: 'policy', id: policyId, agentId });
  });

  it('lists policies', async () => {
    const response = await client.get(`/agent/${agentId}/policies`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);

    const policies = Array.isArray(body.data) ? body.data : body.data.data;
    const found = policies.find((p: any) => p.id === policyId);
    expect(found).toBeDefined();
  });

  it('gets current policies', async () => {
    const response = await client.get(`/agent/${agentId}/policies/current`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('gets policy by ID', async () => {
    const response = await client.get(`/agent/${agentId}/policies/${policyId}`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.name).toBe(policyName);
  });

  it('updates policy active status', async () => {
    const response = await client.put(`/agent/${agentId}/policies/${policyId}`, {
      is_active: false,
    });
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('evaluates rego', async () => {
    const response = await client.post('/policy/evaluate', {
      policy: 'package test\ndefault allow = true',
      input: {},
    });
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('gets policy metrics', async () => {
    const response = await client.get(`/agent/${agentId}/policies/metrics`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
