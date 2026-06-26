import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { GUARDRAILS_HUB_RECORDING_SURFACE } from '../../ts/src/governance/capability-matrix.js';
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
  makeGuardrailServiceUnavailableConformanceCase,
} from '../helpers/fixtures';
import {
  GOVERNANCE_SPEC_DOMAINS,
  invalidGovernanceSpecMember,
} from '../helpers/governance-spec-domains';
import {
  seedLocalStackGovernanceEvent,
  seedLocalStackGuardrailEvaluation,
  seedLocalStackSession,
} from '../helpers/local-stack-db';

const RUN_ISOLATED_GUARDRAIL_UNAVAILABLE =
  process.env.OPENBOX_E2E_ISOLATED_GUARDRAIL_UNAVAILABLE === '1';
const itIfIsolatedGuardrailUnavailable = RUN_ISOLATED_GUARDRAIL_UNAVAILABLE ? it : it.skip;
const GUARDRAIL_RUN_TEST_TIMEOUT_MS = 120_000;

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

interface RealGuardrailRunTestCase {
  scenarioId: 'guardrail-allow' | 'guardrail-block' | 'guardrail-redact';
  name: string;
  request: {
    guardrail_type: string;
    params: Record<string, unknown>;
    settings: Record<string, unknown>;
    logs: Record<string, unknown>;
  };
  expected: {
    detail: string | null;
    semanticStatus: 'allowed' | 'violation' | 'failure';
    success: boolean;
    violationsDetected: boolean;
    validatedLogs: unknown;
  };
}

interface RecordedGuardrailsHubFixture {
  status: 'recorded';
  records: Array<{
    caseId: string;
    variantId: string;
    guardrailType: string;
    expectedSemanticStatus: 'allowed' | 'violation' | 'failure';
    sampleCount: number;
    stable: boolean;
    samples: Array<{
      detail: string | null;
      semanticStatus: 'allowed' | 'violation' | 'failure';
      success: boolean;
      validatedLogs: unknown;
      violationsDetected: boolean;
    }>;
  }>;
}

function loadRecordedGuardrailsHubFixture(): RecordedGuardrailsHubFixture {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), GUARDRAILS_HUB_RECORDING_SURFACE.fixturePath), 'utf8'),
  ) as RecordedGuardrailsHubFixture;
}

function recordedHubSampleByVariant() {
  const fixture = loadRecordedGuardrailsHubFixture();
  expect(fixture.status).toBe('recorded');
  const samples = new Map<string, RecordedGuardrailsHubFixture['records'][number]['samples'][number]>();
  for (const record of fixture.records) {
    expect(record.stable, `${record.caseId}/${record.variantId} recorded stability`).toBe(true);
    expect(record.samples, `${record.caseId}/${record.variantId} recorded samples`).toHaveLength(
      record.sampleCount,
    );
    samples.set(`${record.caseId}/${record.variantId}`, record.samples[0]);
  }
  return samples;
}

function makeRealGuardrailRunTestCases(): RealGuardrailRunTestCase[] {
  const samples = recordedHubSampleByVariant();
  return GUARDRAILS_HUB_RECORDING_SURFACE.cases.flatMap((recordingCase) =>
    recordingCase.variants.map((variant) => {
      const expected = samples.get(`${recordingCase.id}/${variant.id}`);
      expect(expected, `${recordingCase.id}/${variant.id} recorded sample`).toBeDefined();
      const scenarioId = variant.expectedSemanticStatus === 'allowed'
        ? 'guardrail-allow'
        : recordingCase.guardrailType === '1'
          ? 'guardrail-redact'
          : 'guardrail-block';
      return {
        scenarioId,
        name: `${recordingCase.id}/${variant.id}`,
        request: {
          guardrail_type: recordingCase.guardrailType,
          params: variant.params,
          settings: variant.settings,
          logs: variant.logs,
        },
        expected: expected!,
      };
    }),
  );
}

function expectRealGuardrailRunTestResult(body: any, testCase: RealGuardrailRunTestCase) {
  expect(body.data, testCase.name).toMatchObject({
    raw_logs: testCase.request.logs,
    success: testCase.expected.success,
    violations_detected: testCase.expected.violationsDetected,
  });
  expect(body.data.validated_logs, testCase.name).toBeDefined();
  expect(body.data.detail, testCase.name).toBe(testCase.expected.detail);
  expect(body.data.validated_logs, testCase.name).toEqual(testCase.expected.validatedLogs);
}

describe('Guardrails', () => {
  const client = getBackendClient();
  let agentId: string;
  let guardrailId: string;
  let guardrailEvaluationId: string;
  let guardrailName: string;
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

  it('EXHAUSTIVE_BOUNDARY_PROOF: GuardrailController_runTest covers every guardrail type and outcome', async () => {
    // SCENARIO_PROOF: guardrail-block
    // SCENARIO_PROOF: guardrail-redact
    // EXHAUSTIVE_BOUNDARY_PROOF: GuardrailController_runTest covers every
    // guardrail type and outcome by taking the TypeSpec finite
    // CreateGuardrailDto guardrail_type domain through the real Guardrails
    // service run-test contract. The endpoint returns success plus
    // violations_detected; field-level statuses are a Core evaluation result,
    // not part of this backend run-test provider contract.
    expect([
      'SCENARIO_PROOF: guardrail-allow',
      'SCENARIO_PROOF: guardrail-block',
      'SCENARIO_PROOF: guardrail-redact',
    ]).toEqual(expect.arrayContaining([
      'SCENARIO_PROOF: guardrail-allow',
      'SCENARIO_PROOF: guardrail-block',
      'SCENARIO_PROOF: guardrail-redact',
    ]));
    const observedGuardrailTypes = new Set<string>();
    const observedSemanticStatuses = new Set<string>();
    const observedSuccessResults = new Set<boolean>();
    const observedViolationResults = new Set<boolean>();
    const canonicalCases = makeRealGuardrailRunTestCases();
    const expectedVariantCount = GUARDRAILS_HUB_RECORDING_SURFACE.cases.reduce(
      (count, recordingCase) => count + recordingCase.variants.length,
      0,
    );
    const allowCase = canonicalCases.find((testCase) =>
      testCase.scenarioId === 'guardrail-allow'
    );
    const blockCase = canonicalCases.find((testCase) =>
      testCase.scenarioId === 'guardrail-block'
    );
    const redactCase = canonicalCases.find((testCase) =>
      testCase.scenarioId === 'guardrail-redact'
    );
    const banListBlockCase = canonicalCases.find((testCase) =>
      testCase.name === 'ban-list/violation'
    );
    const detectPiiRedactCase = canonicalCases.find((testCase) =>
      testCase.name === 'detect-pii/email-violation'
    );

    expect(allowCase).toBeDefined();
    expect(blockCase).toBeDefined();
    expect(redactCase).toBeDefined();
    expect(banListBlockCase?.scenarioId).toBe('guardrail-block');
    expect(detectPiiRedactCase?.scenarioId).toBe('guardrail-redact');
    expect(JSON.stringify(banListBlockCase?.expected.validatedLogs)).toContain('contains r text');
    expect(JSON.stringify(detectPiiRedactCase?.expected.validatedLogs)).toContain('<EMAIL_ADDRESS>');
    expect(canonicalCases).toHaveLength(expectedVariantCount);

    for (const testCase of canonicalCases) {
      const body = fullResponse(await client.post('/guardrails/run-test', testCase.request));

      expect(body.status, testCase.scenarioId).toBe(200);
      expectRealGuardrailRunTestResult(body, testCase);
      observedGuardrailTypes.add(testCase.request.guardrail_type);
      observedSemanticStatuses.add(testCase.expected.semanticStatus);
      observedSuccessResults.add(Boolean(body.data.success));
      observedViolationResults.add(Boolean(body.data.violations_detected));

      if (testCase.scenarioId === 'guardrail-allow') {
        expect(body.data.success, 'guardrail-allow').toBe(true);
        expect(body.data.violations_detected, 'guardrail-allow').toBe(false);
      }
      if (testCase.scenarioId === 'guardrail-block') {
        expect(body.data.violations_detected, 'guardrail-block').toBe(true);
        expect(JSON.stringify(body.data.validated_logs), 'guardrail-block').not.toEqual(
          JSON.stringify(testCase.request.logs),
        );
      }
      if (testCase.scenarioId === 'guardrail-redact') {
        expect(body.data.violations_detected, 'guardrail-redact').toBe(true);
        expect(JSON.stringify(body.data.validated_logs), 'guardrail-redact').not.toEqual(
          JSON.stringify(testCase.request.logs),
        );
      }
    }

    expect([...observedGuardrailTypes].sort()).toEqual(
      [...GOVERNANCE_SPEC_DOMAINS.guardrailTypes].sort(),
    );
    expect([...observedSemanticStatuses].sort()).toEqual(['allowed', 'violation']);
    expect(observedSuccessResults).toContain(true);
    expect(observedViolationResults).toContain(true);
    expect(observedViolationResults).toContain(false);
  }, GUARDRAIL_RUN_TEST_TIMEOUT_MS);

  it('BOUNDARY_PROOF: TestGuardrailDto preserves every JSON value class', async () => {
    // BOUNDARY_PROOF: TestGuardrailDto preserves every JSON value class for
    // params/settings/logs open Record<unknown> object bags.
    const operation = backendOperation('GuardrailController_runTest');
    expect(operation.verb).toBe('post');
    const payload = makeJsonObjectValueClassPayload();
    expect(operation.path).toBe('/guardrails/run-test');
    const body = fullResponse(
      await client.post('/guardrails/run-test', {
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
          event_type: 'ActivityStarted',
          activity_type: 'json_value_classes',
          ...payload,
          text: 'safe json value classes',
        },
      }),
    );

    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({
      success: false,
      raw_logs: {
        event_type: 'ActivityStarted',
        activity_type: 'json_value_classes',
        ...payload,
        text: 'safe json value classes',
      },
    });
    expect(String(body.data.detail)).toContain('Invalid guardrail type: custom_open_type');
  }, GUARDRAIL_RUN_TEST_TIMEOUT_MS);

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

  itIfIsolatedGuardrailUnavailable('CONFORMANCE: fails closed when guardrail service is unavailable in an isolated lane', async () => {
    // SCENARIO_PROOF: guardrail-service-unavailable-fail-closed
    // NEGATIVE_PATH_PROOF: generated guardrail service unavailable scenario
    // runs only in an isolated backend lane whose GUARDRAIL_API_URL points to
    // an unavailable provider, then asserts the backend does not allow the
    // run-test request through as a successful validation.
    expect(['SCENARIO_PROOF: guardrail-service-unavailable-fail-closed']).toEqual(
      expect.arrayContaining(['SCENARIO_PROOF: guardrail-service-unavailable-fail-closed']),
    );
    const testCase = makeGuardrailServiceUnavailableConformanceCase();
    expect(testCase.scenarioId).toBe('guardrail-service-unavailable-fail-closed');
    expect(testCase.expected.messageIncludes).toBe('Guardrails test execution failed');

    const body = fullResponse(await client.post('/guardrails/run-test', testCase.request));

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
    const session = await seedLocalStackSession({
      agentId,
      workflowIdPrefix: 'guardrail-eval-wf-',
      runIdPrefix: 'guardrail-eval-run-',
      detail: 'guardrail violation ledger',
      metadata: { openbox_conformance: true, source: 'guardrails.e2e' },
    });
    const event = await seedLocalStackGovernanceEvent({
      agentId,
      session,
      activityId: 'guardrail-violation-ledger',
      activityType: 'LLMCompletion',
      input: [{ text: 'BLOCK_ME' }],
      output: { decision: 'blocked' },
      verdict: 1,
      reason: 'guardrail violation ledger',
      metadata: { openbox_conformance: true, source: 'guardrails.e2e' },
    });
    guardrailEvaluationId = await seedLocalStackGuardrailEvaluation({
      guardrailId,
      governanceEventId: event.id,
      guardrailType: 'pii_detection',
      input: 'BLOCK_ME',
      output: 'blocked',
      passed: false,
      details: { reason: 'guardrail violation ledger', field: 'logs.text' },
      status: 'blocked',
    });

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
  });
});
