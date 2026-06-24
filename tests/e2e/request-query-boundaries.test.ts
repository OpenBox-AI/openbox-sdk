import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import {
  REQUEST_PREFLIGHT_RULES as BACKEND_REQUEST_PREFLIGHT_RULES,
} from '../../ts/src/client/generated/request-preflight.js';
import {
  fullResponse,
  getBackendClient,
  getOrgId,
  getTeamIds,
} from '../helpers/api-client';
import { cleanupAll, trackResource } from '../helpers/cleanup';
import {
  makeCreateAgentDto,
  makeCreateBehaviorRuleDto,
  makeCreatePolicyDto,
} from '../helpers/fixtures';
import { seedLocalStackSession } from '../helpers/local-stack-db';
import { buildRequestConstraintConformance } from '../helpers/request-constraint-conformance';

interface QueryBoundaryCase {
  constraintKey: string;
  operationId: string;
  path: string;
  queryName: 'page' | 'perPage' | 'pattern';
  invalidValue: string;
  expectedStatuses: number[];
}

const TRANSPORT_OR_PERMISSION_GATED = new Set([
  'OrganizationController_getMembers',
]);

function sortedStrings(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function operationPath(path: string, params: Record<string, string>) {
  return path.replace(/\{([^}]+)\}/g, (_, key) => {
    expect(params[key], key).toBeDefined();
    return encodeURIComponent(params[key]);
  });
}

function backendOperation(operationId: string) {
  const operation = BACKEND_ENDPOINT_MANIFEST.find((entry) => entry.operationId === operationId);
  expect(operation, operationId).toBeDefined();
  return operation!;
}

function queryBoundaryConstraintKey(operationId: string, queryName: QueryBoundaryCase['queryName']) {
  const kind = queryName === 'pattern' ? 'maxLength' : 'minimum';
  return `backend:${operationId}:query.${queryName}:${kind}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function boundaryCases(params: Record<string, string>): QueryBoundaryCase[] {
  const cases: QueryBoundaryCase[] = [];
  const manifestByOperation = new Map<string, (typeof BACKEND_ENDPOINT_MANIFEST)[number]>(
    BACKEND_ENDPOINT_MANIFEST.map((entry) => [entry.operationId, entry]),
  );

  for (const rule of BACKEND_REQUEST_PREFLIGHT_RULES) {
    const operation = manifestByOperation.get(rule.operationId);
    if (!operation || operation.verb !== 'get') continue;
    if (rule.operationId.startsWith('ApiKeyController_')) continue;
    if (rule.operationId.startsWith('WebhookController_')) continue;

    for (const query of rule.query ?? []) {
      if (!['page', 'perPage', 'pattern'].includes(query.name)) continue;
      const queryName = query.name as QueryBoundaryCase['queryName'];
      const invalidValue =
        queryName === 'pattern'
          ? 'x'.repeat(Number(query.maxLength) + 1)
          : String(Number(query.minimum) - 1);
      cases.push({
        constraintKey: queryBoundaryConstraintKey(rule.operationId, queryName),
        operationId: rule.operationId,
        path: operationPath(operation.path, params),
        queryName,
        invalidValue,
        expectedStatuses: TRANSPORT_OR_PERMISSION_GATED.has(rule.operationId)
          ? [403]
          : [422],
      });
    }
  }

  return cases.sort((left, right) =>
    `${left.operationId}:${left.queryName}`.localeCompare(`${right.operationId}:${right.queryName}`),
  );
}

function expectedBoundaryCaseCount(): number {
  return BACKEND_REQUEST_PREFLIGHT_RULES.reduce((total, rule) => {
    const operation = BACKEND_ENDPOINT_MANIFEST.find(
      (entry) => entry.operationId === rule.operationId,
    );
    if (!operation || operation.verb !== 'get') return total;
    if (rule.operationId.startsWith('ApiKeyController_')) return total;
    if (rule.operationId.startsWith('WebhookController_')) return total;
    return total + (rule.query ?? []).filter((query) =>
      ['page', 'perPage', 'pattern'].includes(query.name),
    ).length;
  }, 0);
}

function expectedBoundaryConstraintKeysFromLedger(): string[] {
  const excludedOperationPrefixes = ['ApiKeyController_', 'WebhookController_'];
  const ledger = buildRequestConstraintConformance();
  return ledger.constraints
    .filter((entry) => entry.service === 'backend')
    .filter((entry) => ['query.page', 'query.perPage', 'query.pattern'].includes(entry.location))
    .filter((entry) => ['minimum', 'maxLength'].includes(entry.kind))
    .filter((entry) =>
      excludedOperationPrefixes.every((prefix) => !entry.operationId.startsWith(prefix)),
    )
    .map((entry) => entry.key)
    .sort((left, right) => left.localeCompare(right));
}

async function rawBoundaryGet(
  client: ReturnType<typeof getBackendClient>,
  testCase: QueryBoundaryCase,
) {
  const separator = testCase.path.includes('?') ? '&' : '?';
  const path = `${testCase.path}${separator}${testCase.queryName}=${encodeURIComponent(testCase.invalidValue)}`;
  return fullResponse(await client.get(path));
}

describe('Generated Backend Query Boundaries', () => {
  const client = getBackendClient();
  let params: Record<string, string>;

  beforeAll(async () => {
    const orgId = getOrgId();
    const teamIds = await getTeamIds();
    const agentResponse = await client.post('/agent/create', makeCreateAgentDto(teamIds));
    const agentBody = fullResponse(agentResponse);
    expect(agentBody.status).toBe(200);
    const agentId = agentBody.data.agent.id;
    trackResource({ type: 'agent', id: agentId });

    const policyResponse = await client.post(
      `/agent/${agentId}/policies`,
      makeCreatePolicyDto({ trust_impact: 'none' }),
    );
    const policyBody = fullResponse(policyResponse);
    expect(policyBody.status).toBe(200);
    const policyId = policyBody.data.id;
    trackResource({ type: 'policy', id: policyId, agentId });

    const behaviorResponse = await client.post(
      `/agent/${agentId}/behavior-rule`,
      makeCreateBehaviorRuleDto({ trust_impact: 'none' }),
    );
    const behaviorBody = fullResponse(behaviorResponse);
    expect(behaviorBody.status).toBe(200);
    trackResource({ type: 'behavior-rule', id: behaviorBody.data.id, agentId });

    const session = await seedLocalStackSession({
      agentId,
      workflowIdPrefix: 'query-boundary-wf-',
      runIdPrefix: 'query-boundary-run-',
      detail: 'query boundary conformance session',
      startedAt: new Date(),
      completedAt: null,
      trustEvaluatedAt: null,
      metadata: { openbox_conformance: true, source: 'request-query-boundaries.e2e' },
    });
    const sessionId = session.id;

    params = {
      agentId,
      behaviorGroupdId: behaviorBody.data.base_rule_id ?? behaviorBody.data.id,
      organizationId: orgId,
      policyId,
      sessionId,
      teamId: teamIds[0] ?? '00000000-0000-4000-8000-000000000000',
    };
  });

  it('NEGATIVE_BOUNDARY_PROOF: generated backend pagination and search query constraints reject invalid values', async () => {
    // NEGATIVE_BOUNDARY_PROOF: every generated backend page/perPage/pattern
    // request preflight constraint is derived from OpenAPI, then driven
    // against the real local stack via the raw fallback path so this proves
    // server-side validation, not SDK-only preflight.
    const cases = boundaryCases(params);
    expect(cases).toHaveLength(expectedBoundaryCaseCount());
    expect(sortedStrings(cases.map((testCase) => testCase.constraintKey))).toEqual(
      expectedBoundaryConstraintKeysFromLedger(),
    );
    expect(BACKEND_REQUEST_PREFLIGHT_RULES.length).toBeGreaterThan(0);
    expect(cases.some((testCase) => testCase.queryName === 'pattern')).toBe(true);
    const agentEvaluationCases = cases.filter(
      (testCase) => testCase.operationId === 'AgentController_getAgentEvaluations',
    );
    const expectedAgentEvaluationConstraintKeys = [
      'backend:AgentController_getAgentEvaluations:query.page:minimum',
      'backend:AgentController_getAgentEvaluations:query.pattern:maxLength',
      'backend:AgentController_getAgentEvaluations:query.perPage:minimum',
    ];
    expect(sortedStrings(agentEvaluationCases.map((testCase) => testCase.constraintKey))).toEqual(
      expectedAgentEvaluationConstraintKeys,
    );
    expect(agentEvaluationCases.map((testCase) => testCase.queryName).sort()).toEqual([
      'page',
      'pattern',
      'perPage',
    ]);
    expect(agentEvaluationCases.every((testCase) => testCase.expectedStatuses.includes(422))).toBe(
      true,
    );
    const agentEvaluationOperation = backendOperation('AgentController_getAgentEvaluations');
    expect(agentEvaluationOperation.verb).toBe('get');

    const unexpected: Array<{
      operationId: string;
      queryName: string;
      expected: number[];
      actual: number;
      body: unknown;
    }> = [];

    for (const testCase of agentEvaluationCases) {
      expect(testCase.path).toBe(operationPath(agentEvaluationOperation.path, params));
    }

    for (const testCase of cases) {
      const body = await rawBoundaryGet(client, testCase);
      if (!testCase.expectedStatuses.includes(body.status)) {
        unexpected.push({
          operationId: testCase.operationId,
          queryName: testCase.queryName,
          expected: testCase.expectedStatuses,
          actual: body.status,
          body,
        });
      }
      await sleep(750);
    }

    expect(unexpected).toEqual([]);
  }, 120_000);

  afterAll(async () => {
    await cleanupAll();
  });
});
