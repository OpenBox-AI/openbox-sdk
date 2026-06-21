import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenBoxClient } from '../../ts/src/client';
import {
  BACKEND_ENDPOINT_MANIFEST,
  type BackendEndpointManifestEntry,
} from '../../ts/src/client/generated/endpoint-manifest.js';
import {
  REQUEST_PREFLIGHT_RULES as BACKEND_REQUEST_PREFLIGHT_RULES,
} from '../../ts/src/client/generated/request-preflight.js';
import { OpenBoxCoreClient } from '../../ts/src/core-client';
import {
  CORE_ENDPOINT_MANIFEST,
  type CoreEndpointManifestEntry,
} from '../../ts/src/core-client/generated/endpoint-manifest.js';
import { invalidGovernanceSpecMember } from '../helpers/governance-spec-domains';
import {
  buildRequestConstraintConformance,
  type RequestConstraintClassification,
} from '../helpers/request-constraint-conformance';

function backendClient(): OpenBoxClient {
  expect(process.env.OPENBOX_API_URL).toBeTruthy();
  expect(process.env.OPENBOX_BACKEND_API_KEY).toMatch(/^obx_key_/);
  return new OpenBoxClient({
    apiUrl: process.env.OPENBOX_API_URL,
    apiKey: process.env.OPENBOX_BACKEND_API_KEY,
    retry: { maxRetries: 0 },
    clientName: 'openbox-e2e-sdk-preflight-closure',
  });
}

function coreClient(): OpenBoxCoreClient {
  expect(process.env.OPENBOX_CORE_URL).toBeTruthy();
  expect(process.env.OPENBOX_API_KEY).toMatch(/^obx_(test|live)_/);
  return new OpenBoxCoreClient({
    apiUrl: process.env.OPENBOX_CORE_URL,
    apiKey: process.env.OPENBOX_API_KEY!,
    retry: { maxRetries: 0 },
  });
}

function baseGovernancePayload() {
  return {
    event_type: 'ActivityStarted',
    workflow_id: 'sdk-preflight-closure-wf',
    run_id: 'sdk-preflight-closure-run',
    workflow_type: 'sdk-preflight-closure',
    task_queue: 'local-stack',
    source: 'openbox-sdk-e2e',
    timestamp: new Date().toISOString(),
    activity_id: 'sdk-preflight-closure-activity',
    activity_type: 'tool_call',
  } as const;
}

type EndpointEntry = BackendEndpointManifestEntry | CoreEndpointManifestEntry;

function rawSemanticGapConstraints(): RequestConstraintClassification[] {
  const ledger = buildRequestConstraintConformance();
  const constraints = ledger.constraints.filter(
    (entry) => entry.disposition === 'raw-semantic-gap-sdk-closed',
  );

  expect(ledger.summary.missingRawSemanticGapClosures).toEqual([]);
  expect([...new Set(constraints.flatMap((entry) => entry.semanticGapIds))].sort()).toEqual(
    ledger.summary.knownRawSemanticGaps,
  );
  expect(constraints.length).toBeGreaterThan(0);
  return constraints;
}

function operationForConstraint(constraint: RequestConstraintClassification): EndpointEntry {
  const manifest =
    constraint.service === 'backend'
      ? BACKEND_ENDPOINT_MANIFEST
      : CORE_ENDPOINT_MANIFEST;
  const operation = manifest.find((entry) => entry.operationId === constraint.operationId);
  expect(operation, constraint.key).toBeDefined();
  return operation!;
}

function concretePath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, (_, key) => encodeURIComponent(`${key}-1`));
}

function invalidValueForConstraint(constraint: RequestConstraintClassification): unknown {
  switch (constraint.kind) {
    case 'enum':
      return `__openbox_invalid_${constraint.location.replace(/[^a-z0-9]+/gi, '_')}__`;
    case 'format':
      return constraint.value === 'date-time' ? 'not-a-date-time' : 'not-a-number';
    case 'integer':
      return 0.5;
    case 'maximum':
      return Number(constraint.value) + 1;
    case 'maxItems':
      return Array.from({ length: Number(constraint.value) + 1 }, (_, index) => `item-${index}`);
    case 'maxLength':
      return 'x'.repeat(Number(constraint.value) + 1);
    case 'minimum':
      return Number(constraint.value) - 1;
    case 'minItems':
      return Array.from({ length: Math.max(0, Number(constraint.value) - 1) }, () => 'item');
    case 'type':
      return constraint.value === 'string' ? 42 : 'not-a-number';
  }
}

function bodyWithLocation(location: string, value: unknown): Record<string, unknown> {
  const segments = location.replace(/^body\./, '').split('.');
  let current: unknown = value;
  for (const segment of [...segments].reverse()) {
    current = segment === '*' ? [current] : { [segment]: current };
  }
  return current as Record<string, unknown>;
}

function requestOptionsForConstraint(constraint: RequestConstraintClassification): {
  params?: Record<string, unknown>;
  data?: unknown;
} {
  const value = invalidValueForConstraint(constraint);
  if (constraint.location.startsWith('query.')) {
    return {
      params: {
        [constraint.location.replace(/^query\./, '')]: value,
      },
    };
  }
  return {
    data: bodyWithLocation(constraint.location, value),
  };
}

describe('SDK semantic gap preflight closures', () => {
  const originalFetch = globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(() => {
      throw new Error('SDK preflight closure should reject before transport');
    });
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('E2E_SDK_GAP_CLOSURE: approval-status-invalid-query-not-rejected', async () => {
    // AgentController_getPendingApprovals, AgentController_getApprovalHistory,
    // and OrganizationController_getApprovals are raw backend gaps today; the
    // generated public SDK wrappers must reject invalid status before fetch.
    const client = backendClient();
    const invalidStatus = invalidGovernanceSpecMember('approvalStatuses');

    await expect(
      client.getPendingApprovals('agent-1', { status: invalidStatus }),
    ).rejects.toMatchObject({
      name: 'RequestPreflightError',
      operationId: 'AgentController_getPendingApprovals',
      location: 'query.status',
    });
    await expect(
      client.getApprovalHistory('agent-1', { status: invalidStatus }),
    ).rejects.toMatchObject({
      name: 'RequestPreflightError',
      operationId: 'AgentController_getApprovalHistory',
      location: 'query.status',
    });
    await expect(
      client.getOrgApprovals('org-1', { status: invalidStatus }),
    ).rejects.toMatchObject({
      name: 'RequestPreflightError',
      operationId: 'OrganizationController_getApprovals',
      location: 'query.status',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('E2E_SDK_GAP_CLOSURE: backend-agent-evaluations-query-boundaries-not-rejected', async () => {
    // AgentController_getAgentEvaluations is exposed as getAgentViolations.
    // Every generated query boundary must fail through SDK preflight before
    // the raw backend can accept the invalid query.
    const client = backendClient();
    const rule = BACKEND_REQUEST_PREFLIGHT_RULES.find(
      (entry) => entry.operationId === 'AgentController_getAgentEvaluations',
    );
    expect(rule?.query?.map((entry) => entry.name).sort()).toEqual([
      'page',
      'pattern',
      'perPage',
    ]);

    const invalidByQueryName: Record<string, unknown> = {
      page: -1,
      pattern: 'x'.repeat(
        Number(rule?.query?.find((entry) => entry.name === 'pattern')?.maxLength) + 1,
      ),
      perPage: 0,
    };

    for (const queryRule of rule?.query ?? []) {
      await expect(
        client.getAgentViolations('agent-1', {
          [queryRule.name]: invalidByQueryName[queryRule.name],
        }),
      ).rejects.toMatchObject({
        name: 'RequestPreflightError',
        operationId: 'AgentController_getAgentEvaluations',
        location: `query.${queryRule.name}`,
      });
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('E2E_SDK_GAP_CLOSURE: core governance request boundary raw gaps', async () => {
    // core-governance-attempt-min-not-rejected,
    // core-governance-timestamp-format-not-rejected, and
    // core-governance-cost-type-not-rejected remain raw Core gaps; the SDK
    // generated Core client must close each before transport.
    const client = coreClient();

    await expect(client.evaluate({
      ...baseGovernancePayload(),
      attempt: 0,
    })).rejects.toMatchObject({
      name: 'RequestPreflightError',
      operationId: 'evaluateGovernance',
      location: 'body.attempt',
    });

    await expect(client.evaluate({
      ...baseGovernancePayload(),
      timestamp: 'not-a-date-time',
    })).rejects.toMatchObject({
      name: 'RequestPreflightError',
      operationId: 'evaluateGovernance',
      location: 'body.timestamp',
    });

    await expect(client.evaluate({
      ...baseGovernancePayload(),
      cost_usd: 'not-a-number',
    } as any)).rejects.toMatchObject({
      name: 'RequestPreflightError',
      operationId: 'evaluateGovernance',
      location: 'body.cost_usd',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('E2E_SDK_GAP_CLOSURE: every generated raw semantic gap constraint rejects before transport', async () => {
    const backend = backendClient();
    const core = coreClient();

    for (const constraint of rawSemanticGapConstraints()) {
      const operation = operationForConstraint(constraint);
      const client = constraint.service === 'backend' ? backend : core;
      await expect(
        client.requestOperation(
          operation.verb,
          concretePath(operation.path),
          requestOptionsForConstraint(constraint),
        ),
        constraint.key,
      ).rejects.toMatchObject({
        name: 'RequestPreflightError',
        operationId: constraint.operationId,
        location: constraint.location,
      });
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
