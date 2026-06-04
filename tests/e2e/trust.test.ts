import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBackendClient, fullResponse, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto } from '../helpers/fixtures';

describe('Trust Score', () => {
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

  it('GET /agent/{agentId}/trust/histories returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/trust/histories?duration=7d`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('GET /agent/{agentId}/trust/events returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/trust/events`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('GET /agent/{agentId}/trust-tier-changes returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/trust-tier-changes`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('GET /agent/{agentId}/trust/recovery-status returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/trust/recovery-status`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
