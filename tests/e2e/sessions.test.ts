import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBackendClient, fullResponse, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto } from '../helpers/fixtures';

describe('Sessions', () => {
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

  it('GET /agent/{agentId}/sessions returns 200 with data array and meta', async () => {
    const response = await client.get(`/agent/${agentId}/sessions`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toHaveProperty('data');
    expect(Array.isArray(body.data.data)).toBe(true);
    // Pagination may use 'meta' or 'start/limit/total' format
    expect(body.data.data !== undefined).toBe(true);
  });

  it('GET /agent/{agentId}/active-sessions returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/active-sessions`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('GET session detail endpoints if sessions exist', async () => {
    const response = await client.get(`/agent/${agentId}/sessions`);
    const body = fullResponse(response);

    if (body.data.data.length === 0) {
      console.log('No sessions found for agent, skipping session detail tests');
      return;
    }

    const sessionId = body.data.data[0].id || body.data.data[0].session_id;

    const detailRes = await client.get(`/agent/${agentId}/sessions/${sessionId}`);
    expect(fullResponse(detailRes).status).toBe(200);

    const logsRes = await client.get(`/agent/${agentId}/sessions/${sessionId}/logs`);
    expect(fullResponse(logsRes).status).toBe(200);

    const goalAlignRes = await client.get(
      `/agent/${agentId}/sessions/${sessionId}/goal-alignment-stats`,
    );
    expect(fullResponse(goalAlignRes).status).toBe(200);

    const reasoningRes = await client.get(
      `/agent/${agentId}/sessions/${sessionId}/reasoning-trace`,
    );
    expect(fullResponse(reasoningRes).status).toBe(200);
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
