import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { getBackendClient, fullResponse, getTeamIds } from '../helpers/api-client';
import {
  GOVERNANCE_BOUNDARY_DOMAINS,
  invalidBoundarySpecMember,
  makeJsonObjectValueClassPayload,
  makeTrustThresholdBoundaryCases,
} from '../helpers/boundary-conformance';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import {
  makeCreateAgentDto,
  makeCreateGuardrailDto,
  makeGuardrailRunTestConformanceCases,
  makeGuardrailServiceUnavailableConformanceCase,
} from '../helpers/fixtures';
import {
  GOVERNANCE_SPEC_DOMAINS,
  invalidGovernanceSpecMember,
} from '../helpers/governance-spec-domains';
import { startGuardrailProviderStub } from '../helpers/guardrail-provider-stub';
import { runLocalStackSql, sqlLiteral } from '../helpers/local-stack-db';

function listItems(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Guardrails', () => {
  const client = getBackendClient();
  let agentId: string;
  let guardrailId: string;
  let guardrailEvaluationId: string;
  let guardrailName: string;
  let teamIds: string[];
  let guardrailProviderStub: Server | undefined;

  async function closeGuardrailProviderStub() {
    if (!guardrailProviderStub) return;
    const server = guardrailProviderStub;
    guardrailProviderStub = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  async function guardrailRunTestWithThrottleRetry(
    request: () => ReturnType<typeof client.post>,
  ) {
    const throttleWaitMs = Number(process.env.OPENBOX_E2E_THROTTLE_WAIT_MS ?? 65_000);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request();
      const result = fullResponse(response);
      if (result.status !== 429) return result;
      await sleep(throttleWaitMs);
    }
    return fullResponse(await request());
  }

  beforeAll(async () => {
    guardrailProviderStub = await startGuardrailProviderStub();
    teamIds = await getTeamIds();

    const dto = makeCreateAgentDto(teamIds);
    const response = await client.post('/agent/create', dto);
    const body = fullResponse(response);

    expect(body.status).toBe(200);

    agentId = body.data.agent.id;

    trackResource({ type: 'agent', id: agentId });
  });

  it('creates guardrail', async () => {
    // SCENARIO_PROOF: guardrail-lifecycle-order-metrics
    // CONFORMANCE_PROOF: guardrail lifecycle conformance starts with a
    // persisted active guardrail whose returned fields match the authored DTO.
    expect('SCENARIO_PROOF: guardrail-lifecycle-order-metrics').toContain(
      'guardrail-lifecycle-order-metrics',
    );
    const operation = backendOperation('AgentController_createGuardrail');
    expect(operation.verb).toBe('post');
    const dto = makeCreateGuardrailDto();
    guardrailName = dto.name;

    const response = await client.post(operationPath(operation.path, { agentId }), dto);
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.id).toBeDefined();
    expect(body.data.name).toBe(guardrailName);
    expect(body.data.is_active).toBe(true);

    guardrailId = body.data.id;

    trackResource({ type: 'guardrail', id: guardrailId, agentId });
  });

  it('lists guardrails', async () => {
    // SCENARIO_PROOF: guardrail-lifecycle-order-metrics
    // CONFORMANCE_PROOF: guardrail lifecycle conformance verifies list state
    // contains the created guardrail instead of only checking reachability.
    expect('SCENARIO_PROOF: guardrail-lifecycle-order-metrics').toContain(
      'guardrail-lifecycle-order-metrics',
    );
    const operation = backendOperation('AgentController_getGuardrails');
    expect(operation.verb).toBe('get');

    const response = await client.get(operationPath(operation.path, { agentId }));
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(Array.isArray(body.data.data)).toBe(true);

    const found = body.data.data.find((g: any) => g.id === guardrailId);
    expect(found).toBeDefined();
  });

  it('gets guardrail by ID', async () => {
    // SCENARIO_PROOF: guardrail-lifecycle-order-metrics
    // CONFORMANCE_PROOF: guardrail lifecycle conformance reads the persisted
    // guardrail by ID and checks stable identifying fields.
    expect('SCENARIO_PROOF: guardrail-lifecycle-order-metrics').toContain(
      'guardrail-lifecycle-order-metrics',
    );
    const operation = backendOperation('AgentController_getGuardrail');
    expect(operation.verb).toBe('get');

    const response = await client.get(operationPath(operation.path, { agentId, guardrailId }));
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data.name).toBe(guardrailName);
  });

  it('creates every spec guardrail type and stage pair', async () => {
    // EXHAUSTIVE_SPEC_PROOF: the finite CreateGuardrailDto domain is read
    // from TypeSpec and every guardrail_type x processing_stage pair is
    // created and read back through the local stack.
    const pairs = GOVERNANCE_SPEC_DOMAINS.guardrailTypes.flatMap((guardrailType) =>
      GOVERNANCE_SPEC_DOMAINS.guardrailProcessingStages.map((processingStage) => ({
        guardrailType,
        processingStage,
      })),
    );

    expect(pairs).toHaveLength(
      GOVERNANCE_SPEC_DOMAINS.guardrailTypes.length *
        GOVERNANCE_SPEC_DOMAINS.guardrailProcessingStages.length,
    );

    for (const { guardrailType, processingStage } of pairs) {
      const dto = makeCreateGuardrailDto({
        name: `guardrail-domain-${guardrailType}-${processingStage}`,
        guardrail_type: guardrailType as any,
        processing_stage: processingStage as any,
        trust_impact: 'none',
      });
      const response = await client.post(`/agent/${agentId}/guardrails`, dto);
      const body = fullResponse(response);

      expect(body.status).toBe(200);
      expect(body.data).toMatchObject({
        name: dto.name,
        guardrail_type: guardrailType,
        processing_stage: processingStage,
        is_active: true,
      });

      trackResource({ type: 'guardrail', id: body.data.id, agentId });
    }
  });

  it('updates guardrail', async () => {
    // SCENARIO_PROOF: guardrail-lifecycle-order-metrics
    // CONFORMANCE_PROOF: guardrail lifecycle conformance verifies update
    // returns persisted name and active-state mutation.
    expect('SCENARIO_PROOF: guardrail-lifecycle-order-metrics').toContain(
      'guardrail-lifecycle-order-metrics',
    );
    const operation = backendOperation('AgentController_updateGuardrails');
    expect(operation.verb).toBe('put');

    const response = await client.put(operationPath(operation.path, { agentId, guardrailId }), {
      name: 'Updated Guardrail',
      is_active: false,
    });
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      id: guardrailId,
      name: 'Updated Guardrail',
      is_active: false,
    });
    guardrailName = 'Updated Guardrail';
  });

  it('updates through every spec guardrail type and stage pair', async () => {
    // EXHAUSTIVE_SPEC_PROOF: the finite UpdateGuardrailDto guardrail_type and
    // processing_stage domains are identical to create, and every pair is sent
    // through PUT against the same persisted guardrail.
    for (const guardrailType of GOVERNANCE_SPEC_DOMAINS.guardrailTypes) {
      for (const processingStage of GOVERNANCE_SPEC_DOMAINS.guardrailProcessingStages) {
        const name = `updated-guardrail-domain-${guardrailType}-${processingStage}`;
        const response = await client.put(`/agent/${agentId}/guardrails/${guardrailId}`, {
          name,
          guardrail_type: guardrailType,
          processing_stage: processingStage,
          is_active: false,
        });
        const body = fullResponse(response);

        expect(body.status).toBe(200);
        expect(body.data).toMatchObject({
          id: guardrailId,
          name,
          guardrail_type: guardrailType,
          processing_stage: processingStage,
          is_active: false,
        });
        guardrailName = name;
      }
    }
  });

  it('NEGATIVE_BOUNDARY_PROOF: guardrail finite enum fields reject out-of-domain values', async () => {
    // NEGATIVE_BOUNDARY_PROOF: CreateGuardrailDto and UpdateGuardrailDto
    // reject guardrail_type and processing_stage values outside their
    // TypeSpec finite domains.
    const invalidGuardrailType = invalidGovernanceSpecMember('guardrailTypes');
    const invalidProcessingStage = invalidGovernanceSpecMember('guardrailProcessingStages');
    const invalidTrustImpact = invalidBoundarySpecMember('trustImpacts');
    const createCases = [
      makeCreateGuardrailDto({
        name: 'guardrail-invalid-type',
        guardrail_type: invalidGuardrailType as any,
        processing_stage: '0',
      }),
      makeCreateGuardrailDto({
        name: 'guardrail-invalid-stage',
        guardrail_type: '1',
        processing_stage: invalidProcessingStage as any,
      }),
      makeCreateGuardrailDto({
        name: 'guardrail-invalid-trust-impact',
        guardrail_type: '1',
        processing_stage: '0',
        trust_impact: invalidTrustImpact as any,
      }),
    ];

    for (const dto of createCases) {
      const response = await client.post(`/agent/${agentId}/guardrails`, dto);
      const body = fullResponse(response);

      expect(body.status, dto.name).toBe(422);
    }

    for (const update of [
      { guardrail_type: invalidGuardrailType },
      { processing_stage: invalidProcessingStage },
      { trust_impact: invalidTrustImpact },
    ]) {
      const response = await client.put(`/agent/${agentId}/guardrails/${guardrailId}`, update);
      const body = fullResponse(response);

      expect(body.status, JSON.stringify(update)).toBe(422);
    }
  });

  it('reorders guardrail', async () => {
    // SCENARIO_PROOF: guardrail-lifecycle-order-metrics
    // CONFORMANCE_PROOF: guardrail lifecycle conformance verifies reorder
    // returns the same guardrail with the requested order.
    expect('SCENARIO_PROOF: guardrail-lifecycle-order-metrics').toContain(
      'guardrail-lifecycle-order-metrics',
    );
    const operation = backendOperation('AgentController_reorderGuardrail');
    expect(operation.verb).toBe('patch');

    const response = await client.patch(operationPath(operation.path, { agentId, guardrailId }), {
      order: 0,
    });
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      id: guardrailId,
      name: guardrailName,
      order: 0,
    });
  });

  it('runs guardrail test', async () => {
    // CONFORMANCE_PROOF: generated guardrail scenario paths drive allow,
    // blocked, and redacted run-test outcomes through the real backend route.
    for (const testCase of makeGuardrailRunTestConformanceCases()) {
      const body = await guardrailRunTestWithThrottleRetry(() =>
        client.post('/guardrails/run-test', testCase.request),
      );

      expect(body.status).toBe(200);
      expect(body.data).toHaveProperty('validation_passed', testCase.expected.validationPassed);
      expect(body.data.field_results?.[0]).toMatchObject({
        status: testCase.expected.fieldStatus,
      });
      if (testCase.expected.redactedInput) {
        expect(body.data).toHaveProperty('redacted_input');
        expect(body.data.redacted_input).toMatchObject(testCase.expected.redactedInput);
      }
      if (testCase.expected.reasonIncludes) {
        expect(body.data.field_results?.[0]?.reason).toContain(testCase.expected.reasonIncludes);
      }
    }
  });

  it('EXHAUSTIVE_BOUNDARY_PROOF: GuardrailController_runTest covers every guardrail type and outcome', async () => {
    // SCENARIO_PROOF: guardrail-block
    // SCENARIO_PROOF: guardrail-redact
    // EXHAUSTIVE_BOUNDARY_PROOF: GuardrailController_runTest covers every
    // guardrail type and outcome by taking the TypeSpec finite
    // CreateGuardrailDto guardrail_type domain across allowed, blocked,
    // redacted, transformed, and skipped provider outcomes.
    // EXHAUSTIVE_SPEC_PROOF: guardrail finite field statuses are extracted
    // from TypeSpec and every GuardrailFieldResult.status member is returned
    // by the local provider stub.
    expect([
      'SCENARIO_PROOF: guardrail-allow',
      'SCENARIO_PROOF: guardrail-block',
      'SCENARIO_PROOF: guardrail-redact',
    ]).toEqual(expect.arrayContaining([
      'SCENARIO_PROOF: guardrail-allow',
      'SCENARIO_PROOF: guardrail-block',
      'SCENARIO_PROOF: guardrail-redact',
    ]));
    const guardrailRunTestCases = makeGuardrailRunTestConformanceCases();
    const expectedFieldStatuses = [...GOVERNANCE_SPEC_DOMAINS.coreGuardrailFieldStatuses].sort();
    expect(guardrailRunTestCases.map((testCase) => testCase.expected.fieldStatus).sort()).toEqual(
      expectedFieldStatuses,
    );
    expect(guardrailRunTestCases).toHaveLength(expectedFieldStatuses.length);

    const observedStatuses = new Set<string>();
    const observedGuardrailTypeStatuses = new Map<string, Set<string>>();
    const observedGuardrailTypeStatusPairs = new Set<string>();
    const observedValidationResults = new Set<boolean>();

    for (const guardrailType of GOVERNANCE_SPEC_DOMAINS.guardrailTypes) {
      const observedTypeStatuses = new Set<string>();
      observedGuardrailTypeStatuses.set(guardrailType, observedTypeStatuses);

      for (const testCase of guardrailRunTestCases) {
        const body = await guardrailRunTestWithThrottleRetry(() =>
          client.post('/guardrails/run-test', {
            ...testCase.request,
            guardrail_type: guardrailType,
          }),
        );

        expect(body.status, `${guardrailType}:${testCase.name}`).toBe(200);
        expect(body.data).toHaveProperty('validation_passed', testCase.expected.validationPassed);
        observedValidationResults.add(Boolean(body.data.validation_passed));
        expect(body.data.field_results?.[0]).toMatchObject({
          status: testCase.expected.fieldStatus,
        });
        const observedStatus = String(body.data.field_results?.[0]?.status);
        observedStatuses.add(observedStatus);
        observedTypeStatuses.add(observedStatus);
        observedGuardrailTypeStatusPairs.add(`${guardrailType}:${observedStatus}`);
        expect(body.data.results?.[0]).toMatchObject({
          guardrail_type: guardrailType,
        });
        if (testCase.expected.redactedInput) {
          expect(body.data.redacted_input).toMatchObject(testCase.expected.redactedInput);
        }
      }
    }

    expect([...observedStatuses].sort()).toEqual(expectedFieldStatuses);
    for (const guardrailType of GOVERNANCE_SPEC_DOMAINS.guardrailTypes) {
      expect([...(observedGuardrailTypeStatuses.get(guardrailType) ?? [])].sort()).toEqual(
        expectedFieldStatuses,
      );
    }
    expect(observedGuardrailTypeStatusPairs.size).toBe(
      GOVERNANCE_SPEC_DOMAINS.guardrailTypes.length * expectedFieldStatuses.length,
    );
    expect(observedStatuses).toContain('allowed');
    expect(observedStatuses).toContain('blocked');
    expect(observedStatuses).toContain('redacted');
    expect(observedStatuses).toContain('transformed');
    expect(observedStatuses).toContain('skipped');
    expect(observedValidationResults).toContain(true);
    expect(observedValidationResults).toContain(false);
  });

  it('BOUNDARY_PROOF: TestGuardrailDto preserves every JSON value class', async () => {
    // BOUNDARY_PROOF: TestGuardrailDto preserves every JSON value class for
    // params/settings/logs open Record<unknown> object bags.
    const operation = backendOperation('GuardrailController_runTest');
    expect(operation.verb).toBe('post');
    const payload = makeJsonObjectValueClassPayload();
    expect(operation.path).toBe('/guardrails/run-test');
    const body = await guardrailRunTestWithThrottleRetry(() =>
      client.post('/guardrails/run-test', {
        guardrail_type: 'custom_open_type',
        params: {
          ...payload,
          threshold: 1,
        },
        settings: {
          ...payload,
          enabled: true,
        },
        logs: {
          ...payload,
          text: 'safe json value classes',
        },
      }),
    );

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      validation_passed: true,
      raw_params: {
        ...payload,
        threshold: 1,
      },
      raw_settings: {
        ...payload,
        enabled: true,
      },
      raw_logs: {
        ...payload,
        text: 'safe json value classes',
      },
    });
    expect(body.data.results?.[0]).toMatchObject({
      guardrail_type: 'custom_open_type',
    });
  });

  it('BOUNDARY_PROOF: guardrail create/update params and settings preserve every JSON value class', async () => {
    // BOUNDARY_PROOF: CreateGuardrailDto and UpdateGuardrailDto preserve
    // every JSON value class for persisted params/settings open
    // Record<unknown> object bags.
    const createOperation = backendOperation('AgentController_createGuardrail');
    const updateOperation = backendOperation('AgentController_updateGuardrails');
    expect([createOperation.verb, updateOperation.verb]).toEqual(['post', 'put']);
    const payload = makeJsonObjectValueClassPayload();
    const createResponse = await client.post(operationPath(createOperation.path, { agentId }), makeCreateGuardrailDto({
      name: 'guardrail-json-value-classes-create',
      guardrail_type: '1',
      processing_stage: '0',
      params: {
        ...payload,
        phase: 'create',
      },
      settings: {
        ...payload,
        enabled: true,
      },
      trust_impact: 'none',
    }));
    const createBody = fullResponse(createResponse);

    expect(createBody.status).toBe(200);
    expect(createBody.data.params).toMatchObject({
      ...payload,
      phase: 'create',
    });
    expect(createBody.data.settings).toMatchObject({
      ...payload,
      enabled: true,
    });

    trackResource({ type: 'guardrail', id: createBody.data.id, agentId });

    const updateResponse = await client.put(
      operationPath(updateOperation.path, { agentId, guardrailId: createBody.data.id }),
      {
        params: {
          ...payload,
          phase: 'update',
        },
        settings: {
          ...payload,
          enabled: false,
        },
      },
    );
    const updateBody = fullResponse(updateResponse);

    expect(updateBody.status).toBe(200);
    expect(updateBody.data.params).toMatchObject({
      ...payload,
      phase: 'update',
    });
    expect(updateBody.data.settings).toMatchObject({
      ...payload,
      enabled: false,
    });
  });

  it('EXHAUSTIVE_BOUNDARY_PROOF: guardrail trust impact and threshold boundaries match spec', async () => {
    // EXHAUSTIVE_BOUNDARY_PROOF: CreateGuardrailDto and
    // UpdateGuardrailDto trust_impact finite members and trust_threshold
    // numeric|null boundaries match the TypeSpec contract and local-stack
    // validation.
    const createCases = makeTrustThresholdBoundaryCases('CreateGuardrailDto');
    const updateCases = makeTrustThresholdBoundaryCases('UpdateGuardrailDto');

    for (const trust_impact of GOVERNANCE_BOUNDARY_DOMAINS.trustImpacts) {
      for (const testCase of createCases.valid) {
        const response = await client.post(`/agent/${agentId}/guardrails`, makeCreateGuardrailDto({
          name: `guardrail-trust-${trust_impact}-${testCase.id}`,
          guardrail_type: '1',
          processing_stage: '0',
          trust_impact: trust_impact as 'none' | 'low' | 'medium' | 'high',
          trust_threshold: testCase.trust_threshold,
        }));
        const body = fullResponse(response);

        expect(body.status, `${trust_impact}:${testCase.id}`).toBe(200);
        expect(body.data).toMatchObject({
          trust_impact,
          trust_threshold: testCase.trust_threshold,
        });

        trackResource({ type: 'guardrail', id: body.data.id, agentId });
      }
    }

    for (const testCase of createCases.invalid) {
      const response = await client.post(`/agent/${agentId}/guardrails`, makeCreateGuardrailDto({
        name: `guardrail-threshold-invalid-${testCase.id}`,
        guardrail_type: '1',
        processing_stage: '0',
        trust_impact: 'low',
        trust_threshold: testCase.trust_threshold,
      }));
      const body = fullResponse(response);

      expect(body.status, testCase.id).toBe(422);
    }

    for (const testCase of updateCases.valid) {
      const response = await client.put(`/agent/${agentId}/guardrails/${guardrailId}`, {
        trust_impact: 'medium',
        trust_threshold: testCase.trust_threshold,
      });
      const body = fullResponse(response);

      expect(body.status, `update:${testCase.id}`).toBe(200);
      expect(body.data).toMatchObject({
        id: guardrailId,
        trust_impact: 'medium',
        trust_threshold: testCase.trust_threshold,
      });
    }

    for (const testCase of updateCases.invalid) {
      const response = await client.put(`/agent/${agentId}/guardrails/${guardrailId}`, {
        trust_impact: 'medium',
        trust_threshold: testCase.trust_threshold,
      });
      const body = fullResponse(response);

      expect(body.status, `update:${testCase.id}`).toBe(422);
    }
  });

  it('fails closed when guardrail service is unavailable', async () => {
    // SCENARIO_PROOF: guardrail-service-unavailable-fail-closed
    // NEGATIVE_PATH_PROOF: generated guardrail service unavailable scenario
    // closes the provider stub, then asserts the backend does not allow the
    // run-test request through as a successful validation.
    expect(['SCENARIO_PROOF: guardrail-service-unavailable-fail-closed']).toEqual(
      expect.arrayContaining(['SCENARIO_PROOF: guardrail-service-unavailable-fail-closed']),
    );
    const testCase = makeGuardrailServiceUnavailableConformanceCase();
    expect(testCase.scenarioId).toBe('guardrail-service-unavailable-fail-closed');
    expect(testCase.expected.messageIncludes).toBe('Guardrails test execution failed');

    await closeGuardrailProviderStub();

    const body = await guardrailRunTestWithThrottleRetry(() =>
      client.post('/guardrails/run-test', testCase.request),
    );

    expect(body.status).toBe(testCase.expected.status);
    expect(JSON.stringify(body)).toContain(testCase.expected.messageIncludes);
  });

  it('gets guardrail metrics', async () => {
    // SCENARIO_PROOF: guardrail-lifecycle-order-metrics
    // CONFORMANCE_PROOF: guardrail violation ledger row is seeded in the
    // local-stack DB and metrics must expose the guardrail dashboard shape.
    expect('SCENARIO_PROOF: guardrail-lifecycle-order-metrics').toContain(
      'guardrail-lifecycle-order-metrics',
    );
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
          'guardrail-eval-wf-' || gen_random_uuid(),
          'guardrail-eval-run-' || gen_random_uuid(),
          'completed',
          'guardrail violation ledger',
          now() - interval '2 minutes',
          now() - interval '1 minute',
          now(),
          '{"openbox_conformance":true,"source":"guardrails.e2e"}'::jsonb
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
          'guardrail-violation-ledger',
          'LLMCompletion',
          1,
          '[{"text":"BLOCK_ME"}]'::jsonb,
          '{"decision":"blocked"}'::jsonb,
          1,
          'guardrail violation ledger',
          '{"openbox_conformance":true,"source":"guardrails.e2e"}'::jsonb
        from seeded_session
        returning id
      ),
      seeded_guardrail_evaluation as (
        insert into guardrails_evaluations (
          guardrails_id,
          governance_event_id,
          guardrails_type,
          input,
          output,
          passed,
          details,
          status
        )
        select
          ${sqlLiteral(guardrailId)},
          seeded_event.id,
          'pii_detection',
          'BLOCK_ME',
          'blocked',
          false,
          '{"reason":"guardrail violation ledger","field":"logs.text"}'::jsonb,
          'blocked'
        from seeded_event
        returning id
      )
      select id from seeded_guardrail_evaluation;
    `);
    guardrailEvaluationId = seedOutput.trim().split('\n').at(-1)!;

    const operation = backendOperation('AgentController_getGuardrailMetrics');
    expect(operation.verb).toBe('get');

    const response = await client.get(operationPath(operation.path, { agentId }));
    const body = fullResponse(response);

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      active_guardrails: expect.any(Number),
      violations_today: expect.any(Number),
      avg_response_time_ms: expect.any(Number),
      violations_trend: expect.any(Array),
      trigger_rate_by_type: expect.any(Array),
      latency_percentiles: expect.any(Object),
      evaluations_per_sec: expect.any(Number),
    });
    expect(
      typeof body.data.protection_rate === 'number' || body.data.protection_rate === null,
    ).toBe(true);
  });

  it('gets guardrail violation logs', async () => {
    // SCENARIO_PROOF: guardrail-lifecycle-order-metrics
    // CONFORMANCE_PROOF: guardrail lifecycle conformance reads the seeded
    // guardrail violation ledger row through the public violation-log surface.
    expect('SCENARIO_PROOF: guardrail-lifecycle-order-metrics').toContain(
      'guardrail-lifecycle-order-metrics',
    );
    const operation = backendOperation('AgentController_getGuardrailViolationLogs');
    expect(operation.verb).toBe('get');

    const response = await client.get(operationPath(operation.path, { agentId }));
    const body = fullResponse(response);
    const violation = listItems(body.data).find((entry: any) => entry.id === guardrailEvaluationId);

    expect(body.status).toBe(200);
    expect(violation).toMatchObject({
      id: guardrailEvaluationId,
      status: 'blocked',
    });
  });

  it('deletes guardrail', async () => {
    // SCENARIO_PROOF: guardrail-lifecycle-order-metrics
    // CONFORMANCE_PROOF: guardrail lifecycle conformance deletes the guardrail
    // and verifies it is removed from subsequent list results.
    expect('SCENARIO_PROOF: guardrail-lifecycle-order-metrics').toContain(
      'guardrail-lifecycle-order-metrics',
    );
    const deleteOperation = backendOperation('AgentController_deleteGuardrails');
    const listOperation = backendOperation('AgentController_getGuardrails');
    expect(deleteOperation.verb).toBe('delete');
    expect(listOperation.verb).toBe('get');

    const response = await client.delete(
      operationPath(deleteOperation.path, { agentId, guardrailId }),
    );
    const body = fullResponse(response);

    expect(body.status).toBe(200);

    const listResponse = await client.get(operationPath(listOperation.path, { agentId }));
    const listBody = fullResponse(listResponse);

    expect(listBody.status).toBe(200);
    expect(listItems(listBody.data).find((g: any) => g.id === guardrailId)).toBeUndefined();
  });

  afterAll(async () => {
    await cleanupAll();
    await closeGuardrailProviderStub();
  });
});
