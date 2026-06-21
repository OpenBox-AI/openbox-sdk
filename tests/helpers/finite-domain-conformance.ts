import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GOVERNANCE_SPEC_DOMAINS } from './governance-spec-domains';

type DomainKey = keyof typeof GOVERNANCE_SPEC_DOMAINS;

export interface FiniteDomainEvidence {
  id: string;
  domainKeys: DomainKey[];
  source: 'typespec';
  proofMode:
    | 'exhaustive-local-stack-e2e'
    | 'boundary-local-stack-e2e'
    | 'generated-unit'
    | 'sdk-runtime-unit';
  proofFile: string;
  evidencePattern: string;
  executablePatterns: string[];
}

export interface FiniteDomainGap {
  id: string;
  domainKeys: DomainKey[];
  operationIds: string[];
  proofFile: string;
  evidencePattern: string;
  executablePatterns: string[];
  observedBehavior: string;
  requiredBehavior: string;
}

export const FINITE_DOMAIN_EVIDENCE: FiniteDomainEvidence[] = [
  {
    id: 'guardrail-create-members',
    domainKeys: ['guardrailTypes', 'guardrailProcessingStages'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/guardrails.test.ts',
    evidencePattern: 'creates every spec guardrail type and stage pair',
    executablePatterns: [
      'GOVERNANCE_SPEC_DOMAINS.guardrailTypes.flatMap',
      'GOVERNANCE_SPEC_DOMAINS.guardrailProcessingStages.map',
      'expect(pairs).toHaveLength',
      'client.post(`/agent/${agentId}/guardrails`, dto)',
      'guardrail_type: guardrailType',
      'processing_stage: processingStage',
    ],
  },
  {
    id: 'guardrail-update-members',
    domainKeys: ['guardrailTypes', 'guardrailProcessingStages'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/guardrails.test.ts',
    evidencePattern: 'updates through every spec guardrail type and stage pair',
    executablePatterns: [
      'for (const guardrailType of GOVERNANCE_SPEC_DOMAINS.guardrailTypes)',
      'for (const processingStage of GOVERNANCE_SPEC_DOMAINS.guardrailProcessingStages)',
      'client.put(`/agent/${agentId}/guardrails/${guardrailId}`',
      'guardrail_type: guardrailType',
      'processing_stage: processingStage',
    ],
  },
  {
    id: 'behavior-rule-trigger-members',
    domainKeys: ['behaviorRuleTriggers'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/behavior-rules.test.ts',
    evidencePattern: 'EXHAUSTIVE: behavior-rule trigger query filter accepts every spec trigger',
    executablePatterns: [
      'for (const trigger of GOVERNANCE_SPEC_DOMAINS.behaviorRuleTriggers)',
      'client.get(`/agent/${agentId}/behavior-rule?trigger=${trigger}`)',
      'rows.every((row: any) => row.trigger === trigger)',
    ],
  },
  {
    id: 'behavior-rule-state-members',
    domainKeys: ['behaviorRuleStateInputVariants', 'behaviorRuleStateMembers'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/behavior-rules.test.ts',
    evidencePattern: 'EXHAUSTIVE: behavior-rule states accepts every spec state member',
    executablePatterns: [
      'GOVERNANCE_SPEC_DOMAINS.behaviorRuleStateInputVariants',
      'GOVERNANCE_SPEC_DOMAINS.behaviorRuleStateMembers',
      'states: GOVERNANCE_SPEC_DOMAINS.behaviorRuleStateMembers',
      'for (const state of GOVERNANCE_SPEC_DOMAINS.behaviorRuleStateMembers)',
    ],
  },
  {
    id: 'behavior-rule-verdict-members',
    domainKeys: ['behaviorRuleVerdicts'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/behavior-rules.test.ts',
    evidencePattern: 'creates every spec behavior verdict integer',
    executablePatterns: [
      'for (const verdict of GOVERNANCE_SPEC_DOMAINS.behaviorRuleVerdicts)',
      'verdict,',
      'expect(body.data.approval_timeout).toBe(120)',
    ],
  },
  {
    id: 'approval-status-agent-query-members',
    domainKeys: ['approvalStatuses'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/approvals.test.ts',
    evidencePattern: 'EXHAUSTIVE: approval status query members are accepted by agent approval lists',
    executablePatterns: [
      'for (const status of GOVERNANCE_SPEC_DOMAINS.approvalStatuses)',
      '/approvals/pending?status=${status}',
      '/approvals/history?status=${status}',
    ],
  },
  {
    id: 'approval-status-org-query-members',
    domainKeys: ['approvalStatuses'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/approvals.test.ts',
    evidencePattern: 'EXHAUSTIVE: approval status query members are accepted by org approvals',
    executablePatterns: [
      'for (const status of GOVERNANCE_SPEC_DOMAINS.approvalStatuses)',
      '/approvals?status=${status}',
    ],
  },
  {
    id: 'approval-decision-action-members',
    domainKeys: ['approvalDecisionActions'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'CONFORMANCE: creates a require_approval policy and polls its pending approval',
    executablePatterns: [
      '?action=approve',
      '?action=reject',
      'expect(decideBody.data.verdict).toBe(0)',
      "expect(rejectedHistoryApproval.approval_status ?? rejectedHistoryApproval.status).toBe('rejected')",
    ],
  },
  {
    id: 'approval-decision-action-invalid-members',
    domainKeys: ['approvalDecisionActions'],
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'CONFORMANCE: creates a require_approval policy and polls its pending approval',
    executablePatterns: [
      "invalidGovernanceSpecMember('approvalDecisionActions')",
      '?action=${invalidApprovalAction}',
      'expect(invalidDecisionBody.status).toBe(422)',
    ],
  },
  {
    id: 'session-status-duration-invalid-query-members',
    domainKeys: ['sessionStatuses', 'sessionDurations'],
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/sessions.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: session finite query filters reject out-of-domain values',
    executablePatterns: [
      "invalidGovernanceSpecMember('sessionStatuses')",
      "invalidGovernanceSpecMember('sessionDurations')",
      '?status=${invalidStatus}',
      '?duration=${invalidDuration}',
      'expect(body.status, label).toBe(422)',
    ],
  },
  {
    id: 'session-status-duration-query-members',
    domainKeys: ['sessionStatuses', 'sessionDurations'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/sessions.test.ts',
    evidencePattern: 'EXHAUSTIVE: session status and duration query members are accepted by session lists',
    executablePatterns: [
      'for (const status of GOVERNANCE_SPEC_DOMAINS.sessionStatuses)',
      'for (const duration of GOVERNANCE_SPEC_DOMAINS.sessionDurations)',
      'encodeURIComponent(duration)',
      '/sessions?status=${status}',
      '/sessions?duration=${encodedDuration}',
    ],
  },
  {
    id: 'trust-history-duration-invalid-query-members',
    domainKeys: ['trustHistoryDurations'],
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/trust.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: trust history duration rejects out-of-domain values',
    executablePatterns: [
      "invalidGovernanceSpecMember('trustHistoryDurations')",
      '/trust/histories?duration=${invalidDuration}',
      'expect(body.status).toBe(422)',
    ],
  },
  {
    id: 'trust-history-duration-query-members',
    domainKeys: ['trustHistoryDurations'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/trust.test.ts',
    evidencePattern: 'EXHAUSTIVE: trust history duration query members are accepted',
    executablePatterns: [
      'for (const duration of GOVERNANCE_SPEC_DOMAINS.trustHistoryDurations)',
      '/trust/histories?duration=${duration}',
      'expect(body.status, duration).toBe(200)',
    ],
  },
  {
    id: 'audit-event-result-export-status-invalid-members',
    domainKeys: ['auditEventTypes', 'auditResults', 'auditExportStatuses'],
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/audit-logs.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: audit finite filters reject out-of-domain values',
    executablePatterns: [
      "invalidGovernanceSpecMember('auditEventTypes')",
      "invalidGovernanceSpecMember('auditResults')",
      "invalidGovernanceSpecMember('auditExportStatuses')",
      'eventTypes: [invalidEventType]',
      'expect(fullResponse(invalidExportStatusResponse).status).toBe(422)',
    ],
  },
  {
    id: 'audit-event-result-export-status-members',
    domainKeys: ['auditEventTypes', 'auditResults', 'auditExportStatuses'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/audit-logs.test.ts',
    evidencePattern: 'EXHAUSTIVE: audit filters accept every finite event/result/status member',
    executablePatterns: [
      'eventTypes: GOVERNANCE_SPEC_DOMAINS.auditEventTypes',
      'for (const eventType of GOVERNANCE_SPEC_DOMAINS.auditEventTypes)',
      'for (const result of GOVERNANCE_SPEC_DOMAINS.auditResults)',
      'for (const status of GOVERNANCE_SPEC_DOMAINS.auditExportStatuses)',
    ],
  },
  {
    id: 'api-key-permission-members',
    domainKeys: ['apiKeyPermissions'],
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/api-keys.test.ts',
    evidencePattern: 'NEGATIVE: API-key management endpoints reject API-key transport',
    executablePatterns: [
      'for (const permission of GOVERNANCE_SPEC_DOMAINS.apiKeyPermissions)',
      'permissions: [permission]',
      'expect(created.data.status, permission).toBe(401)',
      "expect(created.data.message, permission).toContain('API keys are not accepted')",
    ],
  },
  {
    id: 'agent-attestation-mode-members',
    domainKeys: ['agentAttestationModes'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/agent-crud.test.ts',
    evidencePattern: 'EXHAUSTIVE_SPEC_PROOF: CreateAgentDto attestation modes are accepted',
    executablePatterns: [
      'GOVERNANCE_SPEC_DOMAINS.agentAttestationModes',
      'for (const attestationMode of GOVERNANCE_SPEC_DOMAINS.agentAttestationModes)',
      'attestation_mode: attestationMode',
      'attestation_domain: \'attestation.example.invalid\'',
      'expect(body.status, attestationMode).toBe(200)',
    ],
  },
  {
    id: 'agent-attestation-mode-invalid-members',
    domainKeys: ['agentAttestationModes'],
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/agent-crud.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: CreateAgentDto attestation mode rejects out-of-domain values',
    executablePatterns: [
      "invalidGovernanceSpecMember('agentAttestationModes')",
      'attestation_mode: invalidAttestationMode',
      'expect(body.status).toBe(422)',
    ],
  },
  {
    id: 'organization-timezone-members',
    domainKeys: ['organizationTimezones'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/organization.test.ts',
    evidencePattern: 'EXHAUSTIVE_SPEC_PROOF: organization settings timezone members are accepted',
    executablePatterns: [
      'for (const timezone of GOVERNANCE_SPEC_DOMAINS.organizationTimezones)',
      'client.put(`/organization/${orgId}/settings`, { timezone })',
      'expect(readBody.data.timezone, timezone).toBe(timezone)',
    ],
  },
  {
    id: 'organization-timezone-invalid-members',
    domainKeys: ['organizationTimezones'],
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/organization.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: organization settings timezone rejects out-of-domain values',
    executablePatterns: [
      "invalidGovernanceSpecMember('organizationTimezones')",
      'timezone: invalidTimezone',
      'expect(body.status).toBe(422)',
    ],
  },
  {
    id: 'welcome-email-type-members',
    domainKeys: ['welcomeEmailTypes'],
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/organization.test.ts',
    evidencePattern: 'user administration operations require user-management permissions',
    executablePatterns: [
      'for (const type of GOVERNANCE_SPEC_DOMAINS.welcomeEmailTypes)',
      'client.post(`/organization/${orgId}/send-welcome-email`',
      'expect(welcome.data.status).toBe(403)',
      "expect(welcome.data.message).toContain('create:user')",
    ],
  },
  {
    id: 'webhook-event-type-members',
    domainKeys: ['webhookChannels', 'webhookEventTypes'],
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/webhooks.test.ts',
    evidencePattern: 'NEGATIVE: webhook CRUD operations are feature-gated when webhooks are disabled',
    executablePatterns: [
      'for (const channel of GOVERNANCE_SPEC_DOMAINS.webhookChannels)',
      'for (const eventType of GOVERNANCE_SPEC_DOMAINS.webhookEventTypes)',
      'channel,',
      'event_types: [eventType]',
      'expect(created.data.status, `${channel}:${eventType}`).toBe(403)',
      'expect(updated.data.status, `${channel}:${eventType}`).toBe(403)',
    ],
  },
  {
    id: 'sso-method-members',
    domainKeys: ['ssoMethods'],
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/sso.test.ts',
    evidencePattern: 'GET /sso/status returns public organization SSO status',
    executablePatterns: [
      'GOVERNANCE_SPEC_DOMAINS.ssoMethods',
      'if (body.data.method !== undefined && body.data.method !== null)',
      'expect(GOVERNANCE_SPEC_DOMAINS.ssoMethods).toContain(body.data.method)',
    ],
  },
  {
    id: 'demo-setup-status-members',
    domainKeys: ['demoSetupStatuses'],
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/organization.test.ts',
    evidencePattern: 'GET /organization/demo-setup-status returns local setup status',
    executablePatterns: [
      'client.get(\'/organization/demo-setup-status\')',
      'expect(GOVERNANCE_SPEC_DOMAINS.demoSetupStatuses).toContain(body.data.status)',
    ],
  },
  {
    id: 'core-governance-payload-finite-members',
    domainKeys: ['coreEventTypes'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'EXHAUSTIVE_SPEC_PROOF: core governance finite payload members',
    executablePatterns: [
      'for (const event_type of GOVERNANCE_SPEC_DOMAINS.coreEventTypes)',
      "coreOperation('evaluateGovernance')",
      'event_type,',
      'expect(response.data, event_type).toHaveProperty',
    ],
  },
  {
    id: 'core-auth-environment-members',
    domainKeys: ['coreAuthEnvironments'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'EXHAUSTIVE_SPEC_PROOF: core auth validation environment members follow token prefix boundaries',
    executablePatterns: [
      'GOVERNANCE_SPEC_DOMAINS.coreAuthEnvironments',
      "get('/api/v1/auth/validate')",
      'expect(GOVERNANCE_SPEC_DOMAINS.coreAuthEnvironments).toContain(response.data.environment)',
      'const unknownPrefix = `obx_unknown_${apiKey.replace',
      'expect(invalidResponse.status).toBeLessThan(500)',
    ],
  },
  {
    id: 'core-verdict-opa-members',
    domainKeys: ['coreVerdicts'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'CONFORMANCE: OPA verdict matrix covers ALLOW, REQUIRE_APPROVAL, BLOCK, and HALT paths',
    executablePatterns: [
      'GOVERNANCE_SPEC_DOMAINS.coreVerdicts.filter',
      'GOVERNANCE_SPEC_DOMAINS.behaviorRuleTriggers',
      'matrix.cases.map((entry) => entry.expected.verdict)',
      'matrix.cases.map((entry) => entry.semanticType)',
      'expect([...opaVerdicts].sort()).toEqual',
      'expect([...opaSemanticTypes].sort()).toEqual',
      'expectedOpaVerdicts.length * expectedOpaSemanticTypes.length',
    ],
  },
  {
    id: 'core-verdict-constrain-member',
    domainKeys: ['coreVerdicts'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'CONFORMANCE: Core guardrail redaction returns a constrained verdict with guardrails_result',
    executablePatterns: [
      "expect(GOVERNANCE_SPEC_DOMAINS.coreVerdicts).toContain('constrain')",
      "expect(response.data, JSON.stringify(response.data)).toHaveProperty('verdict', 'constrain')",
    ],
  },
  {
    id: 'core-legacy-action-members',
    domainKeys: ['coreLegacyActions'],
    source: 'typespec',
    proofMode: 'sdk-runtime-unit',
    proofFile: 'tests/unit/govern-invariants.test.ts',
    evidencePattern: 'EXHAUSTIVE_SPEC_PROOF: generated govern runtime normalizes every legacy Core action member',
    executablePatterns: [
      'Object.keys(expectedArms).sort()',
      'GOVERNANCE_SPEC_DOMAINS.coreLegacyActions',
      'for (const action of GOVERNANCE_SPEC_DOMAINS.coreLegacyActions)',
      'expect(Object.fromEntries(observed)).toEqual(expectedArms)',
    ],
  },
  {
    id: 'core-guardrails-input-type-members',
    domainKeys: ['coreGuardrailsInputTypes'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'CONFORMANCE: Core guardrail redaction returns a constrained verdict with guardrails_result',
    executablePatterns: [
      'const observedInputTypes = new Set<string>()',
      'observedInputTypes.add(response.data.guardrails_result.input_type)',
      'GOVERNANCE_SPEC_DOMAINS.coreGuardrailsInputTypes',
      'expect([...observedInputTypes].sort()).toEqual',
    ],
  },
  {
    id: 'guardrail-field-status-members',
    domainKeys: ['coreGuardrailFieldStatuses'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/guardrails.test.ts',
    evidencePattern: 'EXHAUSTIVE_BOUNDARY_PROOF: GuardrailController_runTest covers every guardrail type and outcome',
    executablePatterns: [
      'const observedStatuses = new Set<string>()',
      'observedStatuses.add(String(body.data.field_results?.[0]?.status))',
      'GOVERNANCE_SPEC_DOMAINS.coreGuardrailFieldStatuses',
      'expect([...observedStatuses].sort()).toEqual',
    ],
  },
  {
    id: 'openbox-capability-id-members',
    domainKeys: ['openboxCapabilityIds'],
    source: 'typespec',
    proofMode: 'generated-unit',
    proofFile: 'tests/unit/provider-capability-matrix.test.ts',
    evidencePattern: 'declares every required capability for every provider',
    executablePatterns: [
      'for (const provider of PROVIDERS)',
      'PROVIDER_CAPABILITY_MATRIX.filter((entry) => entry.provider === provider)',
      '[...OPENBOX_CAPABILITY_IDS].sort()',
      'expect(entry.rationale.length, `${provider}/${entry.capability} rationale`).toBeGreaterThan(20)',
    ],
  },
  {
    id: 'provider-capability-provider-tier-members',
    domainKeys: ['openboxProviderIds', 'openboxSupportTiers'],
    source: 'typespec',
    proofMode: 'generated-unit',
    proofFile: 'tests/unit/provider-capability-matrix.test.ts',
    evidencePattern: 'matches the TypeSpec-emitted provider capability conformance fixture',
    executablePatterns: [
      'expect(OPENBOX_PROVIDER_IDS).toEqual(fixture.providerIds)',
      'expect(OPENBOX_SUPPORT_TIERS).toEqual(fixture.supportTiers)',
      'expect(PROVIDER_CAPABILITY_MATRIX).toEqual(fixture.providerCapabilityMatrix)',
    ],
  },
  {
    id: 'provider-runtime-status-promotion-members',
    domainKeys: [
      'referenceProviderParityClosureStatuses',
      'referenceProviderRuntimePromotionDecisions',
    ],
    source: 'typespec',
    proofMode: 'generated-unit',
    proofFile: 'tests/unit/provider-capability-matrix.test.ts',
    evidencePattern: 'pins runtime promotion audits to every reference provider parity closure',
    executablePatterns: [
      'ReferenceProviderParityClosureStatus',
      'ReferenceProviderRuntimePromotionDecision',
      'expectedDecisionsByStatus',
      'expectedDecisionsByStatus[audit.status].includes(audit.promotionDecision)',
    ],
  },
  {
    id: 'local-stack-scenario-matrix-domain-members',
    domainKeys: [
      'localStackScenarioCategories',
      'localStackScenarioAxes',
      'localStackProofLevels',
      'localStackOutcomeSources',
      'sdkSemanticGapClosureTargets',
    ],
    source: 'typespec',
    proofMode: 'generated-unit',
    proofFile: 'tests/unit/local-stack-conformance-matrix.test.ts',
    evidencePattern:
      'fails generated local-stack category axis proof source and closure-target domain drift',
    executablePatterns: [
      'GOVERNANCE_SPEC_DOMAINS.localStackScenarioCategories',
      'GOVERNANCE_SPEC_DOMAINS.localStackScenarioAxes',
      'GOVERNANCE_SPEC_DOMAINS.localStackProofLevels',
      'GOVERNANCE_SPEC_DOMAINS.localStackOutcomeSources',
      'GOVERNANCE_SPEC_DOMAINS.sdkSemanticGapClosureTargets',
      'localStackScenarioDomainRefsForTesting',
      'unknownScenarioCategoryRefs',
      'unknownScenarioAxisRefs',
      'unknownScenarioProofLevelRefs',
      'unknownOutcomeSourceRefs',
      'unknownOutcomeProofLevelRefs',
      'unknownScenarioMatrixCategoryRefs',
      'unknownScenarioMatrixAxisRefs',
      'unknownScenarioMatrixProofLevelRefs',
      'unknownSdkSemanticGapClosureTargetRefs',
    ],
  },
  {
    id: 'rules-projection-trigger-severity-source-members',
    domainKeys: ['ruleTriggers', 'ruleSeverities', 'projectedRuleSources'],
    source: 'typespec',
    proofMode: 'sdk-runtime-unit',
    proofFile: 'tests/unit/cursor-rules-render.test.ts',
    evidencePattern: 'EXHAUSTIVE_SPEC_PROOF: Cursor rules renderer covers every spec rule trigger, severity, and source',
    executablePatterns: [
      'GOVERNANCE_SPEC_DOMAINS.ruleTriggers',
      'GOVERNANCE_SPEC_DOMAINS.ruleSeverities',
      'GOVERNANCE_SPEC_DOMAINS.projectedRuleSources',
      'for (const trigger of GOVERNANCE_SPEC_DOMAINS.ruleTriggers)',
      'for (const severity of GOVERNANCE_SPEC_DOMAINS.ruleSeverities)',
      'for (const source of GOVERNANCE_SPEC_DOMAINS.projectedRuleSources)',
      "trigger === 'manual'",
      '# openbox.severity:',
      '# openbox.source:',
    ],
  },
];

export const FINITE_DOMAIN_GAPS: FiniteDomainGap[] = [
  {
    id: 'approval-status-invalid-query-not-rejected',
    domainKeys: ['approvalStatuses'],
    operationIds: [
      'AgentController_getPendingApprovals',
      'AgentController_getApprovalHistory',
      'OrganizationController_getApprovals',
    ],
    proofFile: 'tests/e2e/approvals.test.ts',
    evidencePattern: 'SEMANTIC_GAP_PROOF: approval status query out-of-domain values are accepted by local stack',
    executablePatterns: [
      "invalidGovernanceSpecMember('approvalStatuses')",
      '?status=${invalidStatus}',
      'expect(pendingBody.status).toBe(200)',
      'expect(historyBody.status).toBe(200)',
      'expect(orgBody.status).toBe(200)',
    ],
    observedBehavior:
      'The local stack accepts out-of-domain approval status query values with 200 responses.',
    requiredBehavior:
      'Approval status query parameters are finite in TypeSpec and should reject out-of-domain values.',
  },
];

export function assertFiniteDomainEvidenceFiles(repoRoot = process.cwd()): void {
  for (const entry of FINITE_DOMAIN_EVIDENCE) {
    for (const key of entry.domainKeys) {
      const domain = GOVERNANCE_SPEC_DOMAINS[key];
      if (!Array.isArray(domain) || domain.length === 0) {
        throw new Error(`Finite domain ${String(key)} is empty for ${entry.id}`);
      }
    }
    const source = readFileSync(resolve(repoRoot, entry.proofFile), 'utf8');
    const missingPatterns = missingExecutableEvidencePatterns(
      source,
      entry.evidencePattern,
      entry.executablePatterns,
    );
    if (missingPatterns.length > 0) {
      throw new Error(
        `Missing executable finite-domain evidence for ${entry.id}: ${missingPatterns.join(', ')}`,
      );
    }
    if (entry.executablePatterns.length === 0) {
      throw new Error(`Finite-domain evidence ${entry.id} lacks executable patterns`);
    }
  }

  for (const gap of FINITE_DOMAIN_GAPS) {
    for (const key of gap.domainKeys) {
      const domain = GOVERNANCE_SPEC_DOMAINS[key];
      if (!Array.isArray(domain) || domain.length === 0) {
        throw new Error(`Finite-domain gap ${gap.id} has empty domain ${String(key)}`);
      }
    }
    const source = readFileSync(resolve(repoRoot, gap.proofFile), 'utf8');
    const missingPatterns = missingExecutableEvidencePatterns(
      source,
      gap.evidencePattern,
      gap.executablePatterns,
    );
    if (missingPatterns.length > 0) {
      throw new Error(
        `Missing executable finite-domain gap evidence for ${gap.id}: ${missingPatterns.join(', ')}`,
      );
    }
    if (gap.operationIds.length === 0) {
      throw new Error(`Finite-domain gap ${gap.id} must name affected operation IDs`);
    }
    if (gap.executablePatterns.length === 0) {
      throw new Error(`Finite-domain gap ${gap.id} lacks executable patterns`);
    }
  }
}

function stripCodeComments(source: string): string {
  let out = '';
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i++;
      out += ' ';
      continue;
    }
    out += ch;
  }
  return out;
}

function missingExecutableEvidencePatterns(
  source: string,
  evidencePattern: string,
  executablePatterns: readonly string[],
): string[] {
  const matchingBlocks = extractTestBlocks(source)
    .map((block) => `${block.name}\n${stripCodeComments(block.source)}`)
    .filter((blockSource) => blockSource.includes(evidencePattern));
  if (matchingBlocks.length === 0) return [evidencePattern];
  const complete = matchingBlocks.some((blockSource) =>
    executablePatterns.every((pattern) => blockSource.includes(pattern)),
  );
  if (complete) return [];
  const bestBlock = matchingBlocks
    .map((blockSource) => ({
      blockSource,
      matched: executablePatterns.filter((pattern) => blockSource.includes(pattern)).length,
    }))
    .sort((left, right) => right.matched - left.matched)[0]?.blockSource ?? '';
  return executablePatterns.filter((pattern) =>
    !bestBlock.includes(pattern),
  );
}

function extractTestBlocks(source: string): Array<{ name: string; source: string }> {
  const out: Array<{ name: string; source: string }> = [];
  const skippedRanges = findSkippedDescribeRanges(source);
  const testRe = /\b(?:it|test)\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1\s*,/g;
  for (const match of source.matchAll(testRe)) {
    const start = match.index ?? 0;
    if (isInsideRange(start, skippedRanges)) continue;
    const arrowIndex = source.indexOf('=>', start);
    if (arrowIndex === -1) continue;
    const bodyStart = source.indexOf('{', arrowIndex);
    if (bodyStart === -1) continue;
    const bodyEnd = findMatchingBrace(source, bodyStart);
    if (bodyEnd === -1) continue;
    out.push({
      name: match[2],
      source: source.slice(start, bodyEnd + 1),
    });
  }
  return out;
}

function findSkippedDescribeRanges(source: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const describeSkipRe = /\bdescribe\.skip\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1\s*,/g;
  for (const match of source.matchAll(describeSkipRe)) {
    const start = match.index ?? 0;
    const arrowIndex = source.indexOf('=>', start);
    if (arrowIndex === -1) continue;
    const bodyStart = source.indexOf('{', arrowIndex);
    if (bodyStart === -1) continue;
    const bodyEnd = findMatchingBrace(source, bodyStart);
    if (bodyEnd === -1) continue;
    ranges.push({ start, end: bodyEnd + 1 });
  }
  return ranges;
}

function isInsideRange(index: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function findMatchingBrace(source: string, start: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
