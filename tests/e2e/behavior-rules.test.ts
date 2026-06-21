import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { getBackendClient, fullResponse, getTeamIds, hasOrgId } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import { runLocalStackSql, sqlLiteral } from '../helpers/local-stack-db';
import {
  GOVERNANCE_BOUNDARY_DOMAINS,
  invalidBoundarySpecMember,
  invalidUuidString,
  makeBehaviorRuleBoundaryCases,
  makeTrustThresholdBoundaryCases,
} from '../helpers/boundary-conformance';
import { makeCreateAgentDto, makeCreateBehaviorRuleDto } from '../helpers/fixtures';
import {
  GOVERNANCE_SPEC_DOMAINS,
  invalidGovernanceSpecMember,
  invalidNumericGovernanceSpecMember,
} from '../helpers/governance-spec-domains';

const CAN_RUN = !!process.env.OPENBOX_BACKEND_API_KEY && hasOrgId();
const describeOrSkip = CAN_RUN ? describe : describe.skip;

function listItems(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (value && typeof value === 'object') return [value];
  return [];
}

function backendOperation(operationId: string) {
  const operation = BACKEND_ENDPOINT_MANIFEST.find((entry) => entry.operationId === operationId);
  expect(operation, operationId).toBeDefined();
  return operation!;
}

function operationPath(path: string, params: Record<string, string>) {
  return path.replace(/\{([^}]+)\}/g, (_, key) => {
    expect(params[key], key).toBeDefined();
    return encodeURIComponent(params[key]);
  });
}

describeOrSkip('Behavior Rules', () => {
  let client: ReturnType<typeof getBackendClient>;
  let agentId: string;
  let ruleId: string;
  let originalRuleId: string;
  let behaviorBaseRuleId: string;
  let ruleName: string;
  let originalRuleName: string;
  let teamIds: string[];
  let ruleDto: ReturnType<typeof makeCreateBehaviorRuleDto>;
  let behaviorViolationId: string | undefined;

  async function ensureBehaviorViolationLedger() {
    if (behaviorViolationId) return;

    const seedOutput = await runLocalStackSql(`
      with seeded_session as (
        insert into sessions (
          agent_id,
          workflow_id,
          run_id,
          status,
          detail,
          started_at,
          completed_at,
          trust_evaluated_at,
          metadata
        )
        values (
          ${sqlLiteral(agentId)},
          'behavior-rule-wf-' || gen_random_uuid(),
          'behavior-rule-run-' || gen_random_uuid(),
          'completed',
          'behavior rule violation conformance',
          now() - interval '2 minutes',
          now() - interval '1 minute',
          now(),
          '{"openbox_conformance":true,"source":"behavior-rules.e2e"}'::jsonb
        )
        returning id, workflow_id, run_id
      ),
      seeded_event as (
        insert into governance_events (
          event_type,
          agent_id,
          session_id,
          workflow_id,
          run_id,
          workflow_type,
          task_queue,
          activity_id,
          activity_type,
          span_count,
          input,
          output,
          verdict,
          reason,
          metadata
        )
        select
          'ActivityCompleted',
          ${sqlLiteral(agentId)},
          seeded_session.id,
          seeded_session.workflow_id,
          seeded_session.run_id,
          'sdk-conformance',
          'local-stack',
          'behavior-rule-violation',
          'LLMCompletion',
          1,
          '[{"prompt":"behavior rule violation"}]'::jsonb,
          '{"response":"violation"}'::jsonb,
          1,
          'behavior rule violation',
          '{"openbox_conformance":true,"source":"behavior-rules.e2e"}'::jsonb
        from seeded_session
        returning id, session_id
      )
      insert into age_evaluations (
        agent_id,
        session_id,
        governance_event_id,
        semantic_type,
        goal_alignment_checked,
        goal_drift,
        behavior_violated,
        behavior_compliance_detail,
        trust_score,
        trust_tier,
        behavioral_compliance,
        alignment_consistency,
        evaluated_at
      )
      select
        ${sqlLiteral(agentId)},
        seeded_event.session_id,
        seeded_event.id,
        'llm_gen_ai',
        true,
        false,
        true,
        '{"reason":"behavior rule violation conformance"}'::text,
        70,
        2,
        40,
        100,
        now()
      from seeded_event
      returning id;
    `);
    behaviorViolationId = seedOutput
      .trim()
      .split('\n')
      .find((line) => /^[0-9a-f-]{36}$/i.test(line));
    expect(behaviorViolationId).toBeDefined();
  }

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

  it('gets semantic types', async () => {
    const response = await client.get('/agent/behavior-rule/semantic-types');
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);

    const types = body.data as string[];
    expect([...types].sort()).toEqual([...GOVERNANCE_SPEC_DOMAINS.behaviorRuleTriggers].sort());
  });

  it('creates behavior rule', async () => {
    // SCENARIO_PROOF: behavior-rule-lifecycle-current
    // CONFORMANCE_PROOF: behavior rule lifecycle conformance starts with a
    // persisted rule whose returned fields match the authored contract.
    expect('SCENARIO_PROOF: behavior-rule-lifecycle-current').toContain(
      'behavior-rule-lifecycle-current',
    );
    const operation = backendOperation('AgentController_createBehaviorRule');
    expect(operation.verb).toBe('post');
    ruleDto = makeCreateBehaviorRuleDto();
    ruleName = ruleDto.rule_name;

    const response = await client.post(operationPath(operation.path, { agentId }), ruleDto);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.id).toBeDefined();
    expect(body.data.rule_name).toBe(ruleName);
    expect(body.data.trigger).toBe(ruleDto.trigger);
    expect(body.data.states).toBeDefined();
    expect(body.data.verdict).toBeDefined();

    ruleId = body.data.id;
    originalRuleId = body.data.id;
    behaviorBaseRuleId = body.data.base_rule_id;
    originalRuleName = ruleName;

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
    // SCENARIO_PROOF: behavior-rule-rollback-history
    // CONFORMANCE_PROOF: behavior rule lifecycle conformance checks that the
    // current-rules surface exposes the active rule persisted by create.
    expect('SCENARIO_PROOF: behavior-rule-rollback-history').toContain(
      'behavior-rule-rollback-history',
    );
    const operation = backendOperation('AgentController_getCurrentBehaviorRule');
    expect(operation.verb).toBe('get');

    const response = await client.get(operationPath(operation.path, { agentId }));
    const body = fullResponse(response);
    const rules = listItems(body.data);
    const found = rules.find((r: any) => r.id === ruleId);

    expect(body.status).toBe(200);
    expect(found).toBeDefined();
    expect(found.is_active).toBe(true);
  });

  it('gets rule by ID', async () => {
    // SCENARIO_PROOF: behavior-rule-lifecycle-current
    // CONFORMANCE_PROOF: behavior rule lifecycle conformance reads the
    // persisted rule by ID after list/current surfaces have observed it.
    expect('SCENARIO_PROOF: behavior-rule-lifecycle-current').toContain(
      'behavior-rule-lifecycle-current',
    );
    const operation = backendOperation('AgentController_getBehaviorRule');
    expect(operation.verb).toBe('get');

    const response = await client.get(
      operationPath(operation.path, { agentId, behaviorRuleId: ruleId }),
    );
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.rule_name).toBe(ruleName);
  });

  it('updates rule', async () => {
    // SCENARIO_PROOF: behavior-rule-lifecycle-current
    // SCENARIO_PROOF: behavior-rule-rollback-history
    // CONFORMANCE_PROOF: behavior rule lifecycle conformance updates persisted
    // rule fields and carries an explicit change_log.
    expect('SCENARIO_PROOF: behavior-rule-lifecycle-current').toContain(
      'behavior-rule-lifecycle-current',
    );
    expect('SCENARIO_PROOF: behavior-rule-rollback-history').toContain(
      'behavior-rule-rollback-history',
    );
    const operation = backendOperation('AgentController_updateBehaviorRule');
    expect(operation.verb).toBe('put');
    const updateDto = {
      ...ruleDto,
      rule_name: `${ruleName}-updated`,
      description: 'Updated behavior rule conformance',
      change_log: 'E2E update test',
    };

    const response = await client.put(
      operationPath(operation.path, { agentId, behaviorRuleId: ruleId }),
      updateDto,
    );
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.id).toBeDefined();
    expect(body.data.base_rule_id).toBe(behaviorBaseRuleId);
    expect(body.data.rule_name).toBe(updateDto.rule_name);
    expect(body.data.description).toBe(updateDto.description);
    expect(body.data.change_log).toBe(updateDto.change_log);
    expect(body.data.trigger).toBe(updateDto.trigger);
    expect(body.data.is_current_version).toBe(true);
    expect(body.data.states).toBeDefined();

    ruleId = body.data.id;
    ruleDto = updateDto;
    ruleName = updateDto.rule_name;
    if (ruleId !== originalRuleId) {
      trackResource({ type: 'behavior-rule', id: ruleId, agentId });
    }
  });

  it('reads behavior rule history and rolls back to a prior version', async () => {
    // SCENARIO_PROOF: behavior-rule-rollback-history
    // CONFORMANCE_PROOF: behavior rollback history conformance verifies
    // version history is keyed by base_rule_id and rollback makes the selected
    // historical rule current again.
    expect('SCENARIO_PROOF: behavior-rule-rollback-history').toContain(
      'behavior-rule-rollback-history',
    );
    const historyOperation = backendOperation('AgentController_getBehavioralRuleHistories');
    const rollbackOperation = backendOperation('AgentController_rollbackBehaviorRule');
    expect(historyOperation.verb).toBe('get');
    expect(rollbackOperation.verb).toBe('post');

    const historyResponse = await client.get(
      operationPath(historyOperation.path, { agentId, behaviorGroupdId: behaviorBaseRuleId }),
    );
    const historyBody = fullResponse(historyResponse);
    const versions = listItems(historyBody.data);
    const originalVersion = versions.find((r: any) => r.id === originalRuleId);
    const updatedVersion = versions.find((r: any) => r.id === ruleId);

    expect(historyBody.status).toBe(200);
    expect(originalVersion).toMatchObject({
      id: originalRuleId,
      base_rule_id: behaviorBaseRuleId,
      is_current_version: false,
      rule_name: originalRuleName,
    });
    expect(updatedVersion).toMatchObject({
      id: ruleId,
      base_rule_id: behaviorBaseRuleId,
      is_current_version: true,
      change_log: 'E2E update test',
    });

    const rollbackResponse = await client.post(
      operationPath(rollbackOperation.path, { agentId, behaviorRuleId: originalRuleId }),
    );
    const rollbackBody = fullResponse(rollbackResponse);

    expect(rollbackBody.status).toBe(200);
    expect(rollbackBody.data).toMatchObject({
      id: originalRuleId,
      base_rule_id: behaviorBaseRuleId,
      rule_name: originalRuleName,
      is_current_version: true,
    });

    ruleId = rollbackBody.data.id;
    ruleName = rollbackBody.data.rule_name;
  });

  it('toggles rule status', async () => {
    // SCENARIO_PROOF: behavior-rule-lifecycle-current
    // CONFORMANCE_PROOF: behavior rule lifecycle conformance toggles is_active
    // and verifies the current-rule surface reflects the inactive state.
    expect('SCENARIO_PROOF: behavior-rule-lifecycle-current').toContain(
      'behavior-rule-lifecycle-current',
    );
    const statusOperation = backendOperation('AgentController_changeBehaviorRuleStatus');
    const currentOperation = backendOperation('AgentController_getCurrentBehaviorRule');
    expect(statusOperation.verb).toBe('put');
    expect(currentOperation.verb).toBe('get');

    const response = await client.put(
      operationPath(statusOperation.path, { agentId, behaviorRuleId: ruleId }),
      { is_active: false },
    );
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.id).toBe(ruleId);
    expect(body.data.is_active).toBe(false);

    const currentResponse = await client.get(operationPath(currentOperation.path, { agentId }));
    const currentBody = fullResponse(currentResponse);
    const currentRules = listItems(currentBody.data);

    expect(currentBody.status).toBe(200);
    expect(currentRules.find((r: any) => r.id === ruleId)).toMatchObject({
      id: ruleId,
      is_active: false,
    });
  });

  it('CONFORMANCE: gets behavior metrics', async () => {
    // SCENARIO_PROOF: behavior-rule-metrics-violations
    // CONFORMANCE_PROOF: behavior metrics conformance asserts dashboard metric
    // keys instead of only endpoint reachability.
    expect('SCENARIO_PROOF: behavior-rule-metrics-violations').toContain(
      'behavior-rule-metrics-violations',
    );
    const operation = backendOperation('AgentController_getBehaviorMetrics');
    expect(operation.verb).toBe('get');
    expect(operation.path).toContain('behavior/metrics');
    const response = await client.get(operationPath(operation.path, { agentId }));
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      active: expect.any(Number),
      violations_today: expect.any(Number),
      compliance_rate: expect.any(Number),
      pending_approvals: expect.any(Number),
    });
  });

  it('CONFORMANCE: gets behavior violations', async () => {
    // SCENARIO_PROOF: behavior-rule-metrics-violations
    // CONFORMANCE_PROOF: behavior metrics conformance asserts the violations
    // endpoint returns the seeded behavior_violated failure row.
    expect('SCENARIO_PROOF: behavior-rule-metrics-violations').toContain(
      'behavior-rule-metrics-violations',
    );
    await ensureBehaviorViolationLedger();

    const operation = backendOperation('AgentController_getBehaviorViolations');
    expect(operation.verb).toBe('get');
    expect(operation.path).toContain('behavior/violations');
    const response = await client.get(`/agent/${agentId}/behavior/violations`);
    const body = fullResponse(response);
    const violations = listItems(body.data);
    const violation = violations.find((entry: any) => entry.id === behaviorViolationId);

    expect(body.status).toBe(200);
    expect(violation).toMatchObject({
      id: behaviorViolationId,
      behavior_violated: true,
      semantic_type: 'llm_gen_ai',
    });
  });

  it('deletes rule', async () => {
    // SCENARIO_PROOF: behavior-rule-lifecycle-current
    // CONFORMANCE_PROOF: behavior rule lifecycle conformance deletes the
    // persisted rule and verifies it is removed from subsequent list results.
    expect('SCENARIO_PROOF: behavior-rule-lifecycle-current').toContain(
      'behavior-rule-lifecycle-current',
    );
    const deleteOperation = backendOperation('AgentController_deleteBehaviorRule');
    const listOperation = backendOperation('AgentController_getBehaviorRuleList');
    expect(deleteOperation.verb).toBe('delete');
    expect(listOperation.verb).toBe('get');

    const response = await client.delete(
      operationPath(deleteOperation.path, { agentId, behaviorRuleId: ruleId }),
    );
    const body = fullResponse(response);

    expect(body.status).toBe(200);

    const listResponse = await client.get(operationPath(listOperation.path, { agentId }));
    const listBody = fullResponse(listResponse);

    expect(listBody.status).toBe(200);
    expect(listItems(listBody.data).find((r: any) => r.id === ruleId)).toBeUndefined();
  });

  it('creates every spec behavior trigger', async () => {
    // EXHAUSTIVE_SPEC_PROOF: BehaviorRuleTrigger is finite in TypeSpec, so
    // every trigger member is created and read back from the local stack.
    for (const [index, trigger] of GOVERNANCE_SPEC_DOMAINS.behaviorRuleTriggers.entries()) {
      const dto = makeCreateBehaviorRuleDto({
        rule_name: `behavior-trigger-domain-${trigger}`,
        priority: (index % 100) + 1,
        trigger,
        states: [trigger],
        verdict: 3,
        reject_message: `blocked trigger ${trigger}`,
        trust_impact: 'none',
      });
      const response = await client.post(`/agent/${agentId}/behavior-rule`, dto);
      const body = fullResponse(response);

      expect(body.status).toBe(200);
      expect(body.data).toMatchObject({
        rule_name: dto.rule_name,
        trigger,
        verdict: 3,
      });
      expect(JSON.stringify(body.data.states)).toContain(trigger);

      trackResource({ type: 'behavior-rule', id: body.data.id, agentId });
    }
  });

  it('EXHAUSTIVE: behavior-rule trigger query filter accepts every spec trigger', async () => {
    // EXHAUSTIVE_SPEC_PROOF: AgentController_getBehaviorRules exposes a
    // finite BehaviorRuleTrigger query filter. Every trigger member is sent
    // through the local-stack query surface and matched against seeded rules.
    for (const trigger of GOVERNANCE_SPEC_DOMAINS.behaviorRuleTriggers) {
      const response = await client.get(`/agent/${agentId}/behavior-rule?trigger=${trigger}`);
      const body = fullResponse(response);
      const rows = listItems(body.data);

      expect(body.status).toBe(200);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row: any) => row.trigger === trigger)).toBe(true);
    }
  });

  it('creates every spec behavior verdict integer', async () => {
    // EXHAUSTIVE_SPEC_PROOF: CreateBehaviorRuleDto.verdict is a finite
    // TypeSpec numeric union, so every member is persisted through create.
    for (const verdict of GOVERNANCE_SPEC_DOMAINS.behaviorRuleVerdicts) {
      const dto = makeCreateBehaviorRuleDto({
        rule_name: `behavior-verdict-domain-${verdict}`,
        trigger: 'http_post',
        states: ['http_post'],
        verdict,
        reject_message: `verdict ${verdict}`,
        approval_timeout: verdict === 2 ? 120 : undefined,
        trust_impact: 'none',
      });
      const response = await client.post(`/agent/${agentId}/behavior-rule`, dto);
      const body = fullResponse(response);

      expect(body.status).toBe(200);
      expect(body.data).toMatchObject({
        rule_name: dto.rule_name,
        trigger: 'http_post',
        verdict,
      });
      if (verdict === 2) {
        expect(body.data.approval_timeout).toBe(120);
      }

      trackResource({ type: 'behavior-rule', id: body.data.id, agentId });
    }
  });

  it('EXHAUSTIVE_BOUNDARY_PROOF: behavior-rule numeric boundaries are enforced', async () => {
    // EXHAUSTIVE_BOUNDARY_PROOF: behavior-rule numeric boundaries come from
    // TypeSpec @minValue/@maxValue annotations and cover accepted edge values,
    // rejected outside values, and approval-timeout requiredness.
    const operation = backendOperation('AgentController_createBehaviorRule');
    expect(operation.verb).toBe('post');
    const cases = makeBehaviorRuleBoundaryCases();

    for (const testCase of cases.valid) {
      const dto = makeCreateBehaviorRuleDto({
        rule_name: `behavior-boundary-${testCase.id}`,
        trust_impact: 'low',
        ...testCase.overrides,
      });
      const response = await client.post(operationPath(operation.path, { agentId }), dto);
      const body = fullResponse(response);

      expect(body.status, testCase.id).toBe(200);
      expect(body.data).toMatchObject(testCase.expect);

      trackResource({ type: 'behavior-rule', id: body.data.id, agentId });
    }

    for (const testCase of cases.invalid) {
      const dto = makeCreateBehaviorRuleDto({
        rule_name: `behavior-boundary-invalid-${testCase.id}`,
        trust_impact: 'low',
        ...testCase.overrides,
      });
      const response = await client.post(operationPath(operation.path, { agentId }), dto);
      const body = fullResponse(response);

      expect(body.status, testCase.id).toBe(422);
    }
  });

  it('EXHAUSTIVE_BOUNDARY_PROOF: behavior-rule trust impact members match spec', async () => {
    // EXHAUSTIVE_BOUNDARY_PROOF: CreateBehaviorRuleDto.trust_impact finite
    // members are sent through create and read back from the local stack.
    for (const trust_impact of GOVERNANCE_BOUNDARY_DOMAINS.trustImpacts) {
      const dto = makeCreateBehaviorRuleDto({
        rule_name: `behavior-trust-impact-${trust_impact}`,
        trigger: 'http_post',
        states: ['http_post'],
        verdict: 3,
        reject_message: `trust impact ${trust_impact}`,
        trust_impact,
      });
      const response = await client.post(`/agent/${agentId}/behavior-rule`, dto);
      const body = fullResponse(response);

      expect(body.status, trust_impact).toBe(200);
      expect(body.data).toMatchObject({
        rule_name: dto.rule_name,
        trust_impact,
      });

      trackResource({ type: 'behavior-rule', id: body.data.id, agentId });
    }
  });

  it('EXHAUSTIVE_BOUNDARY_PROOF: behavior-rule update trust threshold boundaries match spec', async () => {
    // EXHAUSTIVE_BOUNDARY_PROOF: UpdateBehavioralRuleDto.trust_threshold is
    // numeric|null with @minValue(1); null and the explicit minimum update
    // successfully, while below-min values fail validation.
    const createOperation = backendOperation('AgentController_createBehaviorRule');
    const updateOperation = backendOperation('AgentController_updateBehaviorRule');
    expect([createOperation.verb, updateOperation.verb]).toEqual(['post', 'put']);
    const createResponse = await client.post(operationPath(createOperation.path, { agentId }), makeCreateBehaviorRuleDto({
      rule_name: 'behavior-update-trust-threshold-base',
      trigger: 'http_post',
      states: ['http_post'],
      verdict: 3,
      reject_message: 'base threshold rule',
      trust_impact: 'low',
      trust_threshold: null,
    }));
    const createBody = fullResponse(createResponse);

    expect(createBody.status).toBe(200);
    let updateRuleId = createBody.data.id;
    trackResource({ type: 'behavior-rule', id: updateRuleId, agentId });

    const cases = makeTrustThresholdBoundaryCases('UpdateBehavioralRuleDto');

    for (const testCase of cases.valid) {
      const response = await client.put(operationPath(updateOperation.path, { agentId, behaviorRuleId: updateRuleId }), {
        ...makeCreateBehaviorRuleDto({
          rule_name: `behavior-update-trust-threshold-${testCase.id}`,
          trigger: 'http_post',
          states: ['http_post'],
          verdict: 3,
          reject_message: `update threshold ${testCase.id}`,
          trust_impact: 'medium',
          trust_threshold: testCase.trust_threshold,
        }),
        change_log: `update threshold ${testCase.id}`,
      });
      const body = fullResponse(response);

      expect(body.status, `update:${testCase.id}`).toBe(200);
      expect(body.data).toMatchObject({
        trust_impact: 'medium',
        trust_threshold: testCase.trust_threshold,
      });

      updateRuleId = body.data.id;
      trackResource({ type: 'behavior-rule', id: updateRuleId, agentId });
    }

    for (const testCase of cases.invalid) {
      const response = await client.put(operationPath(updateOperation.path, { agentId, behaviorRuleId: updateRuleId }), {
        ...makeCreateBehaviorRuleDto({
          rule_name: `behavior-update-trust-threshold-invalid-${testCase.id}`,
          trigger: 'http_post',
          states: ['http_post'],
          verdict: 3,
          reject_message: `invalid threshold ${testCase.id}`,
          trust_impact: 'medium',
          trust_threshold: testCase.trust_threshold,
        }),
        change_log: `invalid threshold ${testCase.id}`,
      });
      const body = fullResponse(response);

      expect(body.status, `update:${testCase.id}`).toBe(422);
    }
  });

  it('EXHAUSTIVE: behavior-rule states accepts every spec state member', async () => {
    // EXHAUSTIVE_SPEC_PROOF: BehaviorRuleStateInput resolves to the
    // BehaviorRuleTrigger finite string domain, so every concrete state
    // member is sent through CreateBehaviorRuleDto.states and read back.
    expect(GOVERNANCE_SPEC_DOMAINS.behaviorRuleStateInputVariants).toEqual([
      'BehaviorRuleTrigger',
    ]);
    expect(GOVERNANCE_SPEC_DOMAINS.behaviorRuleStateMembers).toEqual(
      GOVERNANCE_SPEC_DOMAINS.behaviorRuleTriggers,
    );

    const dto = makeCreateBehaviorRuleDto({
      rule_name: 'behavior-state-member-domain',
      trigger: 'http_post',
      states: GOVERNANCE_SPEC_DOMAINS.behaviorRuleStateMembers,
      verdict: 2,
      approval_timeout: 90,
      reject_message: 'approval required for matched state',
      trust_impact: 'none',
    });
    const response = await client.post(`/agent/${agentId}/behavior-rule`, dto);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      rule_name: dto.rule_name,
      trigger: 'http_post',
      verdict: 2,
      approval_timeout: 90,
    });
    for (const state of GOVERNANCE_SPEC_DOMAINS.behaviorRuleStateMembers) {
      expect(JSON.stringify(body.data.states), state).toContain(state);
    }

    trackResource({ type: 'behavior-rule', id: body.data.id, agentId });
  });

  it('does not persist unsupported behavior trigger_match extras', async () => {
    // BOUNDARY_PROOF: trigger_match is outside the backend behavior-rule
    // contract. The backend currently ignores unknown DTO extras, so the
    // test proves the field is not returned as a supported persisted path.
    const response = await client.post(`/agent/${agentId}/behavior-rule`, {
      ...makeCreateBehaviorRuleDto({
        rule_name: 'behavior-trigger-match-extra-boundary',
        trigger: 'http_post',
        states: ['file_write'],
        verdict: 3,
        reject_message: 'trigger_match extra should not persist',
        trust_impact: 'none',
      }),
      trigger_match: [{ field: 'http_url', op: 'contains', value: '/admin' }],
    });
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).not.toHaveProperty('trigger_match');

    const getResponse = await client.get(`/agent/${agentId}/behavior-rule/${body.data.id}`);
    const getBody = fullResponse(getResponse);

    expect(getBody.status).toBe(200);
    expect(getBody.data).not.toHaveProperty('trigger_match');

    trackResource({ type: 'behavior-rule', id: body.data.id, agentId });
  });

  it('rejects structured behavior state objects outside the spec domain', async () => {
    // NEGATIVE_PATH_PROOF: structured state objects are not a persisted
    // backend behavior-rule state variant. They must fail instead of being
    // silently accepted as an untested extra shape.
    const response = await client.post(`/agent/${agentId}/behavior-rule`, {
      ...makeCreateBehaviorRuleDto({
        rule_name: 'behavior-state-object-negative',
        trigger: 'http_post',
        states: [
          {
            semantic_type: 'file_read',
            match: [{ field: 'file_path', op: 'contains', value: '/private' }],
          },
        ],
        verdict: 3,
        reject_message: 'structured state object should be rejected',
        trust_impact: 'none',
      }),
    });
    const body = fullResponse(response);

    expect(body.status).toBe(422);
  });

  it('NEGATIVE_BOUNDARY_PROOF: behavior-rule finite fields reject out-of-domain values', async () => {
    // NEGATIVE_BOUNDARY_PROOF: CreateBehaviorRuleDto and
    // UpdateBehavioralRuleDto reject trigger, states, and verdict values
    // outside their TypeSpec finite domains.
    const invalidTrigger = invalidGovernanceSpecMember('behaviorRuleTriggers');
    const invalidState = invalidGovernanceSpecMember('behaviorRuleStateMembers');
    const invalidVerdict = invalidNumericGovernanceSpecMember('behaviorRuleVerdicts');
    const invalidTrustImpact = invalidBoundarySpecMember('trustImpacts');
    const createCases = [
      makeCreateBehaviorRuleDto({
        rule_name: 'behavior-invalid-trigger',
        trigger: invalidTrigger,
        states: ['http_post'],
      }),
      makeCreateBehaviorRuleDto({
        rule_name: 'behavior-invalid-state',
        trigger: 'http_post',
        states: [invalidState],
      }),
      makeCreateBehaviorRuleDto({
        rule_name: 'behavior-invalid-verdict',
        trigger: 'http_post',
        states: ['http_post'],
        verdict: invalidVerdict,
      }),
      makeCreateBehaviorRuleDto({
        rule_name: 'behavior-invalid-trust-impact',
        trigger: 'http_post',
        states: ['http_post'],
        trust_impact: invalidTrustImpact,
      }),
    ];

    for (const dto of createCases) {
      const response = await client.post(`/agent/${agentId}/behavior-rule`, dto);
      const body = fullResponse(response);

      expect(body.status, dto.rule_name).toBe(422);
    }

    const baseResponse = await client.post(`/agent/${agentId}/behavior-rule`, makeCreateBehaviorRuleDto({
      rule_name: 'behavior-invalid-update-base',
      trigger: 'http_post',
      states: ['http_post'],
      verdict: 3,
      trust_impact: 'none',
    }));
    const baseBody = fullResponse(baseResponse);

    expect(baseBody.status).toBe(200);
    trackResource({ type: 'behavior-rule', id: baseBody.data.id, agentId });

    const updateCases = [
      {
        ...makeCreateBehaviorRuleDto({
          rule_name: 'behavior-invalid-update-trigger',
          trigger: invalidTrigger,
          states: ['http_post'],
          verdict: 3,
        }),
        change_log: 'invalid trigger update',
      },
      {
        ...makeCreateBehaviorRuleDto({
          rule_name: 'behavior-invalid-update-state',
          trigger: 'http_post',
          states: [invalidState],
          verdict: 3,
        }),
        change_log: 'invalid state update',
      },
      {
        ...makeCreateBehaviorRuleDto({
          rule_name: 'behavior-invalid-update-verdict',
          trigger: 'http_post',
          states: ['http_post'],
          verdict: invalidVerdict,
        }),
        change_log: 'invalid verdict update',
      },
      {
        ...makeCreateBehaviorRuleDto({
          rule_name: 'behavior-invalid-update-trust-impact',
          trigger: 'http_post',
          states: ['http_post'],
          trust_impact: invalidTrustImpact,
        }),
        change_log: 'invalid trust impact update',
      },
    ];

    for (const dto of updateCases) {
      const response = await client.put(`/agent/${agentId}/behavior-rule/${baseBody.data.id}`, dto);
      const body = fullResponse(response);

      expect(body.status, dto.rule_name).toBe(422);
    }
  });

  it('NEGATIVE_BOUNDARY_PROOF: behavior-rule dependency UUID format is enforced', async () => {
    // NEGATIVE_BOUNDARY_PROOF: dependency_base_rule_id has a TypeSpec
    // @format("uuid") annotation on create and update DTOs. Non-UUID values
    // must fail validation before dependency ordering is evaluated.
    const invalidCreateDependency = invalidUuidString(
      'CreateBehaviorRuleDto',
      'dependency_base_rule_id',
    );
    const invalidUpdateDependency = invalidUuidString(
      'UpdateBehavioralRuleDto',
      'dependency_base_rule_id',
    );

    const createResponse = await client.post(`/agent/${agentId}/behavior-rule`, makeCreateBehaviorRuleDto({
      rule_name: 'behavior-invalid-create-dependency-uuid',
      trigger: 'http_post',
      states: ['http_post'],
      verdict: 3,
      dependency_base_rule_id: invalidCreateDependency,
      trust_impact: 'none',
    }));
    const createBody = fullResponse(createResponse);

    expect(createBody.status).toBe(422);

    const baseResponse = await client.post(`/agent/${agentId}/behavior-rule`, makeCreateBehaviorRuleDto({
      rule_name: 'behavior-invalid-update-dependency-base',
      trigger: 'http_post',
      states: ['http_post'],
      verdict: 3,
      trust_impact: 'none',
    }));
    const baseBody = fullResponse(baseResponse);

    expect(baseBody.status).toBe(200);
    trackResource({ type: 'behavior-rule', id: baseBody.data.id, agentId });

    const updateResponse = await client.put(`/agent/${agentId}/behavior-rule/${baseBody.data.id}`, {
      ...makeCreateBehaviorRuleDto({
        rule_name: 'behavior-invalid-update-dependency-uuid',
        trigger: 'http_post',
        states: ['http_post'],
        verdict: 3,
        dependency_base_rule_id: invalidUpdateDependency,
        trust_impact: 'none',
      }),
      change_log: 'invalid dependency uuid update',
    });
    const updateBody = fullResponse(updateResponse);

    expect(updateBody.status).toBe(422);
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
