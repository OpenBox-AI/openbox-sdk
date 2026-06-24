import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildLocalStackConformanceMatrix,
  localStackScenarioDomainRefsForTesting,
  providerCapabilityDomainRefsForTesting,
  type LocalStackConformanceMatrix,
  type OperationCoverage,
} from '../helpers/local-stack-conformance';
import { GOVERNANCE_SPEC_DOMAINS } from '../helpers/governance-spec-domains';

function operation(
  matrix: LocalStackConformanceMatrix,
  operationId: string,
): OperationCoverage {
  const found = matrix.operations.find((entry) => entry.operation.operationId === operationId);
  expect(found, operationId).toBeDefined();
  return found!;
}

function objective(matrix: LocalStackConformanceMatrix, id: string) {
  const found = matrix.objectives.find((entry) => entry.id === id);
  expect(found, id).toBeDefined();
  return found!;
}

function outcome(matrix: LocalStackConformanceMatrix, id: string) {
  const found = matrix.outcomes.find((entry) => entry.id === id);
  expect(found, id).toBeDefined();
  return found!;
}

const PROOF_RANK: Record<string, number> = {
  none: 0,
  smoke: 1,
  'negative-path': 2,
  behavioral: 3,
  conformance: 4,
};

function proofAtLeast(proofLevel: string, minimum: string): boolean {
  return PROOF_RANK[proofLevel] >= PROOF_RANK[minimum];
}

function sortedOperationIds(operationIds: readonly string[]): string[] {
  return [...operationIds].sort();
}

function sortedUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function scenario(matrix: LocalStackConformanceMatrix, id: string) {
  const found = matrix.scenarioPaths.find((entry) => entry.id === id);
  expect(found, id).toBeDefined();
  return found!;
}

const providerCapabilitiesFixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'codegen/fixtures/provider-capabilities.json'), 'utf8'),
) as {
  capabilityIds: string[];
  providerIds: string[];
  supportTiers: string[];
  localStackScenarioMatrix: {
    requiredObjectiveIds: string[];
    requiredOutcomeSpecs: Array<{
      id: string;
      label: string;
      source: string;
      minimumProofLevel: string;
      operationIds: string[];
      providerGuardCapabilities: string[];
      exceptionCapabilities: string[];
    }>;
    requiredObjectiveSpecs: Array<{
      id: string;
      label: string;
      minimumProofLevel: string;
      operationIds: string[];
    }>;
    transportOrFeatureGatedOperationIds: string[];
    requestConstraintEvidenceSpecs: Array<{
      id: string;
      requestConstraintKeys: string[];
    }>;
    requestConstraintDomainSpecs: Array<{
      domainKey: string;
      requestConstraintKeys: string[];
    }>;
    sdkGeneratedPreflightOnlyConstraintKeys: string[];
  };
};

describe('local-stack conformance matrix', () => {
  const matrix = buildLocalStackConformanceMatrix();
  const providerDomains = {
    capabilityIds: providerCapabilitiesFixture.capabilityIds,
    providerIds: providerCapabilitiesFixture.providerIds,
    supportTiers: providerCapabilitiesFixture.supportTiers,
  };
  const localStackDomains = {
    categoryIds: GOVERNANCE_SPEC_DOMAINS.localStackScenarioCategories,
    axisIds: GOVERNANCE_SPEC_DOMAINS.localStackScenarioAxes,
    proofLevels: GOVERNANCE_SPEC_DOMAINS.localStackProofLevels,
    outcomeSources: GOVERNANCE_SPEC_DOMAINS.localStackOutcomeSources,
    sdkSemanticGapClosureTargets: GOVERNANCE_SPEC_DOMAINS.sdkSemanticGapClosureTargets,
  };

  it('is derived from generated TypeSpec fixtures and current e2e files', () => {
    expect(matrix.generatedBy).toBe('tests/helpers/local-stack-conformance.ts');
    expect(matrix.sources).toEqual(
      expect.arrayContaining([
        'specs/typespec/backend/main.tsp',
        'specs/typespec/core/main.tsp',
        'specs/typespec/govern/capabilities.tsp',
        'tests/e2e/**/*.test.ts',
        'tests/unit/request-preflight-conformance.test.ts',
        'python/tests/test_request_preflight.py',
        'python/openbox_sdk/generated/request_preflight.py',
        'tests/helpers/finite-domain-conformance.ts',
        'tests/helpers/boundary-conformance.ts',
      ]),
    );
    const operationsWithE2eHits = matrix.operations.filter((entry) => entry.hits.length > 0);
    const operationsWithBehavioralOrBetterHits = matrix.operations.filter((entry) =>
      proofAtLeast(entry.proofLevel, 'behavioral'),
    );
    const operationsWithConformanceHits = matrix.operations.filter((entry) =>
      proofAtLeast(entry.proofLevel, 'conformance'),
    );
    const smokeHits = matrix.operations.flatMap((entry) =>
      entry.hits
        .filter((hit) => hit.proofLevel === 'smoke')
        .map((hit) => ({
          operationId: entry.operation.operationId,
          file: hit.file,
          testName: hit.testName,
          call: hit.call,
        })),
    );
    const sdkSemanticGapClosures = matrix.sdkSemanticGapClosures;
    const requestConstraints = matrix.requestConstraints;
    const incompleteOutcomeIds = matrix.outcomes
      .filter((entry) => entry.status === 'incomplete')
      .map((entry) => entry.id)
      .sort();
    const markerOnlyProofBlockRefs = matrix.scenarioPaths
      .flatMap((entry) =>
        entry.markerOnlyProofBlockKeys.map((blockKey) => `${entry.id}:${blockKey}`),
      )
      .sort();
    const backendCoreAffectedOperationIds = sortedUniqueStrings(
      matrix.backendCoreGapRemediationTargets.flatMap((entry) => entry.operationIds),
    );
    const backendCoreRequestConstraintKeys = sortedUniqueStrings(
      matrix.backendCoreGapRemediationTargets.flatMap((entry) => entry.requestConstraintKeys),
    );
    const backendCoreRawProofFiles = sortedUniqueStrings(
      matrix.backendCoreGapRemediationTargets.map((entry) => entry.rawProofFile),
    );
    const backendCoreRemediationRefs = sortedUniqueStrings(
      matrix.backendCoreGapRemediationTargets.flatMap((entry) => entry.remediationRefs),
    );
    const backendCoreSdkClosureTargets = sortedUniqueStrings(
      matrix.backendCoreGapRemediationTargets.flatMap((entry) => entry.sdkClosureTargets),
    );

    expect(matrix.summary.totalOperations).toBe(matrix.operations.length);
    expect(matrix.summary.operationsWithE2eHits).toBe(operationsWithE2eHits.length);
    expect(matrix.summary.operationsWithBehavioralOrBetterHits).toBe(
      operationsWithBehavioralOrBetterHits.length,
    );
    expect(matrix.summary.operationsWithConformanceHits).toBe(operationsWithConformanceHits.length);
    expect(matrix.summary.operationsWithConformanceHits).toBe(matrix.summary.totalOperations);
    expect(matrix.summary.operationsWithoutE2eHits).toBe(0);
    expect(matrix.summary.smokeHitCount).toBe(smokeHits.length);
    expect(matrix.summary.smokeHitCount).toBe(0);
    expect(matrix.summary.unresolvedMethodHitCount).toBe(matrix.unresolvedMethodHits.length);
    expect(matrix.summary.unresolvedMethodHitCount).toBe(0);
    expect(matrix.summary.smokeOnlyOperations).toBe(0);
    expect(matrix.summary.knownSemanticGaps).toBe(matrix.semanticGaps.length);
    expect(matrix.summary.outcomes).toEqual({
      total: matrix.outcomes.length,
      proven: matrix.outcomes.filter((entry) => entry.status === 'proven').length,
      incomplete: incompleteOutcomeIds.length,
      incompleteOutcomeIds,
    });
    expect(matrix.summary.outcomes.incompleteOutcomeIds).toEqual([]);
    expect(matrix.summary.backendCoreGaps).toEqual({
      status: matrix.scenarioMatrix.backendCoreGapStatus,
      known: matrix.scenarioMatrix.knownBackendCoreGapIds.length,
      knownGapIds: matrix.scenarioMatrix.knownBackendCoreGapIds,
      generated: matrix.scenarioMatrix.generatedBackendCoreGapIds.length,
      generatedGapIds: matrix.scenarioMatrix.generatedBackendCoreGapIds,
      remediationTargets: matrix.scenarioMatrix.backendCoreGapRemediationTargetIds.length,
      remediationTargetIds: matrix.scenarioMatrix.backendCoreGapRemediationTargetIds,
      rawGapOutcomeRefs: matrix.scenarioMatrix.rawSemanticGapOutcomeRefs,
      affectedOperations: backendCoreAffectedOperationIds.length,
      affectedOperationIds: backendCoreAffectedOperationIds,
      requestConstraints: backendCoreRequestConstraintKeys.length,
      requestConstraintKeys: backendCoreRequestConstraintKeys,
      rawProofFiles: backendCoreRawProofFiles,
      remediationRefs: backendCoreRemediationRefs,
      sdkClosureTargets: backendCoreSdkClosureTargets,
      missingGeneratedGapIds: matrix.scenarioMatrix.missingGeneratedBackendCoreGapIds,
      unexpectedGeneratedGapIds: matrix.scenarioMatrix.unexpectedGeneratedBackendCoreGapIds,
      missingRemediationTargetIds:
        matrix.scenarioMatrix.missingBackendCoreGapRemediationTargetIds,
      unexpectedRemediationTargetIds:
        matrix.scenarioMatrix.unexpectedBackendCoreGapRemediationTargetIds,
      specMismatchRefs: matrix.scenarioMatrix.backendCoreGapSpecMismatchRefs,
      missingRemediationRefRefs:
        matrix.scenarioMatrix.missingBackendCoreGapRemediationRefRefs,
      invalidRemediationRefRefs:
        matrix.scenarioMatrix.invalidBackendCoreGapRemediationRefRefs,
      serviceMismatchRemediationRefRefs:
        matrix.scenarioMatrix.serviceMismatchBackendCoreGapRemediationRefRefs,
      duplicateRemediationRefRefs:
        matrix.scenarioMatrix.duplicateBackendCoreGapRemediationRefRefs,
      missingRemediationFileRefs:
        matrix.scenarioMatrix.missingBackendCoreGapRemediationFileRefs,
      invalidRemediationLineRefs:
        matrix.scenarioMatrix.invalidBackendCoreGapRemediationLineRefs,
      remediationRepositoryStatuses:
        matrix.scenarioMatrix.remediationRepositoryStatuses,
      missingRawProofConstraintKeyRefs: matrix.scenarioMatrix.missingRawProofConstraintKeyRefs,
    });
    expect(matrix.summary.backendCoreGaps).toMatchObject({
      status: 'gap-free',
      known: 0,
      knownGapIds: [],
      generated: 0,
      generatedGapIds: [],
      remediationTargets: 0,
      remediationTargetIds: [],
      affectedOperations: 0,
      affectedOperationIds: [],
      requestConstraints: 0,
      requestConstraintKeys: [],
      rawProofFiles: [],
      remediationRefs: [],
      sdkClosureTargets: [],
      missingGeneratedGapIds: [],
      unexpectedGeneratedGapIds: [],
      missingRemediationTargetIds: [],
      unexpectedRemediationTargetIds: [],
      specMismatchRefs: [],
      missingRemediationRefRefs: [],
      invalidRemediationRefRefs: [],
      serviceMismatchRemediationRefRefs: [],
      duplicateRemediationRefRefs: [],
      missingRawProofConstraintKeyRefs: [],
    });
    expect(matrix.summary.scenarioPaths).toEqual({
      total: matrix.scenarioPaths.length,
      localStackRequired: matrix.scenarioPaths.filter((entry) => entry.localStackRequired).length,
      localStackProven: matrix.scenarioPaths.filter(
        (entry) => entry.localStackRequired && entry.status === 'proven',
      ).length,
      providerOwned: matrix.scenarioPaths.filter((entry) => !entry.localStackRequired).length,
      providerOwnedProven: matrix.scenarioPaths.filter(
        (entry) => !entry.localStackRequired && entry.status === 'proven',
      ).length,
      incomplete: matrix.scenarioPaths.filter((entry) => entry.status !== 'proven').length,
      incompleteScenarioIds: matrix.scenarioPaths
        .filter((entry) => entry.status !== 'proven')
        .map((entry) => entry.id)
        .sort(),
      missingScenarioProofMarkerIds: matrix.scenarioPaths
        .filter((entry) => entry.missingScenarioProofMarker)
        .map((entry) => entry.id)
        .sort(),
      markerOnlyProofBlockRefs,
      missingAssertedEvidenceScenarioIds: matrix.scenarioPaths
        .filter((entry) => entry.missingAssertedEvidence)
        .map((entry) => entry.id)
        .sort(),
    });
    expect(matrix.summary.scenarioPaths).toEqual({
      total: 48,
      localStackRequired: 45,
      localStackProven: 45,
      providerOwned: 3,
      providerOwnedProven: 3,
      incomplete: 0,
      incompleteScenarioIds: [],
      missingScenarioProofMarkerIds: [],
      markerOnlyProofBlockRefs: [],
      missingAssertedEvidenceScenarioIds: [],
    });
    expect(matrix.summary.localStackAxes).toEqual({
      requiredAxes: matrix.scenarioMatrix.requiredLocalStackAxes,
      categoryCount: matrix.scenarioMatrix.categoryAxisCoverage.length,
      missingAxes: matrix.scenarioMatrix.missingLocalStackAxes,
      incompleteAxes: matrix.scenarioMatrix.incompleteLocalStackAxes,
      missingCategoryAxisRefs: matrix.scenarioMatrix.missingCategoryAxisRefs,
      incompleteCategoryAxisRefs: matrix.scenarioMatrix.incompleteCategoryAxisRefs,
    });
    expect(matrix.summary.localStackAxes).toEqual({
      requiredAxes: [
        'approval',
        'cost',
        'dbquery',
        'failure',
        'goal',
        'guardrails',
        'happy',
        'matrix',
        'opa',
        'order',
        'rego',
        'span',
        'tool',
        'usage',
      ],
      categoryCount: 8,
      missingAxes: [],
      incompleteAxes: [],
      missingCategoryAxisRefs: [],
      incompleteCategoryAxisRefs: [],
    });
    expect(matrix.summary.providerExceptions).toEqual({
      total: matrix.exceptions.length,
      observeOnly: matrix.exceptions.filter((entry) => entry.tier === 'observe-only').length,
      outOfScope: matrix.exceptions.filter((entry) => entry.tier === 'out-of-scope').length,
      diagnoseOnly: matrix.exceptions.filter((entry) => entry.tier === 'diagnose-only').length,
      capabilityIds: [...new Set(matrix.exceptions.map((entry) => entry.capability))].sort(),
      providerIds: [...new Set(matrix.exceptions.map((entry) => entry.provider))].sort(),
    });
    expect(matrix.summary.providerExceptions).toEqual({
      total: 26,
      observeOnly: 13,
      outOfScope: 9,
      diagnoseOnly: 4,
      capabilityIds: [
        'hooks',
        'install-doctor',
        'mcp',
        'plugins',
        'skills',
        'subagents-agents',
        'usage-cost',
      ],
      providerIds: [
        'anthropic-agent-sdk',
        'codex',
        'copilotkit',
        'cursor',
        'mcp',
        'n8n',
        'openai-agents-sdk',
      ],
    });
    expect(matrix.summary.providerGuards).toEqual({
      capabilityIds: matrix.providerGuards.map((entry) => entry.capability).sort(),
      totalGuardTests: matrix.providerGuards.reduce(
        (total, entry) => total + entry.guardTestRefs.length,
        0,
      ),
      totalProofBlocks: matrix.providerGuards.reduce(
        (total, entry) => total + entry.guardProofBlockKeys.length,
        0,
      ),
      sharedGuardTestRefs: matrix.providerGuards.flatMap((entry) =>
        entry.sharedGuardTestRefs.map(
          (ref) => `${entry.capability}:${ref.providers.join('+')}:${ref.guardTest}`,
        ),
      ).sort(),
      missingGuardTestRefs: [],
      missingProviderCapabilityGuardProviderRefs: [],
      unexpectedProviderCapabilityGuardProviderRefs: [],
      providerTierMismatchRefs: [],
      duplicateProviderCapabilityGuardProviderRefs: [],
    });
    expect(matrix.summary.providerGuards).toEqual({
      capabilityIds: [
        'approvals-hitl',
        'guardrails',
        'opa-rules',
        'tracing',
        'usage-cost',
      ],
      totalGuardTests: 40,
      totalProofBlocks: 33,
      sharedGuardTestRefs: [
        'opa-rules:anthropic-agent-sdk+claude-code+codex+copilotkit+cursor+mcp+n8n+openai-agents-sdk:tests/unit/policy-evaluation-guard.test.ts#keeps OPA/Rego and behavior-rule evaluation backend-owned in SDK sources',
      ],
      missingGuardTestRefs: [],
      missingProviderCapabilityGuardProviderRefs: [],
      unexpectedProviderCapabilityGuardProviderRefs: [],
      providerTierMismatchRefs: [],
      duplicateProviderCapabilityGuardProviderRefs: [],
    });
    expect(matrix.summary.requestConstraints).toEqual({
      total: requestConstraints.summary.totalConstraints,
      localStackE2e: requestConstraints.summary.byDisposition['local-stack-e2e'],
      rawSemanticGapSdkClosed:
        requestConstraints.summary.byDisposition['raw-semantic-gap-sdk-closed'],
      transportOrFeatureGated:
        requestConstraints.summary.byDisposition['transport-or-feature-gated'],
      sdkGeneratedPreflightOnly: requestConstraints.summary.sdkGeneratedPreflightOnly,
      unclassified: requestConstraints.unclassified.length,
      missingRawSemanticGapClosures:
        requestConstraints.summary.missingRawSemanticGapClosures.length,
      unknownGeneratedRequestConstraintEvidenceRefs:
        requestConstraints.summary.unknownGeneratedEvidenceConstraintKeys.length,
      unknownGeneratedRequestConstraintDomainRefs:
        requestConstraints.summary.unknownGeneratedDomainConstraintKeys.length +
        requestConstraints.summary.unknownGeneratedDomainKeys.length,
      unknownSdkGeneratedPreflightOnlyConstraintRefs:
        requestConstraints.summary.unknownSdkGeneratedPreflightOnlyConstraintKeys.length,
      missingTransportGatedPublicWrapperClosures:
        requestConstraints.transportGatedPublicWrapperClosures.filter(
          (entry) => entry.status !== 'proven',
        ).length,
      transportGatedPublicWrapperClosures:
        requestConstraints.summary.transportGatedPublicWrapperClosures,
    });
    expect(matrix.summary.requestConstraints.total).toBe(365);
    expect(matrix.summary.requestConstraints.unclassified).toBe(0);
    expect(matrix.summary.requestConstraints.sdkGeneratedPreflightOnly).toBe(0);
    expect(matrix.summary.requestConstraints.missingRawSemanticGapClosures).toBe(0);
    expect(matrix.summary.requestConstraints.missingTransportGatedPublicWrapperClosures).toBe(0);
    expect(matrix.summary.requestConstraints.transportGatedPublicWrapperClosures).toEqual({
      constraintCount: 22,
      total: 44,
      proven: 44,
      missing: 0,
    });
    expect(matrix.summary.sdkSemanticGapClosures).toEqual({
      total: sdkSemanticGapClosures.length,
      proven: sdkSemanticGapClosures.filter((entry) => entry.status === 'proven').length,
      missing: sdkSemanticGapClosures.filter((entry) => entry.status !== 'proven').length,
    });
    expect(matrix.scenarioMatrix.id).toBe('backend-core-governance-full-matrix');
    expect(matrix.scenarioMatrix.status).toBe('proven');
    expect(matrix.scenarioMatrix.duplicateOperationIdRefs).toEqual([]);
    expect(matrix.scenarioMatrix.duplicateServiceOperationIdRefs).toEqual([]);
    expect(matrix.scenarioMatrix.duplicateOperationRouteRefs).toEqual([]);
    expect(matrix.scenarioMatrix.duplicateOperationPathPatternRefs).toEqual([]);
    expect(matrix.scenarioMatrix.operationRouteResolutionMismatchRefs).toEqual([]);
    expect(matrix.scenarioMatrix.ambiguousOperationRouteTieRefs).toEqual([]);
    expect(matrix.scenarioMatrix.underConformanceOperationRefs).toEqual([]);
    expect(matrix.scenarioMatrix.underConformanceLocalStackRequiredProofLevelRefs).toEqual([]);
    expect(matrix.scenarioMatrix.underConformanceObjectiveOperationRefs).toEqual([]);
    expect(matrix.scenarioMatrix.underConformanceLocalStackOutcomeRefs).toEqual([]);
    expect(matrix.scenarioMatrix.underConformanceProviderGuardOutcomeRefs).toEqual([]);
    expect(matrix.smokeHits).toEqual([]);
    expect(matrix.unresolvedMethodHits).toEqual([]);
    expect(matrix.unknownHits).toEqual([]);
  });

  it('classifies endpoint local-stack proof strength', () => {
    expect(operation(matrix, 'AppController_getHello').proofLevel).toBe('conformance');
    expect(operation(matrix, 'AgentController_createAgent').proofLevel).toBe('conformance');
    expect(operation(matrix, 'PolicyController_evaluate').proofLevel).toBe('conformance');

    expect(operation(matrix, 'GuardrailController_runTest').proofLevel).toBe('conformance');
  });

  it('fails generated local-stack category axis proof source and closure-target domain drift', () => {
    expect(localStackDomains.categoryIds).toBe(
      GOVERNANCE_SPEC_DOMAINS.localStackScenarioCategories,
    );
    expect(localStackDomains.axisIds).toBe(GOVERNANCE_SPEC_DOMAINS.localStackScenarioAxes);
    expect(localStackDomains.proofLevels).toBe(GOVERNANCE_SPEC_DOMAINS.localStackProofLevels);
    expect(localStackDomains.outcomeSources).toBe(
      GOVERNANCE_SPEC_DOMAINS.localStackOutcomeSources,
    );
    expect(localStackDomains.sdkSemanticGapClosureTargets).toBe(
      GOVERNANCE_SPEC_DOMAINS.sdkSemanticGapClosureTargets,
    );

    const refs = localStackScenarioDomainRefsForTesting({
      contract: {
        ...matrix.scenarioMatrix,
        requiredCategories: [
          ...matrix.scenarioMatrix.requiredCategories,
          'category-domain-drift',
        ],
        requiredAxes: [...matrix.scenarioMatrix.requiredAxes, 'required-axis-domain-drift'],
        requiredLocalStackAxes: [
          ...matrix.scenarioMatrix.requiredLocalStackAxes,
          'local-stack-axis-domain-drift',
        ],
        requiredCategoryAxes: [
          ...matrix.scenarioMatrix.requiredCategoryAxes,
          {
            category: 'category-axis-category-domain-drift',
            axes: ['category-axis-domain-drift'],
          },
        ],
        requiredOutcomeSpecs: [
          ...matrix.scenarioMatrix.requiredOutcomeSpecs,
          {
            ...matrix.scenarioMatrix.requiredOutcomeSpecs[0],
            id: 'proof-level-domain-drift-outcome-spec',
            minimumProofLevel: 'minimum-proof-level-domain-drift',
          },
        ],
        requiredObjectiveSpecs: [
          ...matrix.scenarioMatrix.requiredObjectiveSpecs,
          {
            ...matrix.scenarioMatrix.requiredObjectiveSpecs[0],
            id: 'proof-level-domain-drift-objective-spec',
            minimumProofLevel: 'minimum-proof-level-domain-drift',
          },
        ],
        requiredSdkSemanticGapClosureTargets: [
          ...matrix.scenarioMatrix.requiredSdkSemanticGapClosureTargets,
          'sdk-closure-target-domain-drift',
        ],
      } as any,
      scenarioPaths: [
        ...matrix.scenarioPaths,
        {
          id: 'local-stack-domain-drift-scenario',
          category: 'scenario-category-domain-drift',
          axes: ['scenario-axis-domain-drift'],
          requiredProofLevel: 'scenario-proof-level-domain-drift',
        } as any,
      ],
      outcomes: [
        ...matrix.outcomes,
        {
          id: 'local-stack-domain-drift-outcome',
          source: 'outcome-source-domain-drift',
          minimumProofLevel: 'outcome-proof-level-domain-drift',
        } as any,
      ],
      localStackDomains,
    });

    expect(refs).toEqual({
      unknownScenarioCategoryRefs: [
        'local-stack-domain-drift-scenario:scenario-category-domain-drift',
      ],
      unknownScenarioAxisRefs: [
        'local-stack-domain-drift-scenario:scenario-axis-domain-drift',
      ],
      unknownScenarioProofLevelRefs: [
        'local-stack-domain-drift-scenario:scenario-proof-level-domain-drift',
      ],
      unknownOutcomeSourceRefs: [
        'local-stack-domain-drift-outcome:outcome-source-domain-drift',
      ],
      unknownOutcomeProofLevelRefs: [
        'local-stack-domain-drift-outcome:outcome-proof-level-domain-drift',
      ],
      unknownScenarioMatrixCategoryRefs: [
        'requiredCategories:category-domain-drift',
        'requiredCategoryAxes:category-axis-category-domain-drift',
      ],
      unknownScenarioMatrixAxisRefs: [
        'requiredAxes:required-axis-domain-drift',
        'requiredCategoryAxes:category-axis-category-domain-drift:category-axis-domain-drift',
        'requiredLocalStackAxes:local-stack-axis-domain-drift',
      ],
      unknownScenarioMatrixProofLevelRefs: [
        'requiredObjectiveSpecs:proof-level-domain-drift-objective-spec:minimumProofLevel:minimum-proof-level-domain-drift',
        'requiredOutcomeSpecs:proof-level-domain-drift-outcome-spec:minimumProofLevel:minimum-proof-level-domain-drift',
      ],
      unknownSdkSemanticGapClosureTargetRefs: [
        'requiredSdkSemanticGapClosureTargets:sdk-closure-target-domain-drift',
      ],
    });
  });

  it('fails generated capability provider and tier references outside canonical domains', () => {
    const refs = providerCapabilityDomainRefsForTesting({
      contract: {
        ...matrix.scenarioMatrix,
        requiredCapabilities: [
          ...matrix.scenarioMatrix.requiredCapabilities,
          'capability-domain-drift',
        ],
        requiredSharedProviderGuardProofCapabilities: [
          ...matrix.scenarioMatrix.requiredSharedProviderGuardProofCapabilities,
          'shared-provider-guard-domain-drift',
        ],
        requiredOutcomeSpecs: [
          ...matrix.scenarioMatrix.requiredOutcomeSpecs,
          {
            ...matrix.scenarioMatrix.requiredOutcomeSpecs[0],
            id: 'domain-drift-outcome-spec',
            providerGuardCapabilities: ['outcome-provider-guard-domain-drift'],
            exceptionCapabilities: ['outcome-exception-domain-drift'],
          },
        ],
      },
      scenarioPaths: [
        ...matrix.scenarioPaths,
        { id: 'domain-drift-scenario', capability: 'scenario-capability-domain-drift' },
      ],
      outcomes: [
        ...matrix.outcomes,
        {
          id: 'domain-drift-outcome',
          providerGuardCapabilities: ['outcome-capability-domain-drift'],
          exceptionCapabilities: ['outcome-exception-domain-drift'],
        },
      ],
      providerGuards: [
        ...matrix.providerGuards,
        {
          capability: 'provider-guard-capability-domain-drift',
          providers: ['provider-domain-drift'],
          guardProviderTiers: [
            { provider: 'guard-tier-provider-domain-drift', tier: 'guard-tier-domain-drift' },
          ],
          matrixProviderTiers: [
            { provider: 'matrix-provider-domain-drift', tier: 'matrix-tier-domain-drift' },
          ],
        },
      ],
      providerDomains,
    });

    expect(refs).toEqual({
      unknownScenarioCapabilityRefs: [
        'domain-drift-scenario:scenario-capability-domain-drift',
      ],
      unknownOutcomeCapabilityRefs: [
        'domain-drift-outcome:exceptionCapabilities:outcome-exception-domain-drift',
        'domain-drift-outcome:providerGuardCapabilities:outcome-capability-domain-drift',
      ],
      unknownScenarioMatrixCapabilityRefs: [
        'requiredCapabilities:capability-domain-drift',
        'requiredOutcomeSpecs:domain-drift-outcome-spec:exceptionCapabilities:outcome-exception-domain-drift',
        'requiredOutcomeSpecs:domain-drift-outcome-spec:providerGuardCapabilities:outcome-provider-guard-domain-drift',
        'requiredSharedProviderGuardProofCapabilities:shared-provider-guard-domain-drift',
      ],
      unknownProviderGuardCapabilityRefs: ['provider-guard-capability-domain-drift'],
      unknownProviderGuardProviderRefs: [
        'provider-guard-capability-domain-drift:guard:provider-domain-drift',
        'provider-guard-capability-domain-drift:guardTier:guard-tier-provider-domain-drift',
        'provider-guard-capability-domain-drift:matrix:matrix-provider-domain-drift',
      ],
      unknownProviderGuardTierRefs: [
        'provider-guard-capability-domain-drift:guard:guard-tier-provider-domain-drift:guard-tier-domain-drift',
        'provider-guard-capability-domain-drift:matrix:matrix-provider-domain-drift:matrix-tier-domain-drift',
      ],
    });
  });

  it('resolves overlapping generated routes to the most specific operation', () => {
    expect(operation(matrix, 'AgentController_getAgentsMetrics').operation.path).toBe(
      '/agent/metrics',
    );
    expect(operation(matrix, 'AgentController_getAgent').operation.pathPattern).toBe('/agent/{x}');
    expect(matrix.scenarioMatrix.operationRouteResolutionMismatchRefs).toEqual([]);
    expect(matrix.scenarioMatrix.ambiguousOperationRouteTieRefs).toEqual([]);
  });

  it('ties local-stack scenario evidence to blocks that hit required operations', () => {
    for (const scenarioPath of matrix.scenarioPaths) {
      if (!scenarioPath.localStackRequired || scenarioPath.operationIds.length === 0) continue;
      const operationHitBlockKeys = new Set(
        matrix.operations
          .filter((entry) => scenarioPath.operationIds.includes(entry.operation.operationId))
          .flatMap((entry) => entry.hits.map((hit) => `${hit.file}\0${hit.testName}`)),
      );

      expect(scenarioPath.proofBlockKeys.length, scenarioPath.id).toBeGreaterThan(0);
      expect(scenarioPath.missingScenarioProofMarker, scenarioPath.id).toBe(false);
      expect(scenarioPath.scenarioProofMarker, scenarioPath.id).toBe(
        `SCENARIO_PROOF: ${scenarioPath.id}`,
      );
      expect(scenarioPath.scenarioProofMarkerBlockKeys.length, scenarioPath.id).toBeGreaterThan(0);
      expect(
        scenarioPath.markerOnlyProofBlockKeys.every((blockKey) =>
          scenarioPath.scenarioProofMarkerBlockKeys.includes(blockKey),
        ),
        scenarioPath.id,
      ).toBe(true);
      expect(
        scenarioPath.proofBlockKeys.every((blockKey) =>
          scenarioPath.scenarioProofMarkerBlockKeys.includes(blockKey),
        ),
        scenarioPath.id,
      ).toBe(true);
      expect(
        scenarioPath.proofBlockKeys.every((blockKey) =>
          !scenarioPath.markerOnlyProofBlockKeys.includes(blockKey),
        ),
        scenarioPath.id,
      ).toBe(true);
      expect(
        scenarioPath.proofBlockKeys.every((blockKey) => operationHitBlockKeys.has(blockKey)),
        scenarioPath.id,
      ).toBe(true);
      expect(scenarioPath.operationProofs.map((entry) => entry.operationId).sort(), scenarioPath.id).toEqual(
        [...scenarioPath.operationIds].sort(),
      );
      expect(scenarioPath.duplicateScenarioOperationIds, scenarioPath.id).toEqual([]);
      expect(scenarioPath.duplicateScenarioAxisIds, scenarioPath.id).toEqual([]);
      expect(
        (scenarioPath.operationEvidencePatterns ?? []).map((entry) => entry.operationId).sort(),
        scenarioPath.id,
      ).toEqual([...scenarioPath.operationIds].sort());
      expect(new Set((scenarioPath.operationEvidencePatterns ?? []).map((entry) => entry.operationId)).size, scenarioPath.id).toBe(
        scenarioPath.operationIds.length,
      );
      expect(scenarioPath.missingOperationEvidencePatternIds, scenarioPath.id).toEqual([]);
      expect(scenarioPath.unknownOperationEvidencePatternIds, scenarioPath.id).toEqual([]);
      expect(scenarioPath.duplicateOperationEvidencePatternIds, scenarioPath.id).toEqual([]);
      for (const evidence of scenarioPath.evidencePatternBlockKeys) {
        expect(evidence.blockKeys.length, `${scenarioPath.id}:${evidence.pattern}`).toBeGreaterThan(0);
        expect(
          evidence.blockKeys.every((blockKey) => scenarioPath.proofBlockKeys.includes(blockKey)),
          `${scenarioPath.id}:${evidence.pattern}`,
        ).toBe(true);
      }
      expect(scenarioPath.missingAssertedEvidence, scenarioPath.id).toBe(false);
      expect([...scenarioPath.assertedEvidencePatterns].sort(), scenarioPath.id).toEqual(
        [...scenarioPath.evidencePatterns].sort(),
      );
      expect(scenarioPath.weakEvidencePatterns, scenarioPath.id).toEqual([]);
      for (const evidence of scenarioPath.assertedEvidencePatternBlockKeys) {
        expect(
          evidence.blockKeys.every((blockKey) => scenarioPath.proofBlockKeys.includes(blockKey)),
          `${scenarioPath.id}:${evidence.pattern}`,
        ).toBe(true);
      }
      for (const operationProof of scenarioPath.operationProofs) {
        expect(operationProof.missingProofBlock, `${scenarioPath.id}:${operationProof.operationId}`).toBe(false);
        expect(operationProof.underProven, `${scenarioPath.id}:${operationProof.operationId}`).toBe(false);
        expect(operationProof.missingEvidence, `${scenarioPath.id}:${operationProof.operationId}`).toBe(false);
        expect(operationProof.missingAssertedEvidence, `${scenarioPath.id}:${operationProof.operationId}`).toBe(false);
        expect(operationProof.proofBlockKeys.length, `${scenarioPath.id}:${operationProof.operationId}`).toBeGreaterThan(0);
        expect(
          operationProof.proofBlockKeys.every((blockKey) => scenarioPath.proofBlockKeys.includes(blockKey)),
          `${scenarioPath.id}:${operationProof.operationId}`,
        ).toBe(true);
        expect(
          operationProof.proofBlockKeys.every((blockKey) => operationHitBlockKeys.has(blockKey)),
          `${scenarioPath.id}:${operationProof.operationId}`,
        ).toBe(true);
        expect(
          operationProof.requiredEvidencePatterns.length > 0,
          `${scenarioPath.id}:${operationProof.operationId}`,
        ).toBe(true);
        expect(
          operationProof.missingEvidencePatterns,
          `${scenarioPath.id}:${operationProof.operationId}`,
        ).toEqual([]);
        expect(
          operationProof.matchedEvidencePatterns.sort(),
          `${scenarioPath.id}:${operationProof.operationId}`,
        ).toEqual([...operationProof.requiredEvidencePatterns].sort());
        expect(
          [...operationProof.assertedEvidencePatterns].sort(),
          `${scenarioPath.id}:${operationProof.operationId}`,
        ).toEqual([...operationProof.requiredEvidencePatterns].sort());
        expect(
          operationProof.weakEvidencePatterns,
          `${scenarioPath.id}:${operationProof.operationId}`,
        ).toEqual([]);
        expect(
          operationProof.generatedConformanceBlockKeys.length,
          `${scenarioPath.id}:${operationProof.operationId}`,
        ).toBeGreaterThan(0);
        expect(
          operationProof.generatedConformanceBlockKeys.every((blockKey) =>
            operationProof.proofBlockKeys.includes(blockKey),
          ),
          `${scenarioPath.id}:${operationProof.operationId}`,
        ).toBe(true);
        for (const evidence of operationProof.evidencePatternBlockKeys) {
          expect(
            evidence.blockKeys.length,
            `${scenarioPath.id}:${operationProof.operationId}:${evidence.pattern}`,
          ).toBeGreaterThan(0);
          expect(
            evidence.blockKeys.every((blockKey) => operationProof.proofBlockKeys.includes(blockKey)),
            `${scenarioPath.id}:${operationProof.operationId}:${evidence.pattern}`,
          ).toBe(true);
        }
        for (const evidence of operationProof.assertedEvidencePatternBlockKeys) {
          expect(
            evidence.blockKeys.every((blockKey) => operationProof.proofBlockKeys.includes(blockKey)),
            `${scenarioPath.id}:${operationProof.operationId}:${evidence.pattern}`,
          ).toBe(true);
        }
      }
      for (const operationId of scenarioPath.operationIds) {
        const operationCoverage = operation(matrix, operationId);
        expect(
          operationCoverage.hits.some((hit) => {
            const proofOrder = {
              none: 0,
              smoke: 1,
              'negative-path': 2,
              behavioral: 3,
              conformance: 4,
            } as const;
            return (
              scenarioPath.proofBlockKeys.includes(`${hit.file}\0${hit.testName}`) &&
              proofOrder[hit.proofLevel] >= proofOrder[scenarioPath.requiredProofLevel]
            );
          }),
          `${scenarioPath.id}:${operationId}`,
        ).toBe(true);
      }
      expect(scenarioPath.proofOperationIds, scenarioPath.id).toEqual(
        [...scenarioPath.operationIds].sort(),
      );
      expect(scenarioPath.missingProofOperationIds, scenarioPath.id).toEqual([]);
      expect(scenarioPath.missingOperationEvidenceIds, scenarioPath.id).toEqual([]);
      expect(scenarioPath.missingAssertedOperationEvidenceIds, scenarioPath.id).toEqual([]);
    }
  });

  it('resolves same-name backend and core SDK aliases independently', () => {
    expect(operation(matrix, 'AppController_getHello').hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'tests/e2e/openbox-client.test.ts',
          testName: 'health endpoint returns success',
          call: 'client.health()',
        }),
      ]),
    );
    expect(operation(matrix, 'healthCheck').hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'tests/e2e/core-client.test.ts',
          testName: 'CONFORMANCE: returns the literal core health response from the generated operation',
          call: 'client.health()',
        }),
      ]),
    );
  });

  it('proves every core governance operation with conformance evidence', () => {
    const core = objective(matrix, 'core-governance');
    const coreOperationIds = matrix.operations
      .filter((entry) => entry.operation.service === 'core')
      .map((entry) => entry.operation.operationId)
      .sort();

    expect(core.operationCount).toBe(coreOperationIds.length);
    expect(core.missingOperationIds).toEqual([]);
    expect(core.underConformanceOperationIds).toEqual([]);
    expect(sortedOperationIds(core.conformanceOperationIds)).toEqual(coreOperationIds);
    expect(core.proofCounts.conformance).toBe(coreOperationIds.length);
    expect(sortedOperationIds(core.behavioralOrBetterOperationIds)).toEqual(coreOperationIds);
  });

  it('proves every requested governance objective operation beyond endpoint smoke', () => {
    expect(matrix.scenarioMatrix.requiredObjectiveIds).toEqual(
      providerCapabilitiesFixture.localStackScenarioMatrix.requiredObjectiveIds,
    );
    expect(matrix.scenarioMatrix.requiredObjectiveSpecs.map((entry) => entry.id)).toEqual(
      matrix.scenarioMatrix.requiredObjectiveIds,
    );
    expect(
      matrix.objectives.map((entry) => ({
        id: entry.id,
        label: entry.label,
        minimumProofLevel: entry.minimumProofLevel,
        operationIds: entry.operationIds,
      })),
    ).toEqual(providerCapabilitiesFixture.localStackScenarioMatrix.requiredObjectiveSpecs);
    expect(matrix.scenarioMatrix.missingObjectiveIds).toEqual([]);
    expect(matrix.scenarioMatrix.objectiveSpecMismatchRefs).toEqual([]);

    const guardrails = objective(matrix, 'backend-guardrails');
    const policies = objective(matrix, 'backend-policies');
    const approvals = objective(matrix, 'backend-approvals-hitl');

    expect(guardrails.operationCount).toBeGreaterThan(0);
    expect(guardrails.smokeOnlyOperationIds).not.toContain('GuardrailController_runTest');
    expect(guardrails.proofCounts.conformance).toBeGreaterThan(0);

    expect(policies.operationCount).toBeGreaterThan(0);
    expect(policies.proofCounts.conformance).toBeGreaterThan(0);
    expect(policies.smokeOnlyOperationIds).toEqual([]);

    expect(approvals.operationCount).toBeGreaterThan(0);
    expect(approvals.proofCounts.conformance).toBeGreaterThan(0);
    expect(approvals.behavioralOrBetterOperationIds).toEqual(
      expect.arrayContaining([
        'AgentController_decideApproval',
        'AgentController_getApprovalHistory',
        'AgentController_getPendingApprovals',
        'OrganizationController_getApprovals',
      ]),
    );

    for (const objectiveCoverage of matrix.objectives) {
      expect(objectiveCoverage.underConformanceOperationIds, objectiveCoverage.id).toEqual([]);
      expect(objectiveCoverage.proofCounts.conformance, objectiveCoverage.id).toBe(
        objectiveCoverage.operationCount,
      );
    }
  });

  it('keeps finite, boundary, and raw backend/Core semantic gap ledgers closed', () => {
    expect(matrix.semanticGaps).toEqual([]);
    expect(matrix.sdkSemanticGapClosures).toEqual([]);
    expect(matrix.backendCoreGapRemediationTargets).toEqual([]);
    expect(matrix.scenarioMatrix.rawBackendCoreSemanticGaps).toEqual([]);
    expect(matrix.scenarioMatrix.backendCoreGapRemediationTargetIds).toEqual([]);
    expect(matrix.scenarioMatrix.backendCoreGapStatus).toBe('gap-free');
    expect(matrix.scenarioMatrix.knownBackendCoreGapIds).toEqual([]);
    expect(matrix.scenarioMatrix.generatedBackendCoreGapIds).toEqual([]);
    expect(matrix.scenarioMatrix.semanticGapLedgerMismatchRefs).toEqual([]);
    expect(matrix.scenarioMatrix.duplicateSemanticGapRefs).toEqual([]);
    expect(matrix.scenarioMatrix.duplicateGeneratedBackendCoreGapRefs).toEqual([]);
    expect(matrix.scenarioMatrix.duplicateBackendCoreGapRemediationTargetRefs).toEqual([]);
    expect(matrix.scenarioMatrix.missingGeneratedBackendCoreGapIds).toEqual([]);
    expect(matrix.scenarioMatrix.unexpectedGeneratedBackendCoreGapIds).toEqual([]);
    expect(matrix.scenarioMatrix.backendCoreGapSpecMismatchRefs).toEqual([]);
  });

  it('links provider parity areas to their generated guard-test evidence', () => {
    expect(matrix.providerGuards.map((entry) => entry.capability).sort()).toEqual([
      'approvals-hitl',
      'guardrails',
      'opa-rules',
      'tracing',
      'usage-cost',
    ]);

    for (const guard of matrix.providerGuards) {
      expect(guard.guardCount, guard.capability).toBeGreaterThan(0);
      expect(guard.providers.length, guard.capability).toBeGreaterThan(0);
      expect(guard.providers, guard.capability).toEqual(guard.matrixProviders);
      expect(
        guard.matrixProviderTiers.map((entry) => entry.provider),
        guard.capability,
      ).toEqual(guard.matrixProviders);
      expect(guard.missingProviderCapabilityGuardProviders, guard.capability).toEqual([]);
      expect(guard.unexpectedProviderCapabilityGuardProviders, guard.capability).toEqual([]);
      expect(guard.providerTierMismatchRefs, guard.capability).toEqual([]);
      expect(guard.duplicateProviderCapabilityGuardProviderRefs, guard.capability).toEqual([]);
      expect(guard.guardCount, guard.capability).toBe(guard.providers.length);
      expect(guard.guardTestRefs.length, guard.capability).toBe(guard.guardCount);
      expect(guard.guardTests.length, guard.capability).toBeGreaterThan(0);
      expect(guard.missingGuardTestRefs, guard.capability).toEqual([]);
      expect(guard.guardProofBlockKeys.length, guard.capability).toBe(guard.guardTests.length);
      expect(
        guard.guardProofBlockKeys.every((key) => key.includes('\0')),
        guard.capability,
      ).toBe(true);
      expect(guard.guardTests.every((guardTest) => /^tests\/.+\.test\.ts#.+/.test(guardTest))).toBe(
        true,
      );
      expect(
        guard.guardTestRefs.every((ref) =>
          guard.providers.includes(ref.provider) && guard.guardTests.includes(ref.guardTest),
        ),
        guard.capability,
      ).toBe(true);
      if (guard.capability === 'opa-rules') {
        expect(guard.sharedGuardTestRefs, guard.capability).toEqual([
          {
            guardTest:
              'tests/unit/policy-evaluation-guard.test.ts#keeps OPA/Rego and behavior-rule evaluation backend-owned in SDK sources',
            providers: guard.providers,
          },
        ]);
      } else {
        expect(guard.sharedGuardTestRefs, guard.capability).toEqual([]);
      }
      for (const ref of guard.guardTestRefs) {
        const [file, title] = ref.guardTest.split('#');
        expect(
          guard.guardProofBlockKeys.some(
            (key) => key.startsWith(`${file}\0`) && key.includes(title),
          ),
          `${guard.capability}:${ref.guardTest}`,
        ).toBe(true);
      }
      expect(
        guard.proofFiles.every((file) =>
          file.startsWith('tests/unit/') || file.startsWith('tests/contract/'),
        ),
      ).toBe(true);
    }
  });

  it('tracks canonical capability outcomes and generated exceptions', () => {
    expect(matrix.outcomes.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'core-governance-verdicts',
        'core-approval-polling',
        'backend-policy-evaluation',
        'backend-guardrail-enforcement',
        'backend-approvals-hitl',
        'backend-organization-member-admin',
        'backend-tracing-observability',
        'backend-usage-cost-trust',
        'provider-adapter-guardrails',
        'provider-adapter-usage-cost',
        'provider-adapter-opa-rules',
      ]),
    );

    const policies = outcome(matrix, 'backend-policy-evaluation');
    expect(policies.status).toBe('proven');
    expect(policies.source).toBe('local-stack-e2e');
    expect(policies.operationIds).toContain('PolicyController_evaluate');
    expect(policies.semanticGapIds).toEqual([]);

    const coreVerdicts = outcome(matrix, 'core-governance-verdicts');
    expect(coreVerdicts.status).toBe('proven');
    expect(coreVerdicts.semanticGapIds).toEqual([]);

    const coreApproval = outcome(matrix, 'core-approval-polling');
    expect(coreApproval.status).toBe('proven');
    expect(coreApproval.underProvenOperationIds).toEqual([]);
    expect(coreApproval.proofCounts.conformance).toBe(coreApproval.operationIds.length);
    expect(coreApproval.semanticGapIds).toEqual([]);

    const guardrails = outcome(matrix, 'backend-guardrail-enforcement');
    expect(guardrails.status).toBe('proven');
    expect(guardrails.underProvenOperationIds).toEqual([]);

    const approvals = outcome(matrix, 'backend-approvals-hitl');
    expect(approvals.status).toBe('proven');
    expect(approvals.underProvenOperationIds).toEqual([]);
    expect(approvals.proofCounts.conformance).toBe(approvals.operationIds.length);
    expect(approvals.semanticGapIds).toEqual([]);

    const memberAdmin = outcome(matrix, 'backend-organization-member-admin');
    expect(memberAdmin.status).toBe('proven');
    expect(memberAdmin.underProvenOperationIds).toEqual([]);
    expect(memberAdmin.proofCounts.conformance).toBe(memberAdmin.operationIds.length);
    expect(memberAdmin.semanticGapIds).toEqual([]);

    const usage = outcome(matrix, 'backend-usage-cost-trust');
    expect(usage.status).toBe('proven');
    expect(usage.underProvenOperationIds).toEqual([]);
    expect(usage.proofCounts.conformance).toBe(usage.operationIds.length);
    expect(usage.proofCounts.behavioral).toBe(0);
    expect(usage.semanticGapIds).toEqual([]);

    const providerUsage = outcome(matrix, 'provider-adapter-usage-cost');
    expect(providerUsage.source).toBe('provider-guard-fixture');
    expect(providerUsage.status).toBe('proven');
    expect(providerUsage.missingProviderGuardCapabilities).toEqual([]);
    expect(providerUsage.missingProviderGuardTestRefs).toEqual([]);
    expect(providerUsage.missingExceptionCapabilities).toEqual([]);
    expect(providerUsage.exceptionIds).toEqual(
      expect.arrayContaining([
        'codex:usage-cost:observe-only',
        'cursor:usage-cost:observe-only',
      ]),
    );

    for (const providerOutcomeId of [
      'provider-adapter-guardrails',
      'provider-adapter-approvals-hitl',
      'provider-adapter-tracing',
      'provider-adapter-usage-cost',
      'provider-adapter-opa-rules',
    ]) {
      const providerOutcome = outcome(matrix, providerOutcomeId);
      const guardProofBlockKeys = providerOutcome.providerGuardCapabilities.flatMap((capability) => {
        const guard = matrix.providerGuards.find((entry) => entry.capability === capability);
        expect(guard, `${providerOutcomeId}:${capability}`).toBeDefined();
        return guard!.guardProofBlockKeys;
      }).sort();

      expect(providerOutcome.source, providerOutcomeId).toBe('provider-guard-fixture');
      expect(providerOutcome.minimumProofLevel, providerOutcomeId).toBe('conformance');
      expect(providerOutcome.status, providerOutcomeId).toBe('proven');
      expect(providerOutcome.missingProviderGuardCapabilities, providerOutcomeId).toEqual([]);
      expect(providerOutcome.missingProviderGuardTestRefs, providerOutcomeId).toEqual([]);
      expect(providerOutcome.missingExceptionCapabilities, providerOutcomeId).toEqual([]);
      expect(providerOutcome.providerGuardProofBlockKeys, providerOutcomeId).toEqual(
        [...new Set(guardProofBlockKeys)].sort(),
      );
      expect(providerOutcome.providerGuardProofBlockKeys.length, providerOutcomeId)
        .toBeGreaterThan(0);
    }

    expect(matrix.exceptions.length).toBeGreaterThan(0);
    expect(matrix.exceptions.every((entry) =>
      ['observe-only', 'out-of-scope', 'diagnose-only'].includes(entry.tier),
    )).toBe(true);

    const outcomeGapIds = new Set(matrix.outcomes.flatMap((entry) => entry.semanticGapIds));
    expect([...outcomeGapIds].sort()).toEqual(
      matrix.semanticGaps.map((entry) => entry.id).sort(),
    );
    expect(matrix.scenarioMatrix.requiredOutcomeSpecs.map((entry) => entry.id)).toEqual(
      matrix.scenarioMatrix.requiredOutcomeIds,
    );
    expect(matrix.scenarioMatrix.requiredOutcomeSpecs).toEqual(
      providerCapabilitiesFixture.localStackScenarioMatrix.requiredOutcomeSpecs,
    );
    expect(matrix.scenarioMatrix.transportOrFeatureGatedOperationIds).toEqual(
      providerCapabilitiesFixture.localStackScenarioMatrix.transportOrFeatureGatedOperationIds,
    );
    expect(matrix.scenarioMatrix.requestConstraintEvidenceSpecs).toEqual(
      providerCapabilitiesFixture.localStackScenarioMatrix.requestConstraintEvidenceSpecs,
    );
    expect(matrix.scenarioMatrix.requestConstraintDomainSpecs).toEqual(
      providerCapabilitiesFixture.localStackScenarioMatrix.requestConstraintDomainSpecs,
    );
    expect(matrix.scenarioMatrix.sdkGeneratedPreflightOnlyConstraintKeys).toEqual(
      providerCapabilitiesFixture.localStackScenarioMatrix.sdkGeneratedPreflightOnlyConstraintKeys,
    );
    expect(matrix.scenarioMatrix.unknownTransportOrFeatureGatedOperationIds).toEqual([]);
    expect(
      matrix.outcomes.map((entry) => ({
        id: entry.id,
        label: entry.label,
        source: entry.source,
        minimumProofLevel: entry.minimumProofLevel,
        operationIds: entry.operationIds,
        providerGuardCapabilities: entry.providerGuardCapabilities,
        exceptionCapabilities: entry.exceptionCapabilities,
      })),
    ).toEqual(providerCapabilitiesFixture.localStackScenarioMatrix.requiredOutcomeSpecs);
    expect(matrix.scenarioMatrix.outcomeSpecMismatchRefs).toEqual([]);
    expect(matrix.scenarioMatrix.underConformanceLocalStackOutcomeRefs).toEqual([]);
    expect(matrix.scenarioMatrix.underConformanceProviderGuardOutcomeRefs).toEqual([]);

    for (const spec of matrix.scenarioMatrix.requiredOutcomeSpecs) {
      const coveredOutcome = outcome(matrix, spec.id);
      expect(coveredOutcome.label, spec.id).toBe(spec.label);
      expect(coveredOutcome.source, spec.id).toBe(spec.source);
      expect(coveredOutcome.minimumProofLevel, spec.id).toBe(spec.minimumProofLevel);
      if (coveredOutcome.source === 'local-stack-e2e') {
        expect(coveredOutcome.minimumProofLevel, spec.id).toBe('conformance');
      }
      if (coveredOutcome.source === 'provider-guard-fixture') {
        expect(coveredOutcome.minimumProofLevel, spec.id).toBe('conformance');
      }
      expect(coveredOutcome.operationIds, spec.id).toEqual(spec.operationIds);
      expect(coveredOutcome.providerGuardCapabilities, spec.id).toEqual(
        spec.providerGuardCapabilities,
      );
      expect(coveredOutcome.exceptionCapabilities, spec.id).toEqual(spec.exceptionCapabilities);
    }
  });

  it('tracks every required local-stack scenario path from the generated spec', () => {
    const actualCapabilities = [...new Set(matrix.scenarioPaths.map((entry) => entry.capability))].sort();
    const actualCategories = [...new Set(matrix.scenarioPaths.map((entry) => entry.category))].sort();
    const actualAxes = [...new Set(matrix.scenarioPaths.flatMap((entry) => entry.axes))].sort();
    const actualLocalStackAxes = [
      ...new Set(
        matrix.scenarioPaths
          .filter((entry) => entry.localStackRequired)
          .flatMap((entry) => entry.axes),
      ),
    ].sort();
    const provenLocalStackAxes = [
      ...new Set(
        matrix.scenarioPaths
          .filter((entry) => entry.localStackRequired && entry.status === 'proven')
          .flatMap((entry) => entry.axes),
      ),
    ].sort();
    const actualLocalStackScenarioIds = matrix.scenarioPaths
      .filter((entry) => entry.localStackRequired)
      .map((entry) => entry.id)
      .sort();
    const actualProviderOwnedScenarioIds = matrix.scenarioPaths
      .filter((entry) => !entry.localStackRequired)
      .map((entry) => entry.id)
      .sort();

    expect(matrix.scenarioPaths.length).toBe(
      matrix.scenarioMatrix.localStackScenarioIds.length +
        matrix.scenarioMatrix.providerOwnedScenarioIds.length,
    );
    expect(new Set(matrix.scenarioPaths.map((entry) => entry.id)).size).toBe(
      matrix.scenarioPaths.length,
    );
    expect(actualCapabilities).toEqual([...matrix.scenarioMatrix.requiredCapabilities].sort());
    expect(actualCategories).toEqual([...matrix.scenarioMatrix.requiredCategories].sort());
    expect(actualAxes).toEqual([...matrix.scenarioMatrix.requiredAxes].sort());
    expect(matrix.scenarioMatrix.requiredLocalStackAxes).toEqual(
      matrix.scenarioMatrix.requiredAxes,
    );
    expect(actualLocalStackAxes).toEqual([...matrix.scenarioMatrix.requiredLocalStackAxes].sort());
    expect(provenLocalStackAxes).toEqual([...matrix.scenarioMatrix.requiredLocalStackAxes].sort());
    expect(matrix.scenarioMatrix.requiredCategoryAxes).toEqual([
      { category: 'approvals-hitl', axes: ['approval', 'failure', 'happy', 'matrix', 'order', 'tool'] },
      { category: 'behavioral', axes: ['dbquery', 'failure', 'goal', 'happy', 'matrix', 'order', 'span', 'tool'] },
      { category: 'goal-drift', axes: ['failure', 'goal', 'happy'] },
      { category: 'guardrails', axes: ['dbquery', 'failure', 'guardrails', 'happy', 'order'] },
      { category: 'opa', axes: ['approval', 'dbquery', 'failure', 'happy', 'matrix', 'opa', 'rego', 'tool'] },
      { category: 'tracing', axes: ['dbquery', 'failure', 'happy', 'matrix', 'order', 'span', 'tool'] },
      { category: 'usage-cost', axes: ['cost', 'dbquery', 'happy', 'matrix', 'usage'] },
      { category: 'workflow', axes: ['failure', 'happy', 'order'] },
    ]);
    expect(actualLocalStackScenarioIds).toEqual(
      [...matrix.scenarioMatrix.localStackScenarioIds].sort(),
    );
    expect(actualProviderOwnedScenarioIds).toEqual(
      [...matrix.scenarioMatrix.providerOwnedScenarioIds].sort(),
    );
    expect(matrix.scenarioPaths.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'opa-allow',
        'opa-require-approval',
        'opa-block',
        'opa-halt',
        'opa-decision-aliases',
        'opa-constrain',
        'opa-unavailable-fail-closed',
        'approval-pending',
        'approval-approved',
        'approval-rejected',
        'approval-expired-timeout',
        'approval-dashboard-metrics-history',
        'guardrail-allow',
        'guardrail-block',
        'guardrail-redact',
        'guardrail-service-unavailable-fail-closed',
        'behavior-order-goal-before-action',
        'behavior-db-query',
        'behavior-tool-call',
        'behavior-http',
        'behavior-file-read',
        'behavior-file-write',
        'behavior-shell',
        'behavior-llm',
        'behavior-mcp',
        'behavior-rule-lifecycle-current',
        'behavior-rule-metrics-violations',
        'behavior-rule-rollback-history',
        'policy-lifecycle-evaluations-metrics',
        'guardrail-lifecycle-order-metrics',
        'usage-core-wire-boundary',
        'usage-token-counts',
        'usage-cost-usd',
        'usage-zero-values',
        'trust-aivss-ledger',
        'goal-alignment-checked',
        'goal-drift-detected',
        'goal-drift-unavailable-fail-closed',
        'trace-session',
        'trace-logs',
        'trace-reasoning',
        'trace-source-attribution',
        'observability-ledger-dashboard',
        'violation-false-positive',
        'workflow-session-lifecycle',
        'workflow-session-terminate',
        'backend-dashboard-metrics',
      ]),
    );
    expect(
      matrix.scenarioPaths.every((entry) =>
        (entry.localStackRequired
          ? entry.operationIds.length > 0 || entry.id === 'local-llamafirewall-real-scan'
          : entry.operationIds.length >= 0) &&
        entry.evidencePatterns.length > 0 &&
        entry.requiredBehavior.length > 30,
      ),
    ).toBe(true);

    expect(matrix.scenarioMatrix).toMatchObject({
      status: 'proven',
      requiredSharedProviderGuardProofCapabilities: ['opa-rules'],
      requiredSdkSemanticGapClosureTargets: ['typescript', 'python'],
      duplicateOperationIdRefs: [],
      duplicateServiceOperationIdRefs: [],
      duplicateOperationRouteRefs: [],
      duplicateOperationPathPatternRefs: [],
      operationRouteResolutionMismatchRefs: [],
      ambiguousOperationRouteTieRefs: [],
      missingCapabilities: [],
      unexpectedCapabilities: [],
      missingCategories: [],
      unexpectedCategories: [],
      missingAxes: [],
      unexpectedAxes: [],
      unknownScenarioCategoryRefs: [],
      unknownScenarioAxisRefs: [],
      unknownScenarioProofLevelRefs: [],
      unknownOutcomeSourceRefs: [],
      unknownOutcomeProofLevelRefs: [],
      unknownScenarioMatrixCategoryRefs: [],
      unknownScenarioMatrixAxisRefs: [],
      unknownScenarioMatrixProofLevelRefs: [],
      unknownSdkSemanticGapClosureTargetRefs: [],
      unknownScenarioCapabilityRefs: [],
      unknownOutcomeCapabilityRefs: [],
      unknownScenarioMatrixCapabilityRefs: [],
      unknownProviderGuardCapabilityRefs: [],
      unknownProviderGuardProviderRefs: [],
      unknownProviderGuardTierRefs: [],
      missingLocalStackAxes: [],
      incompleteLocalStackAxes: [],
      outcomeSpecMismatchRefs: [],
      missingOutcomeExceptionCapabilityRefs: [],
      missingObjectiveIds: [],
      objectiveSpecMismatchRefs: [],
      unknownTransportOrFeatureGatedOperationIds: [],
      missingProviderCapabilityGuardProviderRefs: [],
      unexpectedProviderCapabilityGuardProviderRefs: [],
      providerGuardTierMismatchRefs: [],
      duplicateProviderCapabilityGuardProviderRefs: [],
      sharedProviderGuardProofCapabilities: ['opa-rules'],
      missingSharedProviderGuardProofCapabilities: [],
      unexpectedSharedProviderGuardProofCapabilities: [],
      missingCategoryAxisRefs: [],
      incompleteCategoryAxisRefs: [],
      missingLocalStackScenarioIds: [],
      unexpectedLocalStackScenarioIds: [],
      missingProviderOwnedScenarioIds: [],
      unexpectedProviderOwnedScenarioIds: [],
      underConformanceOperationRefs: [],
      underConformanceObjectiveOperationRefs: [],
      unknownScenarioProofMarkerRefs: [],
      markerOnlyScenarioProofBlockRefs: [],
      throttleTolerantScenarioProofBlockRefs: [],
      duplicateScenarioPathRefs: [],
      duplicateOutcomeRefs: [],
      duplicateScenarioMatrixContractRefs: [],
      duplicateScenarioOperationRefs: [],
      duplicateScenarioAxisRefs: [],
      missingOperationEvidencePatternRefs: [],
      unknownOperationEvidencePatternRefs: [],
      duplicateOperationEvidencePatternRefs: [],
      weakScenarioEvidencePatternRefs: [],
      missingGeneratedConformanceOperationRefs: [],
      incompleteScenarioIds: [],
      missingOutcomeIds: [],
      incompleteOutcomeIds: [],
      missingSemanticGapOutcomeRefs: [],
      duplicateSemanticGapOutcomeRefs: [],
      semanticGapLedgerMismatchRefs: [],
      duplicateSemanticGapRefs: [],
      duplicateGeneratedBackendCoreGapRefs: [],
      duplicateBackendCoreGapRemediationTargetRefs: [],
      missingGeneratedBackendCoreGapIds: [],
      unexpectedGeneratedBackendCoreGapIds: [],
      backendCoreGapSpecMismatchRefs: [],
      missingBackendCoreGapRemediationRefRefs: [],
      invalidBackendCoreGapRemediationRefRefs: [],
      serviceMismatchBackendCoreGapRemediationRefRefs: [],
      duplicateBackendCoreGapRemediationRefRefs: [],
      missingBackendCoreGapRemediationFileRefs: [],
      invalidBackendCoreGapRemediationLineRefs: [],
      missingRawProofConstraintKeyRefs: [],
      unclassifiedRequestConstraintRefs: [],
      sdkGeneratedPreflightOnlyConstraintRefs: [],
      missingRequestConstraintRawGapClosureRefs: [],
      unknownGeneratedRequestConstraintEvidenceRefs: [],
      unknownGeneratedRequestConstraintDomainRefs: [],
      unknownSdkGeneratedPreflightOnlyConstraintRefs: [],
      missingTransportGatedPublicWrapperClosureRefs: [],
      rawSemanticGapOutcomeIds: [],
      rawSemanticGapOutcomeRefs: [],
      unclosedSemanticGapIds: [],
    });
    expect(
      matrix.scenarioMatrix.categoryAxisCoverage.map((entry) => ({
        category: entry.category,
        requiredAxes: entry.requiredAxes,
        missingAxes: entry.missingAxes,
        incompleteAxes: entry.incompleteAxes,
      })),
    ).toEqual(
      matrix.scenarioMatrix.requiredCategoryAxes.map((entry) => ({
        category: entry.category,
        requiredAxes: [...entry.axes].sort(),
        missingAxes: [],
        incompleteAxes: [],
      })),
    );
    expect(matrix.scenarioMatrix.rawSemanticGapPolicy).toContain(
      'generated TypeScript and Python request-preflight closure evidence',
    );
    expect(matrix.scenarioMatrix.backendCoreGapStatusPolicy).toContain(
      'backendCoreGapStatus is gap-free',
    );
    expect(matrix.scenarioMatrix.backendCoreGapRemediationPolicy).toContain(
      'generated request constraint remediation target',
    );
    expect(matrix.scenarioMatrix.localStackAxisPolicy).toContain(
      'provider-owned fixture evidence cannot satisfy',
    );
    expect(matrix.scenarioMatrix.providerGuardSharedProofPolicy).toContain(
      'backend-owned capabilities',
    );
    expect(matrix.scenarioMatrix.status).toBe('proven');
    expect(matrix.scenarioMatrix.backendCoreGapStatus).toBe('gap-free');
    expect(matrix.scenarioMatrix.knownBackendCoreGapIds).toEqual(
      matrix.semanticGaps.map((entry) => entry.id).sort(),
    );
    expect(matrix.scenarioMatrix.generatedBackendCoreGapIds).toEqual(
      matrix.semanticGaps.map((entry) => entry.id).sort(),
    );
    expect(matrix.scenarioMatrix.semanticGapLedgerMismatchRefs).toEqual([]);
    expect(matrix.scenarioMatrix.duplicateSemanticGapRefs).toEqual([]);
    expect(matrix.scenarioMatrix.duplicateGeneratedBackendCoreGapRefs).toEqual([]);
    expect(matrix.scenarioMatrix.duplicateBackendCoreGapRemediationTargetRefs).toEqual([]);
    expect(matrix.scenarioMatrix.missingGeneratedBackendCoreGapIds).toEqual([]);
    expect(matrix.scenarioMatrix.unexpectedGeneratedBackendCoreGapIds).toEqual([]);
    expect(matrix.scenarioMatrix.backendCoreGapSpecMismatchRefs).toEqual([]);
    expect(matrix.scenarioMatrix.missingBackendCoreGapRemediationFileRefs).toEqual([]);
    expect(matrix.scenarioMatrix.invalidBackendCoreGapRemediationLineRefs).toEqual([]);
    expect(matrix.scenarioMatrix.missingRawProofConstraintKeyRefs).toEqual([]);
    expect(matrix.scenarioMatrix.unclassifiedRequestConstraintRefs).toEqual([]);
    expect(matrix.scenarioMatrix.sdkGeneratedPreflightOnlyConstraintRefs).toEqual([]);
    expect(matrix.scenarioMatrix.missingRequestConstraintRawGapClosureRefs).toEqual([]);
    expect(matrix.scenarioMatrix.unknownGeneratedRequestConstraintEvidenceRefs).toEqual([]);
    expect(matrix.scenarioMatrix.unknownGeneratedRequestConstraintDomainRefs).toEqual([]);
    expect(matrix.scenarioMatrix.unknownSdkGeneratedPreflightOnlyConstraintRefs).toEqual([]);
    expect(matrix.scenarioMatrix.missingTransportGatedPublicWrapperClosureRefs).toEqual([]);
    expect(matrix.scenarioMatrix.semanticGapIds).toEqual(
      matrix.semanticGaps.map((entry) => entry.id).sort(),
    );
    expect(
      matrix.scenarioMatrix.rawSemanticGapOutcomeRefs.flatMap((entry) => entry.semanticGapIds).sort(),
    ).toEqual(matrix.scenarioMatrix.semanticGapIds);
    expect(matrix.scenarioMatrix.missingSemanticGapOutcomeRefs).toEqual([]);
    expect(matrix.scenarioMatrix.duplicateSemanticGapOutcomeRefs).toEqual([]);
  });

  it('separates proven scenario paths from required-but-open gaps', () => {
    expect(scenario(matrix, 'opa-allow').status).toBe('proven');
    expect(scenario(matrix, 'opa-require-approval').status).toBe('proven');
    expect(scenario(matrix, 'approval-pending').status).toBe('proven');
    expect(scenario(matrix, 'approval-approved').status).toBe('proven');
    expect(scenario(matrix, 'approval-rejected').status).toBe('proven');
    expect(scenario(matrix, 'behavior-tool-call').status).toBe('proven');
    expect(scenario(matrix, 'opa-block').status).toBe('proven');
    expect(scenario(matrix, 'opa-halt').status).toBe('proven');
    expect(scenario(matrix, 'opa-decision-aliases').status).toBe('proven');
    expect(scenario(matrix, 'opa-unavailable-fail-closed').status).toBe('proven');
    expect(scenario(matrix, 'behavior-db-query').status).toBe('proven');
    expect(scenario(matrix, 'behavior-http').status).toBe('proven');
    expect(scenario(matrix, 'behavior-file-read').status).toBe('proven');
    expect(scenario(matrix, 'behavior-file-write').status).toBe('proven');
    expect(scenario(matrix, 'behavior-shell').status).toBe('proven');
    expect(scenario(matrix, 'behavior-llm').status).toBe('proven');
    expect(scenario(matrix, 'behavior-mcp').status).toBe('proven');
    expect(scenario(matrix, 'guardrail-allow').status).toBe('proven');
    expect(scenario(matrix, 'guardrail-block').status).toBe('proven');
    expect(scenario(matrix, 'guardrail-redact').status).toBe('proven');
    expect(scenario(matrix, 'guardrail-service-unavailable-fail-closed').status).toBe('proven');
    expect(scenario(matrix, 'behavior-order-goal-before-action').status).toBe('proven');
    expect(scenario(matrix, 'goal-alignment-checked').status).toBe('proven');
    expect(scenario(matrix, 'goal-drift-detected').status).toBe('proven');
    expect(scenario(matrix, 'goal-drift-unavailable-fail-closed').status).toBe('proven');
    expect(scenario(matrix, 'approval-expired-timeout').status).toBe('proven');
    expect(scenario(matrix, 'approval-dashboard-metrics-history').status).toBe('proven');
    expect(scenario(matrix, 'behavior-rule-lifecycle-current').status).toBe('proven');
    expect(scenario(matrix, 'behavior-rule-metrics-violations').status).toBe('proven');
    expect(scenario(matrix, 'behavior-rule-rollback-history').status).toBe('proven');
    expect(scenario(matrix, 'policy-lifecycle-evaluations-metrics').status).toBe('proven');
    expect(scenario(matrix, 'guardrail-lifecycle-order-metrics').status).toBe('proven');
    expect(scenario(matrix, 'workflow-session-lifecycle').status).toBe('proven');
    expect(scenario(matrix, 'workflow-session-terminate').status).toBe('proven');
    expect(scenario(matrix, 'observability-ledger-dashboard').status).toBe('proven');
    expect(scenario(matrix, 'violation-false-positive').status).toBe('proven');
    expect(scenario(matrix, 'backend-dashboard-metrics').status).toBe('proven');
    expect(scenario(matrix, 'trust-aivss-ledger').status).toBe('proven');
    expect(scenario(matrix, 'opa-constrain').status).toBe('proven');
    expect(scenario(matrix, 'usage-core-wire-boundary').status).toBe('proven');

    const underConformedLocalStackScenarios = matrix.scenarioPaths
      .filter((entry) => entry.localStackRequired && entry.proofLevel !== 'conformance')
      .map((entry) => `${entry.id}:${entry.proofLevel}`);
    expect(underConformedLocalStackScenarios).toEqual([]);

    const underRequiredProofLocalStackScenarios = matrix.scenarioPaths
      .filter((entry) => entry.localStackRequired && entry.requiredProofLevel !== 'conformance')
      .map((entry) => `${entry.id}:${entry.requiredProofLevel}`);
    expect(underRequiredProofLocalStackScenarios).toEqual([]);
    expect(matrix.scenarioMatrix.underConformanceLocalStackRequiredProofLevelRefs).toEqual([]);

    const constrainBoundary = scenario(matrix, 'opa-constrain');
    expect(constrainBoundary.localStackRequired).toBe(true);
    expect(constrainBoundary.status).toBe('proven');
    expect(constrainBoundary.proofSource).toBe('local-stack-e2e');
    expect(constrainBoundary.underProvenOperationIds).toEqual([]);

    const providerOwnedScenarioIds = matrix.scenarioMatrix.providerOwnedScenarioIds;
    expect(providerOwnedScenarioIds).toEqual(['usage-token-counts', 'usage-cost-usd', 'usage-zero-values']);

    for (const id of providerOwnedScenarioIds) {
      const providerOwned = scenario(matrix, id);
      const providerGuard = matrix.providerGuards.find((entry) => entry.capability === providerOwned.capability);
      expect(providerGuard, id).toBeDefined();
      expect(providerGuard!.guardTestRefs.length, id).toBeGreaterThan(0);
      expect(providerOwned.localStackRequired, id).toBe(false);
      expect(providerOwned.status, id).toBe('proven');
      expect(providerOwned.proofSource, id).toBe('provider-guard-fixture');
      expect(providerOwned.proofLevel, id).toBe(providerOwned.requiredProofLevel);
      expect(providerOwned.missingAssertedEvidence, id).toBe(false);
      expect(providerOwned.weakEvidencePatterns, id).toEqual([]);
      expect([...providerOwned.assertedEvidencePatterns].sort(), id).toEqual(
        [...providerOwned.evidencePatterns].sort(),
      );
      expect(providerOwned.providerGuardTestRefs, id).toEqual(providerGuard!.guardTestRefs);
      expect(providerOwned.missingProviderGuardTestRefs, id).toEqual([]);
      expect(providerOwned.providerGuardProofBlockKeys.length, id).toBe(
        providerOwned.providerGuardTestRefs.length,
      );
      expect(
        providerOwned.providerGuardProofBlockKeys.every((key) => key.includes('\0')),
        id,
      ).toBe(true);
      for (const ref of providerOwned.providerGuardTestRefs) {
        const [file, title] = ref.guardTest.split('#');
        expect(
          providerOwned.providerGuardProofBlockKeys.some(
            (key) => key.startsWith(`${file}\0`) && key.includes(title),
          ),
          `${id}:${ref.guardTest}`,
        ).toBe(true);
      }
      expect(providerOwned.proofFiles, id).toEqual(
        expect.arrayContaining(providerGuard!.proofFiles),
      );
      expect(providerOwned.matchedEvidencePatterns, id).toEqual(
        [...providerOwned.evidencePatterns].sort(),
      );
      expect(providerOwned.proofTestNames.length, id).toBeGreaterThan(0);
    }

    expect(matrix.scenarioPaths.filter((entry) => entry.status !== 'proven')).toEqual([]);
  });
});
