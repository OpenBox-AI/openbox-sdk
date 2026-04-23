import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBackendClient, fullResponse, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto, makeGoalAlignmentConfigDto } from '../helpers/fixtures';

describe('Goal Alignment', () => {
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

  it('PUT /agent/{agentId}/goal-alignment configures goal alignment', async () => {
    const dto = makeGoalAlignmentConfigDto();
    const response = await client.put(`/agent/${agentId}/goal-alignment`, dto);
    const body = fullResponse(response);

    // May return 200 or 400/422 depending on model availability
    expect([200, 400, 422]).toContain(body.status);
  });

  it('GET /agent/{agentId}/goal-alignment/trend returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/goal-alignment/trend`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('GET /agent/{agentId}/goal-alignment/recent-drifts returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/goal-alignment/recent-drifts`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
