import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBackendClient, fullResponse, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto } from '../helpers/fixtures';

describe('Observability & Monitoring', () => {
  const client = getBackendClient();
  let agentId: string;
  let teamIds: string[];

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
    const response = await client.get(`/agent/${agentId}/observability`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('GET /agent/{agentId}/issues returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/issues`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('GET /agent/{agentId}/insights/metrics returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/insights/metrics`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('GET /agent/{agentId}/logs returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/logs`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('GET /agent/{agentId}/logs/drift returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/logs/drift`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('GET /agent/metrics returns 200', async () => {
    const response = await client.get('/agent/metrics');
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
