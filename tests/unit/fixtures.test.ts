import { describe, it, expect } from 'vitest';
import {
  makeApprovalExpirationConformanceCase,
  makeCreateAgentDto,
  makeCreateGuardrailDto,
  makeCreatePolicyDto,
  makeEvaluateRegoConformanceCase,
  makeGoalDriftDetectedConformanceCase,
  makeGoalSignalOrderConformanceCase,
  makeGuardrailRunTestConformanceCases,
  makeGuardrailServiceUnavailableConformanceCase,
  makeOpaAliasDecisionConformanceCase,
  makeOpaUnsupportedConstrainConformanceCase,
  makeOpaUnavailableFailClosedConformanceCase,
  makeOpaVerdictMatrixConformanceCase,
  makeRequireApprovalPolicyConformanceCase,
  makeCreateBehaviorRuleDto,
  makeGovernanceEvent,
  makeUpdateAivssConfigDto,
  makeGoalAlignmentConfigDto,
} from '../helpers/fixtures';
import type { components } from '../../ts/src/types/generated/backend';
import type {
  ApprovalStatusRequest,
  GovernanceEventPayload,
  SpanData,
} from '../../ts/src/core-client';
import {
  GOVERNANCE_SPEC_DOMAINS,
  GOVERNANCE_SPEC_DOMAIN_PROVENANCE,
  untrackedFiniteTypeSpecDomains,
} from '../helpers/governance-spec-domains';
import { GOVERNANCE_BOUNDARY_DOMAINS } from '../helpers/boundary-conformance';

type GeneratedCreateBehaviorRuleDto =
  components['schemas']['CreateBehaviorRuleDto'];
type GeneratedBehaviorRule = components['schemas']['BehaviorRule'];
type GeneratedCreateGuardrailDto =
  components['schemas']['CreateGuardrailDto'];
type GeneratedCreatePolicyDto = components['schemas']['CreatePolicyDto'];
type GeneratedEvaluateRegoDto = components['schemas']['EvaluateRegoDto'];
type GeneratedTestGuardrailDto = components['schemas']['TestGuardrailDto'];
type GeneratedUpdateGuardrailDto =
  components['schemas']['UpdateGuardrailDto'];

describe('Test Fixtures', () => {
  describe('governance TypeSpec domains', () => {
    it('extracts every finite governance member from declared TypeSpec sources', () => {
      const domainEntries = Object.entries(GOVERNANCE_SPEC_DOMAINS) as Array<[
        keyof typeof GOVERNANCE_SPEC_DOMAINS,
        readonly unknown[],
      ]>;

      expect(Object.keys(GOVERNANCE_SPEC_DOMAIN_PROVENANCE).sort()).toEqual(
        domainEntries.map(([key]) => key).sort(),
      );

      for (const [key, members] of domainEntries) {
        const provenance = GOVERNANCE_SPEC_DOMAIN_PROVENANCE[key];
        expect(provenance.source, key).toMatch(/^specs\/typespec\//);
        expect(provenance.selector, key).toMatch(/\S/);
        expect(members.length, key).toBeGreaterThan(0);
        expect(new Set(members).size, key).toBe(members.length);
      }

      expect(GOVERNANCE_SPEC_DOMAINS.behaviorRuleStateMembers).toEqual(
        GOVERNANCE_SPEC_DOMAINS.behaviorRuleTriggers,
      );
      expect(
        GOVERNANCE_SPEC_DOMAINS.coreVerdicts.every((verdict) =>
          GOVERNANCE_SPEC_DOMAINS.coreLegacyActions.includes(verdict),
        ),
      ).toBe(true);
      expect(untrackedFiniteTypeSpecDomains(GOVERNANCE_BOUNDARY_DOMAINS)).toEqual([]);
    });
  });

  describe('makeCreateAgentDto', () => {
    it('generates valid agent DTO with required fields', () => {
      const dto = makeCreateAgentDto(['team-1']);
      expect(dto.agent_name).toMatch(/^test-agent-/);
      expect(dto.icon).toBe('robot');
      expect(dto.team_ids).toEqual(['team-1']);
      expect(dto.aivss_config).toBeDefined();
      expect(dto.aivss_config.base_security.attack_vector).toBeGreaterThanOrEqual(1);
      expect(dto.aivss_config.ai_specific.model_robustness).toBeGreaterThanOrEqual(1);
      expect(dto.aivss_config.impact.confidentiality_impact).toBeGreaterThanOrEqual(1);
    });

    it('generates unique names', () => {
      const a = makeCreateAgentDto([]);
      const b = makeCreateAgentDto([]);
      expect(a.agent_name).not.toBe(b.agent_name);
    });

    it('accepts overrides', () => {
      const dto = makeCreateAgentDto([], { agent_name: 'custom' });
      expect(dto.agent_name).toBe('custom');
    });
  });

  describe('makeCreateGuardrailDto', () => {
    it('generates valid guardrail DTO', () => {
      const dto = makeCreateGuardrailDto();
      const typed: GeneratedCreateGuardrailDto = dto;
      const update: GeneratedUpdateGuardrailDto = {
        guardrail_type: dto.guardrail_type,
        processing_stage: dto.processing_stage,
      };
      expect(dto.name).toMatch(/^test-guardrail-/);
      expect(dto.guardrail_type).toBe('1');
      expect(dto.processing_stage).toBe('1');
      expect(dto.trust_impact).toBeTruthy();
      expect(typed.guardrail_type).toBe('1');
      expect(update.processing_stage).toBe('1');
    });

    it('keeps legacy activity scoping absent and defaulted trust impact optional', () => {
      const minimal: GeneratedCreateGuardrailDto = {
        guardrail_type: '1',
        name: 'minimal-guardrail',
        processing_stage: '0',
      };

      expect(minimal).not.toHaveProperty('trust_impact');
      expect(minimal).not.toHaveProperty('activity_type');
      expect(minimal).not.toHaveProperty('fields_to_check');
    });
  });

  describe('makeCreatePolicyDto', () => {
    it('generates valid policy DTO with rego code', () => {
      const dto = makeCreatePolicyDto();
      expect(dto.name).toMatch(/^test-policy-/);
      expect(dto.rego_code).toContain('package openbox.policy');
      expect(dto.rego_code).toContain('decision');
    });

    it('generated create policy type keeps trust impact optional', () => {
      const dto: GeneratedCreatePolicyDto = {
        name: 'minimal-policy',
        rego_code: 'package openbox.policy',
        input: {},
      };

      expect(dto).not.toHaveProperty('trust_impact');
    });
  });

  describe('makeEvaluateRegoConformanceCase', () => {
    it('generates a typed policy evaluation case with expected OPA output', () => {
      const testCase = makeEvaluateRegoConformanceCase();
      const body: GeneratedEvaluateRegoDto = testCase.body;

      expect(testCase.operationId).toBe('PolicyController_evaluate');
      expect(body.policy).toContain('package test');
      expect(body.input).toEqual({});
      expect(testCase.expected).toEqual({ allow: true });
    });
  });

  describe('makeRequireApprovalPolicyConformanceCase', () => {
    it('generates a typed policy/evaluate/poll case for approval conformance', () => {
      const testCase = makeRequireApprovalPolicyConformanceCase();
      const policyBody: GeneratedCreatePolicyDto = testCase.policyBody;
      const event: GovernanceEventPayload = testCase.event;
      const pollRequest: ApprovalStatusRequest = testCase.pollRequest;
      const span: SpanData | undefined = event.spans?.[0];

      expect(testCase.createPolicyOperationId).toBe('AgentController_createPolicy');
      expect(testCase.pendingApprovalsOperationId).toBe('AgentController_getPendingApprovals');
      expect(testCase.organizationApprovalsOperationId).toBe('OrganizationController_getApprovals');
      expect(testCase.decideApprovalOperationId).toBe('AgentController_decideApproval');
      expect(testCase.approvalHistoryOperationId).toBe('AgentController_getApprovalHistory');
      expect(testCase.evaluateOperationId).toBe('evaluateGovernance');
      expect(testCase.pollOperationId).toBe('pollApproval');
      expect(policyBody.rego_code).toContain('REQUIRE_APPROVAL');
      expect(policyBody.rego_code).toContain('input.activity_type == "tool_call"');
      expect(policyBody.rego_code).toContain('input.spans[_].semantic_type == "llm_gen_ai"');
      expect(event.activity_type).toBe('tool_call');
      expect(event.span_count).toBe(1);
      expect(span?.semantic_type).toBe('llm_gen_ai');
      expect(pollRequest.workflow_id).toBe(event.workflow_id);
      expect(pollRequest.run_id).toBe(event.run_id);
      expect(pollRequest.activity_id).toBe(event.activity_id);
      expect(testCase.expected).toMatchObject({
        verdict: 'require_approval',
        action: 'require_approval',
      });
    });
  });

  describe('makeApprovalExpirationConformanceCase', () => {
    it('generates a spec-backed expired approval timeout case', () => {
      const testCase = makeApprovalExpirationConformanceCase();
      const policyBody: GeneratedCreatePolicyDto = testCase.policyBody;
      const pollRequest: ApprovalStatusRequest = testCase.pollRequest;

      expect(testCase.scenarioId).toBe('approval-expired-timeout');
      expect(testCase.createPolicyOperationId).toBe('AgentController_createPolicy');
      expect(testCase.pendingApprovalsOperationId).toBe('AgentController_getPendingApprovals');
      expect(testCase.organizationApprovalsOperationId).toBe('OrganizationController_getApprovals');
      expect(testCase.pollOperationId).toBe('pollApproval');
      expect(policyBody.rego_code).toContain('REQUIRE_APPROVAL');
      expect(pollRequest.activity_id).toBe(testCase.event.activity_id);
      expect(testCase.expected).toMatchObject({
        action: 'require_approval',
        expiredStatus: 'expired',
        expiredCount: 1,
      });
    });
  });

  describe('makeOpaVerdictMatrixConformanceCase', () => {
    it('generates a spec-backed OPA verdict matrix across canonical span paths', () => {
      const testCase = makeOpaVerdictMatrixConformanceCase();
      const policyBody: GeneratedCreatePolicyDto = testCase.policyBody;

      expect(testCase.createPolicyOperationId).toBe('AgentController_createPolicy');
      expect(testCase.evaluateOperationId).toBe('evaluateGovernance');
      expect(policyBody.rego_code).toContain('ALLOW');
      expect(policyBody.rego_code).toContain('REQUIRE_APPROVAL');
      expect(policyBody.rego_code).toContain('BLOCK');
      expect(policyBody.rego_code).toContain('HALT');
      expect(policyBody.rego_code).not.toContain('CONSTRAIN');
      expect(testCase.cases.map((entry) => entry.scenarioId)).toEqual(
        expect.arrayContaining([
          'opa-allow',
          'opa-require-approval',
          'opa-block',
          'opa-halt',
        ]),
      );
      expect(testCase.cases.map((entry) => entry.semanticType)).toEqual(
        expect.arrayContaining([
          'mcp_tool_call',
          'database_query',
          'file_read',
          'file_write',
          'internal',
          'http_post',
        ]),
      );
      expect(testCase.cases.map((entry) => entry.activityType)).toEqual(
        expect.arrayContaining([
          'MCPToolCall',
          'DatabaseQuery',
          'FileRead',
          'FileEdit',
          'ShellExecution',
          'HTTPRequest',
        ]),
      );

      for (const matrixCase of testCase.cases) {
        const event: GovernanceEventPayload = matrixCase.event;
        const span: SpanData | undefined = event.spans?.[0];
        const activityInput = Array.isArray(event.activity_input)
          ? event.activity_input
          : [];
        expect(event.activity_type).toBe(matrixCase.activityType);
        expect(event.span_count).toBe(1);
        expect(activityInput[0]).toMatchObject(matrixCase.activityInput);
        expect(span?.semantic_type).toBe(matrixCase.semanticType);
        expect(matrixCase.expected.reason).toContain(matrixCase.semanticType);
      }
    });
  });

  describe('makeOpaAliasDecisionConformanceCase', () => {
    it('generates spec-backed OPA alias decision cases', () => {
      const testCase = makeOpaAliasDecisionConformanceCase();
      const policyBody: GeneratedCreatePolicyDto = testCase.policyBody;

      expect(testCase.createPolicyOperationId).toBe('AgentController_createPolicy');
      expect(testCase.evaluateOperationId).toBe('evaluateGovernance');
      expect(policyBody.rego_code).toContain('"continue"');
      expect(policyBody.rego_code).toContain('"stop"');
      expect(policyBody.rego_code).toContain('"require-approval"');
      expect(testCase.cases.map((entry) => entry.decision)).toEqual([
        'continue',
        'stop',
        'require-approval',
      ]);
      expect(testCase.cases.map((entry) => entry.expected.verdict)).toEqual([
        'allow',
        'halt',
        'require_approval',
      ]);

      for (const matrixCase of testCase.cases) {
        const event: GovernanceEventPayload = matrixCase.event;
        const span: SpanData | undefined = event.spans?.[0];
        expect(event.activity_type).toBe(matrixCase.activityType);
        expect(event.span_count).toBe(1);
        expect(span?.semantic_type).toBe(matrixCase.semanticType);
        expect(span?.attributes).toMatchObject({
          'openbox.matrix.decision': matrixCase.decision,
        });
      }
    });
  });

  describe('makeOpaUnsupportedConstrainConformanceCase', () => {
    it('generates the OPA CONSTRAIN propagation boundary case', () => {
      const testCase = makeOpaUnsupportedConstrainConformanceCase();
      const policyBody: GeneratedCreatePolicyDto = testCase.policyBody;

      expect(testCase.scenarioId).toBe('opa-constrain');
      expect(testCase.createPolicyOperationId).toBe('AgentController_createPolicy');
      expect(testCase.evaluateOperationId).toBe('evaluateGovernance');
      expect(policyBody.rego_code).toContain('CONSTRAIN');
      expect(testCase.event.activity_type).toBe('DatabaseQuery');
      expect(testCase.event.spans?.[0]?.semantic_type).toBe('database_query');
      expect(testCase.expected).toEqual({
        verdict: 'constrain',
        action: 'constrain',
        reason: 'SDK conformance OPA CONSTRAIN propagation boundary',
      });
    });
  });

  describe('makeOpaUnavailableFailClosedConformanceCase', () => {
    it('generates an active-policy OPA unavailable fail-closed case', () => {
      const testCase = makeOpaUnavailableFailClosedConformanceCase();
      const policyBody: GeneratedCreatePolicyDto = testCase.policyBody;
      const event: GovernanceEventPayload = testCase.event;
      const span: SpanData | undefined = event.spans?.[0];

      expect(testCase.scenarioId).toBe('opa-unavailable-fail-closed');
      expect(testCase.createPolicyOperationId).toBe('AgentController_createPolicy');
      expect(testCase.evaluateOperationId).toBe('evaluateGovernance');
      expect(policyBody.rego_code).toContain('BLOCK');
      expect(policyBody.rego_code).toContain('input.activity_type == "DatabaseQuery"');
      expect(event.activity_type).toBe('DatabaseQuery');
      expect(span?.semantic_type).toBe('database_query');
      expect(span?.attributes).toMatchObject({
        'openbox.matrix.scenario_id': 'opa-unavailable-fail-closed',
        'openbox.matrix.decision': 'OPA_UNAVAILABLE',
      });
      expect(testCase.expected).toMatchObject({
        availableVerdict: 'block',
        unavailableVerdict: 'halt',
        unavailableReason: 'OPA unavailable - fail-closed security policy applied',
      });
    });
  });

  describe('makeGuardrailRunTestConformanceCases', () => {
    it('generates spec-backed guardrail field-status cases', () => {
      const cases = makeGuardrailRunTestConformanceCases();

      expect(cases.map((entry) => entry.scenarioId)).toEqual([
        'guardrail-allow',
        'guardrail-block',
        'guardrail-redact',
        'guardrail-redact',
        'guardrail-allow',
      ]);
      expect(cases.map((entry) => entry.expected.fieldStatus)).toEqual([
        'allowed',
        'blocked',
        'redacted',
        'transformed',
        'skipped',
      ]);

      for (const testCase of cases) {
        const body: GeneratedTestGuardrailDto = testCase.request;
        expect(body.guardrail_type).toBe('pii_detection');
        expect(body.logs).toHaveProperty('text');
      }

      expect(cases[1].expected.validationPassed).toBe(false);
      expect(cases[1].expected.reasonIncludes).toBe('BLOCK_ME');
      expect(cases[2].expected.redactedInput).toMatchObject({
        text: expect.stringContaining('[redacted-email]'),
      });
      expect(cases[3].expected.redactedInput).toMatchObject({
        text: expect.stringContaining('transformed-value'),
      });
      expect(cases[4].expected.reasonIncludes).toBe('out of scope');
    });
  });

  describe('makeGuardrailServiceUnavailableConformanceCase', () => {
    it('generates the spec-backed guardrail unavailable negative path', () => {
      const testCase = makeGuardrailServiceUnavailableConformanceCase();
      const body: GeneratedTestGuardrailDto = testCase.request;

      expect(testCase.scenarioId).toBe('guardrail-service-unavailable-fail-closed');
      expect(body.guardrail_type).toBe('pii_detection');
      expect(body.logs).toMatchObject({
        text: expect.stringContaining('guardrail service unavailable'),
      });
      expect(testCase.expected).toMatchObject({
        status: 500,
        messageIncludes: 'Guardrails test execution failed',
      });
    });
  });

  describe('makeGoalSignalOrderConformanceCase', () => {
    it('generates a spec-backed SignalReceived-before-action AGE result path', () => {
      const testCase = makeGoalSignalOrderConformanceCase();
      const signal: GovernanceEventPayload = testCase.goalSignalEvent;
      const action: GovernanceEventPayload = testCase.firstGovernedEvent;
      const span: SpanData | undefined = action.spans?.[0];

      expect(testCase.evaluateOperationId).toBe('evaluateGovernance');
      expect(testCase.scenarioIds).toEqual({
        order: 'behavior-order-goal-before-action',
        alignmentChecked: 'goal-alignment-checked',
        ageUnavailable: 'goal-drift-unavailable-fail-closed',
      });
      expect(signal.event_type).toBe('SignalReceived');
      expect(signal.workflow_id).toBe(action.workflow_id);
      expect(signal.run_id).toBe(action.run_id);
      expect(action.activity_type).toBe(testCase.expected.firstGovernedSurface);
      expect(span?.semantic_type).toBe('llm_gen_ai');
      expect(span?.attributes).toMatchObject({
        'openbox.source': 'openbox-sdk-e2e',
        'openbox.goal_signal_order': 'after-signal',
      });
      expect(testCase.expected).toMatchObject({
        governanceChecksIncomplete: false,
        goalAlignmentChecked: false,
        goalDrifted: false,
      });
    });
  });

  describe('makeGoalDriftDetectedConformanceCase', () => {
    it('generates a spec-backed public endpoint matrix for drift detection', () => {
      const testCase = makeGoalDriftDetectedConformanceCase();

      expect(testCase.scenarioId).toBe('goal-drift-detected');
      expect(testCase.recentDriftsOperationId).toBe('AgentController_getRecentDriftEvents');
      expect(testCase.driftLogsOperationId).toBe('AgentController_getDriftEvents');
      expect(testCase.trendOperationId).toBe('AgentController_getGoalAlignmentTrend');
      expect(testCase.sessionStatsOperationId).toBe('AgentController_getSessionGoalAlignmentStats');
      expect(testCase.seed).toMatchObject({
        activityId: 'goal-drift-detected',
        semanticType: 'llm_gen_ai',
        reason: 'goal_drifted: true',
      });
      expect(testCase.expected).toMatchObject({
        goalDrifted: true,
        driftedCount: 1,
        totalDrifted: 1,
      });
    });
  });

  describe('makeCreateBehaviorRuleDto', () => {
    it('generates valid behavior rule DTO', () => {
      const dto = makeCreateBehaviorRuleDto();
      expect(dto.rule_name).toMatch(/^test-rule-/);
      expect(dto.trigger).toBeTruthy();
      expect(dto.states).toBeInstanceOf(Array);
      expect(dto.states.length).toBeGreaterThan(0);
      expect(dto.time_window).toBeGreaterThan(0);
      expect(dto.verdict).toBeGreaterThanOrEqual(0);
      expect(dto.reject_message).toBeTruthy();
    });

    it('generated behavior rule types support string states', () => {
      const dto: GeneratedCreateBehaviorRuleDto = {
        rule_name: 'state-predicate',
        priority: 50,
        trigger: 'http_post',
        states: ['file_read', 'file_write'],
        time_window: 60,
        verdict: 2,
        reject_message: 'approval required',
        approval_timeout: 300,
        trust_impact: 'none',
      };
      const rule: GeneratedBehaviorRule = {
        id: 'rule-1',
        rule_name: dto.rule_name,
        priority: dto.priority,
        trigger: dto.trigger,
        states: dto.states,
        time_window: dto.time_window,
        verdict: dto.verdict,
        reject_message: dto.reject_message,
        approval_timeout: dto.approval_timeout,
        is_active: true,
      };

      expect(rule.states[0]).toBe('file_read');
      expect(rule.states[1]).toBe('file_write');
    });

    it('generated create behavior rule type keeps trust impact optional', () => {
      const dto: GeneratedCreateBehaviorRuleDto = {
        rule_name: 'minimal-rule',
        priority: 50,
        trigger: 'http_post',
        states: ['http_post'],
        time_window: 60,
        verdict: 0,
        reject_message: 'allow',
      };

      expect(dto).not.toHaveProperty('trust_impact');
    });
  });

  describe('makeGovernanceEvent', () => {
    it('generates valid governance event', () => {
      const event = makeGovernanceEvent();
      expect(event.event_type).toBe('ActivityStarted');
      expect(event.workflow_id).toMatch(/^test-wf-/);
      expect(event.run_id).toMatch(/^test-run-/);
      expect(event.timestamp).toBeTruthy();
    });
  });

  describe('makeUpdateAivssConfigDto', () => {
    it('has all three config sections', () => {
      const dto = makeUpdateAivssConfigDto();
      expect(dto.aivss_config.base_security).toBeDefined();
      expect(dto.aivss_config.ai_specific).toBeDefined();
      expect(dto.aivss_config.impact).toBeDefined();
      expect(dto.reason).toBeTruthy();
    });
  });

  describe('makeGoalAlignmentConfigDto', () => {
    it('has valid config', () => {
      const dto = makeGoalAlignmentConfigDto();
      expect(dto.alignment_threshold).toBeGreaterThanOrEqual(0);
      expect(dto.alignment_threshold).toBeLessThanOrEqual(100);
      expect(dto.drift_detection_action).toBeTruthy();
    });
  });
});
