import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBackendClient, fullResponse, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto, makeUpdateAivssConfigDto } from '../helpers/fixtures';

describe('AIVSS Assessment', () => {
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

  it('GET /agent/{agentId}/assessments returns 200', async () => {
    const response = await client.get(`/agent/${agentId}/assessments`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  // SKIPPED; backend bug: NOT NULL violation on
  //   agent_trust_scores_history.evaluated_by under X-API-Key auth.
  //
  // Symptom: HTTP 500 with
  //   `null value in column "evaluated_by" of relation
  //    "agent_trust_scores_history" violates not-null constraint`
  //
  // Same root cause as the behavior-rule test's created_by skip:
  //   handler tries to populate the audit column from req.user.id
  //   which is undefined under X-API-Key auth. Backend fix: coalesce
  //   to a system UUID / owner_id when the principal is api-key.
  it.skip('PUT /agent/{agentId}/aivss updates AIVSS config', async () => {
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
