import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { CORE_ENDPOINT_MANIFEST } from '../../ts/src/core-client/generated/endpoint-manifest.js';
import {
  type AgentIdentityForSigning,
  getBackendClient,
  getCoreClient,
  fullResponse,
  getOrgId,
  getTeamIds,
} from '../helpers/api-client';
import {
  GOVERNANCE_BOUNDARY_DOMAINS,
  makeJsonArrayValueClassPayload,
  makeJsonObjectValueClassPayload,
} from '../helpers/boundary-conformance';
import { trackResource, cleanupAll } from '../helpers/cleanup';
import {
  expireGovernanceApproval,
  listUsageMetricRowsForKeys,
  readGovernanceEventInputAndSpansText,
  readGovernanceEventStorageText,
} from '../helpers/local-stack-db';
import {
  makeApprovalExpirationConformanceCase,
  makeCreateAgentDto,
  makeCreateGuardrailDto,
  makeGoalSignalOrderConformanceCase,
  makeGovernanceEvent,
  makeOpaAliasDecisionConformanceCase,
  makeOpaUnsupportedConstrainConformanceCase,
  makeOpaUnavailableFailClosedConformanceCase,
  makeOpaVerdictMatrixConformanceCase,
  makeRequireApprovalPolicyConformanceCase,
} from '../helpers/fixtures';
import {
  GOVERNANCE_SPEC_DOMAINS,
  invalidGovernanceSpecMember,
} from '../helpers/governance-spec-domains';

const OPA_URL = (process.env.OPENBOX_E2E_OPA_URL ?? 'http://127.0.0.1:8181').replace(/\/+$/, '');
const OPA_POLICY_LOAD_TIMEOUT_MS = Number(process.env.OPENBOX_E2E_OPA_BUNDLE_WAIT_MS ?? 30_000);
const RUN_ISOLATED_AGE_UNAVAILABLE =
  process.env.OPENBOX_E2E_ISOLATED_AGE_UNAVAILABLE === '1';
const itIfIsolatedAgeUnavailable = RUN_ISOLATED_AGE_UNAVAILABLE ? it : it.skip;
const RUN_ISOLATED_OPA_UNAVAILABLE =
  process.env.OPENBOX_E2E_ISOLATED_OPA_UNAVAILABLE === '1';
const itIfIsolatedOpaUnavailable = RUN_ISOLATED_OPA_UNAVAILABLE ? it : it.skip;
const CORE_TELEMETRY_TOP_LEVEL_NUMERIC_FIELDS = [
  'cost_usd',
  'input_tokens',
  'output_tokens',
  'total_tokens',
  'span_count',
] as const;
const CORE_TELEMETRY_SPAN_NUMERIC_FIELDS = [
  'start_time',
  'end_time',
  'duration_ns',
  'http_status_code',
  'server_port',
  'rowcount',
  'bytes_read',
  'bytes_written',
  'lines_count',
] as const;

interface UsageWireCase {
  caseId: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  prompt: string;
  completion: string;
  expectedMetricRows: Array<{
    metricType: string;
    metricKey: string;
    metricValue: number;
  }>;
}

function makeUsageWireCases(): UsageWireCase[] {
  return GOVERNANCE_SPEC_DOMAINS.localStackUsageWireCaseIds.map((caseId) => {
    switch (caseId) {
      case 'nonzero-tokens-nonzero-cost':
        return {
          caseId,
          input_tokens: 17,
          output_tokens: 19,
          total_tokens: 36,
          cost_usd: 0.03125,
          prompt: 'usage boundary nonzero prompt',
          completion: 'usage boundary nonzero completion',
          expectedMetricRows: [
            { metricType: 'token', metricKey: 'input_tokens', metricValue: 17 },
            { metricType: 'token', metricKey: 'output_tokens', metricValue: 19 },
          ],
        };
      case 'zero-tokens-zero-cost':
        return {
          caseId,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          cost_usd: 0,
          prompt: 'usage boundary zero prompt',
          completion: 'usage boundary zero completion',
          expectedMetricRows: [],
        };
      default:
        throw new Error(
          `Unhandled LocalStackUsageWireCaseId: ${caseId}; sentinel=${invalidGovernanceSpecMember(
            'localStackUsageWireCaseIds',
          )}`,
        );
    }
  });
}

function backendOperation(operationId: string) {
  const operation = BACKEND_ENDPOINT_MANIFEST.find((entry) => entry.operationId === operationId);
  expect(operation, operationId).toBeDefined();
  return operation!;
}

function coreOperation(operationId: string) {
  const operation = CORE_ENDPOINT_MANIFEST.find((entry) => entry.operationId === operationId);
  expect(operation, operationId).toBeDefined();
  return operation!;
}

function operationPath(path: string, params: Record<string, string>) {
  return path.replace(/\{([^}]+)\}/g, (_, key: string) => params[key] ?? `{${key}}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let governanceEventSequence = 0;

function uniqueGovernanceSuffix(label: string) {
  governanceEventSequence += 1;
  return `${label}-${Date.now()}-${governanceEventSequence}`;
}

function scopedGovernanceEvent<T extends {
  workflow_id?: string;
  run_id?: string;
  activity_id?: string;
}>(event: T, label: string): T {
  const suffix = uniqueGovernanceSuffix(label);
  return {
    ...event,
    workflow_id: `${event.workflow_id ?? 'workflow'}-${suffix}`,
    run_id: `${event.run_id ?? 'run'}-${suffix}`,
    activity_id: event.activity_id ? `${event.activity_id}-${suffix}` : event.activity_id,
  };
}

function scopedPollRequest<T extends {
  workflow_id?: string;
  run_id?: string;
  activity_id?: string;
}>(
  request: T,
  event: { workflow_id?: string; run_id?: string; activity_id?: string },
): T {
  return {
    ...request,
    workflow_id: event.workflow_id,
    run_id: event.run_id,
    activity_id: event.activity_id,
  };
}

async function waitForUsageMetricRows(
  agentId: string,
  expectedRows: UsageWireCase['expectedMetricRows'],
) {
  const deadline = Date.now() + 5_000;
  let rows: Awaited<ReturnType<typeof listUsageMetricRowsForKeys>> = [];

  while (Date.now() < deadline) {
    rows = await listUsageMetricRowsForKeys(agentId);
    if (expectedRows.length > 0 && JSON.stringify(rows) === JSON.stringify(expectedRows)) {
      return rows;
    }
    if (expectedRows.length === 0 && rows.length > 0) {
      return rows;
    }
    await sleep(250);
  }

  return rows;
}

function expectedInvalidTelemetryCaseCount(): number {
  return (
    CORE_TELEMETRY_TOP_LEVEL_NUMERIC_FIELDS.length +
    CORE_TELEMETRY_SPAN_NUMERIC_FIELDS.length +
    1
  );
}

async function waitForOpaPolicyPath(policyResponseBody: any) {
  const policyPath = policyResponseBody?.data?.config?.path;
  expect(policyPath).toEqual(expect.any(String));

  const deadline = Date.now() + OPA_POLICY_LOAD_TIMEOUT_MS;
  let lastState = 'not queried';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${OPA_URL}/v1/data/${policyPath}`);
      if (!response.ok) {
        lastState = `HTTP ${response.status}`;
      } else {
        const body = await response.json();
        if (Object.prototype.hasOwnProperty.call(body, 'result')) {
          return;
        }
        lastState = 'undefined OPA data result';
      }
    } catch (error) {
      lastState = error instanceof Error ? error.message : String(error);
    }

    await sleep(1000);
  }

  throw new Error(
    `OPA policy path ${policyPath} did not load within ${OPA_POLICY_LOAD_TIMEOUT_MS}ms (${lastState})`,
  );
}

function listItems(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.approvals?.data)) return value.approvals.data;
  return [];
}

function findApproval(items: any[], eventId: string, approvalId?: string) {
  return items.find((item) =>
    item?.id === eventId ||
    item?.event_id === eventId ||
    (approvalId && (item?.id === approvalId || item?.event_id === approvalId)),
  );
}

function expectRange(
  value: unknown,
  min: number,
  max: number,
  label: string,
): void {
  expect(typeof value, label).toBe('number');
  expect(value as number, label).toBeGreaterThanOrEqual(min);
  expect(value as number, label).toBeLessThanOrEqual(max);
}

let finiteProbeCounter = 0;

function makeFiniteProbeSpan(overrides: Record<string, any> = {}) {
  const nowNs = Date.now() * 1_000_000;
  const id = finiteProbeCounter++;
  return {
    span_id: `finite-domain-span-${id}`,
    trace_id: `finite-domain-trace-${id}`,
    name: `finite.domain.${id}`,
    kind: 'INTERNAL',
    start_time: nowNs,
    end_time: nowNs + 1_000_000,
    duration_ns: 1_000_000,
    semantic_type: 'function_call',
    attributes: {
      'openbox.conformance': true,
      'openbox.finite_domain': true,
    },
    status: {
      code: 'OK',
    },
    stage: 'completed',
    ...overrides,
  };
}

describe('Core Governance API', () => {
  const backendClient = getBackendClient();
  let agentId: string;
  let apiKey: string;
  let agentIdentity: AgentIdentityForSigning;
  let sourceAgentDid: string;
  let teamIds: string[];
  let orgId: string;

  beforeAll(async () => {
    teamIds = await getTeamIds();
    orgId = getOrgId();

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
    expect(agentIdentity.did).toMatch(/^did:aip:/);
    trackResource({ type: 'agent', id: agentId });

    const sourceResponse = await backendClient.post('/agent/create', makeCreateAgentDto(teamIds, {
      agent_name: `handoff-source-${Date.now()}`,
    }));
    const sourceBody = fullResponse(sourceResponse);
    expect(sourceBody.status).toBe(200);
    sourceAgentDid = sourceBody.data.identity.did;
    expect(sourceAgentDid).toMatch(/^did:aip:/);
    trackResource({ type: 'agent', id: sourceBody.data.agent.id });
  });

  it('GET /api/v1/auth/validate returns valid: true with matching agent_id', async () => {
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const response = await coreClient.get('/api/v1/auth/validate');

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('valid', true);
    expect(response.data).toHaveProperty('agent_id', agentId);
  });

  it('EXHAUSTIVE_SPEC_PROOF: core auth validation environment members follow token prefix boundaries', async () => {
    // EXHAUSTIVE_SPEC_PROOF: AgentValidationResponse.environment is finite.
    // Runtime keys produced by the local backend must return one accepted
    // member, and unsupported prefixes must fail closed before an invalid
    // environment value can be emitted.
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const response = await coreClient.get('/api/v1/auth/validate');

    expect(response.status).toBe(200);
    expect(GOVERNANCE_SPEC_DOMAINS.coreAuthEnvironments).toEqual([
      'live',
      'test',
      'unknown',
    ]);

    const expectedEnvironment = apiKey.startsWith('obx_live_') ? 'live' : 'test';
    expect(response.data.environment).toBe(expectedEnvironment);
    expect(GOVERNANCE_SPEC_DOMAINS.coreAuthEnvironments).toContain(response.data.environment);

    const unknownPrefix = `obx_unknown_${apiKey.replace(/^obx_(?:live|test)_/, '')}`;
    const invalidClient = getCoreClient(unknownPrefix, agentIdentity);
    const invalidResponse = await invalidClient.get('/api/v1/auth/validate');

    expect(invalidResponse.status).toBeGreaterThanOrEqual(400);
    expect(invalidResponse.status).toBeLessThan(500);
  });

  it('POST /api/v1/governance/evaluate returns response with verdict', async () => {
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const event = makeGovernanceEvent();
    const response = await coreClient.post('/api/v1/governance/evaluate', event);

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('verdict');
    expect(GOVERNANCE_BOUNDARY_DOMAINS.coreNumericFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelName: 'GovernanceVerdictResponse',
          fieldName: 'risk_score',
          min: 0,
          max: 1,
        }),
      ]),
    );
    expectRange(response.data.risk_score, 0, 1, 'risk_score');
    if (response.data.trust_tier !== undefined && response.data.trust_tier !== null) {
      expectRange(response.data.trust_tier, 0, 4, 'trust_tier');
    }
    if (response.data.alignment_score !== undefined && response.data.alignment_score !== null) {
      expectRange(response.data.alignment_score, 0, 1, 'alignment_score');
    }
  });

  it('NEGATIVE_BOUNDARY_PROOF: core governance attempt rejects below-min, fractional, and nonnumeric values', async () => {
    // NEGATIVE_BOUNDARY_PROOF: GovernanceEventPayload.attempt is generated
    // from OpenAPI as int32 with @minValue(1). Drive every invalid class through
    // the signed local Core path.
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const evaluateOperation = coreOperation('evaluateGovernance');

    for (const testCase of [
      { id: 'below-min', activityType: 'InvalidAttemptBelowMinProbe', attempt: 0 },
      { id: 'fractional', activityType: 'FractionalAttemptProbe', attempt: 0.5 },
      { id: 'nonnumeric', activityType: 'NonnumericAttemptProbe', attempt: 'not-an-integer' },
    ] as const) {
      const response = await coreClient.post(evaluateOperation.path, makeGovernanceEvent({
        event_type: 'ActivityStarted',
        activity_id: `invalid-attempt-${testCase.id}-${Date.now()}`,
        activity_type: testCase.activityType,
        attempt: testCase.attempt,
      }));

      expect([400, 422], `${testCase.id}: ${JSON.stringify(response.data)}`).toContain(response.status);
    }
  });

  it('NEGATIVE_BOUNDARY_PROOF: core governance timestamp rejects invalid date-time and non-string values', async () => {
    // NEGATIVE_BOUNDARY_PROOF: GovernanceEventPayload.timestamp is OpenAPI
    // type=string format=date-time. Invalid strings and non-string values are
    // rejected before the event is evaluated.
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const evaluateOperation = coreOperation('evaluateGovernance');

    for (const testCase of [
      {
        id: 'format',
        timestamp: 'not-a-date-time',
        activityType: 'InvalidTimestampFormatProbe',
      },
      {
        id: 'type',
        timestamp: 12345,
        activityType: 'InvalidTimestampTypeProbe',
      },
    ] as const) {
      const response = await coreClient.post(evaluateOperation.path, makeGovernanceEvent({
        timestamp: testCase.timestamp,
        activity_id: `invalid-timestamp-${testCase.id}-${Date.now()}`,
        activity_type: testCase.activityType,
      }));

      expect([400, 422], `${testCase.id}: ${JSON.stringify(response.data)}`).toContain(response.status);
    }
  });

  it('NEGATIVE_BOUNDARY_PROOF: core governance numeric telemetry fields reject invalid request types', async () => {
    // NEGATIVE_BOUNDARY_PROOF: Core governance numeric telemetry fields are
    // emitted from OpenAPI as executable request preflight constraints. Drive
    // every top-level usage/cost/span-count field plus every nested span
    // numeric field through the signed local Core path so this is not
    // SDK-only proof.
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const evaluateOperation = coreOperation('evaluateGovernance');
    const nowNs = Date.now() * 1_000_000;
    expect(CORE_TELEMETRY_TOP_LEVEL_NUMERIC_FIELDS).toContain('cost_usd');
    const validSpan = () => makeFiniteProbeSpan({
      start_time: nowNs,
      end_time: nowNs + 1_000_000,
      duration_ns: 1_000_000,
      events: [{
        name: 'telemetry-boundary-event',
        timestamp: nowNs,
      }],
      http_status_code: 200,
      server_port: 443,
      rowcount: 1,
      bytes_read: 2,
      bytes_written: 3,
      lines_count: 4,
    });
    const cases: Array<{ id: string; event: Record<string, any> }> = [
      ...CORE_TELEMETRY_TOP_LEVEL_NUMERIC_FIELDS.map((field) => ({
        id: field,
        event: makeGovernanceEvent({
          [field]: 'not-a-number',
        }),
      })),
      ...CORE_TELEMETRY_SPAN_NUMERIC_FIELDS.map((field) => ({
        id: `span.${field}`,
        event: makeGovernanceEvent({
          span_count: 1,
          spans: [{
            ...validSpan(),
            [field]: 'not-a-number',
          }],
        }),
      })),
      {
        id: 'span.events.timestamp',
        event: makeGovernanceEvent({
          span_count: 1,
          spans: [{
            ...validSpan(),
            events: [{
              name: 'invalid-event-timestamp',
              timestamp: 'not-a-number',
            }],
          }],
        }),
      },
    ];

    expect(cases).toHaveLength(expectedInvalidTelemetryCaseCount());
    for (const testCase of cases) {
      const response = await coreClient.post(evaluateOperation.path, {
        ...testCase.event,
        activity_id: `invalid-telemetry-${testCase.id}-${Date.now()}`,
        activity_type: 'InvalidTelemetryProbe',
      });

      expect([400, 422], `${testCase.id}: ${JSON.stringify(response.data)}`).toContain(response.status);
    }
  });

  it('BOUNDARY_PROOF: core governance open JSON payload fields accept wrapped and bare JSON value classes', async () => {
    // BOUNDARY_PROOF: core governance open JSON payload fields accept wrapped
    // and bare JSON value classes for activity_input, activity_output,
    // signal_args, span attributes, span data, args, result, and event
    // attributes.
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const evaluateOperation = coreOperation('evaluateGovernance');
    const objectPayload = makeJsonObjectValueClassPayload();
    const arrayPayload = makeJsonArrayValueClassPayload();
    const nowNs = Date.now() * 1_000_000;
    const event = makeGovernanceEvent({
      event_type: 'ActivityCompleted',
      activity_id: 'json-value-class-activity',
      activity_type: 'JsonValueClassProbe',
      activity_input: arrayPayload,
      activity_output: objectPayload,
      signal_args: objectPayload,
      span_count: 1,
      spans: [
        {
          span_id: 'json-value-class-span',
          trace_id: 'json-value-class-trace',
          name: 'json.value.class',
          kind: 'INTERNAL',
          start_time: nowNs,
          end_time: nowNs + 1_000_000,
          duration_ns: 1_000_000,
          attributes: objectPayload,
          events: [
            {
              name: 'json-value-class-event',
              timestamp: nowNs,
              attributes: objectPayload,
            },
          ],
          semantic_type: 'function_call',
          stage: 'completed',
          data: objectPayload,
          args: arrayPayload,
          result: objectPayload,
        },
      ],
    });

    const response = await coreClient.post(evaluateOperation.path, event);

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('verdict');

    const bareObjectInputResponse = await coreClient.post(evaluateOperation.path, {
      ...event,
      activity_id: 'json-value-class-bare-object-input',
      activity_input: objectPayload,
    });

    expect(bareObjectInputResponse.status).toBe(200);
    expect(bareObjectInputResponse.data).toHaveProperty('verdict');
  });

  it('CONFORMANCE: Core usage/cost wire boundary accepts provider telemetry and materializes supported token metrics', async () => {
    // CONFORMANCE_PROOF: Core usage/cost wire boundary sends every
    // LocalStackUsageWireCaseId through evaluateGovernance. The local stack
    // must accept top-level usage/cost fields, persist the governance row,
    // materialize only supported nonzero token metrics, and avoid fabricating
    // total-token or cost metric rows.
    expect(['SCENARIO_PROOF: usage-core-wire-boundary']).toEqual(
      expect.arrayContaining(['SCENARIO_PROOF: usage-core-wire-boundary']),
    );
    const evaluateOperation = coreOperation('evaluateGovernance');

    const usageWireCases = makeUsageWireCases();
    expect(usageWireCases.map((entry) => entry.caseId)).toEqual(
      GOVERNANCE_SPEC_DOMAINS.localStackUsageWireCaseIds,
    );
    expect(usageWireCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cost_usd: 0.03125 }),
        expect.objectContaining({ input_tokens: 0 }),
        expect.objectContaining({
          expectedMetricRows: expect.arrayContaining([
            expect.objectContaining({ metricKey: 'input_tokens' }),
            expect.objectContaining({ metricKey: 'output_tokens' }),
          ]),
        }),
      ]),
    );

    for (const usageWireCase of usageWireCases) {
      const usageAgentResponse = await backendClient.post('/agent/create', makeCreateAgentDto(teamIds, {
        agent_name: `usage-cost-wire-${usageWireCase.caseId}-${Date.now()}`,
      }));
      const usageAgentBody = fullResponse(usageAgentResponse);
      expect(usageAgentBody.status, usageWireCase.caseId).toBe(200);
      const usageAgentId = usageAgentBody.data.agent.id;
      trackResource({ type: 'agent', id: usageAgentId });

      const coreClient = getCoreClient(usageAgentBody.data.token, {
        did: usageAgentBody.data.identity.did,
        privateKey: usageAgentBody.data.identity.privateKey,
      });

      const event = makeGovernanceEvent({
        event_type: 'ActivityCompleted',
        activity_id: `usage-cost-wire-${usageWireCase.caseId}-${Date.now()}`,
        activity_type: 'LLMCompleted',
        llm_model: 'openbox-sdk-usage-boundary',
        input_tokens: usageWireCase.input_tokens,
        output_tokens: usageWireCase.output_tokens,
        total_tokens: usageWireCase.total_tokens,
        cost_usd: usageWireCase.cost_usd,
        prompt: usageWireCase.prompt,
        completion: usageWireCase.completion,
        finish_reason: 'stop',
        activity_input: [{ prompt: usageWireCase.prompt }],
        activity_output: { completion: usageWireCase.completion },
      });

      const response = await coreClient.post(evaluateOperation.path, event);

      expect(response.status, usageWireCase.caseId).toBe(200);
      expect(response.data, usageWireCase.caseId).toHaveProperty('verdict', 'allow');
      expect(response.data, usageWireCase.caseId).toHaveProperty('governance_event_id');

      const stored = await readGovernanceEventStorageText(response.data.governance_event_id);
      const storedText = stored.trim();

      expect(storedText, usageWireCase.caseId).toContain(usageWireCase.prompt);
      expect(storedText, usageWireCase.caseId).toContain(usageWireCase.completion);
      expect(storedText, usageWireCase.caseId).not.toContain('input_tokens');
      expect(storedText, usageWireCase.caseId).not.toContain('output_tokens');
      expect(storedText, usageWireCase.caseId).not.toContain('total_tokens');
      expect(storedText, usageWireCase.caseId).not.toContain('cost_usd');

      const usageMetricRows = await waitForUsageMetricRows(
        usageAgentId,
        usageWireCase.expectedMetricRows,
      );
      expect(usageMetricRows, usageWireCase.caseId).toEqual(usageWireCase.expectedMetricRows);
      const metricKeys = usageMetricRows.map((row) => row.metricKey);
      expect(metricKeys, usageWireCase.caseId).not.toContain('cost_usd');
      expect(metricKeys, usageWireCase.caseId).not.toContain('total_tokens');
    }
  });

  it('EXHAUSTIVE_SPEC_PROOF: core governance finite payload members are accepted', async () => {
    // EXHAUSTIVE_SPEC_PROOF: core governance finite payload members are read
    // from TypeSpec and every EventType member is sent through Core evaluate.
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const evaluateOperation = coreOperation('evaluateGovernance');

    for (const event_type of GOVERNANCE_SPEC_DOMAINS.coreEventTypes) {
      const workflow_id = `finite-event-type-workflow-${event_type}-${Date.now()}`;
      const run_id = `finite-event-type-run-${event_type}-${Date.now()}`;
      const isActivityEvent = event_type === 'ActivityStarted' || event_type === 'ActivityCompleted';
      if (event_type === 'WorkflowCompleted' || event_type === 'WorkflowFailed') {
        const startResponse = await coreClient.post(evaluateOperation.path, makeGovernanceEvent({
          event_type: 'WorkflowStarted',
          workflow_id,
          run_id,
          activity_id: `finite-event-type-start-${event_type}`,
          activity_type: 'FiniteEventTypeStartProbe',
        }));
        expect(startResponse.status, `start:${event_type}`).toBe(200);
      }
      if (event_type === 'Handoff') {
        const startResponse = await coreClient.post(evaluateOperation.path, makeGovernanceEvent({
          event_type: 'WorkflowStarted',
          workflow_id,
          run_id,
          activity_id: `finite-event-type-start-${event_type}`,
          activity_type: 'FiniteEventTypeStartProbe',
        }));
        expect(startResponse.status, `handoff-start:${event_type}`).toBe(200);
      }
      if (event_type === 'ActivityCompleted') {
        const startResponse = await coreClient.post(evaluateOperation.path, makeGovernanceEvent({
          event_type: 'ActivityStarted',
          workflow_id,
          run_id,
          activity_id: `finite-event-type-activity-${event_type}`,
          activity_type: 'FiniteActivityPairProbe',
          span_count: 1,
          spans: [makeFiniteProbeSpan({
            name: `finite.event_type.start.${event_type}`,
          })],
        }));
        expect(startResponse.status, `activity-start:${event_type}`).toBe(200);
      }

      const response = await coreClient.post(evaluateOperation.path, makeGovernanceEvent({
        workflow_id,
        run_id,
        event_type,
        activity_id: event_type === 'ActivityCompleted'
          ? `finite-event-type-activity-${event_type}`
          : `finite-event-type-${event_type}`,
        activity_type: isActivityEvent ? 'FiniteEventTypeProbe' : undefined,
        signal_name: event_type === 'SignalReceived' ? 'finite-signal' : undefined,
        signal_args: event_type === 'SignalReceived' ? { event_type } : undefined,
        multi_agent_session_id: event_type === 'Handoff' ? `finite-multi-agent-${Date.now()}` : undefined,
        status: event_type === 'WorkflowCompleted'
          ? 'completed'
          : event_type === 'WorkflowFailed'
            ? 'failed'
            : undefined,
        from_agent_did: event_type === 'Handoff'
          ? sourceAgentDid
          : undefined,
        span_count: isActivityEvent ? 1 : undefined,
        spans: isActivityEvent ? [makeFiniteProbeSpan({
          name: `finite.event_type.${event_type}`,
        })] : undefined,
      }));

      expect(response.status, `${event_type}:${JSON.stringify(response.data)}`).toBe(200);
      expect(response.data, event_type).toHaveProperty('verdict');
    }
  });

  it('NEGATIVE_BOUNDARY_PROOF: core governance finite event_type rejects out-of-domain values', async () => {
    // NEGATIVE_BOUNDARY_PROOF: Core rejects event_type values outside the
    // TypeSpec finite EventType domain before treating the event as governed.
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const evaluateOperation = coreOperation('evaluateGovernance');
    const invalidEventType = invalidGovernanceSpecMember('coreEventTypes');
    const invalidCases = [
      {
        label: 'event_type',
        event: makeGovernanceEvent({
          event_type: invalidEventType,
        }),
      },
    ];

    for (const testCase of invalidCases) {
      const response = await coreClient.post(evaluateOperation.path, testCase.event);

      expect(response.status, `${testCase.label}:${JSON.stringify(response.data)}`).toBeGreaterThanOrEqual(400);
      expect(response.status, testCase.label).toBeLessThan(500);
    }
  });

  it('BOUNDARY_PROOF: core governance open string metadata fields accept noncanonical values', async () => {
    // BOUNDARY_PROOF: Core accepts free-form status, span stage, hook_type,
    // and span status code strings. These are open metadata fields in the
    // SDK spec rather than finite validation domains.
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const evaluateOperation = coreOperation('evaluateGovernance');
    const response = await coreClient.post(evaluateOperation.path, makeGovernanceEvent({
      event_type: 'ActivityStarted',
      status: '__noncanonical_status__',
      activity_id: 'open-string-metadata-fields',
      activity_type: 'OpenStringMetadataProbe',
      span_count: 1,
      spans: [makeFiniteProbeSpan({
        stage: '__noncanonical_stage__',
        hook_type: '__noncanonical_hook_type__',
        status: { code: '__noncanonical_status_code__' },
      })],
    }));

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('verdict');
  });

  it('CONFORMANCE: Core retains provider source attribution in persisted telemetry', async () => {
    // SCENARIO_PROOF: trace-source-attribution
    // CONFORMANCE_PROOF: sourceAttribution is retained through Core into
    // governance_events input. Provider adapters stamp _openbox_source on
    // activity input as the local-stack source field when span attributes are not
    // retained on the governance event row.
    expect(['SCENARIO_PROOF: trace-source-attribution']).toEqual(
      expect.arrayContaining(['SCENARIO_PROOF: trace-source-attribution']),
    );
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const evaluateOperation = coreOperation('evaluateGovernance');
    const sourceAttribution = 'openbox-sdk-e2e';
    const activityId = `source-attribution-${Date.now()}`;
    const event = makeGovernanceEvent({
      event_type: 'ActivityCompleted',
      activity_id: activityId,
      activity_type: 'SourceAttributionProbe',
      source: sourceAttribution,
      activity_input: [
        {
          tool: 'source-attribution',
          _openbox_source: sourceAttribution,
        },
      ],
    });

    const response = await coreClient.post(evaluateOperation.path, event);

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('governance_event_id');

    const stored = await readGovernanceEventInputAndSpansText(
      response.data.governance_event_id,
    );

    expect(stored).toContain('_openbox_source');
    expect(stored).toContain('source-attribution');
    expect(stored).toContain(sourceAttribution);
  });

  it('CONFORMANCE: Core guardrail redaction returns a constrained verdict with guardrails_result', async () => {
    // SCENARIO_PROOF: guardrail-redact
    // EXHAUSTIVE_SPEC_PROOF: core guardrails_result input_type members are
    // TypeSpec finite. This Core path proves every runtime-supported member
    // and the constrained/redacted verdict shape through active guardrails.
    // EXHAUSTIVE_SPEC_PROOF: core verdict members include constrain through
    // this redacted guardrail path; OPA matrix covers allow, require_approval,
    // block, and halt.
    expect('SCENARIO_PROOF: guardrail-redact').toContain('guardrail-redact');
    const createdGuardrailIds: string[] = [];
    try {
      const coreClient = getCoreClient(apiKey, agentIdentity);
      const evaluateOperation = coreOperation('evaluateGovernance');
      const observedInputTypes = new Set<string>();
      const cases = [
        {
          inputType: 'activity_input',
          processingStage: '0',
          fieldsToCheck: ['input.0.text'],
          event: makeGovernanceEvent({
            event_type: 'ActivityStarted',
            activity_id: 'core-guardrail-redaction-input',
            activity_type: 'PromptSubmission',
            activity_input: [{
              text: 'contact input@example.com before continuing',
            }],
            span_count: 1,
            spans: [makeFiniteProbeSpan({
              name: 'core.guardrail.redaction.input',
              semantic_type: 'llm_gen_ai',
            })],
          }),
        },
        {
          inputType: 'activity_output',
          processingStage: '1',
          fieldsToCheck: ['output.text'],
          event: makeGovernanceEvent({
            event_type: 'ActivityCompleted',
            activity_id: 'core-guardrail-redaction-output',
            activity_type: 'LLMCompleted',
            activity_output: {
              text: 'send output@example.com to the user',
            },
            span_count: 1,
            spans: [makeFiniteProbeSpan({
              name: 'core.guardrail.redaction.output',
              semantic_type: 'llm_completion',
            })],
          }),
        },
      ] as const;

      for (const testCase of cases) {
        const createGuardrailResponse = await backendClient.post(
          `/agent/${agentId}/guardrails`,
          makeCreateGuardrailDto({
            name: `core-redaction-guardrail-${testCase.inputType}-${Date.now()}`,
            guardrail_type: '1',
            processing_stage: testCase.processingStage,
            trust_impact: 'none',
            params: {},
            settings: {
              activities: [
                {
                  activity_type: testCase.event.activity_type,
                  fields_to_check: testCase.fieldsToCheck,
                },
              ],
            },
          }),
        );
        const createGuardrailBody = fullResponse(createGuardrailResponse);
        expect(createGuardrailBody.status, testCase.inputType).toBe(200);
        createdGuardrailIds.push(createGuardrailBody.data.id);

        const response = await coreClient.post(evaluateOperation.path, testCase.event);

        expect(response.status, `${testCase.inputType}:${JSON.stringify(response.data)}`).toBe(200);
        expect(response.data, JSON.stringify(response.data)).toHaveProperty('verdict', 'constrain');
        expect(response.data).toHaveProperty('action', 'constrain');
        expect(response.data.guardrails_result).toMatchObject({
          input_type: testCase.inputType,
          validation_passed: true,
        });
        expect(JSON.stringify(response.data.guardrails_result)).toContain('<EMAIL_ADDRESS>');
        observedInputTypes.add(response.data.guardrails_result.input_type);
      }

      expect([...observedInputTypes].sort()).toEqual(
        [...GOVERNANCE_SPEC_DOMAINS.coreGuardrailsInputTypes].sort(),
      );
      expect(GOVERNANCE_SPEC_DOMAINS.coreVerdicts).toContain('constrain');
    } finally {
      for (const id of createdGuardrailIds.reverse()) {
        await backendClient.delete(`/agent/${agentId}/guardrails/${id}`);
      }
    }
  });

  it('NEGATIVE_PATH_PROOF: Core approval polling returns not-found for unknown workflow activity', async () => {
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const operation = coreOperation('pollApproval');
    expect(operation.verb).toBe('post');
    const payload = {
      workflow_id: 'unknown-workflow',
      run_id: 'unknown-run',
      activity_id: 'unknown-activity',
    };

    const response = await coreClient.post(operationPath(operation.path, {}), payload);

    expect(response.status).toBe(404);
    expect(response.data).toEqual({
      code: 404,
      message: 'governance event not found',
    });
  });

  it('CONFORMANCE: creates a require_approval policy and polls its pending approval', async () => {
    // SCENARIO_PROOF: behavior-tool-call
    // SCENARIO_PROOF: behavior-llm
    // CONFORMANCE_PROOF: generated operation IDs, generated DTO types, and
    // generated core event types drive this backend->core approval flow.
    expect([
      'SCENARIO_PROOF: opa-require-approval',
      'SCENARIO_PROOF: approval-pending',
      'SCENARIO_PROOF: approval-approved',
      'SCENARIO_PROOF: approval-rejected',
      'SCENARIO_PROOF: behavior-tool-call',
      'SCENARIO_PROOF: behavior-llm',
    ]).toEqual(expect.arrayContaining([
      'SCENARIO_PROOF: opa-require-approval',
      'SCENARIO_PROOF: approval-pending',
      'SCENARIO_PROOF: approval-approved',
      'SCENARIO_PROOF: approval-rejected',
      'SCENARIO_PROOF: behavior-tool-call',
      'SCENARIO_PROOF: behavior-llm',
    ]));
    const conformanceCase = makeRequireApprovalPolicyConformanceCase();
    const createPolicyOperation = backendOperation(conformanceCase.createPolicyOperationId);
    const pendingApprovalsOperation = backendOperation(conformanceCase.pendingApprovalsOperationId);
    const organizationApprovalsOperation = backendOperation(conformanceCase.organizationApprovalsOperationId);
    const decideApprovalOperation = backendOperation(conformanceCase.decideApprovalOperationId);
    const approvalHistoryOperation = backendOperation(conformanceCase.approvalHistoryOperationId);
    const evaluateOperation = coreOperation(conformanceCase.evaluateOperationId);
    const pollOperation = coreOperation(conformanceCase.pollOperationId);

    expect(createPolicyOperation.verb).toBe('post');
    expect(pendingApprovalsOperation.verb).toBe('get');
    expect(organizationApprovalsOperation.verb).toBe('get');
    expect(decideApprovalOperation.verb).toBe('put');
    expect(approvalHistoryOperation.verb).toBe('get');
    expect(evaluateOperation.verb).toBe('post');
    expect(pollOperation.verb).toBe('post');
    expect(conformanceCase.event.activity_type).toBe('tool_call');
    const activityInput = Array.isArray(conformanceCase.event.activity_input)
      ? conformanceCase.event.activity_input
      : [];
    expect(activityInput[0]).toMatchObject({
      tool: 'sdk-conformance-approval-tool',
    });
    expect(conformanceCase.event.spans?.[0]?.semantic_type).toBe('llm_gen_ai');

    const createPolicyResponse = await backendClient.post(
      operationPath(createPolicyOperation.path, { agentId }),
      conformanceCase.policyBody,
    );
    const createPolicyBody = fullResponse(createPolicyResponse);

    expect(createPolicyBody.status).toBe(200);
    expect(createPolicyBody.data.id).toBeDefined();
    expect(createPolicyBody.data.name).toBe(conformanceCase.policyBody.name);
    expect(createPolicyBody.data.rego_code).toContain('REQUIRE_APPROVAL');

    trackResource({ type: 'policy', id: createPolicyBody.data.id, agentId });
    await waitForOpaPolicyPath(createPolicyBody);

    const coreClient = getCoreClient(apiKey, agentIdentity);
    const approvalEvent = scopedGovernanceEvent(conformanceCase.event, 'approval-pending');
    const approvalPollRequest = scopedPollRequest(conformanceCase.pollRequest, approvalEvent);
    const evaluateResponse = await coreClient.post(
      evaluateOperation.path,
      approvalEvent,
    );

    expect(evaluateResponse.status).toBe(200);
    expect(evaluateResponse.data).toHaveProperty('verdict', conformanceCase.expected.verdict);
    expect(evaluateResponse.data).toHaveProperty('action', conformanceCase.expected.action);
    expect(evaluateResponse.data).toHaveProperty('reason', conformanceCase.expected.reason);
    expect(evaluateResponse.data).toHaveProperty('approval_expiration_time');

    const pollResponse = await coreClient.post(
      pollOperation.path,
      approvalPollRequest,
    );

    expect(pollResponse.status).toBe(200);
    expect(pollResponse.data).toHaveProperty('id');
    expect(pollResponse.data).toHaveProperty('action', conformanceCase.expected.action);
    expect(pollResponse.data).toHaveProperty('reason', conformanceCase.expected.reason);
    expect(pollResponse.data).toHaveProperty('approval_expiration_time');

    const eventId = evaluateResponse.data.governance_event_id;
    const pendingResponse = await backendClient.get(
      operationPath(pendingApprovalsOperation.path, { agentId }),
    );
    const pendingBody = fullResponse(pendingResponse);
    const pendingApproval = findApproval(listItems(pendingBody.data), eventId, pollResponse.data.id);

    expect(pendingBody.status).toBe(200);
    expect(pendingApproval).toBeDefined();
    expect(pendingApproval.verdict).toBe(2);
    expect(pendingApproval.approval_status ?? pendingApproval.status).toBe('pending');
    expect(pendingApproval.reason).toBe(conformanceCase.expected.reason);

    const orgApprovalsResponse = await backendClient.get(
      operationPath(organizationApprovalsOperation.path, { organizationId: orgId }),
    );
    const orgApprovalsBody = fullResponse(orgApprovalsResponse);

    expect(orgApprovalsBody.status).toBe(200);
    expect(findApproval(listItems(orgApprovalsBody.data), eventId, pollResponse.data.id)).toBeDefined();

    // NEGATIVE_BOUNDARY_PROOF: approval decision action rejects out-of-domain values before mutating a pending approval.
    const invalidApprovalAction = invalidGovernanceSpecMember('approvalDecisionActions');
    const invalidDecisionResponse = await backendClient.put(
      `${operationPath(decideApprovalOperation.path, { agentId, eventId })}?action=${invalidApprovalAction}`,
    );
    const invalidDecisionBody = fullResponse(invalidDecisionResponse);

    expect(invalidDecisionBody.status).toBe(422);

    const decideResponse = await backendClient.put(
      `${operationPath(decideApprovalOperation.path, { agentId, eventId })}?action=approve`,
    );
    const decideBody = fullResponse(decideResponse);

    expect(decideBody.status).toBe(200);
    expect(decideBody.data.id).toBe(eventId);
    expect(decideBody.data.verdict).toBe(0);
    expect(decideBody.data.decided_at).toBeDefined();

    const historyResponse = await backendClient.get(
      operationPath(approvalHistoryOperation.path, { agentId }),
    );
    const historyBody = fullResponse(historyResponse);
    const historyApproval = findApproval(listItems(historyBody.data), eventId, pollResponse.data.id);

    expect(historyBody.status).toBe(200);
    expect(historyApproval).toBeDefined();
    expect(historyApproval.verdict).toBe(0);
    expect(historyApproval.approval_status ?? historyApproval.status).toBe('approved');

    const rejectedCase = makeRequireApprovalPolicyConformanceCase();
    const rejectedEvent = scopedGovernanceEvent(rejectedCase.event, 'approval-rejected');
    const rejectedPollRequest = scopedPollRequest(rejectedCase.pollRequest, rejectedEvent);
    const rejectEvaluateResponse = await coreClient.post(
      evaluateOperation.path,
      rejectedEvent,
    );

    expect(rejectEvaluateResponse.status).toBe(200);
    expect(rejectEvaluateResponse.data).toHaveProperty('verdict', rejectedCase.expected.verdict);
    expect(rejectEvaluateResponse.data).toHaveProperty('action', rejectedCase.expected.action);

    const rejectPollResponse = await coreClient.post(
      pollOperation.path,
      rejectedPollRequest,
    );

    expect(rejectPollResponse.status).toBe(200);
    expect(rejectPollResponse.data).toHaveProperty('action', rejectedCase.expected.action);

    const rejectedEventId = rejectEvaluateResponse.data.governance_event_id;
    const rejectResponse = await backendClient.put(
      `${operationPath(decideApprovalOperation.path, { agentId, eventId: rejectedEventId })}?action=reject`,
    );
    const rejectBody = fullResponse(rejectResponse);

    expect(rejectBody.status).toBe(200);
    expect(rejectBody.data.id).toBe(rejectedEventId);
    expect(rejectBody.data.decided_at).toBeDefined();

    const rejectedHistoryResponse = await backendClient.get(
      operationPath(approvalHistoryOperation.path, { agentId }),
    );
    const rejectedHistoryBody = fullResponse(rejectedHistoryResponse);
    const rejectedHistoryApproval = findApproval(
      listItems(rejectedHistoryBody.data),
      rejectedEventId,
      rejectPollResponse.data.id,
    );

    expect(rejectedHistoryBody.status).toBe(200);
    expect(rejectedHistoryApproval).toBeDefined();
    expect(rejectedHistoryApproval.approval_status ?? rejectedHistoryApproval.status).toBe('rejected');
  });

  it('CONFORMANCE: expired approval timeout stays denied and leaves pending queues', async () => {
    // CONFORMANCE_PROOF: generated approval timeout scenario creates a real
    // require_approval verdict, moves only the local-stack approval deadline
    // into the past, then proves Core polling never turns the expired request
    // into allow while backend approval surfaces classify it as expired.
    expect(['SCENARIO_PROOF: approval-expired-timeout']).toEqual(
      expect.arrayContaining(['SCENARIO_PROOF: approval-expired-timeout']),
    );
    const conformanceCase = makeApprovalExpirationConformanceCase();
    const createPolicyOperation = backendOperation(conformanceCase.createPolicyOperationId);
    const pendingApprovalsOperation = backendOperation(conformanceCase.pendingApprovalsOperationId);
    const organizationApprovalsOperation = backendOperation(conformanceCase.organizationApprovalsOperationId);
    const evaluateOperation = coreOperation(conformanceCase.evaluateOperationId);
    const pollOperation = coreOperation(conformanceCase.pollOperationId);

    expect(createPolicyOperation.verb).toBe('post');
    expect(pendingApprovalsOperation.verb).toBe('get');
    expect(organizationApprovalsOperation.verb).toBe('get');
    expect(evaluateOperation.verb).toBe('post');
    expect(pollOperation.verb).toBe('post');
    expect(conformanceCase.scenarioId).toBe('approval-expired-timeout');

    const createPolicyResponse = await backendClient.post(
      operationPath(createPolicyOperation.path, { agentId }),
      conformanceCase.policyBody,
    );
    const createPolicyBody = fullResponse(createPolicyResponse);

    expect(createPolicyBody.status).toBe(200);
    expect(createPolicyBody.data.id).toBeDefined();

    trackResource({ type: 'policy', id: createPolicyBody.data.id, agentId });
    await waitForOpaPolicyPath(createPolicyBody);

    const coreClient = getCoreClient(apiKey, agentIdentity);
    const expirationEvent = scopedGovernanceEvent(conformanceCase.event, 'approval-expired');
    const expirationPollRequest = scopedPollRequest(conformanceCase.pollRequest, expirationEvent);
    const evaluateResponse = await coreClient.post(
      evaluateOperation.path,
      expirationEvent,
    );

    expect(evaluateResponse.status).toBe(200);
    expect(evaluateResponse.data).toHaveProperty('verdict', conformanceCase.expected.verdict);
    expect(evaluateResponse.data).toHaveProperty('action', conformanceCase.expected.action);

    const eventId = evaluateResponse.data.governance_event_id;
    const pollBeforeExpiration = await coreClient.post(
      pollOperation.path,
      expirationPollRequest,
    );

    expect(pollBeforeExpiration.status).toBe(200);
    expect(pollBeforeExpiration.data).toHaveProperty('action', conformanceCase.expected.action);
    expect(pollBeforeExpiration.data).toHaveProperty('approval_expiration_time');

    await expireGovernanceApproval(eventId);

    const pollAfterExpiration = await coreClient.post(
      pollOperation.path,
      expirationPollRequest,
    );

    expect(pollAfterExpiration.status).toBe(200);
    expect(pollAfterExpiration.data).toHaveProperty('id', eventId);
    expect(pollAfterExpiration.data).toHaveProperty('action', conformanceCase.expected.action);
    expect(pollAfterExpiration.data.action).not.toBe('allow');
    expect(Date.parse(pollAfterExpiration.data.approval_expiration_time)).toBeLessThanOrEqual(
      Date.now(),
    );

    const pendingResponse = await backendClient.get(
      operationPath(pendingApprovalsOperation.path, { agentId }),
    );
    const pendingBody = fullResponse(pendingResponse);

    expect(pendingBody.status).toBe(200);
    expect(findApproval(listItems(pendingBody.data), eventId, pollAfterExpiration.data.id)).toBeUndefined();

    const expiredApprovalsResponse = await backendClient.get(
      `${operationPath(organizationApprovalsOperation.path, { organizationId: orgId })}?status=expired`,
    );
    const expiredApprovalsBody = fullResponse(expiredApprovalsResponse);
    const expiredApproval = findApproval(
      listItems(expiredApprovalsBody.data),
      eventId,
      pollAfterExpiration.data.id,
    );

    expect(expiredApprovalsBody.status).toBe(200);
    expect(expiredApproval).toBeDefined();
    expect(expiredApproval.status ?? expiredApproval.approval_status).toBe(
      conformanceCase.expected.expiredStatus,
    );
    expect(expiredApprovalsBody.data.metrics.expired_count).toBeGreaterThanOrEqual(
      conformanceCase.expected.expiredCount,
    );
  });

  it('CONFORMANCE: OPA verdict matrix covers ALLOW, REQUIRE_APPROVAL, BLOCK, and HALT paths', async () => {
    // SCENARIO_PROOF: opa-allow
    // SCENARIO_PROOF: behavior-db-query
    // SCENARIO_PROOF: behavior-tool-call
    // SCENARIO_PROOF: behavior-http
    // SCENARIO_PROOF: behavior-file-read
    // SCENARIO_PROOF: behavior-file-write
    // SCENARIO_PROOF: behavior-shell
    // SCENARIO_PROOF: behavior-llm
    // SCENARIO_PROOF: behavior-mcp
    // CONFORMANCE_PROOF: generated scenario paths drive the OPA verdict
    // EXHAUSTIVE_SPEC_PROOF: core verdict members include allow,
    // require_approval, block, and halt through this OPA matrix.
    // matrix over database_query, file_read, file_write, http_post,
    // mcp_tool_call, and shell/internal span classifications. Rego
    // supports ALLOW, REQUIRE_APPROVAL, BLOCK, and HALT here; CONSTRAIN
    // is intentionally not asserted as an OPA decision because the SDK
    // validator documents it as an invalid Rego decision.
    expect([
      'SCENARIO_PROOF: opa-allow',
      'SCENARIO_PROOF: opa-block',
      'SCENARIO_PROOF: opa-halt',
      'SCENARIO_PROOF: behavior-db-query',
      'SCENARIO_PROOF: behavior-tool-call',
      'SCENARIO_PROOF: behavior-http',
      'SCENARIO_PROOF: behavior-file-read',
      'SCENARIO_PROOF: behavior-file-write',
      'SCENARIO_PROOF: behavior-shell',
      'SCENARIO_PROOF: behavior-llm',
      'SCENARIO_PROOF: behavior-mcp',
    ]).toEqual(expect.arrayContaining([
      'SCENARIO_PROOF: opa-allow',
      'SCENARIO_PROOF: opa-block',
      'SCENARIO_PROOF: opa-halt',
      'SCENARIO_PROOF: behavior-db-query',
      'SCENARIO_PROOF: behavior-tool-call',
      'SCENARIO_PROOF: behavior-http',
      'SCENARIO_PROOF: behavior-file-read',
      'SCENARIO_PROOF: behavior-file-write',
      'SCENARIO_PROOF: behavior-shell',
      'SCENARIO_PROOF: behavior-llm',
      'SCENARIO_PROOF: behavior-mcp',
    ]));
    const matrix = makeOpaVerdictMatrixConformanceCase();
    const createPolicyOperation = backendOperation(matrix.createPolicyOperationId);
    const evaluateOperation = coreOperation(matrix.evaluateOperationId);

    expect(createPolicyOperation.verb).toBe('post');
    expect(evaluateOperation.verb).toBe('post');
    expect(matrix.policyBody.rego_code).toContain('ALLOW');
    expect(matrix.policyBody.rego_code).toContain('REQUIRE_APPROVAL');
    expect(matrix.policyBody.rego_code).toContain('BLOCK');
    expect(matrix.policyBody.rego_code).toContain('HALT');
    expect(matrix.policyBody.rego_code).not.toContain('CONSTRAIN');
    expect(matrix.cases.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        'ALLOW db query database_query path',
        'ALLOW mcp_tool_call path',
        'ALLOW llm_gen_ai e2e-approve-llm path',
        'ALLOW llm_completion e2e-approve-llm path',
        'REQUIRE_APPROVAL file_read path',
        'REQUIRE_APPROVAL llm_tool_call path',
        'BLOCK file_write path',
        'BLOCK shell path',
        'HALT http POST http_post path',
      ]),
    );
    expect(matrix.cases.map((entry) => entry.activityType)).toEqual(
      expect.arrayContaining([
        'DatabaseQuery',
        'MCPToolCall',
        'LLMGeneration',
        'LLMCompletion',
        'FileRead',
        'ToolCall',
        'FileEdit',
        'ShellExecution',
        'HTTPRequest',
      ]),
    );
    expect(matrix.cases.map((entry) => entry.activityInput.tool)).toEqual(
      expect.arrayContaining(['check_governance', 'sdk-conformance-approval-tool']),
    );
    const expectedOpaVerdicts = [
      ...GOVERNANCE_SPEC_DOMAINS.coreVerdicts.filter((verdict) => verdict !== 'constrain'),
    ].sort();
    const expectedOpaSemanticTypes = [
      ...GOVERNANCE_SPEC_DOMAINS.behaviorRuleTriggers,
      'llm_gen_ai',
      'mcp_tool_call',
    ].sort();
    const opaVerdicts = new Set(matrix.cases.map((entry) => entry.expected.verdict));
    const opaSemanticTypes = new Set(matrix.cases.map((entry) => entry.semanticType));

    expect([...opaVerdicts].sort()).toEqual(expectedOpaVerdicts);
    expect([...opaSemanticTypes].sort()).toEqual(expectedOpaSemanticTypes);
    expect(matrix.cases).toHaveLength(
      expectedOpaVerdicts.length * expectedOpaSemanticTypes.length,
    );

    const createPolicyResponse = await backendClient.post(
      operationPath(createPolicyOperation.path, { agentId }),
      matrix.policyBody,
    );
    const createPolicyBody = fullResponse(createPolicyResponse);

    expect(createPolicyBody.status).toBe(200);
    expect(createPolicyBody.data.id).toBeDefined();
    expect(createPolicyBody.data.rego_code).toContain('REQUIRE_APPROVAL');

    trackResource({ type: 'policy', id: createPolicyBody.data.id, agentId });
    await waitForOpaPolicyPath(createPolicyBody);

    const coreClient = getCoreClient(apiKey, agentIdentity);

    for (const matrixCase of matrix.cases) {
      const eventInput = Array.isArray(matrixCase.event.activity_input)
        ? matrixCase.event.activity_input
        : [];
      expect(eventInput[0]).toMatchObject(matrixCase.activityInput);
      expect(matrixCase.event.activity_type).toBe(matrixCase.activityType);
      expect(matrixCase.event.spans?.[0]?.semantic_type).toBe(matrixCase.semanticType);

      const event = scopedGovernanceEvent(matrixCase.event, `opa-matrix-${matrixCase.expected.verdict}`);
      const response = await coreClient.post(evaluateOperation.path, event);

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('verdict', matrixCase.expected.verdict);
      expect(response.data).toHaveProperty('action', matrixCase.expected.action);
      expect(response.data).toHaveProperty('reason', matrixCase.expected.reason);
      if (matrixCase.expected.verdict === 'require_approval') {
        expect(response.data).toHaveProperty('approval_expiration_time');
      }
    }
  }, 180_000);

  it('CONFORMANCE: OPA decision aliases cover continue, stop, and require-approval paths', async () => {
    // CONFORMANCE_PROOF: generated OPA alias cases prove legacy decision
    // strings through the real backend/Core policy pipeline, not only SDK
    // source validation. `continue` maps to allow, `stop` maps to halt, and
    // `require-approval` maps to require_approval.
    expect(['SCENARIO_PROOF: opa-decision-aliases']).toEqual(
      expect.arrayContaining(['SCENARIO_PROOF: opa-decision-aliases']),
    );
    const aliasCase = makeOpaAliasDecisionConformanceCase();
    const createPolicyOperation = backendOperation(aliasCase.createPolicyOperationId);
    const evaluateOperation = coreOperation(aliasCase.evaluateOperationId);

    expect(createPolicyOperation.verb).toBe('post');
    expect(evaluateOperation.verb).toBe('post');
    expect(aliasCase.policyBody.rego_code).toContain('continue');
    expect(aliasCase.policyBody.rego_code).toContain('stop');
    expect(aliasCase.policyBody.rego_code).toContain('require-approval');

    const createPolicyResponse = await backendClient.post(
      operationPath(createPolicyOperation.path, { agentId }),
      aliasCase.policyBody,
    );
    const createPolicyBody = fullResponse(createPolicyResponse);

    expect(createPolicyBody.status).toBe(200);
    expect(createPolicyBody.data.id).toBeDefined();

    trackResource({ type: 'policy', id: createPolicyBody.data.id, agentId });
    await waitForOpaPolicyPath(createPolicyBody);

    const coreClient = getCoreClient(apiKey, agentIdentity);

    for (const matrixCase of aliasCase.cases) {
      const event = scopedGovernanceEvent(matrixCase.event, `opa-alias-${matrixCase.expected.verdict}`);
      const response = await coreClient.post(evaluateOperation.path, event);

      expect(response.status, matrixCase.name).toBe(200);
      expect(response.data, matrixCase.name).toHaveProperty('verdict', matrixCase.expected.verdict);
      expect(response.data, matrixCase.name).toHaveProperty('action', matrixCase.expected.action);
      expect(response.data, matrixCase.name).toHaveProperty('reason', matrixCase.expected.reason);
      if (matrixCase.expected.verdict === 'require_approval') {
        expect(response.data, matrixCase.name).toHaveProperty('approval_expiration_time');
      }
    }
  });

  it('CONFORMANCE: OPA CONSTRAIN is an unsupported local-stack policy boundary', async () => {
    // CONFORMANCE_PROOF: the generated OPA CONSTRAIN scenario proves the
    // real backend/Core boundary. Backend accepts a CONSTRAIN policy, Core
    // currently falls through to allow, and SDK source validation rejects
    // CONSTRAIN so validated authoring surfaces do not present it as a
    // supported OPA decision.
    expect(['SCENARIO_PROOF: opa-constrain']).toEqual(
      expect.arrayContaining(['SCENARIO_PROOF: opa-constrain']),
    );
    const constrainCase = makeOpaUnsupportedConstrainConformanceCase();
    const createPolicyOperation = backendOperation(constrainCase.createPolicyOperationId);
    const evaluateOperation = coreOperation(constrainCase.evaluateOperationId);

    expect(constrainCase.scenarioId).toBe('opa-constrain');
    expect(createPolicyOperation.verb).toBe('post');
    expect(evaluateOperation.verb).toBe('post');
    expect(constrainCase.policyBody.rego_code).toContain('CONSTRAIN');
    expect(constrainCase.event.activity_type).toBe('DatabaseQuery');
    expect(constrainCase.event.spans?.[0]?.semantic_type).toBe('database_query');

    const createPolicyResponse = await backendClient.post(
      operationPath(createPolicyOperation.path, { agentId }),
      constrainCase.policyBody,
    );
    const createPolicyBody = fullResponse(createPolicyResponse);

    expect(createPolicyBody.status).toBe(200);
    expect(createPolicyBody.data.id).toBeDefined();

    trackResource({ type: 'policy', id: createPolicyBody.data.id, agentId });
    await waitForOpaPolicyPath(createPolicyBody);

    const coreClient = getCoreClient(apiKey, agentIdentity);
    const event = scopedGovernanceEvent(constrainCase.event, 'opa-constrain');
    const response = await coreClient.post(evaluateOperation.path, event);

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('verdict', constrainCase.expected.verdict);
    expect(response.data).toHaveProperty('action', constrainCase.expected.action);
    expect(response.data).toHaveProperty('reason', constrainCase.expected.reason);
  });

  itIfIsolatedOpaUnavailable('CONFORMANCE: fails closed when OPA is unavailable for an active policy', async () => {
    // CONFORMANCE_PROOF: the generated OPA unavailable scenario uses a real
    // active blocking policy and an isolated Core lane whose OPA_URL points to
    // an unavailable endpoint. The shared local OPA sidecar is never stopped.
    expect(['SCENARIO_PROOF: opa-unavailable-fail-closed']).toEqual(
      expect.arrayContaining(['SCENARIO_PROOF: opa-unavailable-fail-closed']),
    );
    expect(process.env.OPENBOX_E2E_ISOLATED_OPA_UNAVAILABLE).toBe('1');
    const conformanceCase = makeOpaUnavailableFailClosedConformanceCase();
    const createPolicyOperation = backendOperation(conformanceCase.createPolicyOperationId);
    const evaluateOperation = coreOperation(conformanceCase.evaluateOperationId);

    expect(createPolicyOperation.verb).toBe('post');
    expect(evaluateOperation.verb).toBe('post');
    expect(conformanceCase.scenarioId).toBe('opa-unavailable-fail-closed');
    expect(conformanceCase.policyBody.rego_code).toContain('BLOCK');
    expect(conformanceCase.event.activity_type).toBe('DatabaseQuery');

    const createPolicyResponse = await backendClient.post(
      operationPath(createPolicyOperation.path, { agentId }),
      conformanceCase.policyBody,
    );
    const createPolicyBody = fullResponse(createPolicyResponse);

    expect(createPolicyBody.status).toBe(200);
    expect(createPolicyBody.data.id).toBeDefined();

    trackResource({ type: 'policy', id: createPolicyBody.data.id, agentId });

    const coreClient = getCoreClient(apiKey, agentIdentity);
    const suffix = Date.now();
    const unavailableEvent = {
      ...conformanceCase.event,
      workflow_id: `sdk-opa-unavailable-${suffix}`,
      run_id: `run-opa-unavailable-${suffix}`,
      activity_id: `opa-unavailable-active-policy-${suffix}`,
    };
    const unavailableResponse = await coreClient.post(
      evaluateOperation.path,
      unavailableEvent,
    );

    expect(unavailableResponse.status).toBe(200);
    expect(unavailableResponse.data).toHaveProperty(
      'verdict',
      conformanceCase.expected.unavailableVerdict,
    );
    expect(unavailableResponse.data).toHaveProperty(
      'action',
      conformanceCase.expected.unavailableAction,
    );
    expect(unavailableResponse.data).toHaveProperty(
      'reason',
      conformanceCase.expected.unavailableReason,
    );
  });

  it('CONFORMANCE: sends the goal signal before the first governed action and surfaces AGE result', async () => {
    // CONFORMANCE_PROOF: the generated goal/order scenario IDs drive a
    // SignalReceived event that precedes the firstGovernedSurface. The
    // same Core AGE result asserts goal_alignment_checked and the Core
    // governance-checks-incomplete flag, so the healthy AGE path cannot silently hide
    // required-check completion state.
    expect([
      'SCENARIO_PROOF: behavior-order-goal-before-action',
      'SCENARIO_PROOF: goal-alignment-checked',
    ]).toEqual(expect.arrayContaining([
      'SCENARIO_PROOF: behavior-order-goal-before-action',
      'SCENARIO_PROOF: goal-alignment-checked',
    ]));
    const conformanceCase = makeGoalSignalOrderConformanceCase();
    const evaluateOperation = coreOperation(conformanceCase.evaluateOperationId);
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const observedOrder: string[] = [];

    expect(evaluateOperation.verb).toBe('post');
    expect(conformanceCase.goalSignalEvent.event_type).toBe(conformanceCase.expected.firstEventType);
    expect(conformanceCase.goalSignalEvent.workflow_id).toBe(
      conformanceCase.firstGovernedEvent.workflow_id,
    );
    expect(conformanceCase.goalSignalEvent.run_id).toBe(
      conformanceCase.firstGovernedEvent.run_id,
    );
    expect(conformanceCase.goalSignalEvent.signal_name).toBe('openbox_goal');
    expect(conformanceCase.goalSignalEvent.activity_input).toEqual(
      conformanceCase.goalSignalEvent.signal_args,
    );
    expect(conformanceCase.firstGovernedEvent.activity_type).toBe(
      conformanceCase.expected.firstGovernedSurface,
    );
    expect(conformanceCase.scenarioIds).toMatchObject({
      order: 'behavior-order-goal-before-action',
      alignmentChecked: 'goal-alignment-checked',
      ageUnavailable: 'goal-drift-unavailable-fail-closed',
    });

    const signalResponse = await coreClient.post(
      evaluateOperation.path,
      conformanceCase.goalSignalEvent,
    );
    observedOrder.push(conformanceCase.goalSignalEvent.event_type);

    expect(signalResponse.status).toBe(200);
    expect(signalResponse.data).toHaveProperty('verdict');
    expect(signalResponse.data.age_result).toMatchObject({
      goal_alignment_checked: expect.any(Boolean),
      governance_checks_incomplete: conformanceCase.expected.governanceChecksIncomplete,
    });
    expect(signalResponse.data.age_result).toHaveProperty(
      'governance_checks_incomplete',
      conformanceCase.expected.governanceChecksIncomplete,
    );

    const actionResponse = await coreClient.post(
      evaluateOperation.path,
      conformanceCase.firstGovernedEvent,
    );
    const firstGovernedSurface = conformanceCase.firstGovernedEvent.activity_type;
    expect(firstGovernedSurface).toBeDefined();
    if (!firstGovernedSurface) {
      throw new Error('first governed surface is required for conformance ordering');
    }
    observedOrder.push(firstGovernedSurface);

    expect(actionResponse.status).toBe(200);
    expect(actionResponse.data).toHaveProperty('verdict', 'allow');
    expect(actionResponse.data).toHaveProperty(
      'governance_checks_incomplete',
      conformanceCase.expected.governanceChecksIncomplete,
    );
    expect(actionResponse.data.age_result).toMatchObject({
      goal_alignment_checked: conformanceCase.expected.goalAlignmentChecked,
      goal_drifted: conformanceCase.expected.goalDrifted,
      governance_checks_incomplete: conformanceCase.expected.governanceChecksIncomplete,
    });
    if (actionResponse.data.age_result?.trust_score?.trust_tier !== undefined) {
      expectRange(
        actionResponse.data.age_result.trust_score.trust_tier,
        0,
        4,
        'age_result.trust_score.trust_tier',
      );
    }
    expect(observedOrder).toEqual([
      conformanceCase.expected.firstEventType,
      conformanceCase.expected.firstGovernedSurface,
    ]);
    expect(observedOrder.indexOf(conformanceCase.expected.firstEventType)).toBeLessThan(
      observedOrder.indexOf(firstGovernedSurface),
    );
  });

  itIfIsolatedAgeUnavailable('CONFORMANCE: AGE unavailable marks governance checks incomplete', async () => {
    // SCENARIO_PROOF: goal-drift-unavailable-fail-closed
    // CONFORMANCE_PROOF: this test is only enabled by the isolated Core runner,
    // which starts Core with AGE_URL pointed at an unavailable local port.
    // The Core governance-checks-incomplete flag must be true on the governed action response.
    expect(process.env.OPENBOX_E2E_ISOLATED_AGE_UNAVAILABLE).toBe('1');
    expect('AGE unavailable').toBe('AGE unavailable');
    expect(['SCENARIO_PROOF: goal-drift-unavailable-fail-closed']).toEqual(
      expect.arrayContaining(['SCENARIO_PROOF: goal-drift-unavailable-fail-closed']),
    );
    const conformanceCase = makeGoalSignalOrderConformanceCase();
    const evaluateOperation = coreOperation(conformanceCase.evaluateOperationId);
    const coreClient = getCoreClient(apiKey, agentIdentity);
    const suffix = Date.now();
    const workflowId = `sdk-age-unavailable-${suffix}`;
    const runId = `run-age-unavailable-${suffix}`;
    const goalSignalEvent = {
      ...conformanceCase.goalSignalEvent,
      workflow_id: workflowId,
      run_id: runId,
      activity_id: `goal-age-unavailable-${suffix}`,
    };
    const governedEvent = {
      ...conformanceCase.firstGovernedEvent,
      workflow_id: workflowId,
      run_id: runId,
      activity_id: `action-age-unavailable-${suffix}`,
    };

    const signalResponse = await coreClient.post(evaluateOperation.path, goalSignalEvent);
    expect(signalResponse.status).toBe(200);

    const actionResponse = await coreClient.post(evaluateOperation.path, governedEvent);
    expect(actionResponse.status).toBe(200);
    expect(actionResponse.data).toHaveProperty('governance_checks_incomplete', true);
    expect(actionResponse.data.age_result).toMatchObject({
      goal_alignment_checked: expect.any(Boolean),
      governance_checks_incomplete: true,
    });
    expect(actionResponse.data.age_result).toHaveProperty('governance_checks_incomplete', true);
  });

  afterAll(async () => {
    await cleanupAll();
  });
});
