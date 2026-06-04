import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBackendClient, fullResponse, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto } from '../helpers/fixtures';

describe('Agent CRUD Lifecycle', () => {
  const client = getBackendClient();
  let agentId: string;
  let apiKey: string;
  let teamIds: string[];
  let agentName: string;

  beforeAll(async () => {
    teamIds = await getTeamIds();
  });

  it('creates an agent', async () => {
    const dto = makeCreateAgentDto(teamIds);
    agentName = dto.agent_name;

    const response = await client.post('/agent/create', dto);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.agent).toBeDefined();
    expect(body.data.agent.id).toBeDefined();
    expect(body.data.agent.agent_name).toBe(agentName);
    expect(body.data.agent.organization_id).toBeDefined();
    expect(body.data.token).toBeDefined();
    // Backend issues obx_live_* in prod and obx_test_* everywhere else.
    // Accept both; env-detection bug land if we hardcode one.
    expect(body.data.token).toMatch(/^obx_(?:live|test)_/);
    expect(body.data.identity).toEqual(
      expect.objectContaining({
        did: expect.stringMatching(/^did:aip:/),
        privateKey: expect.any(String),
      }),
    );

    agentId = body.data.agent.id;
    apiKey = body.data.token;

    trackResource({ type: 'agent', id: agentId });
  });

  it('lists agents and includes created agent', async () => {
    // Search by the unique name; default list paginates and filters drafts
    // (status=0) so newly-created agents may not appear on page 1.
    const response = await client.get(`/agent/list?search=${encodeURIComponent(agentName)}`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(Array.isArray(body.data.data)).toBe(true);

    const found = body.data.data.find((a: any) => a.id === agentId);
    expect(found).toBeDefined();
  });

  it('gets agent by ID', async () => {
    const response = await client.get(`/agent/${agentId}`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.agent_name).toBe(agentName);
  });

  it('updates agent', async () => {
    const response = await client.put(`/agent/${agentId}`, {
      description: 'Updated by test',
    });
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('verifies update', async () => {
    const response = await client.get(`/agent/${agentId}`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.description).toBe('Updated by test');
  });

  it('deletes agent', async () => {
    const response = await client.delete(`/agent/${agentId}`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('confirms deletion returns 403 or 404', async () => {
    const response = await client.get(`/agent/${agentId}`);
    const body = fullResponse(response);

    expect([403, 404]).toContain(body.status);
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
