import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  type AgentIdentityForSigning,
  getBackendClient,
  getCoreClient,
  fullResponse,
  getTeamIds,
} from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto, makeGovernanceEvent } from '../helpers/fixtures';

describe('Core Governance API', () => {
  const backendClient = getBackendClient();
  let agentId: string;
  let apiKey: string;
  let agentIdentity: AgentIdentityForSigning;
  let teamIds: string[];

  beforeAll(async () => {
    teamIds = await getTeamIds();

    const dto = makeCreateAgentDto(teamIds);
    const response = await backendClient.post('/agent/create', dto);
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

  it('GET /api/v1/auth/validate returns valid: true with matching agent_id', async () => {
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const response = await coreClient.get('/api/v1/auth/validate');

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('valid', true);
    expect(response.data).toHaveProperty('agent_id', agentId);
  });

  it('POST /api/v1/governance/evaluate returns response with verdict', async () => {
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const event = makeGovernanceEvent();
    const response = await coreClient.post('/api/v1/governance/evaluate', event);

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('verdict');
  });

  it('POST /api/v1/governance/approval returns a response', async () => {
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const payload = {
      workflow_id: 'fake',
      run_id: 'fake',
      activity_id: 'fake',
    };

    const response = await coreClient.post('/api/v1/governance/approval', payload);

    // This may return an error structure but should still respond (not hang/crash)
    expect(response.status).toBeDefined();
    expect(response.data).toBeDefined();
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
