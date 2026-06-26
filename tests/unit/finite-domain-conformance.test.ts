import { describe, expect, it } from 'vitest';
import {
  FINITE_DOMAIN_EVIDENCE,
  FINITE_DOMAIN_GAPS,
  assertFiniteDomainEvidenceFiles,
} from '../helpers/finite-domain-conformance';
import { GOVERNANCE_SPEC_DOMAINS } from '../helpers/governance-spec-domains';

describe('finite-domain conformance ledger', () => {
  it('links every extracted finite domain to explicit e2e evidence', () => {
    expect(FINITE_DOMAIN_EVIDENCE.map((entry) => entry.id).sort()).toEqual([
      'agent-attestation-mode-invalid-members',
      'agent-attestation-mode-members',
      'api-key-permission-members',
      'approval-decision-action-invalid-members',
      'approval-decision-action-members',
      'approval-status-agent-query-members',
      'approval-status-invalid-query-boundaries',
      'approval-status-org-query-members',
      'audit-event-result-export-status-invalid-members',
      'audit-event-result-export-status-members',
      'behavior-rule-state-members',
      'behavior-rule-trigger-members',
      'behavior-rule-verdict-members',
      'claude-code-governance-status-members',
      'core-auth-environment-members',
      'core-governance-payload-finite-members',
      'core-guardrails-input-type-members',
      'core-legacy-action-members',
      'core-verdict-constrain-member',
      'core-verdict-opa-members',
      'demo-setup-status-members',
      'governance-checklist-scoring-domain-members',
      'guardrail-create-members',
      'guardrail-field-status-members',
      'guardrail-update-members',
      'local-governance-verdict-matrix-domain-members',
      'local-stack-scenario-matrix-domain-members',
      'openbox-capability-id-members',
      'organization-timezone-invalid-members',
      'organization-timezone-members',
      'provider-capability-provider-tier-members',
      'provider-runtime-status-promotion-members',
      'rules-projection-trigger-severity-source-members',
      'session-status-duration-invalid-query-members',
      'session-status-duration-query-members',
      'sso-method-members',
      'trust-history-duration-invalid-query-members',
      'trust-history-duration-query-members',
      'usage-wire-case-members',
      'webhook-event-type-members',
      'welcome-email-type-members',
    ]);
    assertFiniteDomainEvidenceFiles();
  });

  it('keeps finite-domain semantic gaps closed', () => {
    expect(FINITE_DOMAIN_GAPS.map((entry) => entry.id)).toEqual([]);
  });

  it('requires every extracted finite domain to have evidence or an explicit gap', () => {
    const evidencedKeys = new Set(
      FINITE_DOMAIN_EVIDENCE.flatMap((entry) => entry.domainKeys),
    );
    const gapKeys = new Set(
      FINITE_DOMAIN_GAPS.flatMap((entry) => entry.domainKeys),
    );
    const untrackedKeys = Object.keys(GOVERNANCE_SPEC_DOMAINS)
      .filter((key) => !evidencedKeys.has(key as keyof typeof GOVERNANCE_SPEC_DOMAINS))
      .filter((key) => !gapKeys.has(key as keyof typeof GOVERNANCE_SPEC_DOMAINS));

    expect(untrackedKeys).toEqual([]);
  });
});
