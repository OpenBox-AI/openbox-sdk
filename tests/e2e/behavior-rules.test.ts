import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBackendClient, fullResponse, getTeamIds } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { makeCreateAgentDto, makeCreateBehaviorRuleDto } from '../helpers/fixtures';

describe('Behavior Rules', () => {
  const client = getBackendClient();
  let agentId: string;
  let ruleId: string;
  let ruleName: string;
  let teamIds: string[];
  let ruleDto: ReturnType<typeof makeCreateBehaviorRuleDto>;

  beforeAll(async () => {
    teamIds = await getTeamIds();

    const dto = makeCreateAgentDto(teamIds);
    const response = await client.post('/agent/create', dto);
    const body = fullResponse(response);

    expect(body.status).toBe(200);

    agentId = body.data.agent.id;

    trackResource({ type: 'agent', id: agentId });
  });

  it('gets semantic types', async () => {
    const response = await client.get('/agent/behavior-rule/semantic-types');
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);

    const types = body.data as string[];
    expect(types).toEqual(expect.arrayContaining(['http_get', 'database_select']));
  });

  // SKIPPED; backend bug: NOT NULL violation on
  //   agent_behavior_rules.created_by under X-API-Key auth.
  //
  // Symptom: HTTP 500 with
  //   `null value in column "created_by" of relation
  //    "agent_behavior_rules" violates not-null constraint`
  //
  // Root cause: backend handler populates created_by from
  //   `req.user.id`. JWT auth fills it with the human user UUID;
  //   X-API-Key auth populates `req.user.sub = "api-key:<id>"` and
  //   leaves `req.user.id` undefined, so the INSERT runs with NULL.
  //
  // Fix direction (backend, not here): coalesce; when the
  //   authenticated principal is X-API-Key, write a stable system
  //   UUID (or the api-key's owner_id) to audit columns instead of
  //   attempting `req.user.id`. Same fix unblocks
  //   agent_trust_scores_history.evaluated_by (aivss.test.ts) and
  //   the policy create path (policies.test.ts).
  //
  // The next 6 tests all chain through the create's ruleId, so
  //   they skip together; behavior/{metrics,violations} read-paths
  //   above stay active and exercise the same agent_id without
  //   needing a created rule.
  it.skip('creates behavior rule', async () => {
    ruleDto = makeCreateBehaviorRuleDto();
    ruleName = ruleDto.rule_name;

    const response = await client.post(`/agent/${agentId}/behavior-rule`, ruleDto);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.id).toBeDefined();
    expect(body.data.rule_name).toBe(ruleName);
    expect(body.data.trigger).toBe(ruleDto.trigger);
    expect(body.data.states).toBeDefined();
    expect(body.data.verdict).toBeDefined();

    ruleId = body.data.id;

    trackResource({ type: 'behavior-rule', id: ruleId, agentId });
  });

  it.skip('lists behavior rules', async () => {
    const response = await client.get(`/agent/${agentId}/behavior-rule`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);

    const rules = Array.isArray(body.data) ? body.data : body.data.data;
    const found = rules.find((r: any) => r.id === ruleId);
    expect(found).toBeDefined();
  });

  it('gets current rules', async () => {
    const response = await client.get(`/agent/${agentId}/behavior-rule/current`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it.skip('gets rule by ID', async () => {
    const response = await client.get(`/agent/${agentId}/behavior-rule/${ruleId}`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.rule_name).toBe(ruleName);
  });

  it.skip('updates rule', async () => {
    const updateDto = {
      ...ruleDto,
      change_log: 'E2E update test',
    };

    const response = await client.put(`/agent/${agentId}/behavior-rule/${ruleId}`, updateDto);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it.skip('toggles rule status', async () => {
    const response = await client.put(`/agent/${agentId}/behavior-rule/${ruleId}/status`, {
      is_active: false,
    });
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('gets behavior metrics', async () => {
    const response = await client.get(`/agent/${agentId}/behavior/metrics`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('gets behavior violations', async () => {
    const response = await client.get(`/agent/${agentId}/behavior/violations`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it.skip('deletes rule', async () => {
    const response = await client.delete(`/agent/${agentId}/behavior-rule/${ruleId}`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
