// DTO factories for backend operations. Spec-driven: every shape
// matches a typed `BackendClient` method's body parameter and is
// exercised end-to-end by the e2e suite, so drift between these
// defaults and the live wire shapes is a test failure.
//
// Public sub-path: `import { makeCreateAgentDto, ... } from '@openbox-ai/openbox-sdk/test-utils'`.
//
// Used by:
//   - the openbox-sdk e2e suite (tests/helpers/fixtures.ts re-exports)
//   - any "spin up a deterministic test agent" tooling that wants
//     the same default shape the e2e suite asserts on
//   - any consumer that needs a sensible default for backend writes

import {
  CANONICAL_EVENT_TYPE,
  CANONICAL_VERDICT_ARMS,
} from '../core-client/generated/govern.js';
import type {
  ApprovalStatusRequest,
  GovernanceEventPayload,
  LegacyAction,
  SpanData,
  Verdict,
} from '../core-client/index.js';
import { LOCAL_STACK_SCENARIO_PATHS } from '../governance/capability-matrix.js';
import type { components } from '../types/generated/backend.js';

type CreateGuardrailDto = components['schemas']['CreateGuardrailDto'];
type CreatePolicyDto = components['schemas']['CreatePolicyDto'];
type EvaluateRegoDto = components['schemas']['EvaluateRegoDto'];
type TestGuardrailDto = components['schemas']['TestGuardrailDto'];

let counter = 0;
const ts = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export function makeCreateAgentDto(teamIds: string[], overrides: Record<string, any> = {}) {
  return {
    agent_name: `test-agent-${ts()}`,
    description: 'E2E test agent, auto cleanup',
    icon: 'robot',
    agent_type: 'temporal',
    team_ids: teamIds,
    tags: ['e2e-test'],
    attestation_mode: 'kms' as const,
    aivss_config: {
      base_security: {
        attack_vector: 2,
        attack_complexity: 1,
        privileges_required: 2,
        user_interaction: 1,
        scope: 1,
      },
      ai_specific: {
        model_robustness: 3,
        data_sensitivity: 2,
        ethical_impact: 2,
        decision_criticality: 2,
        adaptability: 3,
      },
      impact: {
        confidentiality_impact: 2,
        integrity_impact: 2,
        availability_impact: 2,
        safety_impact: 1,
      },
    },
    goal_alignment_config: {
      alignment_threshold: 70,
      drift_detection_action: 'alert_only' as const,
      evaluation_frequency: 'every_action' as const,
      llama_firewall_model: 'gpt-4o-mini' as const,
    },
    ...overrides,
  };
}

export function makeCreateGuardrailDto(overrides: Partial<CreateGuardrailDto> = {}): CreateGuardrailDto {
  return {
    name: `test-guardrail-${ts()}`,
    guardrail_type: '1',
    description: 'E2E test guardrail',
    processing_stage: '1',
    params: {},
    settings: {},
    trust_impact: 'medium' as const,
    ...overrides,
  };
}

export function makeCreatePolicyDto(overrides: Partial<CreatePolicyDto> = {}): CreatePolicyDto {
  return {
    name: `test-policy-${ts()}`,
    description: 'E2E test policy',
    rego_code: 'package openbox.policy\ndefault decision = {"verdict": "allow", "reason": ""}',
    input: {},
    trust_impact: 'low',
    ...overrides,
  };
}

export interface EvaluateRegoConformanceCase {
  operationId: 'PolicyController_evaluate';
  body: EvaluateRegoDto;
  expected: Record<string, unknown>;
}

export function makeEvaluateRegoConformanceCase(): EvaluateRegoConformanceCase {
  return {
    operationId: 'PolicyController_evaluate',
    body: {
      policy: 'package test\ndefault allow = true',
      input: {},
    },
    expected: {
      allow: true,
    },
  };
}

export interface RequireApprovalPolicyConformanceCase {
  createPolicyOperationId: 'AgentController_createPolicy';
  pendingApprovalsOperationId: 'AgentController_getPendingApprovals';
  organizationApprovalsOperationId: 'OrganizationController_getApprovals';
  decideApprovalOperationId: 'AgentController_decideApproval';
  approvalHistoryOperationId: 'AgentController_getApprovalHistory';
  evaluateOperationId: 'evaluateGovernance';
  pollOperationId: 'pollApproval';
  policyBody: CreatePolicyDto;
  event: GovernanceEventPayload;
  pollRequest: ApprovalStatusRequest;
  expected: {
    verdict: Extract<Verdict, 'require_approval'>;
    action: Extract<LegacyAction, 'require_approval'>;
    reason: string;
  };
}

export function makeRequireApprovalPolicyConformanceCase(): RequireApprovalPolicyConformanceCase {
  const now = Date.now();
  const traceId = `trace-${ts()}`;
  const span: SpanData = {
    span_id: `span-${ts()}`,
    trace_id: traceId,
    name: 'sdk-conformance-approval-tool',
    kind: 'CLIENT',
    start_time: now,
    end_time: now + 5,
    semantic_type: 'llm_gen_ai',
    stage: 'started',
    status: {
      code: 'OK',
    },
    attributes: {
      'openbox.conformance': true,
      'gen_ai.system': 'openbox-sdk-e2e',
    },
  };
  const reason = 'SDK conformance requires approval';
  const event = makeGovernanceEvent({
    activity_type: 'tool_call',
    activity_input: [
      {
        tool: 'sdk-conformance-approval-tool',
        prompt: 'exercise require_approval verdict and approval polling',
      },
    ],
    span_count: 1,
    spans: [span],
  }) as GovernanceEventPayload;

  return {
    createPolicyOperationId: 'AgentController_createPolicy',
    pendingApprovalsOperationId: 'AgentController_getPendingApprovals',
    organizationApprovalsOperationId: 'OrganizationController_getApprovals',
    decideApprovalOperationId: 'AgentController_decideApproval',
    approvalHistoryOperationId: 'AgentController_getApprovalHistory',
    evaluateOperationId: 'evaluateGovernance',
    pollOperationId: 'pollApproval',
    policyBody: makeCreatePolicyDto({
      name: `test-policy-approval-${ts()}`,
      description: 'E2E conformance policy for require_approval and approval polling',
      rego_code: [
        'package openbox.policy',
        'default result = {"decision": "ALLOW", "reason": null}',
        '',
        `result := {"decision": "REQUIRE_APPROVAL", "reason": ${JSON.stringify(reason)}} if {`,
        '    input.activity_type == "tool_call"',
        '    count(input.spans) > 0',
        '    input.spans[_].semantic_type == "llm_gen_ai"',
        '}',
      ].join('\n'),
      input: {},
      trust_impact: 'none',
    }),
    event,
    pollRequest: {
      workflow_id: event.workflow_id,
      run_id: event.run_id,
      activity_id: event.activity_id!,
    },
    expected: {
      verdict: 'require_approval',
      action: 'require_approval',
      reason,
    },
  };
}

export interface ApprovalExpirationConformanceCase extends RequireApprovalPolicyConformanceCase {
  scenarioId: string;
  expected: RequireApprovalPolicyConformanceCase['expected'] & {
    expiredStatus: 'expired';
    expiredCount: number;
  };
}

export function makeApprovalExpirationConformanceCase(): ApprovalExpirationConformanceCase {
  const base = makeRequireApprovalPolicyConformanceCase();
  return {
    ...base,
    scenarioId: requireLocalStackScenarioId('approval-expired-timeout'),
    expected: {
      ...base.expected,
      expiredStatus: 'expired',
      expiredCount: 1,
    },
  };
}

type OpaMatrixDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'BLOCK' | 'HALT';
type OpaAliasDecision = 'continue' | 'stop' | 'require-approval';

const OPA_DECISION_ORDER = [
  'ALLOW',
  'REQUIRE_APPROVAL',
  'BLOCK',
  'HALT',
] as const satisfies readonly OpaMatrixDecision[];

const OPA_SUPPORTED_DECISIONS = OPA_DECISION_ORDER.filter((decision) =>
  CANONICAL_VERDICT_ARMS.has(opaDecisionToVerdict(decision)),
);

if (
  OPA_SUPPORTED_DECISIONS.length !==
    [...CANONICAL_VERDICT_ARMS].filter((verdict) => verdict !== 'constrain').length
) {
  throw new Error('OPA decision matrix is out of sync with generated Core verdict arms');
}

interface OpaGovernedSurface {
  scenarioId: string;
  label: string;
  activityType: string;
  semanticType: string;
  activityInput: Record<string, unknown>;
}

const OPA_GOVERNED_SURFACES = [
  {
    scenarioId: 'behavior-db-query',
    label: 'db query database_query',
    activityType: 'DatabaseQuery',
    semanticType: 'database_query',
    activityInput: { query: 'SELECT 1', db_system: 'postgresql', db_operation: 'QUERY' },
  },
  {
    scenarioId: 'behavior-db-query',
    label: 'db select database_select',
    activityType: 'DatabaseQuery',
    semanticType: 'database_select',
    activityInput: { query: 'SELECT * FROM accounts', db_system: 'postgresql', db_operation: 'SELECT' },
  },
  {
    scenarioId: 'behavior-db-query',
    label: 'db insert database_insert',
    activityType: 'DatabaseQuery',
    semanticType: 'database_insert',
    activityInput: { query: 'INSERT INTO accounts(id) VALUES (1)', db_system: 'postgresql', db_operation: 'INSERT' },
  },
  {
    scenarioId: 'behavior-db-query',
    label: 'db update database_update',
    activityType: 'DatabaseQuery',
    semanticType: 'database_update',
    activityInput: { query: 'UPDATE accounts SET status = active', db_system: 'postgresql', db_operation: 'UPDATE' },
  },
  {
    scenarioId: 'behavior-db-query',
    label: 'db delete database_delete',
    activityType: 'DatabaseQuery',
    semanticType: 'database_delete',
    activityInput: { query: 'DELETE FROM accounts WHERE id = 1', db_system: 'postgresql', db_operation: 'DELETE' },
  },
  {
    scenarioId: 'behavior-mcp',
    label: 'mcp_tool_call',
    activityType: 'MCPToolCall',
    semanticType: 'mcp_tool_call',
    activityInput: { tool: 'check_governance', arguments: {} },
  },
  {
    scenarioId: 'behavior-http',
    label: 'http GET http_get',
    activityType: 'HTTPRequest',
    semanticType: 'http_get',
    activityInput: { method: 'GET', url: 'https://example.com/openbox-get' },
  },
  {
    scenarioId: 'behavior-http',
    label: 'http POST http_post',
    activityType: 'HTTPRequest',
    semanticType: 'http_post',
    activityInput: { method: 'POST', url: 'https://example.com/openbox-post' },
  },
  {
    scenarioId: 'behavior-http',
    label: 'http PUT http_put',
    activityType: 'HTTPRequest',
    semanticType: 'http_put',
    activityInput: { method: 'PUT', url: 'https://example.com/openbox-put' },
  },
  {
    scenarioId: 'behavior-http',
    label: 'http PATCH http_patch',
    activityType: 'HTTPRequest',
    semanticType: 'http_patch',
    activityInput: { method: 'PATCH', url: 'https://example.com/openbox-patch' },
  },
  {
    scenarioId: 'behavior-http',
    label: 'http DELETE http_delete',
    activityType: 'HTTPRequest',
    semanticType: 'http_delete',
    activityInput: { method: 'DELETE', url: 'https://example.com/openbox-delete' },
  },
  {
    scenarioId: 'behavior-http',
    label: 'http generic http',
    activityType: 'HTTPRequest',
    semanticType: 'http',
    activityInput: { method: 'GET', url: 'https://example.com/openbox-generic' },
  },
  {
    scenarioId: 'behavior-llm',
    label: 'llm_gen_ai e2e-approve-llm',
    activityType: 'LLMGeneration',
    semanticType: 'llm_gen_ai',
    activityInput: {
      prompt: 'e2e-approve-llm prompt',
      model: 'openbox-sdk-local',
    },
  },
  {
    scenarioId: 'behavior-llm',
    label: 'llm_completion e2e-approve-llm',
    activityType: 'LLMCompletion',
    semanticType: 'llm_completion',
    activityInput: {
      completion: 'e2e-approve-llm completion',
      model: 'openbox-sdk-local',
    },
  },
  {
    scenarioId: 'behavior-llm',
    label: 'llm embedding llm_embedding e2e-approve-llm',
    activityType: 'LLMGeneration',
    semanticType: 'llm_embedding',
    activityInput: {
      prompt: 'e2e-approve-llm embedding prompt',
      model: 'openbox-sdk-local',
    },
  },
  {
    scenarioId: 'behavior-tool-call',
    label: 'llm_tool_call',
    activityType: 'ToolCall',
    semanticType: 'llm_tool_call',
    activityInput: { tool: 'sdk-conformance-approval-tool', arguments: {} },
  },
  {
    scenarioId: 'behavior-file-read',
    label: 'file_read',
    activityType: 'FileRead',
    semanticType: 'file_read',
    activityInput: { file_path: '/tmp/openbox-sdk-readme.md' },
  },
  {
    scenarioId: 'behavior-file-read',
    label: 'file open file_open',
    activityType: 'FileRead',
    semanticType: 'file_open',
    activityInput: { file_path: '/tmp/openbox-sdk-open.md' },
  },
  {
    scenarioId: 'behavior-file-write',
    label: 'file_write',
    activityType: 'FileEdit',
    semanticType: 'file_write',
    activityInput: { file_path: '/tmp/openbox-sdk-blocked.txt', content: 'blocked' },
  },
  {
    scenarioId: 'behavior-file-write',
    label: 'file delete file_delete',
    activityType: 'FileDelete',
    semanticType: 'file_delete',
    activityInput: { file_path: '/tmp/openbox-sdk-delete.txt' },
  },
  {
    scenarioId: 'behavior-shell',
    label: 'shell',
    activityType: 'ShellExecution',
    semanticType: 'internal',
    activityInput: { command: 'echo blocked' },
  },
] as const satisfies readonly OpaGovernedSurface[];

export interface OpaVerdictMatrixCase {
  scenarioId: string;
  name: string;
  decision: OpaMatrixDecision | OpaAliasDecision;
  activityType: string;
  semanticType: string;
  activityInput: Record<string, unknown>;
  expected: {
    verdict: Verdict;
    action: LegacyAction;
    reason?: string;
  };
  event: GovernanceEventPayload;
}

export interface OpaVerdictMatrixConformanceCase {
  createPolicyOperationId: 'AgentController_createPolicy';
  evaluateOperationId: 'evaluateGovernance';
  policyBody: CreatePolicyDto;
  cases: OpaVerdictMatrixCase[];
}

export interface OpaAliasDecisionConformanceCase {
  scenarioId: string;
  createPolicyOperationId: 'AgentController_createPolicy';
  evaluateOperationId: 'evaluateGovernance';
  policyBody: CreatePolicyDto;
  cases: OpaVerdictMatrixCase[];
}

export interface OpaUnsupportedConstrainConformanceCase {
  scenarioId: string;
  createPolicyOperationId: 'AgentController_createPolicy';
  evaluateOperationId: 'evaluateGovernance';
  policyBody: CreatePolicyDto;
  event: GovernanceEventPayload;
  expected: {
    verdict: Extract<Verdict, 'allow'>;
    action: Extract<LegacyAction, 'allow'>;
    reason: string;
  };
}

export interface OpaUnavailableFailClosedConformanceCase {
  scenarioId: string;
  createPolicyOperationId: 'AgentController_createPolicy';
  evaluateOperationId: 'evaluateGovernance';
  policyBody: CreatePolicyDto;
  event: GovernanceEventPayload;
  expected: {
    availableVerdict: Extract<Verdict, 'block'>;
    availableAction: Extract<LegacyAction, 'block'>;
    unavailableVerdict: Extract<Verdict, 'halt'>;
    unavailableAction: Extract<LegacyAction, 'halt'>;
    unavailableReason: string;
  };
}

export interface GoalDriftDetectedConformanceCase {
  scenarioId: string;
  recentDriftsOperationId: 'AgentController_getRecentDriftEvents';
  driftLogsOperationId: 'AgentController_getDriftEvents';
  trendOperationId: 'AgentController_getGoalAlignmentTrend';
  sessionStatsOperationId: 'AgentController_getSessionGoalAlignmentStats';
  seed: {
    workflowType: string;
    taskQueue: string;
    activityId: string;
    activityType: string;
    semanticType: string;
    reason: string;
    alignmentPercentage: number;
  };
  expected: {
    goalDrifted: true;
    driftedCount: number;
    totalDrifted: number;
    alignmentPercentage: number;
  };
}

export function makeGoalDriftDetectedConformanceCase(): GoalDriftDetectedConformanceCase {
  return {
    scenarioId: requireLocalStackScenarioId('goal-drift-detected'),
    recentDriftsOperationId: 'AgentController_getRecentDriftEvents',
    driftLogsOperationId: 'AgentController_getDriftEvents',
    trendOperationId: 'AgentController_getGoalAlignmentTrend',
    sessionStatsOperationId: 'AgentController_getSessionGoalAlignmentStats',
    seed: {
      workflowType: 'sdk-conformance',
      taskQueue: 'local-stack',
      activityId: 'goal-drift-detected',
      activityType: 'LLMCompletion',
      semanticType: 'llm_gen_ai',
      reason: 'goal_drifted: true',
      alignmentPercentage: 42,
    },
    expected: {
      goalDrifted: true,
      driftedCount: 1,
      totalDrifted: 1,
      alignmentPercentage: 42,
    },
  };
}

const LOCAL_STACK_SCENARIO_IDS = new Set<string>(
  LOCAL_STACK_SCENARIO_PATHS.map((entry) => entry.id),
);

function requireLocalStackScenarioId(id: string): string {
  if (!LOCAL_STACK_SCENARIO_IDS.has(id)) {
    throw new Error(`Missing generated local-stack scenario path: ${id}`);
  }
  return id;
}

function makeConformanceSpan(
  semanticType: string,
  name: string,
  attributes: Record<string, unknown> = {},
): SpanData {
  const now = Date.now();
  return {
    span_id: `span-${ts()}`,
    trace_id: `trace-${ts()}`,
    name,
    kind: 'CLIENT',
    start_time: now,
    end_time: now + 5,
    semantic_type: semanticType,
    stage: 'started',
    status: {
      code: 'OK',
    },
    attributes: {
      'openbox.conformance': true,
      'openbox.semantic_type': semanticType,
      ...attributes,
    },
  };
}

function makeOpaMatrixEvent(
  activityType: string,
  activityInput: Record<string, unknown>,
  span: SpanData,
): GovernanceEventPayload {
  return makeGovernanceEvent({
    activity_type: activityType,
    activity_input: [activityInput],
    span_count: 1,
    spans: [span],
  }) as GovernanceEventPayload;
}

function opaMatrixReason(decision: OpaMatrixDecision, label: string): string {
  return `SDK conformance OPA ${decision.toLowerCase()} ${label}`;
}

function opaDecisionToVerdict(decision: OpaMatrixDecision): Exclude<Verdict, 'constrain'> {
  return decision.toLowerCase() as Exclude<Verdict, 'constrain'>;
}

function matrixCaseId(decision: OpaMatrixDecision | OpaAliasDecision, surface: OpaGovernedSurface): string {
  return `${decision}:${surface.semanticType}`;
}

export function makeOpaVerdictMatrixConformanceCase(): OpaVerdictMatrixConformanceCase {
  const cases = OPA_SUPPORTED_DECISIONS.flatMap((decision) =>
    OPA_GOVERNED_SURFACES.map((surface) => {
      const reason = opaMatrixReason(decision, surface.semanticType);
      const activityInput = {
        ...surface.activityInput,
        matrix_case: matrixCaseId(decision, surface),
      };
      return {
        scenarioId: requireLocalStackScenarioId(
          decision === 'ALLOW'
            ? 'opa-allow'
            : decision === 'REQUIRE_APPROVAL'
              ? 'opa-require-approval'
              : decision === 'BLOCK'
                ? 'opa-block'
                : 'opa-halt',
        ),
        name: `${decision} ${surface.label} path`,
        decision,
        activityType: surface.activityType,
        semanticType: surface.semanticType,
        activityInput,
        expected: {
          verdict: opaDecisionToVerdict(decision),
          action: opaDecisionToVerdict(decision),
          reason,
        },
        event: makeOpaMatrixEvent(
          surface.activityType,
          activityInput,
          makeConformanceSpan(surface.semanticType, `${decision} ${surface.label} path`, {
            'openbox.matrix.scenario_id': requireLocalStackScenarioId(surface.scenarioId),
            'openbox.matrix.decision': decision,
            'openbox.matrix.case': matrixCaseId(decision, surface),
          }),
        ),
      };
    }),
  );

  const typedCases = cases.map((entry) => {
    return {
      ...entry,
    };
  });

  const ruleBodies = typedCases
    .map((entry) => [
      `result := {"decision": "${entry.decision}", "reason": ${JSON.stringify(entry.expected.reason)}} if {`,
      `    input.activity_input[_].matrix_case == ${JSON.stringify(entry.activityInput.matrix_case)}`,
      '}',
    ].join('\n'));

  return {
    createPolicyOperationId: 'AgentController_createPolicy',
    evaluateOperationId: 'evaluateGovernance',
    policyBody: makeCreatePolicyDto({
      name: `test-policy-opa-verdict-matrix-${ts()}`,
      description: 'E2E conformance policy for OPA ALLOW/REQUIRE_APPROVAL/BLOCK/HALT verdicts',
      rego_code: [
        'package openbox.policy',
        `default result = {"decision": "ALLOW", "reason": ${JSON.stringify(opaMatrixReason('ALLOW', 'default'))}}`,
        '',
        ...ruleBodies,
      ].join('\n\n'),
      input: {},
      trust_impact: 'none',
    }),
    cases: typedCases,
  };
}

export function makeOpaAliasDecisionConformanceCase(): OpaAliasDecisionConformanceCase {
  const cases = [
    {
      scenarioId: requireLocalStackScenarioId('opa-allow'),
      name: 'legacy continue alias allows database path',
      decision: 'continue' as const,
      activityType: 'DatabaseQuery',
      semanticType: 'database_query',
      activityInput: { query: 'SELECT 1', db_system: 'postgresql', alias: 'continue' },
      expected: { verdict: 'allow' as const, action: 'allow' as const },
    },
    {
      scenarioId: requireLocalStackScenarioId('opa-halt'),
      name: 'legacy stop alias halts file write path',
      decision: 'stop' as const,
      activityType: 'FileEdit',
      semanticType: 'file_write',
      activityInput: { file_path: '/tmp/openbox-sdk-stop-alias.txt', content: 'halted' },
      expected: { verdict: 'halt' as const, action: 'halt' as const },
    },
    {
      scenarioId: requireLocalStackScenarioId('opa-require-approval'),
      name: 'hyphenated require-approval alias requires approval',
      decision: 'require-approval' as const,
      activityType: 'FileRead',
      semanticType: 'file_read',
      activityInput: { file_path: '/tmp/openbox-sdk-require-approval-alias.md' },
      expected: { verdict: 'require_approval' as const, action: 'require_approval' as const },
    },
  ].map((entry) => {
    const reason = `SDK conformance OPA alias ${entry.decision}`;
    return {
      ...entry,
      expected: {
        ...entry.expected,
        reason,
      },
      event: makeOpaMatrixEvent(
        entry.activityType,
        entry.activityInput,
        makeConformanceSpan(entry.semanticType, entry.name, {
          'openbox.matrix.scenario_id': entry.scenarioId,
          'openbox.matrix.decision': entry.decision,
        }),
      ),
    };
  });

  const ruleBodies = cases
    .map((entry) => [
      `result := {"decision": "${entry.decision}", "reason": ${JSON.stringify(entry.expected.reason)}} if {`,
      `    input.activity_type == ${JSON.stringify(entry.activityType)}`,
      '}',
    ].join('\n'));

  return {
    scenarioId: requireLocalStackScenarioId('opa-decision-aliases'),
    createPolicyOperationId: 'AgentController_createPolicy',
    evaluateOperationId: 'evaluateGovernance',
    policyBody: makeCreatePolicyDto({
      name: `test-policy-opa-alias-decision-${ts()}`,
      description: 'E2E conformance policy for OPA legacy decision aliases',
      rego_code: [
        'package openbox.policy',
        `default result = {"decision": "ALLOW", "reason": ${JSON.stringify(opaMatrixReason('ALLOW', 'default'))}}`,
        '',
        ...ruleBodies,
      ].join('\n\n'),
      input: {},
      trust_impact: 'none',
    }),
    cases,
  };
}

export function makeOpaUnsupportedConstrainConformanceCase(): OpaUnsupportedConstrainConformanceCase {
  const reason = 'SDK conformance unsupported OPA CONSTRAIN boundary';
  return {
    scenarioId: requireLocalStackScenarioId('opa-constrain'),
    createPolicyOperationId: 'AgentController_createPolicy',
    evaluateOperationId: 'evaluateGovernance',
    policyBody: makeCreatePolicyDto({
      name: `test-policy-opa-constrain-boundary-${ts()}`,
      description: 'E2E conformance policy proving unsupported OPA CONSTRAIN behavior',
      rego_code: [
        'package openbox.policy',
        'default result = {"decision": "ALLOW", "reason": null}',
        `result := {"decision": "CONSTRAIN", "reason": ${JSON.stringify(reason)}} if {`,
        '    input.activity_type == "DatabaseQuery"',
        '}',
      ].join('\n'),
      input: {},
      trust_impact: 'none',
    }),
    event: makeOpaMatrixEvent(
      'DatabaseQuery',
      { query: 'SELECT constrain_boundary', db_system: 'postgresql' },
      makeConformanceSpan('database_query', 'OPA unsupported CONSTRAIN boundary', {
        'openbox.matrix.scenario_id': requireLocalStackScenarioId('opa-constrain'),
        'openbox.matrix.decision': 'CONSTRAIN',
      }),
    ),
    expected: {
      verdict: 'allow',
      action: 'allow',
      reason,
    },
  };
}

export function makeOpaUnavailableFailClosedConformanceCase(): OpaUnavailableFailClosedConformanceCase {
  const reason = 'active policy should block';
  const event = makeOpaMatrixEvent(
    'DatabaseQuery',
    { query: 'SELECT secret FROM blocked' },
    makeConformanceSpan('database_query', 'OPA unavailable active-policy probe', {
      'openbox.matrix.scenario_id': requireLocalStackScenarioId('opa-unavailable-fail-closed'),
      'openbox.matrix.decision': 'OPA_UNAVAILABLE',
    }),
  );

  return {
    scenarioId: requireLocalStackScenarioId('opa-unavailable-fail-closed'),
    createPolicyOperationId: 'AgentController_createPolicy',
    evaluateOperationId: 'evaluateGovernance',
    policyBody: makeCreatePolicyDto({
      name: `test-policy-opa-unavailable-${ts()}`,
      description: 'E2E conformance policy proving OPA unavailable fail-closed behavior',
      rego_code: [
        'package openbox.policy',
        'default result = {"decision": "ALLOW", "reason": null}',
        `result := {"decision": "BLOCK", "reason": ${JSON.stringify(reason)}} if {`,
        '    input.activity_type == "DatabaseQuery"',
        '}',
      ].join('\n'),
      input: {},
      trust_impact: 'none',
    }),
    event,
    expected: {
      availableVerdict: 'block',
      availableAction: 'block',
      unavailableVerdict: 'halt',
      unavailableAction: 'halt',
      unavailableReason: 'OPA unavailable - fail-closed security policy applied',
    },
  };
}

export interface GuardrailRunTestConformanceCase {
  scenarioId: string;
  name: string;
  request: TestGuardrailDto;
  expected: {
    validationPassed: boolean;
    fieldStatus: 'allowed' | 'blocked' | 'redacted' | 'transformed' | 'skipped';
    redactedInput?: Record<string, unknown>;
    reasonIncludes?: string;
  };
}

export function makeGuardrailRunTestConformanceCases(): GuardrailRunTestConformanceCase[] {
  return [
    {
      scenarioId: requireLocalStackScenarioId('guardrail-allow'),
      name: 'allowed safe text',
      request: {
        guardrail_type: 'pii_detection',
        params: {},
        settings: {},
        logs: { text: 'safe support request' },
      },
      expected: {
        validationPassed: true,
        fieldStatus: 'allowed',
      },
    },
    {
      scenarioId: requireLocalStackScenarioId('guardrail-block'),
      name: 'blocked banned text',
      request: {
        guardrail_type: 'pii_detection',
        params: {},
        settings: {},
        logs: { text: 'please BLOCK_ME before continuing' },
      },
      expected: {
        validationPassed: false,
        fieldStatus: 'blocked',
        reasonIncludes: 'BLOCK_ME',
      },
    },
    {
      scenarioId: requireLocalStackScenarioId('guardrail-redact'),
      name: 'redacted email text',
      request: {
        guardrail_type: 'pii_detection',
        params: {},
        settings: {},
        logs: { text: 'contact user@example.com for the ticket' },
      },
      expected: {
        validationPassed: true,
        fieldStatus: 'redacted',
        redactedInput: { text: 'contact [redacted-email] for the ticket' },
      },
    },
    {
      scenarioId: requireLocalStackScenarioId('guardrail-redact'),
      name: 'transformed structured text',
      request: {
        guardrail_type: 'pii_detection',
        params: {},
        settings: {},
        logs: { text: 'please TRANSFORM_ME before returning' },
      },
      expected: {
        validationPassed: true,
        fieldStatus: 'transformed',
        redactedInput: { text: 'please transformed-value before returning' },
      },
    },
    {
      scenarioId: requireLocalStackScenarioId('guardrail-allow'),
      name: 'skipped nonmatching text',
      request: {
        guardrail_type: 'pii_detection',
        params: {},
        settings: { skip: true },
        logs: { text: 'please SKIP_ME because this field is out of scope' },
      },
      expected: {
        validationPassed: true,
        fieldStatus: 'skipped',
        reasonIncludes: 'out of scope',
      },
    },
  ];
}

export interface GuardrailServiceUnavailableConformanceCase {
  scenarioId: string;
  request: TestGuardrailDto;
  expected: {
    status: number;
    messageIncludes: string;
  };
}

export function makeGuardrailServiceUnavailableConformanceCase(): GuardrailServiceUnavailableConformanceCase {
  return {
    scenarioId: requireLocalStackScenarioId('guardrail-service-unavailable-fail-closed'),
    request: {
      guardrail_type: 'pii_detection',
      params: {},
      settings: {},
      logs: { text: 'guardrail service unavailable probe' },
    },
    expected: {
      status: 500,
      messageIncludes: 'Guardrails test execution failed',
    },
  };
}

export interface GoalSignalOrderConformanceCase {
  scenarioIds: {
    order: string;
    alignmentChecked: string;
    fallback: string;
  };
  evaluateOperationId: 'evaluateGovernance';
  goalSignalEvent: GovernanceEventPayload;
  firstGovernedEvent: GovernanceEventPayload;
  expected: {
    firstEventType: string;
    firstGovernedSurface: string;
    fallbackUsed: boolean;
    goalAlignmentChecked: boolean;
    goalDrifted: boolean;
  };
}

export function makeGoalSignalOrderConformanceCase(): GoalSignalOrderConformanceCase {
  const workflowId = `goal-order-wf-${ts()}`;
  const runId = `goal-order-run-${ts()}`;
  return {
    scenarioIds: {
      order: requireLocalStackScenarioId('behavior-order-goal-before-action'),
      alignmentChecked: requireLocalStackScenarioId('goal-alignment-checked'),
      fallback: requireLocalStackScenarioId('goal-drift-fallback'),
    },
    evaluateOperationId: 'evaluateGovernance',
    goalSignalEvent: makeGovernanceEvent({
      event_type: CANONICAL_EVENT_TYPE.SIGNAL_RECEIVED,
      workflow_id: workflowId,
      run_id: runId,
      activity_id: 'goal-signal',
      activity_type: 'GoalSignal',
      signal_name: 'openbox_goal',
      signal_args: [
        {
          goal: 'Complete the approved OpenBox local-stack conformance goal before actions.',
        },
      ],
      activity_input: [
        {
          goal: 'Complete the approved OpenBox local-stack conformance goal before actions.',
        },
      ],
    }) as GovernanceEventPayload,
    firstGovernedEvent: makeGovernanceEvent({
      workflow_id: workflowId,
      run_id: runId,
      activity_id: 'first-governed-action',
      activity_type: 'LLMCompletion',
      activity_input: [
        {
          prompt: 'Summarize the approved local-stack conformance objective.',
          model: 'openbox-sdk-local',
        },
      ],
      span_count: 1,
      spans: [
        makeConformanceSpan('llm_gen_ai', 'first-governed-llm', {
          'openbox.source': 'openbox-sdk-e2e',
          'openbox.goal_signal_order': 'after-signal',
        }),
      ],
    }) as GovernanceEventPayload,
    expected: {
      firstEventType: CANONICAL_EVENT_TYPE.SIGNAL_RECEIVED,
      firstGovernedSurface: 'LLMCompletion',
      fallbackUsed: true,
      goalAlignmentChecked: false,
      goalDrifted: false,
    },
  };
}

export function makeCreateBehaviorRuleDto(overrides: Record<string, any> = {}) {
  return {
    rule_name: `test-rule-${ts()}`,
    description: 'E2E test behavior rule',
    priority: 50,
    trigger: 'http_post',
    states: ['http_get'],
    time_window: 300,
    verdict: 3, // BLOCK
    reject_message: 'Blocked by E2E test rule',
    trust_impact: 'low',
    ...overrides,
  };
}

export function makeUpdateAgentDto(overrides: Record<string, any> = {}) {
  return {
    description: `Updated by E2E test at ${new Date().toISOString()}`,
    ...overrides,
  };
}

export function makeGovernanceEvent(overrides: Record<string, any> = {}) {
  return {
    event_type: CANONICAL_EVENT_TYPE.ACTIVITY_STARTED,
    workflow_id: `test-wf-${ts()}`,
    workflow_type: 'e2e-test',
    run_id: `test-run-${ts()}`,
    activity_id: `act-${ts()}`,
    activity_type: 'tool_call',
    activity_input: [{ tool: 'web_search', args: { query: 'test' } }],
    source: 'workflow-telemetry',
    task_queue: 'temporal',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

export function makeUpdateAivssConfigDto(overrides: Record<string, any> = {}) {
  return {
    aivss_config: {
      base_security: {
        attack_vector: 3,
        attack_complexity: 2,
        privileges_required: 2,
        user_interaction: 1,
        scope: 1,
      },
      ai_specific: {
        model_robustness: 3,
        data_sensitivity: 3,
        ethical_impact: 2,
        decision_criticality: 2,
        adaptability: 3,
      },
      impact: {
        confidentiality_impact: 3,
        integrity_impact: 2,
        availability_impact: 2,
        safety_impact: 1,
      },
    },
    reason: 'E2E test reconfiguration',
    ...overrides,
  };
}

export function makeGoalAlignmentConfigDto(overrides: Record<string, any> = {}) {
  return {
    alignment_threshold: 70,
    llama_firewall_model: 'gpt-4o-mini',
    drift_detection_action: 'alert_only',
    evaluation_frequency: 'every_action',
    ...overrides,
  };
}
