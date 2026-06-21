import { describe, expect, it } from 'vitest';
import {
  buildRequestConstraintConformance,
} from '../helpers/request-constraint-conformance';
import {
  LOCAL_STACK_SCENARIO_MATRIX,
} from '../../ts/src/governance/generated/capability-matrix.js';

describe('generated request constraint conformance ledger', () => {
  const ledger = buildRequestConstraintConformance();

  it('classifies every generated executable request constraint', () => {
    expect(ledger.generatedBy).toBe('tests/helpers/request-constraint-conformance.ts');
    expect(ledger.sources).toEqual(
      expect.arrayContaining([
        'ts/src/client/generated/request-preflight.ts',
        'ts/src/core-client/generated/request-preflight.ts',
        'ts/src/governance/generated/capability-matrix.ts',
        'tests/helpers/finite-domain-conformance.ts',
        'tests/helpers/boundary-conformance.ts',
        'tests/unit/client.test.ts',
      ]),
    );
    expect(ledger.unclassified).toEqual([]);
    expect(ledger.summary.unknownGeneratedEvidenceConstraintKeys).toEqual([]);
    expect(ledger.summary.unknownSdkGeneratedPreflightOnlyConstraintKeys).toEqual([]);
    expect(ledger.summary.totalConstraints).toBe(ledger.constraints.length);
  });

  it('keeps raw backend/core gaps separate from SDK preflight closures', () => {
    const expectedRawSemanticGapConstraintKeys = [
      'backend:AgentController_getAgentEvaluations:query.page:minimum',
      'backend:AgentController_getAgentEvaluations:query.pattern:maxLength',
      'backend:AgentController_getAgentEvaluations:query.perPage:minimum',
      'backend:AgentController_getApprovalHistory:query.status:enum',
      'backend:AgentController_getPendingApprovals:query.status:enum',
      'backend:OrganizationController_getApprovals:query.status:enum',
      'core:evaluateGovernance:body.attempt:minimum',
      'core:evaluateGovernance:body.cost_usd:format',
      'core:evaluateGovernance:body.cost_usd:type',
      'core:evaluateGovernance:body.timestamp:format',
    ];

    expect(ledger.summary.provenRawSemanticGapClosures).toEqual(
      LOCAL_STACK_SCENARIO_MATRIX.rawBackendCoreSemanticGaps.map((entry) => entry.id).sort(),
    );
    expect(ledger.summary.provenRawSemanticGapClosures).toEqual(
      ledger.summary.knownRawSemanticGaps,
    );
    expect(ledger.summary.missingRawSemanticGapClosures).toEqual([]);
    expect(ledger.constraints.filter(
      (entry) => entry.disposition === 'raw-semantic-gap-sdk-closed',
    ).map((entry) => entry.key)).toEqual(expectedRawSemanticGapConstraintKeys);
    expect(ledger.constraints
      .filter((entry) => entry.disposition === 'raw-semantic-gap-sdk-closed')
      .flatMap((entry) => entry.semanticGapIds)
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort()).toEqual(
      LOCAL_STACK_SCENARIO_MATRIX.rawBackendCoreSemanticGaps.map((entry) => entry.id).sort(),
    );
  });

  it('distinguishes raw local-stack evidence, transport gates, and SDK-only preflight', () => {
    const transportGatedConstraintKeys = ledger.constraints
      .filter((entry) => entry.disposition === 'transport-or-feature-gated')
      .map((entry) => entry.key)
      .sort();

    expect(ledger.summary.byDisposition['local-stack-e2e']).toBeGreaterThan(0);
    expect(transportGatedConstraintKeys.length).toBeGreaterThan(0);
    expect(ledger.summary.byDisposition['transport-or-feature-gated']).toBe(
      transportGatedConstraintKeys.length,
    );
    expect([
      ...new Set(
        ledger.constraints
          .filter((entry) => entry.disposition === 'transport-or-feature-gated')
          .map((entry) => entry.operationId),
      ),
    ].sort()).toEqual(
      LOCAL_STACK_SCENARIO_MATRIX.transportOrFeatureGatedOperationIds.filter((operationId) =>
        ledger.constraints.some(
          (entry) =>
            entry.operationId === operationId &&
            entry.disposition === 'transport-or-feature-gated',
        ),
      ).sort(),
    );
    expect(ledger.summary.transportGatedPublicWrapperClosures).toEqual({
      constraintCount: transportGatedConstraintKeys.length,
      total: transportGatedConstraintKeys.length * ledger.transportGatedPublicWrapperClosures.length,
      proven: transportGatedConstraintKeys.length * ledger.transportGatedPublicWrapperClosures.length,
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
      expect(closure.constraintKeys, closure.sdkTarget).toEqual(
        transportGatedConstraintKeys,
      );
    }
    expect(ledger.summary.byDisposition['sdk-generated-preflight']).toBe(0);
    expect(ledger.summary.sdkGeneratedPreflightOnly).toBe(
      LOCAL_STACK_SCENARIO_MATRIX.sdkGeneratedPreflightOnlyConstraintKeys.length,
    );
    for (const spec of LOCAL_STACK_SCENARIO_MATRIX.requestConstraintEvidenceSpecs) {
      expect(spec.requestConstraintKeys.length, spec.id).toBeGreaterThan(0);
      for (const key of spec.requestConstraintKeys) {
        expect(
          ledger.constraints.find((entry) => entry.key === key)?.evidenceIds,
          `${spec.id}:${key}`,
        ).toContain(spec.id);
      }
    }
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
