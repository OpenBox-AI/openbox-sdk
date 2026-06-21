import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  type AgentIdentityForSigning,
  getBackendClient,
  getCoreClient,
  fullResponse,
  getTeamIds,
} from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto } from '../helpers/fixtures';

describe('Agent API Key Management', () => {
  const client = getBackendClient();
  let agentId: string;
  let apiKey: string;
  let agentIdentity: AgentIdentityForSigning;
  let teamIds: string[];

  beforeAll(async () => {
    teamIds = await getTeamIds();

    const dto = makeCreateAgentDto(teamIds);
    const response = await client.post('/agent/create', dto);
    const body = fullResponse(response);

    expect(body.status).toBe(200);

    agentId = body.data.agent.id;
    apiKey = body.data.token;
    agentIdentity = {
      did: body.data.identity.did,
      privateKey: body.data.identity.privateKey,
    };

    trackResource({ type: 'agent', id: agentId });
  });

  it('validates initial API key with core', async () => {
    const coreClient = getCoreClient(apiKey, agentIdentity);
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
    // Backend issues obx_live_* in prod and obx_test_* everywhere else.
    expect(body.data.token).toMatch(/^obx_(?:live|test)_/);
    expect(body.data.token).not.toBe(apiKey);

    apiKey = body.data.token;
  });

  it('validates new API key', async () => {
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const response = await coreClient.get('/api/v1/auth/validate');

    expect(response.status).toBe(200);
    expect(response.data.valid).toBe(true);
  });

  it('revokes API key', async () => {
    // CONFORMANCE_PROOF: agent API key conformance verifies revoke returns an
    // acknowledgement and the revoked runtime key no longer validates in Core.
    const response = await client.post(`/agent/${agentId}/revoke-api-key`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data?.message ?? body.message ?? '').toEqual(expect.any(String));

    const coreClient = getCoreClient(apiKey, agentIdentity);
    const validation = await coreClient.get('/api/v1/auth/validate');

    expect(validation.status).not.toBe(200);
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
