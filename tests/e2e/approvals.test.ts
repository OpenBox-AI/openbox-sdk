import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBackendClient, fullResponse, getOrgId, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto } from '../helpers/fixtures';

describe('Approvals', () => {
  const client = getBackendClient();
  let agentId: string;
  let orgId: string;
  let teamIds: string[];

  beforeAll(async () => {
    teamIds = await getTeamIds();
    orgId = getOrgId();

    const dto = makeCreateAgentDto(teamIds);
    const response = await client.post('/agent/create', dto);
    const body = fullResponse(response);
    expect(body.status).toBe(200);

    agentId = body.data.agent.id;
    trackResource({ type: 'agent', id: agentId });
  });

  // Agent-level approvals

  it('GET /agent/{agentId}/approvals/metrics returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/approvals/metrics`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('GET /agent/{agentId}/approvals/pending returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/approvals/pending`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('GET /agent/{agentId}/approvals/history returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/approvals/history`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  // Org-level approvals

  it('GET /organization/{orgId}/approvals returns 200', async () => {
    const response = await client.get(`/organization/${orgId}/approvals`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('GET /organization/{orgId}/approvals/metrics returns 200', async () => {
    const response = await client.get(`/organization/${orgId}/approvals/metrics`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('GET /organization/{orgId}/approvals/sla returns 200', async () => {
    const response = await client.get(`/organization/${orgId}/approvals/sla`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('GET /organization/{orgId}/approvals/history returns 200', async () => {
    const response = await client.get(`/organization/${orgId}/approvals/history`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
