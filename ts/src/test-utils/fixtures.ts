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

import { randomUUID } from 'node:crypto';
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
import {
  LOCAL_STACK_SCENARIO_PATHS,
  OPA_ALIAS_DECISION_CASES,
  OPA_DECISION_SCENARIOS,
  OPA_EVALUATION_MATRIX,
  OPA_GOVERNED_SURFACES,
} from '../governance/capability-matrix.js';
import type { components } from '../types/generated/backend.js';

type CreateGuardrailDto = components['schemas']['CreateGuardrailDto'];
type CreatePolicyDto = components['schemas']['CreatePolicyDto'];
type EvaluateRegoDto = components['schemas']['EvaluateRegoDto'];
type TestGuardrailDto = components['schemas']['TestGuardrailDto'];

let counter = 0;
const ts = () =>
  `${Date.now().toString(36)}${process.pid.toString(36)}${(counter++).toString(36)}${randomUUID().slice(0, 8)}`;

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

type OpaMatrixDecision = (typeof OPA_DECISION_SCENARIOS)[number]['decision'];
type OpaAliasDecision = (typeof OPA_ALIAS_DECISION_CASES)[number]['decision'];
type OpaGovernedSurface = (typeof OPA_GOVERNED_SURFACES)[number];
type OpaCanonicalAction = Extract<LegacyAction, Verdict>;

const REQUIRED_OPA_VERDICTS = [...CANONICAL_VERDICT_ARMS]
  .filter((verdict): verdict is Exclude<Verdict, 'constrain'> => verdict !== 'constrain')
  .sort((left, right) => left.localeCompare(right));
const GENERATED_OPA_VERDICTS = OPA_DECISION_SCENARIOS
  .map((entry) => generatedOpaVerdict(entry.expectedVerdict, `${entry.decision}.expectedVerdict`))
  .sort((left, right) => left.localeCompare(right));

if (
  REQUIRED_OPA_VERDICTS.length !== GENERATED_OPA_VERDICTS.length ||
  REQUIRED_OPA_VERDICTS.some((verdict, index) => verdict !== GENERATED_OPA_VERDICTS[index])
) {
  throw new Error('Spec-generated OPA decision matrix is out of sync with generated Core verdict arms');
}

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

function generatedOpaVerdict<T extends Verdict>(value: T, label: string): T {
  if (!CANONICAL_VERDICT_ARMS.has(value)) {
    throw new Error(`Invalid spec-generated OPA verdict for ${label}: ${value}`);
  }
  return value;
}

function generatedOpaLegacyAction<T extends OpaCanonicalAction>(value: T, label: string): T {
  const raw = String(value);
  if (
    raw === 'continue' ||
    raw === 'stop' ||
    !CANONICAL_VERDICT_ARMS.has(value)
  ) {
    throw new Error(`Invalid spec-generated OPA legacy action for ${label}: ${value}`);
  }
  return value;
}

function matrixCaseId(decision: OpaMatrixDecision | OpaAliasDecision, surface: OpaGovernedSurface): string {
  return `${decision}:${surface.semanticType}`;
}

export function makeOpaVerdictMatrixConformanceCase(): OpaVerdictMatrixConformanceCase {
  const cases: OpaVerdictMatrixCase[] = OPA_DECISION_SCENARIOS.flatMap((decisionSpec) =>
    OPA_GOVERNED_SURFACES.map((surface) => {
      const decision = decisionSpec.decision;
      const reason = opaMatrixReason(decision, surface.semanticType);
      const activityInput = {
        ...surface.activityInput,
        matrix_case: matrixCaseId(decision, surface),
      };
      return {
        scenarioId: requireLocalStackScenarioId(decisionSpec.scenarioId),
        name: `${decision} ${surface.label} path`,
        decision,
        activityType: surface.activityType,
        semanticType: surface.semanticType,
        activityInput,
        expected: {
          verdict: generatedOpaVerdict(
            decisionSpec.expectedVerdict,
            `${decision}.expectedVerdict`,
          ),
          action: generatedOpaLegacyAction(
            decisionSpec.expectedAction,
            `${decision}.expectedAction`,
          ),
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

  const ruleBodies = cases
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
        `default result = {"decision": "ALLOW", "reason": ${JSON.stringify(OPA_EVALUATION_MATRIX.defaultAllowReason)}}`,
        '',
        ...ruleBodies,
      ].join('\n\n'),
      input: {},
      trust_impact: 'none',
    }),
    cases,
  };
}

export function makeOpaAliasDecisionConformanceCase(): OpaAliasDecisionConformanceCase {
  const cases: OpaVerdictMatrixCase[] = OPA_ALIAS_DECISION_CASES.map((entry) => {
    const reason = `SDK conformance OPA alias ${entry.decision}`;
    const scenarioId = requireLocalStackScenarioId(entry.scenarioId);
    const activityInput = { ...entry.activityInput };
    return {
      scenarioId,
      name: entry.name,
      decision: entry.decision,
      activityType: entry.activityType,
      semanticType: entry.semanticType,
      activityInput,
      expected: {
        verdict: generatedOpaVerdict(
          entry.expectedVerdict,
          `${entry.decision}.expectedVerdict`,
        ),
        action: generatedOpaLegacyAction(
          entry.expectedAction,
          `${entry.decision}.expectedAction`,
        ),
        reason,
      },
      event: makeOpaMatrixEvent(
        entry.activityType,
        activityInput,
        makeConformanceSpan(entry.semanticType, entry.name, {
          'openbox.matrix.scenario_id': scenarioId,
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
        `default result = {"decision": "ALLOW", "reason": ${JSON.stringify(OPA_EVALUATION_MATRIX.defaultAllowReason)}}`,
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
  const spec = OPA_EVALUATION_MATRIX.unsupportedConstrain;
  const scenarioId = requireLocalStackScenarioId(spec.scenarioId);
  const reason = spec.reason;
  const activityInput = { ...spec.activityInput };
  return {
    scenarioId,
    createPolicyOperationId: 'AgentController_createPolicy',
    evaluateOperationId: 'evaluateGovernance',
    policyBody: makeCreatePolicyDto({
      name: `test-policy-opa-constrain-boundary-${ts()}`,
      description: 'E2E conformance policy proving OPA CONSTRAIN propagation',
      rego_code: [
        'package openbox.policy',
        'default result = {"decision": "ALLOW", "reason": null}',
        `result := {"decision": "CONSTRAIN", "reason": ${JSON.stringify(reason)}} if {`,
        `    input.activity_type == ${JSON.stringify(spec.activityType)}`,
        '}',
      ].join('\n'),
      input: {},
      trust_impact: 'none',
    }),
    event: makeOpaMatrixEvent(
      spec.activityType,
      activityInput,
      makeConformanceSpan(spec.semanticType, 'OPA CONSTRAIN propagation boundary', {
        'openbox.matrix.scenario_id': scenarioId,
        'openbox.matrix.decision': 'CONSTRAIN',
      }),
    ),
    expected: {
      verdict: generatedOpaVerdict(spec.expectedVerdict, `${spec.scenarioId}.expectedVerdict`),
      action: generatedOpaLegacyAction(spec.expectedAction, `${spec.scenarioId}.expectedAction`),
      reason,
    },
  };
}

export function makeOpaUnavailableFailClosedConformanceCase(): OpaUnavailableFailClosedConformanceCase {
  const spec = OPA_EVALUATION_MATRIX.unavailableFailClosed;
  const scenarioId = requireLocalStackScenarioId(spec.scenarioId);
  const reason = spec.policyReason;
  const activityInput = { ...spec.activityInput };
  const event = makeOpaMatrixEvent(
    spec.activityType,
    activityInput,
    makeConformanceSpan(spec.semanticType, 'OPA unavailable active-policy probe', {
      'openbox.matrix.scenario_id': scenarioId,
      'openbox.matrix.decision': 'OPA_UNAVAILABLE',
    }),
  );

  return {
    scenarioId,
    createPolicyOperationId: 'AgentController_createPolicy',
    evaluateOperationId: 'evaluateGovernance',
    policyBody: makeCreatePolicyDto({
      name: `test-policy-opa-unavailable-${ts()}`,
      description: 'E2E conformance policy proving OPA unavailable fail-closed behavior',
      rego_code: [
        'package openbox.policy',
        'default result = {"decision": "ALLOW", "reason": null}',
        `result := {"decision": "BLOCK", "reason": ${JSON.stringify(reason)}} if {`,
        `    input.activity_type == ${JSON.stringify(spec.activityType)}`,
        '}',
      ].join('\n'),
      input: {},
      trust_impact: 'none',
    }),
    event,
    expected: {
      availableVerdict: generatedOpaVerdict(
        spec.availableVerdict,
        `${spec.scenarioId}.availableVerdict`,
      ),
      availableAction: generatedOpaLegacyAction(
        spec.availableAction,
        `${spec.scenarioId}.availableAction`,
      ),
      unavailableVerdict: generatedOpaVerdict(
        spec.unavailableVerdict,
        `${spec.scenarioId}.unavailableVerdict`,
      ),
      unavailableAction: generatedOpaLegacyAction(
        spec.unavailableAction,
        `${spec.scenarioId}.unavailableAction`,
      ),
      unavailableReason: spec.unavailableReason,
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
    ageUnavailable: string;
  };
  evaluateOperationId: 'evaluateGovernance';
  goalSignalEvent: GovernanceEventPayload;
  firstGovernedEvent: GovernanceEventPayload;
  expected: {
    firstEventType: string;
    firstGovernedSurface: string;
    governanceChecksIncomplete: boolean;
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
      ageUnavailable: requireLocalStackScenarioId('goal-drift-unavailable-fail-closed'),
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
      governanceChecksIncomplete: false,
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
