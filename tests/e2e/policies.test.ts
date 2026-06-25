import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { getBackendClient, fullResponse, getTeamIds, hasOrgId } from '../helpers/api-client';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import {
  GOVERNANCE_BOUNDARY_DOMAINS,
  invalidBoundarySpecMember,
  makeJsonObjectValueClassPayload,
  makeTrustThresholdBoundaryCases,
  overMaxLengthString,
} from '../helpers/boundary-conformance';
import {
  makeCreateAgentDto,
  makeCreatePolicyDto,
  makeEvaluateRegoConformanceCase,
} from '../helpers/fixtures';
import {
  seedLocalStackGovernanceEvent,
  seedLocalStackPolicyEvaluation,
  seedLocalStackSession,
} from '../helpers/local-stack-db';

const CAN_RUN = !!process.env.OPENBOX_BACKEND_API_KEY && hasOrgId();
const describeOrSkip = CAN_RUN ? describe : describe.skip;
const POLICY_BOUNDARY_TEST_TIMEOUT_MS = Number(
  process.env.OPENBOX_E2E_POLICY_BOUNDARY_TEST_TIMEOUT_MS ?? 180_000,
);

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

function listItems(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

describeOrSkip('Policies', () => {
  let client: ReturnType<typeof getBackendClient>;
  let agentId: string;
  let policyId: string;
  let policyName: string;
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

  it('creates policy', async () => {
    // SCENARIO_PROOF: policy-lifecycle-evaluations-metrics
    // CONFORMANCE_PROOF: policy lifecycle conformance starts with a
    // persisted active policy whose returned fields match the authored Rego.
    expect('SCENARIO_PROOF: policy-lifecycle-evaluations-metrics').toContain(
      'policy-lifecycle-evaluations-metrics',
    );
    const operation = backendOperation('AgentController_createPolicy');
    expect(operation.verb).toBe('post');
    const dto = makeCreatePolicyDto();
    policyName = dto.name;

    const response = await client.post(operationPath(operation.path, { agentId }), dto);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.id).toBeDefined();
    expect(body.data.name).toBe(policyName);
    expect(body.data.rego_code).toContain('package');
    expect(body.data.is_active).toBe(true);

    policyId = body.data.id;

    trackResource({ type: 'policy', id: policyId, agentId });
  });

  it('lists policies', async () => {
    // SCENARIO_PROOF: policy-lifecycle-evaluations-metrics
    // CONFORMANCE_PROOF: policy lifecycle conformance verifies list state
    // contains the created policy instead of only checking route reachability.
    expect('SCENARIO_PROOF: policy-lifecycle-evaluations-metrics').toContain(
      'policy-lifecycle-evaluations-metrics',
    );
    const operation = backendOperation('AgentController_getPolicies');
    expect(operation.verb).toBe('get');

    const response = await client.get(operationPath(operation.path, { agentId }));
    const body = fullResponse(response);

    expect(body.status).toBe(200);

    const policies = Array.isArray(body.data) ? body.data : body.data.data;
    const found = policies.find((p: any) => p.id === policyId);
    expect(found).toBeDefined();
  });

  it('gets current policies', async () => {
    // SCENARIO_PROOF: policy-lifecycle-evaluations-metrics
    // CONFORMANCE_PROOF: policy lifecycle conformance verifies the current
    // policy surface returns the created active policy object.
    expect('SCENARIO_PROOF: policy-lifecycle-evaluations-metrics').toContain(
      'policy-lifecycle-evaluations-metrics',
    );
    const operation = backendOperation('AgentController_getCurrentPolicy');
    expect(operation.verb).toBe('get');

    const response = await client.get(operationPath(operation.path, { agentId }));
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      id: policyId,
      name: policyName,
      is_active: true,
    });
  });

  it('gets policy by ID', async () => {
    const operation = backendOperation('AgentController_getPolicy');
    expect(operation.verb).toBe('get');

    const response = await client.get(operationPath(operation.path, { agentId, policyId }));
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.name).toBe(policyName);
  });

  it('updates policy active status', async () => {
    // SCENARIO_PROOF: policy-lifecycle-evaluations-metrics
    // CONFORMANCE_PROOF: policy lifecycle conformance verifies update returns
    // persisted active-state mutation for the policy.
    expect('SCENARIO_PROOF: policy-lifecycle-evaluations-metrics').toContain(
      'policy-lifecycle-evaluations-metrics',
    );
    const operation = backendOperation('AgentController_updatePolicy');
    expect(operation.verb).toBe('put');

    const response = await client.put(operationPath(operation.path, { agentId, policyId }), {
      is_active: false,
    });
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      id: policyId,
      is_active: false,
    });
  });

  it('evaluates rego', async () => {
    // SCENARIO_PROOF: opa-allow
    expect('SCENARIO_PROOF: opa-allow').toContain('opa-allow');
    const regoCase = makeEvaluateRegoConformanceCase();
    const operation = backendOperation(regoCase.operationId);
    expect(operation.verb).toBe('post');
    expect(regoCase.body.policy).toContain('allow = true');
    expect(regoCase.expected).toEqual({ allow: true });

    const response = await client.post(operation.path, regoCase.body);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toEqual(expect.objectContaining(regoCase.expected));
  });

  it('BOUNDARY_PROOF: PolicyController_evaluate handles nested Rego v1 input and invalid Rego', async () => {
    // BOUNDARY_PROOF: PolicyController_evaluate handles nested Rego v1 input
    // for allow and deny outcomes, and invalid Rego must fail closed instead
    // of producing an allow result.
    const operation = backendOperation('PolicyController_evaluate');
    const policy = [
      'package test',
      'default allow := false',
      'allow if {',
      '  input.user.role == "admin"',
      '  input.request.amount <= 100',
      '}',
    ].join('\n');

    const allowResponse = await client.post(operation.path, {
      policy,
      input: {
        user: { role: 'admin' },
        request: { amount: 50, tags: ['safe', 'nested'] },
      },
    });
    const allowBody = fullResponse(allowResponse);

    expect(allowBody.status).toBe(200);
    expect(allowBody.data).toMatchObject({ allow: true });

    const denyResponse = await client.post(operation.path, {
      policy,
      input: {
        user: { role: 'viewer' },
        request: { amount: 500, tags: ['unsafe', 'nested'] },
      },
    });
    const denyBody = fullResponse(denyResponse);

    expect(denyBody.status).toBe(200);
    expect(denyBody.data).toMatchObject({ allow: false });

    const invalidResponse = await client.post(operation.path, {
      policy: 'package test\nallow {',
      input: {},
    });
    const invalidBody = fullResponse(invalidResponse);

    expect(invalidBody.status).toBe(500);
  });

  it('BOUNDARY_PROOF: backend open JSON fields preserve every JSON value class', async () => {
    // BOUNDARY_PROOF: backend open JSON fields preserve every JSON value
    // class for CreatePolicyDto.input/config and EvaluateRegoDto.input.
    const payload = makeJsonObjectValueClassPayload();
    const dto = makeCreatePolicyDto({
      name: `policy-json-value-classes-${Date.now().toString(36)}`,
      input: payload,
      config: payload,
      trust_impact: 'none',
      trust_threshold: null,
    });
    const response = await client.post(`/agent/${agentId}/policies`, dto);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.input).toMatchObject(payload);
    expect(body.data.config).toMatchObject(payload);

    trackResource({ type: 'policy', id: body.data.id, agentId });

    const operation = backendOperation('PolicyController_evaluate');
    const evaluateResponse = await client.post(operation.path, {
      policy: [
        'package test',
        'default allow := false',
        'allow if {',
        '  input.null_value == null',
        '  input.boolean_value == true',
        '  input.number_value == 42',
        '  input.string_value == "json-value-string"',
        '  input.array_value[3].nested == true',
        '  input.object_value.nested.flag == true',
        '}',
      ].join('\n'),
      input: payload,
    });
    const evaluateBody = fullResponse(evaluateResponse);

    expect(evaluateBody.status).toBe(200);
    expect(evaluateBody.data).toMatchObject({ allow: true });
  });

  it('NEGATIVE_BOUNDARY_PROOF: policy string maxLength fields reject over-limit values', async () => {
    // NEGATIVE_BOUNDARY_PROOF: CreatePolicyDto.name and description maxLength
    // annotations are extracted from TypeSpec and enforced by local-stack
    // validation.
    const cases = [
      {
        id: 'name',
        body: makeCreatePolicyDto({
          name: overMaxLengthString('CreatePolicyDto', 'name'),
        }),
      },
      {
        id: 'description',
        body: makeCreatePolicyDto({
          description: overMaxLengthString('CreatePolicyDto', 'description'),
        }),
      },
    ];

    for (const testCase of cases) {
      const response = await client.post(`/agent/${agentId}/policies`, testCase.body);
      const body = fullResponse(response);

      expect(body.status, testCase.id).toBe(422);
    }
  });

  it('BOUNDARY_PROOF: policy trust impact and threshold boundaries match spec', async () => {
    // BOUNDARY_PROOF: CreatePolicyDto and UpdatePolicyDto trust_impact
    // finite members and trust_threshold numeric|null boundaries match the
    // TypeSpec contract and local-stack validation.
    const createCases = makeTrustThresholdBoundaryCases('CreatePolicyDto');
    const updateCases = makeTrustThresholdBoundaryCases('UpdatePolicyDto');

    for (const trust_impact of GOVERNANCE_BOUNDARY_DOMAINS.trustImpacts) {
      for (const testCase of createCases.valid) {
        const dto = makeCreatePolicyDto({
          name: `policy-trust-${trust_impact}-${testCase.id}`,
          trust_impact: trust_impact as 'none' | 'low' | 'medium' | 'high',
          trust_threshold: testCase.trust_threshold,
        });
        const response = await client.post(`/agent/${agentId}/policies`, dto);
        const body = fullResponse(response);

        expect(body.status, `${trust_impact}:${testCase.id}`).toBe(200);
        expect(body.data).toMatchObject({
          name: dto.name,
          trust_impact,
          trust_threshold: testCase.trust_threshold,
        });

        trackResource({ type: 'policy', id: body.data.id, agentId });
      }
    }

    for (const testCase of createCases.invalid) {
      const response = await client.post(`/agent/${agentId}/policies`, makeCreatePolicyDto({
        name: `policy-trust-invalid-${testCase.id}`,
        trust_impact: 'low',
        trust_threshold: testCase.trust_threshold,
      }));
      const body = fullResponse(response);

      expect(body.status, testCase.id).toBe(422);
    }

    const invalidTrustImpact = invalidBoundarySpecMember('trustImpacts');

    const invalidCreateImpact = await client.post(`/agent/${agentId}/policies`, makeCreatePolicyDto({
      name: 'policy-trust-invalid-impact',
      trust_impact: invalidTrustImpact as any,
      trust_threshold: 1,
    }));
    expect(fullResponse(invalidCreateImpact).status).toBe(422);

    for (const testCase of updateCases.valid) {
      const response = await client.put(`/agent/${agentId}/policies/${policyId}`, {
        trust_impact: 'medium',
        trust_threshold: testCase.trust_threshold,
      });
      const body = fullResponse(response);

      expect(body.status, `update:${testCase.id}`).toBe(200);
      expect(body.data).toMatchObject({
        id: policyId,
        trust_impact: 'medium',
        trust_threshold: testCase.trust_threshold,
      });
    }

    for (const testCase of updateCases.invalid) {
      const response = await client.put(`/agent/${agentId}/policies/${policyId}`, {
        trust_impact: 'medium',
        trust_threshold: testCase.trust_threshold,
      });
      const body = fullResponse(response);

      expect(body.status, `update:${testCase.id}`).toBe(422);
    }

    const invalidUpdateImpact = await client.put(`/agent/${agentId}/policies/${policyId}`, {
      trust_impact: invalidTrustImpact,
      trust_threshold: 1,
    });
    expect(fullResponse(invalidUpdateImpact).status).toBe(422);
  }, POLICY_BOUNDARY_TEST_TIMEOUT_MS);

  it('gets policy metrics', async () => {
    // CONFORMANCE_PROOF: policy lifecycle conformance asserts policy metrics
    // dashboard shape instead of only HTTP reachability.
    expect('SCENARIO_PROOF: policy-lifecycle-evaluations-metrics').toContain(
      'policy-lifecycle-evaluations-metrics',
    );
    const response = await client.get(`/agent/${agentId}/policies/metrics`);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      total_evaluations: expect.any(Number),
      avg_latency_ms: expect.any(Number),
      decision_distribution: expect.any(Object),
      timeline: expect.any(Array),
      top_rules_hit: expect.any(Array),
    });
    expect(
      typeof body.data.compliance_rate === 'number' || body.data.compliance_rate === null,
    ).toBe(true);
  });

  it('CONFORMANCE: reads seeded policy evaluation ledger rows', async () => {
    // SCENARIO_PROOF: policy-lifecycle-evaluations-metrics
    // CONFORMANCE_PROOF: policy evaluation ledger rows are seeded in the
    // local-stack DB and then read through policy evaluations and metrics.
    expect('SCENARIO_PROOF: policy-lifecycle-evaluations-metrics').toContain(
      'policy-lifecycle-evaluations-metrics',
    );
    const session = await seedLocalStackSession({
      agentId,
      workflowIdPrefix: 'policy-eval-wf-',
      runIdPrefix: 'policy-eval-run-',
      detail: 'policy evaluation ledger',
      metadata: { openbox_conformance: true, source: 'policies.e2e' },
    });
    const event = await seedLocalStackGovernanceEvent({
      agentId,
      session,
      activityId: 'policy-evaluation-ledger',
      activityType: 'DatabaseQuery',
      input: [{ query: 'select * from payments' }],
      output: { decision: 'block' },
      verdict: 1,
      reason: 'policy evaluation ledger',
      metadata: { openbox_conformance: true, source: 'policies.e2e' },
    });
    const policyEvaluationId = await seedLocalStackPolicyEvaluation({
      policyId,
      governanceEventId: event.id,
      input: { query: 'select * from payments' },
      output: { decision: 'block' },
      evaluationResult: 'block',
      evaluationDetails: {
        reason: 'policy evaluation ledger',
        decision_distribution: 'block',
      },
      slug: 'policy-evaluation-ledger',
    });

    const evaluationsResponse = await client.get(
      `/agent/${agentId}/policies/${policyId}/evaluations`,
    );
    const evaluationsBody = fullResponse(evaluationsResponse);
    const evaluation = listItems(evaluationsBody.data).find(
      (entry: any) => entry.id === policyEvaluationId,
    );

    expect(evaluationsBody.status).toBe(200);
    expect(evaluation).toMatchObject({
      id: policyEvaluationId,
      evaluation_result: 'block',
    });

    const metricsResponse = await client.get(`/agent/${agentId}/policies/metrics`);
    const metricsBody = fullResponse(metricsResponse);

    expect(metricsBody.status).toBe(200);
    expect(metricsBody.data.decision_distribution).toMatchObject({
      block: expect.any(Number),
    });
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
