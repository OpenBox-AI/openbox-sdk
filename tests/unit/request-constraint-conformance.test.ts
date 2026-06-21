import { describe, expect, it } from 'vitest';
import {
  buildRequestConstraintConformance,
} from '../helpers/request-constraint-conformance';

describe('generated request constraint conformance ledger', () => {
  const ledger = buildRequestConstraintConformance();

  it('classifies every generated executable request constraint', () => {
    expect(ledger.generatedBy).toBe('tests/helpers/request-constraint-conformance.ts');
    expect(ledger.sources).toEqual(
      expect.arrayContaining([
        'ts/src/client/generated/request-preflight.ts',
        'ts/src/core-client/generated/request-preflight.ts',
        'tests/helpers/finite-domain-conformance.ts',
        'tests/helpers/boundary-conformance.ts',
        'tests/unit/client.test.ts',
      ]),
    );
    expect(ledger.unclassified).toEqual([]);
    expect(ledger.summary.totalConstraints).toBe(ledger.constraints.length);
  });

  it('keeps raw backend/core gaps separate from SDK preflight closures', () => {
    expect(ledger.summary.provenRawSemanticGapClosures).toEqual(
      ledger.summary.knownRawSemanticGaps,
    );
    expect(ledger.summary.missingRawSemanticGapClosures).toEqual([]);
    expect(ledger.constraints.filter(
      (entry) => entry.disposition === 'raw-semantic-gap-sdk-closed',
    ).map((entry) => entry.key)).toEqual(
      expect.arrayContaining([
        'backend:AgentController_getApprovalHistory:query.status:enum',
        'backend:AgentController_getPendingApprovals:query.status:enum',
        'backend:OrganizationController_getApprovals:query.status:enum',
        'backend:AgentController_getAgentEvaluations:query.page:minimum',
        'backend:AgentController_getAgentEvaluations:query.pattern:maxLength',
        'backend:AgentController_getAgentEvaluations:query.perPage:minimum',
        'core:evaluateGovernance:body.attempt:minimum',
        'core:evaluateGovernance:body.cost_usd:format',
        'core:evaluateGovernance:body.cost_usd:type',
        'core:evaluateGovernance:body.timestamp:format',
      ]),
    );
  });

  it('distinguishes raw local-stack evidence, transport gates, and SDK-only preflight', () => {
    expect(ledger.summary.byDisposition['local-stack-e2e']).toBeGreaterThan(0);
    expect(ledger.summary.byDisposition['transport-or-feature-gated']).toBe(22);
    expect(ledger.summary.transportGatedPublicWrapperClosures).toEqual({
      constraintCount: 22,
      total: 44,
      proven: 44,
      missing: 0,
    });
    expect(ledger.transportGatedPublicWrapperClosures).toEqual([
      expect.objectContaining({
        sdkTarget: 'typescript',
        proofFile: 'tests/unit/client.test.ts',
        status: 'proven',
        missingEvidencePatterns: [],
      }),
      expect.objectContaining({
        sdkTarget: 'python',
        proofFile: 'python/tests/test_request_preflight.py',
        status: 'proven',
        missingEvidencePatterns: [],
      }),
    ]);
    for (const closure of ledger.transportGatedPublicWrapperClosures) {
      expect(closure.constraintKeys, closure.sdkTarget).toHaveLength(22);
      expect(closure.constraintKeys, closure.sdkTarget).toEqual(
        ledger.constraints
          .filter((entry) => entry.disposition === 'transport-or-feature-gated')
          .map((entry) => entry.key)
          .sort(),
      );
    }
    expect(ledger.summary.byDisposition['sdk-generated-preflight']).toBe(0);
    expect(ledger.constraints.find(
      (entry) => entry.key === 'core:evaluateGovernance:body.attempt:format',
    )).toEqual(expect.objectContaining({
      disposition: 'local-stack-e2e',
      evidenceIds: expect.arrayContaining(['core-governance-attempt-integer-request-boundary']),
    }));
    expect(ledger.constraints.find(
      (entry) => entry.key === 'core:evaluateGovernance:body.attempt:integer',
    )).toEqual(expect.objectContaining({
      disposition: 'local-stack-e2e',
      evidenceIds: expect.arrayContaining(['core-governance-attempt-integer-request-boundary']),
    }));
    expect(ledger.constraints.find(
      (entry) => entry.key === 'core:evaluateGovernance:body.attempt:type',
    )).toEqual(expect.objectContaining({
      disposition: 'local-stack-e2e',
      evidenceIds: expect.arrayContaining(['core-governance-attempt-integer-request-boundary']),
    }));
    expect(ledger.constraints.find(
      (entry) => entry.key === 'core:evaluateGovernance:body.timestamp:type',
    )).toEqual(expect.objectContaining({
      disposition: 'local-stack-e2e',
      evidenceIds: expect.arrayContaining(['core-governance-timestamp-type-request-boundary']),
    }));
    for (const key of [
      'backend:OrganizationController_removeMembers:body.memberIds:type',
      'backend:OrganizationController_removeMembers:body.memberIds:minItems',
      'backend:OrganizationController_removeMembers:body.memberIds:maxItems',
    ]) {
      expect(ledger.constraints.find((entry) => entry.key === key)).toEqual(expect.objectContaining({
        disposition: 'local-stack-e2e',
        evidenceIds: expect.arrayContaining(['remove-members-array-item-boundaries']),
      }));
    }
  });
});
