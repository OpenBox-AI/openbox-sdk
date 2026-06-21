import { describe, expect, it } from 'vitest';
import {
  AIVSS_NUMERIC_BOUNDARIES,
  BOUNDARY_CONFORMANCE_GAPS,
  BOUNDARY_CONFORMANCE_EVIDENCE,
  GOVERNANCE_BOUNDARY_DOMAINS,
  JSON_VALUE_CLASS_CASES,
  assertBoundaryConformanceEvidenceFiles,
  evidencedBoundaryFieldCoverageKeys,
  expectedAivssIntegerMemberCaseCount,
  expectedAivssInvalidBoundaryCaseCount,
  expectedGoalAlignmentFiniteConfigCaseCount,
  makeAivssIntegerMemberCases,
  makeAivssInvalidBoundaryCases,
  makeGoalAlignmentFiniteConfigCases,
  makeTrustThresholdBoundaryCases,
  requiredBoundaryFieldCoverageKeys,
} from '../helpers/boundary-conformance';

function boundaryFieldKeys(fields: ReadonlyArray<{ modelName: string; fieldName: string }>) {
  return fields.map((entry) => `${entry.modelName}.${entry.fieldName}`).sort();
}

describe('boundary conformance ledger', () => {
  it('derives constrained governance value classes from TypeSpec', () => {
    expect(AIVSS_NUMERIC_BOUNDARIES.map((entry) => entry.fieldName)).toEqual([
      'attack_vector',
      'attack_complexity',
      'privileges_required',
      'user_interaction',
      'scope',
      'model_robustness',
      'data_sensitivity',
      'ethical_impact',
      'decision_criticality',
      'adaptability',
      'confidentiality_impact',
      'integrity_impact',
      'availability_impact',
      'safety_impact',
    ]);

    expect(makeAivssIntegerMemberCases()).toHaveLength(expectedAivssIntegerMemberCaseCount());
    expect(makeAivssInvalidBoundaryCases()).toHaveLength(expectedAivssInvalidBoundaryCaseCount());
    expect(makeGoalAlignmentFiniteConfigCases()).toHaveLength(
      expectedGoalAlignmentFiniteConfigCaseCount(),
    );
    expect(boundaryFieldKeys(GOVERNANCE_BOUNDARY_DOMAINS.trustThresholdFields)).toEqual([
      'CreateBehaviorRuleDto.trust_threshold',
      'CreateGuardrailDto.trust_threshold',
      'CreatePolicyDto.trust_threshold',
      'UpdateBehavioralRuleDto.trust_threshold',
      'UpdateGuardrailDto.trust_threshold',
      'UpdatePolicyDto.trust_threshold',
    ]);
    expect(boundaryFieldKeys(GOVERNANCE_BOUNDARY_DOMAINS.backendStringLengthFields)).toEqual([
      'CreatePolicyDto.description',
      'CreatePolicyDto.name',
      'CreateTeamDto.description',
      'CreateTeamDto.icon',
      'CreateTeamDto.name',
    ]);
    expect(GOVERNANCE_BOUNDARY_DOMAINS.backendArrayItemFields).toEqual([
      expect.objectContaining({
        modelName: 'RemoveMembersDto',
        fieldName: 'memberIds',
        min: 1,
        max: 100,
      }),
    ]);
    expect(GOVERNANCE_BOUNDARY_DOMAINS.backendUuidFormatFields).toEqual([
      expect.objectContaining({
        modelName: 'CreateBehaviorRuleDto',
        fieldName: 'dependency_base_rule_id',
        format: 'uuid',
      }),
      expect.objectContaining({
        modelName: 'UpdateBehavioralRuleDto',
        fieldName: 'dependency_base_rule_id',
        format: 'uuid',
      }),
    ]);
    expect(GOVERNANCE_BOUNDARY_DOMAINS.coreNumericFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelName: 'GovernanceEventPayload',
          fieldName: 'attempt',
          min: 1,
        }),
        expect.objectContaining({
          modelName: 'GovernanceVerdictResponse',
          fieldName: 'risk_score',
          min: 0,
          max: 1,
        }),
        expect.objectContaining({
          modelName: 'AGETrustScore',
          fieldName: 'trust_tier',
          min: 0,
          max: 4,
        }),
      ]),
    );
    expect(makeTrustThresholdBoundaryCases('CreateGuardrailDto')).toEqual({
      valid: [
        { id: 'CreateGuardrailDto.trust_threshold=null', trust_threshold: null },
        { id: 'CreateGuardrailDto.trust_threshold=min', trust_threshold: 1 },
      ],
      invalid: [
        { id: 'CreateGuardrailDto.trust_threshold<min', trust_threshold: 0 },
        { id: 'CreateGuardrailDto.trust_threshold<min-1', trust_threshold: -1 },
      ],
    });
    expect(GOVERNANCE_BOUNDARY_DOMAINS.trustImpacts).toEqual([
      'none',
      'low',
      'medium',
      'high',
    ]);
    expect(JSON_VALUE_CLASS_CASES.map((entry) => entry.kind)).toEqual([
      'null',
      'boolean',
      'number',
      'string',
      'array',
      'object',
    ]);
    expect(GOVERNANCE_BOUNDARY_DOMAINS.requiredBodyFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modelName: 'LoginDto', fieldName: 'realm' }),
        expect.objectContaining({ modelName: 'LoginDto', fieldName: 'username' }),
        expect.objectContaining({ modelName: 'LoginDto', fieldName: 'password' }),
        expect.objectContaining({ modelName: 'LoginDto', fieldName: 'recaptchaToken' }),
        expect.objectContaining({ modelName: 'LogoutDto', fieldName: 'refreshToken' }),
        expect.objectContaining({ modelName: 'RefreshDto', fieldName: 'refreshToken' }),
        expect.objectContaining({ modelName: 'CreateOrganizationDto', fieldName: 'recaptchaToken' }),
      ]),
    );
    expect(GOVERNANCE_BOUNDARY_DOMAINS.backendOpenJsonFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modelName: 'CreateAgentDto', fieldName: 'config' }),
        expect.objectContaining({ modelName: 'UpdateAgentDto', fieldName: 'config' }),
        expect.objectContaining({ modelName: 'CreateGuardrailDto', fieldName: 'params' }),
        expect.objectContaining({ modelName: 'CreateGuardrailDto', fieldName: 'settings' }),
        expect.objectContaining({ modelName: 'CreatePolicyDto', fieldName: 'input' }),
        expect.objectContaining({ modelName: 'CreatePolicyDto', fieldName: 'config' }),
        expect.objectContaining({ modelName: 'TestGuardrailDto', fieldName: 'params' }),
        expect.objectContaining({ modelName: 'TestGuardrailDto', fieldName: 'settings' }),
        expect.objectContaining({ modelName: 'TestGuardrailDto', fieldName: 'logs' }),
        expect.objectContaining({ modelName: 'EvaluateRegoDto', fieldName: 'input' }),
      ]),
    );
    expect(GOVERNANCE_BOUNDARY_DOMAINS.coreOpenJsonFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modelName: 'GovernanceEventPayload', fieldName: 'activity_input' }),
        expect.objectContaining({ modelName: 'GovernanceEventPayload', fieldName: 'activity_output' }),
        expect.objectContaining({ modelName: 'GovernanceEventPayload', fieldName: 'signal_args' }),
        expect.objectContaining({ modelName: 'GovernanceEventPayload', fieldName: 'spans' }),
        expect.objectContaining({ modelName: 'SpanData', fieldName: 'attributes' }),
        expect.objectContaining({ modelName: 'SpanData', fieldName: 'data' }),
        expect.objectContaining({ modelName: 'SpanData', fieldName: 'args' }),
        expect.objectContaining({ modelName: 'SpanData', fieldName: 'result' }),
        expect.objectContaining({ modelName: 'SpanEvent', fieldName: 'attributes' }),
      ]),
    );
  });

  it('links every constrained/open value class to explicit e2e evidence', () => {
    assertBoundaryConformanceEvidenceFiles();
    expect(BOUNDARY_CONFORMANCE_GAPS.map((entry) => entry.id)).toEqual([
      'core-governance-attempt-min-not-rejected',
      'core-governance-timestamp-format-not-rejected',
      'core-governance-cost-type-not-rejected',
      'backend-agent-evaluations-query-boundaries-not-rejected',
    ]);
  });

  it('requires every extracted boundary domain key to have evidence or an explicit gap', () => {
    const evidencedKeys = new Set(
      BOUNDARY_CONFORMANCE_EVIDENCE.flatMap((entry) => entry.domainKeys),
    );
    const gapKeys = new Set(
      BOUNDARY_CONFORMANCE_GAPS.flatMap((entry) => entry.domainKeys),
    );
    const untrackedKeys = Object.keys(GOVERNANCE_BOUNDARY_DOMAINS)
      .filter((key) => !evidencedKeys.has(key as keyof typeof GOVERNANCE_BOUNDARY_DOMAINS))
      .filter((key) => !gapKeys.has(key as keyof typeof GOVERNANCE_BOUNDARY_DOMAINS));

    expect(untrackedKeys).toEqual([]);
  });

  it('requires every constrained boundary model field to map to e2e evidence or an explicit gap', () => {
    expect(evidencedBoundaryFieldCoverageKeys()).toEqual(
      requiredBoundaryFieldCoverageKeys(),
    );
  });
});
