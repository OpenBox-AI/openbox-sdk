import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBackendClient, fullResponse, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto, makeUpdateAivssConfigDto } from '../helpers/fixtures';

const CAN_RUN = !!process.env.OPENBOX_BACKEND_API_KEY && !!process.env.OPENBOX_ORG_ID;
const describeOrSkip = CAN_RUN ? describe : describe.skip;

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
    const response = await client.get(`/agent/${agentId}/assessments`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('PUT /agent/{agentId}/aivss updates AIVSS config', async () => {
    const dto = makeUpdateAivssConfigDto();
    const response = await client.put(`/agent/${agentId}/aivss`, dto);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('POST /agent/{agentId}/aivss/recalculate returns 200', async () => {
    const response = await client.post(`/agent/${agentId}/aivss/recalculate`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
