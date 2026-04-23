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

  it('creates behavior rule', async () => {
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

  it('lists behavior rules', async () => {
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

  it('gets rule by ID', async () => {
    const response = await client.get(`/agent/${agentId}/behavior-rule/${ruleId}`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.rule_name).toBe(ruleName);
  });

  it('updates rule', async () => {
    const updateDto = {
      ...ruleDto,
      change_log: 'E2E update test',
    };

    const response = await client.put(`/agent/${agentId}/behavior-rule/${ruleId}`, updateDto);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  it('toggles rule status', async () => {
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

  it('deletes rule', async () => {
    const response = await client.delete(`/agent/${agentId}/behavior-rule/${ruleId}`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
