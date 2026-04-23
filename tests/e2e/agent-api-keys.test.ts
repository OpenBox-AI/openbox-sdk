import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBackendClient, getCoreClient, fullResponse, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto } from '../helpers/fixtures';

describe('Agent API Key Management', () => {
  const client = getBackendClient();
  let agentId: string;
  let apiKey: string;
  let teamIds: string[];

  beforeAll(async () => {
    teamIds = await getTeamIds();

    const dto = makeCreateAgentDto(teamIds);
    const response = await client.post('/agent/create', dto);
    const body = fullResponse(response);

    expect(body.status).toBe(200);

    agentId = body.data.agent.id;
    apiKey = body.data.token;

    trackResource({ type: 'agent', id: agentId });
  });

  it('validates initial API key with core', async () => {
    const coreClient = getCoreClient(apiKey);
    const response = await coreClient.get('/api/v1/auth/validate');

    expect(response.status).toBe(200);
    expect(response.data.valid).toBe(true);
    expect(response.data.agent_id).toBe(agentId);
  });

  it('rotates API key', async () => {
    const response = await client.post(`/agent/${agentId}/rotate-api-key`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.token).toBeDefined();
    expect(body.data.token).toMatch(/^obx_live_/);
    expect(body.data.token).not.toBe(apiKey);

    apiKey = body.data.token;
  });

  it('validates new API key', async () => {
    const coreClient = getCoreClient(apiKey);
    const response = await coreClient.get('/api/v1/auth/validate');

    expect(response.status).toBe(200);
    expect(response.data.valid).toBe(true);
  });

  it('revokes API key', async () => {
    const response = await client.post(`/agent/${agentId}/revoke-api-key`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
