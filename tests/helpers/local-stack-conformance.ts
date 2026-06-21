import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import {
  BOUNDARY_CONFORMANCE_GAPS,
  type BoundaryGap,
} from './boundary-conformance';
import {
  FINITE_DOMAIN_GAPS,
  type FiniteDomainGap,
} from './finite-domain-conformance';
import { GOVERNANCE_SPEC_DOMAINS } from './governance-spec-domains';
import {
  REQUEST_PREFLIGHT_RULES as TS_BACKEND_REQUEST_PREFLIGHT_RULES,
} from '../../ts/src/client/generated/request-preflight.js';
import {
  REQUEST_PREFLIGHT_RULES as TS_CORE_REQUEST_PREFLIGHT_RULES,
} from '../../ts/src/core-client/generated/request-preflight.js';
import {
  buildRequestConstraintConformance,
  type RequestConstraintConformance,
} from './request-constraint-conformance';

export type ProofLevel =
  | 'none'
  | 'smoke'
  | 'negative-path'
  | 'behavioral'
  | 'conformance';

export interface SpecOperation {
  service: 'backend' | 'core';
  operationId: string;
  verb: string;
  path: string;
  pathPattern: string;
  tag?: string;
}

export interface E2eOperationHit {
  file: string;
  testName: string;
  proofLevel: Exclude<ProofLevel, 'none'>;
  reasons: string[];
  call: string;
}

export interface SmokeOperationHit {
  operationId: string;
  file: string;
  testName: string;
  call: string;
}

export interface UnresolvedMethodHit {
  file: string;
  testName: string;
  call: string;
  methodName: string;
  serviceHint?: 'backend' | 'core';
}

export interface OperationCoverage {
  operation: SpecOperation;
  proofLevel: ProofLevel;
  hits: E2eOperationHit[];
}

export interface ObjectiveCoverage {
  id: string;
  label: string;
  minimumProofLevel: ProofLevel;
  operationIds: string[];
  operationCount: number;
  proofCounts: Record<ProofLevel, number>;
  missingOperationIds: string[];
  smokeOnlyOperationIds: string[];
  behavioralOrBetterOperationIds: string[];
  conformanceOperationIds: string[];
  underConformanceOperationIds: string[];
}

export interface ProviderGuardCoverage {
  capability: string;
  guardCount: number;
  providers: string[];
  matrixProviderTiers: Array<{
    provider: string;
    tier: string;
  }>;
  guardProviderTiers: Array<{
    provider: string;
    tier: string;
  }>;
  guardTestRefs: Array<{
    provider: string;
    guardTest: string;
  }>;
  matrixProviders: string[];
  missingProviderCapabilityGuardProviders: string[];
  unexpectedProviderCapabilityGuardProviders: string[];
  providerTierMismatchRefs: string[];
  duplicateProviderCapabilityGuardProviderRefs: string[];
  sharedGuardTestRefs: Array<{
    guardTest: string;
    providers: string[];
  }>;
  guardTests: string[];
  proofFiles: string[];
  guardProofBlockKeys: string[];
  missingGuardTestRefs: Array<{
    provider: string;
    guardTest: string;
  }>;
}

export interface ConformanceException {
  id: string;
  capability: string;
  provider: string;
  tier: string;
  reason: string;
  source: string;
}

export interface CapabilityOutcomeCoverage {
  id: string;
  label: string;
  source: 'local-stack-e2e' | 'provider-guard-fixture';
  minimumProofLevel: ProofLevel;
  operationIds: string[];
  providerGuardCapabilities: string[];
  exceptionCapabilities: string[];
  providerGuardProofBlockKeys: string[];
  missingProviderGuardCapabilities: string[];
  missingProviderGuardTestRefs: Array<{
    capability: string;
    provider: string;
    guardTest: string;
  }>;
  proofCounts: Record<ProofLevel, number>;
  underProvenOperationIds: string[];
  missingOperationIds: string[];
  semanticGapIds: string[];
  exceptionIds: string[];
  status: 'proven' | 'incomplete';
}

export interface LocalStackScenarioPathSpec {
  id: string;
  category: string;
  capability: string;
  label: string;
  axes: string[];
  requiredProofLevel: ProofLevel;
  localStackRequired: boolean;
  operationIds: string[];
  evidencePatterns: string[];
  operationEvidencePatterns?: LocalStackOperationEvidenceSpec[];
  requiredBehavior: string;
}

export interface LocalStackOperationEvidenceSpec {
  operationId: string;
  evidencePatterns: string[];
}

export interface LocalStackCategoryAxisSpec {
  category: string;
  axes: string[];
}

export interface LocalStackOutcomeSpec {
  id: string;
  label: string;
  source: CapabilityOutcomeCoverage['source'];
  minimumProofLevel: ProofLevel;
  operationIds: string[];
  providerGuardCapabilities: string[];
  exceptionCapabilities: string[];
}

export interface LocalStackObjectiveSpec {
  id: string;
  label: string;
  minimumProofLevel: ProofLevel;
  operationIds: string[];
}

export interface RequestConstraintEvidenceSpec {
  id: string;
  requestConstraintKeys: string[];
}

export interface RequestConstraintDomainSpec {
  domainKey: string;
  requestConstraintKeys: string[];
}

export interface RawBackendCoreSemanticGapSpec {
  id: string;
  source: SemanticGapCoverage['source'];
  services: Array<'backend' | 'core'>;
  domainKeys: string[];
  operationIds: string[];
  requestConstraintKeys: string[];
  rawProofFile: string;
  rawEvidencePattern: string;
  observedBehavior: string;
  requiredBehavior: string;
  requiredRawRejection: string;
  remediationRefs: string[];
  sdkClosureTargets: Array<'typescript' | 'python'>;
}

export interface LocalStackScenarioMatrixContract {
  id: string;
  description: string;
  requiredCapabilities: string[];
  requiredCategories: string[];
  requiredAxes: string[];
  requiredLocalStackAxes: string[];
  requiredCategoryAxes: LocalStackCategoryAxisSpec[];
  localStackScenarioIds: string[];
  providerOwnedScenarioIds: string[];
  requiredOutcomeIds: string[];
  requiredOutcomeSpecs: LocalStackOutcomeSpec[];
  requiredObjectiveIds: string[];
  requiredObjectiveSpecs: LocalStackObjectiveSpec[];
  transportOrFeatureGatedOperationIds: string[];
  requestConstraintEvidenceSpecs: RequestConstraintEvidenceSpec[];
  requestConstraintDomainSpecs: RequestConstraintDomainSpec[];
  sdkGeneratedPreflightOnlyConstraintKeys: string[];
  rawBackendCoreSemanticGaps: RawBackendCoreSemanticGapSpec[];
  requiredSharedProviderGuardProofCapabilities: string[];
  requiredSdkSemanticGapClosureTargets: string[];
  providerGuardSharedProofPolicy: string;
  localStackAxisPolicy: string;
  rawSemanticGapPolicy: string;
  backendCoreGapStatusPolicy: string;
  backendCoreGapRemediationPolicy: string;
}

export interface ScenarioOperationProof {
  operationId: string;
  proofLevel: ProofLevel;
  requiredEvidencePatterns: string[];
  proofBlockKeys: string[];
  proofFiles: string[];
  proofTestNames: string[];
  matchedEvidencePatterns: string[];
  missingEvidencePatterns: string[];
  assertedEvidencePatterns: string[];
  weakEvidencePatterns: string[];
  assertedEvidencePatternBlockKeys: Array<{
    pattern: string;
    blockKeys: string[];
  }>;
  evidencePatternBlockKeys: Array<{
    pattern: string;
    blockKeys: string[];
  }>;
  generatedConformanceBlockKeys: string[];
  missingProofBlock: boolean;
  underProven: boolean;
  missingEvidence: boolean;
  missingAssertedEvidence: boolean;
}

export interface ScenarioPathCoverage extends LocalStackScenarioPathSpec {
  proofLevel: ProofLevel;
  operationProofLevel: ProofLevel;
  proofSource: 'local-stack-e2e' | 'provider-guard-fixture' | 'contract-boundary';
  proofFiles: string[];
  proofTestNames: string[];
  scenarioProofMarker: string;
  scenarioProofMarkerBlockKeys: string[];
  markerOnlyProofBlockKeys: string[];
  missingScenarioProofMarker: boolean;
  providerGuardTestRefs: ProviderGuardCoverage['guardTestRefs'];
  providerGuardProofBlockKeys: string[];
  missingProviderGuardTestRefs: ProviderGuardCoverage['guardTestRefs'];
  proofBlockKeys: string[];
  proofOperationIds: string[];
  missingProofOperationIds: string[];
  duplicateScenarioOperationIds: string[];
  duplicateScenarioAxisIds: string[];
  missingOperationEvidencePatternIds: string[];
  unknownOperationEvidencePatternIds: string[];
  duplicateOperationEvidencePatternIds: string[];
  operationProofs: ScenarioOperationProof[];
  missingOperationEvidenceIds: string[];
  missingAssertedOperationEvidenceIds: string[];
  matchedEvidencePatterns: string[];
  assertedEvidencePatterns: string[];
  weakEvidencePatterns: string[];
  missingAssertedEvidence: boolean;
  assertedEvidencePatternBlockKeys: Array<{
    pattern: string;
    blockKeys: string[];
  }>;
  evidencePatternBlockKeys: Array<{
    pattern: string;
    blockKeys: string[];
  }>;
  underProvenOperationIds: string[];
  missingOperationIds: string[];
  status: 'proven' | 'incomplete';
  missingReason?: string;
}

export interface ScenarioMatrixCoverage extends LocalStackScenarioMatrixContract {
  status: 'proven' | 'incomplete';
  backendCoreGapStatus: 'gap-free' | 'known-gaps';
  semanticGapIds: string[];
  knownBackendCoreGapIds: string[];
  backendCoreGapRemediationTargetIds: string[];
  generatedBackendCoreGapIds: string[];
  duplicateSemanticGapRefs: string[];
  duplicateGeneratedBackendCoreGapRefs: string[];
  duplicateBackendCoreGapRemediationTargetRefs: string[];
  missingGeneratedBackendCoreGapIds: string[];
  unexpectedGeneratedBackendCoreGapIds: string[];
  backendCoreGapSpecMismatchRefs: string[];
  missingBackendCoreGapRemediationRefRefs: string[];
  invalidBackendCoreGapRemediationRefRefs: string[];
  serviceMismatchBackendCoreGapRemediationRefRefs: string[];
  duplicateBackendCoreGapRemediationRefRefs: string[];
  missingBackendCoreGapRemediationFileRefs: string[];
  invalidBackendCoreGapRemediationLineRefs: string[];
  remediationRepositoryStatuses: BackendCoreGapRemediationRepositoryStatus[];
  missingBackendCoreGapRemediationTargetIds: string[];
  unexpectedBackendCoreGapRemediationTargetIds: string[];
  duplicateOperationIdRefs: string[];
  duplicateServiceOperationIdRefs: string[];
  duplicateOperationRouteRefs: string[];
  duplicateOperationPathPatternRefs: string[];
  operationRouteResolutionMismatchRefs: string[];
  ambiguousOperationRouteTieRefs: string[];
  missingCapabilities: string[];
  unexpectedCapabilities: string[];
  missingCategories: string[];
  unexpectedCategories: string[];
  missingAxes: string[];
  unexpectedAxes: string[];
  unknownScenarioCategoryRefs: string[];
  unknownScenarioAxisRefs: string[];
  unknownScenarioProofLevelRefs: string[];
  unknownOutcomeSourceRefs: string[];
  unknownOutcomeProofLevelRefs: string[];
  unknownScenarioMatrixCategoryRefs: string[];
  unknownScenarioMatrixAxisRefs: string[];
  unknownScenarioMatrixProofLevelRefs: string[];
  unknownSdkSemanticGapClosureTargetRefs: string[];
  unknownScenarioCapabilityRefs: string[];
  unknownOutcomeCapabilityRefs: string[];
  unknownScenarioMatrixCapabilityRefs: string[];
  unknownProviderGuardCapabilityRefs: string[];
  unknownProviderGuardProviderRefs: string[];
  unknownProviderGuardTierRefs: string[];
  missingLocalStackAxes: string[];
  incompleteLocalStackAxes: string[];
  outcomeSpecMismatchRefs: string[];
  missingObjectiveIds: string[];
  objectiveSpecMismatchRefs: string[];
  unknownTransportOrFeatureGatedOperationIds: string[];
  unknownGeneratedRequestConstraintEvidenceRefs: string[];
  unknownGeneratedRequestConstraintDomainRefs: string[];
  unknownSdkGeneratedPreflightOnlyConstraintRefs: string[];
  missingProviderCapabilityGuardProviderRefs: string[];
  unexpectedProviderCapabilityGuardProviderRefs: string[];
  providerGuardTierMismatchRefs: string[];
  duplicateProviderCapabilityGuardProviderRefs: string[];
  sharedProviderGuardProofCapabilities: string[];
  missingSharedProviderGuardProofCapabilities: string[];
  unexpectedSharedProviderGuardProofCapabilities: string[];
  categoryAxisCoverage: Array<{
    category: string;
    requiredAxes: string[];
    presentAxes: string[];
    provenAxes: string[];
    missingAxes: string[];
    incompleteAxes: string[];
  }>;
  missingCategoryAxisRefs: string[];
  incompleteCategoryAxisRefs: string[];
  missingLocalStackScenarioIds: string[];
  unexpectedLocalStackScenarioIds: string[];
  missingProviderOwnedScenarioIds: string[];
  unexpectedProviderOwnedScenarioIds: string[];
  underConformanceLocalStackRequiredProofLevelRefs: string[];
  unknownScenarioProofMarkerRefs: string[];
  duplicateScenarioPathRefs: string[];
  duplicateOutcomeRefs: string[];
  duplicateScenarioMatrixContractRefs: string[];
  duplicateScenarioOperationRefs: string[];
  duplicateScenarioAxisRefs: string[];
  underConformanceOperationRefs: string[];
  underConformanceObjectiveOperationRefs: string[];
  underConformanceLocalStackOutcomeRefs: string[];
  missingOperationEvidencePatternRefs: string[];
  unknownOperationEvidencePatternRefs: string[];
  duplicateOperationEvidencePatternRefs: string[];
  incompleteScenarioIds: string[];
  missingOutcomeIds: string[];
  incompleteOutcomeIds: string[];
  rawSemanticGapOutcomeIds: string[];
  rawSemanticGapOutcomeRefs: Array<{
    outcomeId: string;
    semanticGapIds: string[];
  }>;
  unclosedSemanticGapIds: string[];
  missingRawProofConstraintKeyRefs: string[];
  unclassifiedRequestConstraintRefs: string[];
  sdkGeneratedPreflightOnlyConstraintRefs: string[];
  missingRequestConstraintRawGapClosureRefs: string[];
  missingTransportGatedPublicWrapperClosureRefs: string[];
}

export interface SemanticGapCoverage {
  id: string;
  source: 'finite-domain-ledger' | 'boundary-ledger';
  domainKeys: string[];
  operationIds: string[];
  proofFile: string;
  evidencePattern: string;
  observedBehavior: string;
  requiredBehavior: string;
}

export interface SdkSemanticGapClosure {
  semanticGapId: string;
  sdkTarget: 'typescript' | 'python';
  operationIds: string[];
  requestConstraintKeys: string[];
  proofFiles: string[];
  evidencePatterns: string[];
  missingOperationIds: string[];
  missingEvidencePatterns: string[];
  status: 'proven' | 'missing';
}

export interface BackendCoreGapRemediationTarget {
  gapId: string;
  services: Array<'backend' | 'core'>;
  operationIds: string[];
  requestConstraintKeys: string[];
  rawProofConstraintKeys: string[];
  missingRawProofConstraintKeys: string[];
  requestLocations: string[];
  constraintKinds: string[];
  rawProofFile: string;
  rawEvidencePattern: string;
  observedBehavior: string;
  requiredBehavior: string;
  requiredRawRejection: string;
  remediationRefs: string[];
  sdkClosureTargets: Array<'typescript' | 'python'>;
}

export interface BackendCoreGapRemediationRefRefs {
  missingBackendCoreGapRemediationRefRefs: string[];
  invalidBackendCoreGapRemediationRefRefs: string[];
  serviceMismatchBackendCoreGapRemediationRefRefs: string[];
  duplicateBackendCoreGapRemediationRefRefs: string[];
  missingBackendCoreGapRemediationFileRefs: string[];
  invalidBackendCoreGapRemediationLineRefs: string[];
  remediationRepositoryStatuses: BackendCoreGapRemediationRepositoryStatus[];
}

export interface BackendCoreGapRemediationRepositoryStatus {
  service: 'backend' | 'core';
  repositoryRoot: string;
  status: 'available' | 'missing';
}

interface BackendCoreGapRemediationRepositoryRoots {
  backend?: string;
  core?: string;
}

export interface LocalStackConformanceMatrix {
  generatedBy: 'tests/helpers/local-stack-conformance.ts';
  sources: string[];
  operations: OperationCoverage[];
  objectives: ObjectiveCoverage[];
  outcomes: CapabilityOutcomeCoverage[];
  scenarioPaths: ScenarioPathCoverage[];
  scenarioMatrix: ScenarioMatrixCoverage;
  semanticGaps: SemanticGapCoverage[];
  sdkSemanticGapClosures: SdkSemanticGapClosure[];
  backendCoreGapRemediationTargets: BackendCoreGapRemediationTarget[];
  requestConstraints: RequestConstraintConformance;
  providerGuards: ProviderGuardCoverage[];
  exceptions: ConformanceException[];
  smokeHits: SmokeOperationHit[];
  unresolvedMethodHits: UnresolvedMethodHit[];
  unknownHits: Array<{
    file: string;
    testName: string;
    call: string;
  }>;
  summary: {
    totalOperations: number;
    operationsWithE2eHits: number;
    operationsWithBehavioralOrBetterHits: number;
    operationsWithConformanceHits: number;
    smokeHitCount: number;
    unresolvedMethodHitCount: number;
    smokeOnlyOperations: number;
    operationsWithoutE2eHits: number;
    knownSemanticGaps: number;
    outcomes: {
      total: number;
      proven: number;
      incomplete: number;
      incompleteOutcomeIds: string[];
    };
    backendCoreGaps: {
      status: 'gap-free' | 'known-gaps';
      known: number;
      knownGapIds: string[];
      generated: number;
      generatedGapIds: string[];
      remediationTargets: number;
      remediationTargetIds: string[];
      rawGapOutcomeRefs: Array<{
        outcomeId: string;
        semanticGapIds: string[];
      }>;
      affectedOperations: number;
      affectedOperationIds: string[];
      requestConstraints: number;
      requestConstraintKeys: string[];
      rawProofFiles: string[];
      remediationRefs: string[];
      sdkClosureTargets: string[];
      missingGeneratedGapIds: string[];
      unexpectedGeneratedGapIds: string[];
      missingRemediationTargetIds: string[];
      unexpectedRemediationTargetIds: string[];
      specMismatchRefs: string[];
      missingRemediationRefRefs: string[];
      invalidRemediationRefRefs: string[];
      serviceMismatchRemediationRefRefs: string[];
      duplicateRemediationRefRefs: string[];
      missingRemediationFileRefs: string[];
      invalidRemediationLineRefs: string[];
      remediationRepositoryStatuses: BackendCoreGapRemediationRepositoryStatus[];
      missingRawProofConstraintKeyRefs: string[];
    };
    scenarioPaths: {
      total: number;
      localStackRequired: number;
      localStackProven: number;
      providerOwned: number;
      providerOwnedProven: number;
      incomplete: number;
      incompleteScenarioIds: string[];
      missingScenarioProofMarkerIds: string[];
      markerOnlyProofBlockRefs: string[];
      missingAssertedEvidenceScenarioIds: string[];
    };
    localStackAxes: {
      requiredAxes: string[];
      categoryCount: number;
      missingAxes: string[];
      incompleteAxes: string[];
      missingCategoryAxisRefs: string[];
      incompleteCategoryAxisRefs: string[];
    };
    providerExceptions: {
      total: number;
      observeOnly: number;
      outOfScope: number;
      diagnoseOnly: number;
      capabilityIds: string[];
      providerIds: string[];
    };
    providerGuards: {
      capabilityIds: string[];
      totalGuardTests: number;
      totalProofBlocks: number;
      sharedGuardTestRefs: string[];
      missingGuardTestRefs: string[];
      missingProviderCapabilityGuardProviderRefs: string[];
      unexpectedProviderCapabilityGuardProviderRefs: string[];
      providerTierMismatchRefs: string[];
      duplicateProviderCapabilityGuardProviderRefs: string[];
    };
    requestConstraints: {
      total: number;
      localStackE2e: number;
      rawSemanticGapSdkClosed: number;
      transportOrFeatureGated: number;
      sdkGeneratedPreflightOnly: number;
      unclassified: number;
      missingRawSemanticGapClosures: number;
      unknownGeneratedRequestConstraintEvidenceRefs: number;
      unknownGeneratedRequestConstraintDomainRefs: number;
      unknownSdkGeneratedPreflightOnlyConstraintRefs: number;
      missingTransportGatedPublicWrapperClosures: number;
      transportGatedPublicWrapperClosures: {
        constraintCount: number;
        total: number;
        proven: number;
        missing: number;
      };
    };
    sdkSemanticGapClosures: {
      total: number;
      proven: number;
      missing: number;
    };
  };
}

interface ManifestEntry {
  operationId: string;
  path: string;
  verb: string;
  pathPattern: string;
}

interface SdkManifestFixture {
  generatedBy: string;
  sources: string[];
  backendEndpointManifest: ManifestEntry[];
  coreEndpointManifest: ManifestEntry[];
}

interface ProviderCapabilitiesFixture {
  source: string;
  capabilityIds?: string[];
  providerIds?: string[];
  supportTiers?: string[];
  providerCapabilityMatrix?: ProviderCapabilityMatrixEntry[];
  hitlCapabilityGuards?: ProviderGuardEntry[];
  guardrailCapabilityGuards?: ProviderGuardEntry[];
  policyEvaluationGuards?: ProviderGuardEntry[];
  tracingCapabilityGuards?: ProviderGuardEntry[];
  usageCostCapabilityGuards?: ProviderGuardEntry[];
  localStackScenarioPaths?: LocalStackScenarioPathSpec[];
  localStackScenarioMatrix?: LocalStackScenarioMatrixContract;
}

interface ProviderGuardEntry {
  provider: string;
  tier: string;
  guardTest: string;
}

interface ProviderCapabilityMatrixEntry {
  provider: string;
  capability: string;
  tier: string;
  rationale?: string;
  status?: string;
  closureDecision?: string;
}

export interface ProviderCapabilityDomains {
  capabilityIds: readonly string[];
  providerIds: readonly string[];
  supportTiers: readonly string[];
}

export interface LocalStackScenarioDomains {
  categoryIds: readonly string[];
  axisIds: readonly string[];
  proofLevels: readonly string[];
  outcomeSources: readonly string[];
  sdkSemanticGapClosureTargets: readonly string[];
}

export type ProviderCapabilityDomainRefs = Pick<
  ScenarioMatrixCoverage,
  | 'unknownScenarioCapabilityRefs'
  | 'unknownOutcomeCapabilityRefs'
  | 'unknownScenarioMatrixCapabilityRefs'
  | 'unknownProviderGuardCapabilityRefs'
  | 'unknownProviderGuardProviderRefs'
  | 'unknownProviderGuardTierRefs'
>;

export type LocalStackScenarioDomainRefs = Pick<
  ScenarioMatrixCoverage,
  | 'unknownScenarioCategoryRefs'
  | 'unknownScenarioAxisRefs'
  | 'unknownScenarioProofLevelRefs'
  | 'unknownOutcomeSourceRefs'
  | 'unknownOutcomeProofLevelRefs'
  | 'unknownScenarioMatrixCategoryRefs'
  | 'unknownScenarioMatrixAxisRefs'
  | 'unknownScenarioMatrixProofLevelRefs'
  | 'unknownSdkSemanticGapClosureTargetRefs'
>;

interface TestBlock {
  file: string;
  name: string;
  source: string;
}

interface ExtractedCall {
  serviceHint?: 'backend' | 'core';
  verb?: string;
  rawPath?: string;
  methodName?: string;
  operationId?: string;
  call: string;
}

interface NormalizedPreflightRule {
  service: 'backend' | 'core';
  operationId: string;
  query?: Array<{
    name: string;
    enum?: readonly string[];
    format?: string;
    integer?: boolean;
    maximum?: number;
    minimum?: number;
    maxLength?: number;
  }>;
  body?: Array<{
    path: readonly string[];
    type?: string;
    enum?: readonly string[];
    format?: string;
    minimum?: number;
    maximum?: number;
    integer?: boolean;
    minItems?: number;
    maxItems?: number;
    maxLength?: number;
  }>;
}

const PROOF_ORDER: Record<ProofLevel, number> = {
  none: 0,
  smoke: 1,
  'negative-path': 2,
  behavioral: 3,
  conformance: 4,
};

type OutcomeSpecInput = {
  id: string;
  label: string;
  source: CapabilityOutcomeCoverage['source'];
  minimumProofLevel: ProofLevel;
  operationIds?: readonly string[];
  providerGuardCapabilities?: readonly string[];
  exceptionCapabilities?: readonly string[];
};

export function buildLocalStackConformanceMatrix(repoRoot = process.cwd()): LocalStackConformanceMatrix {
  const manifest = readJson<SdkManifestFixture>(
    repoRoot,
    'codegen/fixtures/sdk-manifests.json',
  );
  const providerCapabilities = readJson<ProviderCapabilitiesFixture>(
    repoRoot,
    'codegen/fixtures/provider-capabilities.json',
  );

  const operations = [
    ...manifest.backendEndpointManifest.map((entry) => ({
      ...entry,
      service: 'backend' as const,
      tag: tagFromOperation(entry),
    })),
    ...manifest.coreEndpointManifest.map((entry) => ({
      ...entry,
      service: 'core' as const,
      tag: tagFromOperation(entry),
    })),
  ];
  const operationManifestDuplicateRefs = summarizeOperationManifestDuplicates(operations);
  const matcher = new OperationMatcher(operations);
  const operationRouteResolutionRefs = summarizeOperationRouteResolution(operations, matcher);
  const methodMap = buildGeneratedMethodMap(repoRoot, matcher);
  const blocks = readE2eTestBlocks(repoRoot);
  const allBlocks = readAllTestBlocks(repoRoot);
  const hitsByOperationId = new Map<string, E2eOperationHit[]>();
  const unknownHits: LocalStackConformanceMatrix['unknownHits'] = [];
  const unresolvedMethodHits: LocalStackConformanceMatrix['unresolvedMethodHits'] = [];

  for (const block of blocks) {
    const proof = classifyTestBlock(block.source);
    const calls = extractExecutableCalls(block.source, block.file);
    for (const call of calls) {
      const operation =
        call.operationId
          ? matcher.byOperationId(call.operationId)
          : call.methodName
            ? resolveMethodOperation(methodMap, call)
            : matcher.match(call);

      if (!operation) {
        if (call.methodName) {
          unresolvedMethodHits.push({
            file: block.file,
            testName: block.name,
            call: call.call,
            methodName: call.methodName,
            serviceHint: call.serviceHint,
          });
        }
        if (
          (call.operationId && call.operationId !== 'NoSuchOperation') ||
          (call.verb && call.rawPath)
        ) {
          unknownHits.push({
            file: block.file,
            testName: block.name,
            call: call.call,
          });
        }
        continue;
      }

      const hit: E2eOperationHit = {
        file: block.file,
        testName: block.name,
        proofLevel: proof.proofLevel,
        reasons: proof.reasons,
        call: call.call,
      };
      const existing = hitsByOperationId.get(operation.operationId) ?? [];
      existing.push(hit);
      hitsByOperationId.set(operation.operationId, existing);
    }
  }

  const coverage = operations.map((operation) => {
    const hits = hitsByOperationId.get(operation.operationId) ?? [];
    return {
      operation,
      proofLevel: maxProofLevel(hits.map((hit) => hit.proofLevel)),
      hits,
    };
  });
  const smokeHits = summarizeSmokeHits(coverage);
  const coverageByOperationId = new Map(
    coverage.map((entry) => [entry.operation.operationId, entry]),
  );
  const objectiveSpecs = providerCapabilities.localStackScenarioMatrix?.requiredObjectiveSpecs ?? [];
  const objectives = objectiveSpecs.map((spec) => summarizeObjective(spec, coverageByOperationId));

  const providerGuards = summarizeProviderGuards(providerCapabilities, allBlocks);
  const exceptions = summarizeConformanceExceptions(providerCapabilities);
  const unknownScenarioProofMarkerRefs = summarizeUnknownScenarioProofMarkers(
    blocks,
    providerCapabilities.localStackScenarioPaths ?? [],
  );
  const requestConstraints = buildRequestConstraintConformance();
  const semanticGaps = summarizeSemanticGaps();
  const sdkSemanticGapClosures = summarizeSdkSemanticGapClosures(repoRoot, semanticGaps);
  const backendCoreGapRemediationTargets = summarizeBackendCoreGapRemediationTargets(
    semanticGaps,
    allBlocks,
    requestConstraints,
    providerCapabilities.localStackScenarioMatrix?.rawBackendCoreSemanticGaps ?? [],
  );
  const outcomeSpecs = providerCapabilities.localStackScenarioMatrix?.requiredOutcomeSpecs ?? [];
  const outcomes = summarizeCapabilityOutcomes(
    coverage,
    providerGuards,
    exceptions,
    semanticGaps,
    outcomeSpecs,
  );
  const scenarioPaths = summarizeScenarioPaths(
    providerCapabilities.localStackScenarioPaths ?? [],
    blocks,
    allBlocks,
    coverage,
    providerGuards,
  );
  const scenarioMatrix = summarizeScenarioMatrixContract(
    providerCapabilities.localStackScenarioMatrix,
    coverage,
    scenarioPaths,
    outcomes,
    objectives,
    providerGuards,
    semanticGaps,
    sdkSemanticGapClosures,
    backendCoreGapRemediationTargets,
    requestConstraints,
    operationManifestDuplicateRefs,
    operationRouteResolutionRefs,
    unknownScenarioProofMarkerRefs,
    {
      capabilityIds: providerCapabilities.capabilityIds ?? [],
      providerIds: providerCapabilities.providerIds ?? [],
      supportTiers: providerCapabilities.supportTiers ?? [],
    },
    {
      categoryIds: GOVERNANCE_SPEC_DOMAINS.localStackScenarioCategories,
      axisIds: GOVERNANCE_SPEC_DOMAINS.localStackScenarioAxes,
      proofLevels: GOVERNANCE_SPEC_DOMAINS.localStackProofLevels,
      outcomeSources: GOVERNANCE_SPEC_DOMAINS.localStackOutcomeSources,
      sdkSemanticGapClosureTargets: GOVERNANCE_SPEC_DOMAINS.sdkSemanticGapClosureTargets,
    },
  );
  const backendCoreGapAffectedOperationIds = uniqueSorted(
    backendCoreGapRemediationTargets.flatMap((entry) => entry.operationIds),
  );
  const backendCoreGapRequestConstraintKeys = uniqueSorted(
    backendCoreGapRemediationTargets.flatMap((entry) => entry.requestConstraintKeys),
  );
  const backendCoreGapRawProofFiles = uniqueSorted(
    backendCoreGapRemediationTargets.map((entry) => entry.rawProofFile),
  );
  const backendCoreGapRemediationRefs = uniqueSorted(
    backendCoreGapRemediationTargets.flatMap((entry) => entry.remediationRefs),
  );
  const backendCoreGapSdkClosureTargets = uniqueSorted(
    backendCoreGapRemediationTargets.flatMap((entry) => entry.sdkClosureTargets),
  );

  return {
    generatedBy: 'tests/helpers/local-stack-conformance.ts',
    sources: [
      ...manifest.sources,
      providerCapabilities.source,
      'tests/e2e/**/*.test.ts',
      'tests/unit/request-preflight-conformance.test.ts',
      'python/tests/test_request_preflight.py',
      'python/openbox_sdk/generated/request_preflight.py',
      'ts/src/*/generated/wrapper-methods.ts',
      'tests/helpers/finite-domain-conformance.ts',
      'tests/helpers/boundary-conformance.ts',
      'tests/helpers/request-constraint-conformance.ts',
    ],
    operations: coverage,
    objectives,
    outcomes,
    scenarioPaths,
    scenarioMatrix,
    semanticGaps,
    sdkSemanticGapClosures,
    backendCoreGapRemediationTargets,
    requestConstraints,
    providerGuards,
    exceptions,
    smokeHits,
    unresolvedMethodHits: unresolvedMethodHits.sort((left, right) =>
      `${left.file}\0${left.testName}\0${left.call}`.localeCompare(
        `${right.file}\0${right.testName}\0${right.call}`,
      ),
    ),
    unknownHits,
    summary: {
      totalOperations: coverage.length,
      operationsWithE2eHits: coverage.filter((entry) => entry.proofLevel !== 'none').length,
      operationsWithBehavioralOrBetterHits: coverage.filter(
        (entry) => PROOF_ORDER[entry.proofLevel] >= PROOF_ORDER.behavioral,
      ).length,
      operationsWithConformanceHits: coverage.filter((entry) => entry.proofLevel === 'conformance').length,
      smokeHitCount: smokeHits.length,
      unresolvedMethodHitCount: unresolvedMethodHits.length,
      smokeOnlyOperations: coverage.filter((entry) => entry.proofLevel === 'smoke').length,
      operationsWithoutE2eHits: coverage.filter((entry) => entry.proofLevel === 'none').length,
      knownSemanticGaps: semanticGaps.length,
      outcomes: {
        total: outcomes.length,
        proven: outcomes.filter((entry) => entry.status === 'proven').length,
        incomplete: outcomes.filter((entry) => entry.status === 'incomplete').length,
        incompleteOutcomeIds: outcomes
          .filter((entry) => entry.status === 'incomplete')
          .map((entry) => entry.id)
          .sort((left, right) => left.localeCompare(right)),
      },
      backendCoreGaps: {
        status: scenarioMatrix.backendCoreGapStatus,
        known: scenarioMatrix.knownBackendCoreGapIds.length,
        knownGapIds: [...scenarioMatrix.knownBackendCoreGapIds],
        generated: scenarioMatrix.generatedBackendCoreGapIds.length,
        generatedGapIds: [...scenarioMatrix.generatedBackendCoreGapIds],
        remediationTargets: scenarioMatrix.backendCoreGapRemediationTargetIds.length,
        remediationTargetIds: [...scenarioMatrix.backendCoreGapRemediationTargetIds],
        rawGapOutcomeRefs: scenarioMatrix.rawSemanticGapOutcomeRefs.map((entry) => ({
          outcomeId: entry.outcomeId,
          semanticGapIds: [...entry.semanticGapIds],
        })),
        affectedOperations: backendCoreGapAffectedOperationIds.length,
        affectedOperationIds: backendCoreGapAffectedOperationIds,
        requestConstraints: backendCoreGapRequestConstraintKeys.length,
        requestConstraintKeys: backendCoreGapRequestConstraintKeys,
        rawProofFiles: backendCoreGapRawProofFiles,
        remediationRefs: backendCoreGapRemediationRefs,
        sdkClosureTargets: backendCoreGapSdkClosureTargets,
        missingGeneratedGapIds: [...scenarioMatrix.missingGeneratedBackendCoreGapIds],
        unexpectedGeneratedGapIds: [...scenarioMatrix.unexpectedGeneratedBackendCoreGapIds],
        missingRemediationTargetIds: [
          ...scenarioMatrix.missingBackendCoreGapRemediationTargetIds,
        ],
        unexpectedRemediationTargetIds: [
          ...scenarioMatrix.unexpectedBackendCoreGapRemediationTargetIds,
        ],
        specMismatchRefs: [...scenarioMatrix.backendCoreGapSpecMismatchRefs],
        missingRemediationRefRefs: [
          ...scenarioMatrix.missingBackendCoreGapRemediationRefRefs,
        ],
        invalidRemediationRefRefs: [
          ...scenarioMatrix.invalidBackendCoreGapRemediationRefRefs,
        ],
        serviceMismatchRemediationRefRefs: [
          ...scenarioMatrix.serviceMismatchBackendCoreGapRemediationRefRefs,
        ],
        duplicateRemediationRefRefs: [
          ...scenarioMatrix.duplicateBackendCoreGapRemediationRefRefs,
        ],
        missingRemediationFileRefs: [
          ...scenarioMatrix.missingBackendCoreGapRemediationFileRefs,
        ],
        invalidRemediationLineRefs: [
          ...scenarioMatrix.invalidBackendCoreGapRemediationLineRefs,
        ],
        remediationRepositoryStatuses:
          scenarioMatrix.remediationRepositoryStatuses.map((entry) => ({ ...entry })),
        missingRawProofConstraintKeyRefs: [...scenarioMatrix.missingRawProofConstraintKeyRefs],
      },
      scenarioPaths: {
        total: scenarioPaths.length,
        localStackRequired: scenarioPaths.filter((entry) => entry.localStackRequired).length,
        localStackProven: scenarioPaths.filter(
          (entry) => entry.localStackRequired && entry.status === 'proven',
        ).length,
        providerOwned: scenarioPaths.filter((entry) => !entry.localStackRequired).length,
        providerOwnedProven: scenarioPaths.filter(
          (entry) => !entry.localStackRequired && entry.status === 'proven',
        ).length,
        incomplete: scenarioPaths.filter((entry) => entry.status !== 'proven').length,
        incompleteScenarioIds: scenarioPaths
          .filter((entry) => entry.status !== 'proven')
          .map((entry) => entry.id)
          .sort((left, right) => left.localeCompare(right)),
        missingScenarioProofMarkerIds: scenarioPaths
          .filter((entry) => entry.missingScenarioProofMarker)
          .map((entry) => entry.id)
          .sort((left, right) => left.localeCompare(right)),
        markerOnlyProofBlockRefs: uniqueSorted(
          scenarioPaths.flatMap((entry) =>
            entry.markerOnlyProofBlockKeys.map((blockKey) => `${entry.id}:${blockKey}`),
          ),
        ),
        missingAssertedEvidenceScenarioIds: scenarioPaths
          .filter((entry) => entry.missingAssertedEvidence)
          .map((entry) => entry.id)
          .sort((left, right) => left.localeCompare(right)),
      },
      localStackAxes: {
        requiredAxes: [...scenarioMatrix.requiredLocalStackAxes],
        categoryCount: scenarioMatrix.categoryAxisCoverage.length,
        missingAxes: [...scenarioMatrix.missingLocalStackAxes],
        incompleteAxes: [...scenarioMatrix.incompleteLocalStackAxes],
        missingCategoryAxisRefs: [...scenarioMatrix.missingCategoryAxisRefs],
        incompleteCategoryAxisRefs: [...scenarioMatrix.incompleteCategoryAxisRefs],
      },
      providerExceptions: {
        total: exceptions.length,
        observeOnly: exceptions.filter((entry) => entry.tier === 'observe-only').length,
        outOfScope: exceptions.filter((entry) => entry.tier === 'out-of-scope').length,
        diagnoseOnly: exceptions.filter((entry) => entry.tier === 'diagnose-only').length,
        capabilityIds: uniqueSorted(exceptions.map((entry) => entry.capability)),
        providerIds: uniqueSorted(exceptions.map((entry) => entry.provider)),
      },
      providerGuards: {
        capabilityIds: uniqueSorted(providerGuards.map((entry) => entry.capability)),
        totalGuardTests: providerGuards.reduce(
          (total, entry) => total + entry.guardTestRefs.length,
          0,
        ),
        totalProofBlocks: providerGuards.reduce(
          (total, entry) => total + entry.guardProofBlockKeys.length,
          0,
        ),
        sharedGuardTestRefs: uniqueSorted(
          providerGuards.flatMap((entry) =>
            entry.sharedGuardTestRefs.map(
              (ref) => `${entry.capability}:${ref.providers.join('+')}:${ref.guardTest}`,
            ),
          ),
        ),
        missingGuardTestRefs: uniqueSorted(
          providerGuards.flatMap((entry) =>
            entry.missingGuardTestRefs.map(
              (ref) => `${entry.capability}:${ref.provider}:${ref.guardTest}`,
            ),
          ),
        ),
        missingProviderCapabilityGuardProviderRefs: uniqueSorted(
          providerGuards.flatMap((entry) =>
            entry.missingProviderCapabilityGuardProviders.map(
              (provider) => `${entry.capability}:${provider}`,
            ),
          ),
        ),
        unexpectedProviderCapabilityGuardProviderRefs: uniqueSorted(
          providerGuards.flatMap((entry) =>
            entry.unexpectedProviderCapabilityGuardProviders.map(
              (provider) => `${entry.capability}:${provider}`,
            ),
          ),
        ),
        providerTierMismatchRefs: uniqueSorted(
          providerGuards.flatMap((entry) => entry.providerTierMismatchRefs),
        ),
        duplicateProviderCapabilityGuardProviderRefs: uniqueSorted(
          providerGuards.flatMap((entry) => entry.duplicateProviderCapabilityGuardProviderRefs),
        ),
      },
      requestConstraints: {
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
      },
      sdkSemanticGapClosures: {
        total: sdkSemanticGapClosures.length,
        proven: sdkSemanticGapClosures.filter((entry) => entry.status === 'proven').length,
        missing: sdkSemanticGapClosures.filter((entry) => entry.status !== 'proven').length,
      },
    },
  };
}

function summarizeSemanticGaps(): SemanticGapCoverage[] {
  return [
    ...FINITE_DOMAIN_GAPS.map((gap) => finiteDomainGapToSemanticGap(gap)),
    ...BOUNDARY_CONFORMANCE_GAPS.map((gap) => boundaryGapToSemanticGap(gap)),
  ].sort((left, right) => left.id.localeCompare(right.id));
}

function summarizeBackendCoreGapRemediationTargets(
  semanticGaps: SemanticGapCoverage[],
  allBlocks: TestBlock[],
  requestConstraints: RequestConstraintConformance,
  rawBackendCoreSemanticGapSpecs: RawBackendCoreSemanticGapSpec[],
): BackendCoreGapRemediationTarget[] {
  const rawConstraints = requestConstraints.constraints.filter(
    (entry) => entry.disposition === 'raw-semantic-gap-sdk-closed',
  );
  const rawSpecByGapId = new Map(
    rawBackendCoreSemanticGapSpecs.map((entry) => [entry.id, entry]),
  );

  return semanticGaps.map((gap) => {
    const rawSpec = rawSpecByGapId.get(gap.id);
    const constraints = rawConstraints
      .filter((entry) => entry.semanticGapIds.includes(gap.id))
      .sort((left, right) => left.key.localeCompare(right.key));
    const requestConstraintKeys = constraints.map((entry) => entry.key);
    const proofBlocks = allBlocks.filter(
      (block) =>
        block.file === gap.proofFile && rawProofBlockIncludesPattern(block, gap.evidencePattern),
    );
    const rawProofConstraintKeys = requestConstraintKeys.filter((key) =>
      proofBlocks.some((block) => stripCodeComments(block.source).includes(key)),
    );

    return {
      gapId: gap.id,
      services: uniqueSorted(constraints.map((entry) => entry.service)) as Array<'backend' | 'core'>,
      operationIds: [...gap.operationIds].sort(),
      requestConstraintKeys,
      rawProofConstraintKeys,
      missingRawProofConstraintKeys: missing(requestConstraintKeys, rawProofConstraintKeys),
      requestLocations: uniqueSorted(constraints.map((entry) => entry.location)),
      constraintKinds: uniqueSorted(constraints.map((entry) => entry.kind)),
      rawProofFile: gap.proofFile,
      rawEvidencePattern: gap.evidencePattern,
      observedBehavior: gap.observedBehavior,
      requiredBehavior: gap.requiredBehavior,
      requiredRawRejection: rawSpec?.requiredRawRejection ?? '',
      remediationRefs: rawSpec ? [...rawSpec.remediationRefs] : [],
      sdkClosureTargets: (rawSpec
        ? [...rawSpec.sdkClosureTargets]
        : []) as Array<'typescript' | 'python'>,
    };
  }).sort((left, right) => left.gapId.localeCompare(right.gapId));
}

export function backendCoreGapRemediationRefRefsForTesting(
  targets: ReadonlyArray<
    Pick<BackendCoreGapRemediationTarget, 'gapId' | 'services' | 'remediationRefs'>
  >,
  repositoryRoots?: BackendCoreGapRemediationRepositoryRoots,
): BackendCoreGapRemediationRefRefs {
  return summarizeBackendCoreGapRemediationRefRefs(targets, repositoryRoots);
}

function summarizeBackendCoreGapRemediationRefRefs(
  targets: ReadonlyArray<
    Pick<BackendCoreGapRemediationTarget, 'gapId' | 'services' | 'remediationRefs'>
  >,
  repositoryRoots: BackendCoreGapRemediationRepositoryRoots = defaultBackendCoreRepositoryRoots(),
): BackendCoreGapRemediationRefRefs {
  const validRefPattern = /^openbox-(backend|core):([^:\s]+):(\d+)$/;
  const remediationRepositoryStatuses = remediationRepositoryStatusesFor(repositoryRoots);
  const missingBackendCoreGapRemediationRefRefs: string[] = [];
  const invalidBackendCoreGapRemediationRefRefs: string[] = [];
  const serviceMismatchBackendCoreGapRemediationRefRefs: string[] = [];
  const duplicateBackendCoreGapRemediationRefRefs: string[] = [];
  const missingBackendCoreGapRemediationFileRefs: string[] = [];
  const invalidBackendCoreGapRemediationLineRefs: string[] = [];

  for (const target of targets) {
    if (target.remediationRefs.length === 0) {
      missingBackendCoreGapRemediationRefRefs.push(target.gapId);
    }
    duplicateBackendCoreGapRemediationRefRefs.push(
      ...duplicates(target.remediationRefs).map((ref) => `${target.gapId}:${ref}`),
    );

    for (const ref of target.remediationRefs) {
      const match = validRefPattern.exec(ref);
      if (!match) {
        invalidBackendCoreGapRemediationRefRefs.push(`${target.gapId}:${ref}`);
        continue;
      }
      const service = match[1] as 'backend' | 'core';
      const relPath = match[2];
      const lineNumber = Number(match[3]);
      if (!target.services.includes(service)) {
        serviceMismatchBackendCoreGapRemediationRefRefs.push(`${target.gapId}:${ref}`);
      }
      const repositoryRoot = repositoryRoots[service];
      if (!repositoryRoot || !repositoryRootAvailable(repositoryRoot)) continue;
      const resolvedRepositoryRoot = resolve(repositoryRoot);
      const filePath = resolve(resolvedRepositoryRoot, relPath);
      if (relative(resolvedRepositoryRoot, filePath).startsWith('..')) {
        invalidBackendCoreGapRemediationRefRefs.push(`${target.gapId}:${ref}`);
        continue;
      }
      if (!fileExists(filePath)) {
        missingBackendCoreGapRemediationFileRefs.push(`${target.gapId}:${ref}`);
        continue;
      }
      const lineCount = readFileSync(filePath, 'utf8').split(/\r?\n/).length;
      if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lineCount) {
        invalidBackendCoreGapRemediationLineRefs.push(`${target.gapId}:${ref}`);
      }
    }
  }

  return {
    missingBackendCoreGapRemediationRefRefs: uniqueSorted(
      missingBackendCoreGapRemediationRefRefs,
    ),
    invalidBackendCoreGapRemediationRefRefs: uniqueSorted(
      invalidBackendCoreGapRemediationRefRefs,
    ),
    serviceMismatchBackendCoreGapRemediationRefRefs: uniqueSorted(
      serviceMismatchBackendCoreGapRemediationRefRefs,
    ),
    duplicateBackendCoreGapRemediationRefRefs: uniqueSorted(
      duplicateBackendCoreGapRemediationRefRefs,
    ),
    missingBackendCoreGapRemediationFileRefs: uniqueSorted(
      missingBackendCoreGapRemediationFileRefs,
    ),
    invalidBackendCoreGapRemediationLineRefs: uniqueSorted(
      invalidBackendCoreGapRemediationLineRefs,
    ),
    remediationRepositoryStatuses,
  };
}

function defaultBackendCoreRepositoryRoots(): BackendCoreGapRemediationRepositoryRoots {
  return {
    backend:
      process.env.OPENBOX_BACKEND_REPO ??
      resolve(process.cwd(), '../openbox-repos/openbox-backend'),
    core:
      process.env.OPENBOX_CORE_REPO ??
      resolve(process.cwd(), '../openbox-repos/openbox-core'),
  };
}

function remediationRepositoryStatusesFor(
  repositoryRoots: BackendCoreGapRemediationRepositoryRoots,
): BackendCoreGapRemediationRepositoryStatus[] {
  return (['backend', 'core'] as const).map((service) => {
    const repositoryRoot = repositoryRoots[service] ?? '';
    return {
      service,
      repositoryRoot,
      status:
        repositoryRoot && repositoryRootAvailable(repositoryRoot)
          ? 'available'
          : 'missing',
    };
  });
}

function repositoryRootAvailable(repositoryRoot: string): boolean {
  try {
    return statSync(repositoryRoot).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function summarizeSdkSemanticGapClosures(
  repoRoot: string,
  semanticGaps: SemanticGapCoverage[],
): SdkSemanticGapClosure[] {
  const tsRules = normalizeTsPreflightRules();
  const tsOperationIds = new Set(tsRules.map((rule) => rule.operationId));
  const pythonRules = readPythonGeneratedPreflightRules(repoRoot);
  const pythonOperationIds = new Set(pythonRules.map((rule) => rule.operationId));
  const rawConstraintKeysByGapId = rawSemanticGapConstraintKeysByGapId();
  const tsProofSources = readCombinedSource(repoRoot, [
    'tests/helpers/request-constraint-conformance.ts',
    'tests/unit/request-constraint-conformance.test.ts',
    'tests/unit/request-preflight-conformance.test.ts',
    'tests/unit/client.test.ts',
    'tests/unit/core-client.test.ts',
    'tests/e2e/sdk-preflight-closures.test.ts',
  ]);
  const pythonProofSources = readCombinedSource(repoRoot, [
    'python/openbox_sdk/generated/request_preflight.py',
    'python/tests/test_request_preflight.py',
  ]);

  return semanticGaps.flatMap((gap) => [
    sdkClosureForGap({
      gap,
      sdkTarget: 'typescript',
      operationIds: tsOperationIds,
      proofFiles: [
        'tests/helpers/request-constraint-conformance.ts',
        'tests/unit/request-constraint-conformance.test.ts',
        'tests/unit/request-preflight-conformance.test.ts',
        'tests/unit/client.test.ts',
        'tests/unit/core-client.test.ts',
        'tests/e2e/sdk-preflight-closures.test.ts',
      ],
      proofSource: tsProofSources,
      requestConstraintKeys: rawConstraintKeysByGapId.get(gap.id) ?? [],
      generatedRuleClosure: gapClosedByPreflight(
        rawConstraintKeysByGapId.get(gap.id) ?? [],
        tsRules,
      ),
    }),
    sdkClosureForGap({
      gap,
      sdkTarget: 'python',
      operationIds: pythonOperationIds,
      proofFiles: [
        'python/openbox_sdk/generated/request_preflight.py',
        'python/tests/test_request_preflight.py',
      ],
      proofSource: pythonProofSources,
      requestConstraintKeys: rawConstraintKeysByGapId.get(gap.id) ?? [],
      generatedRuleClosure: gapClosedByPreflight(
        rawConstraintKeysByGapId.get(gap.id) ?? [],
        pythonRules,
      ),
    }),
  ]);
}

function rawSemanticGapConstraintKeysByGapId(): Map<string, string[]> {
  const keysByGapId = new Map<string, string[]>();
  for (const constraint of buildRequestConstraintConformance().constraints) {
    if (constraint.disposition !== 'raw-semantic-gap-sdk-closed') continue;
    for (const gapId of constraint.semanticGapIds) {
      const keys = keysByGapId.get(gapId) ?? [];
      keys.push(constraint.key);
      keysByGapId.set(gapId, keys);
    }
  }
  for (const [gapId, keys] of keysByGapId) {
    keysByGapId.set(gapId, [...new Set(keys)].sort());
  }
  return keysByGapId;
}

function sdkClosureForGap(opts: {
  gap: SemanticGapCoverage;
  sdkTarget: SdkSemanticGapClosure['sdkTarget'];
  operationIds: Set<string>;
  proofFiles: string[];
  proofSource: string;
  generatedRuleClosure: boolean;
  requestConstraintKeys: string[];
}): SdkSemanticGapClosure {
  const evidencePatterns = sdkGapEvidencePatterns(opts.gap, opts.requestConstraintKeys);
  const missingOperationIds = opts.gap.operationIds
    .filter((operationId) => !opts.operationIds.has(operationId))
    .sort();
  const missingEvidencePatterns = evidencePatterns
    .filter((pattern) => !opts.proofSource.includes(pattern))
    .sort();
  if (!opts.generatedRuleClosure) {
    missingEvidencePatterns.push(`generated-rule-closure:${opts.gap.id}`);
  }
  return {
    semanticGapId: opts.gap.id,
    sdkTarget: opts.sdkTarget,
    operationIds: [...opts.gap.operationIds].sort(),
    requestConstraintKeys: opts.requestConstraintKeys,
    proofFiles: opts.proofFiles,
    evidencePatterns,
    missingOperationIds,
    missingEvidencePatterns,
    status:
      missingOperationIds.length === 0 && missingEvidencePatterns.length === 0
        ? 'proven'
        : 'missing',
  };
}

function sdkGapEvidencePatterns(
  gap: SemanticGapCoverage,
  requestConstraintKeys: string[],
): string[] {
  return [
    gap.id,
    ...gap.operationIds,
    ...requestConstraintKeys,
  ];
}

function normalizeTsPreflightRules(): NormalizedPreflightRule[] {
  return [
    ...TS_BACKEND_REQUEST_PREFLIGHT_RULES.map((rule) => normalizeTsPreflightRule('backend', rule)),
    ...TS_CORE_REQUEST_PREFLIGHT_RULES.map((rule) => normalizeTsPreflightRule('core', rule)),
  ];
}

function normalizeTsPreflightRule(
  service: 'backend' | 'core',
  rule: (typeof TS_BACKEND_REQUEST_PREFLIGHT_RULES)[number],
): NormalizedPreflightRule {
  return {
    service,
    operationId: rule.operationId,
    query: rule.query?.map((query) => ({
      name: query.name,
      enum: query.enum,
      format: query.format,
      integer: query.integer,
      maximum: query.maximum,
      minimum: query.minimum,
      maxLength: query.maxLength,
    })),
    body: rule.body?.map((body) => ({
      path: body.path,
      type: body.type,
      enum: body.enum,
      format: body.format,
      minimum: body.minimum,
      maximum: body.maximum,
      integer: body.integer,
      minItems: body.minItems,
      maxItems: body.maxItems,
      maxLength: body.maxLength,
    })),
  };
}

function gapClosedByPreflight(
  requestConstraintKeys: string[],
  rules: NormalizedPreflightRule[],
): boolean {
  if (requestConstraintKeys.length === 0) return false;
  const generatedConstraintKeys = new Set(generatedPreflightConstraintKeys(rules));
  return requestConstraintKeys.every((key) => generatedConstraintKeys.has(key));
}

function generatedPreflightConstraintKeys(rules: readonly NormalizedPreflightRule[]): string[] {
  const keys: string[] = [];
  for (const rule of rules) {
    for (const query of rule.query ?? []) {
      for (const kind of executablePreflightConstraintKinds(query, false)) {
        keys.push(`${rule.service}:${rule.operationId}:query.${query.name}:${kind}`);
      }
    }
    for (const body of rule.body ?? []) {
      for (const kind of executablePreflightConstraintKinds(body, true)) {
        keys.push(`${rule.service}:${rule.operationId}:body.${body.path.join('.')}:${kind}`);
      }
    }
  }
  return uniqueSorted(keys);
}

function executablePreflightConstraintKinds(
  rule:
    | NonNullable<NormalizedPreflightRule['query']>[number]
    | NonNullable<NormalizedPreflightRule['body']>[number],
  includeType: boolean,
): string[] {
  const kinds: string[] = [];
  if (includeType && 'type' in rule && rule.type) kinds.push('type');
  if (rule.enum) kinds.push('enum');
  if (rule.format) kinds.push('format');
  if (rule.integer) kinds.push('integer');
  if (rule.maximum !== undefined) kinds.push('maximum');
  if ('maxItems' in rule && rule.maxItems !== undefined) kinds.push('maxItems');
  if (rule.maxLength !== undefined) kinds.push('maxLength');
  if (rule.minimum !== undefined) kinds.push('minimum');
  if ('minItems' in rule && rule.minItems !== undefined) kinds.push('minItems');
  return kinds;
}

function readPythonGeneratedPreflightRules(repoRoot: string): NormalizedPreflightRule[] {
  const source = readFileSync(
    resolve(repoRoot, 'python/openbox_sdk/generated/request_preflight.py'),
    'utf8',
  );
  return [
    ...parsePythonPreflightRuleList(source, 'BACKEND_REQUEST_PREFLIGHT_RULES', 'backend'),
    ...parsePythonPreflightRuleList(source, 'CORE_REQUEST_PREFLIGHT_RULES', 'core'),
  ];
}

function parsePythonPreflightRuleList(
  source: string,
  variableName: string,
  service: 'backend' | 'core',
): NormalizedPreflightRule[] {
  const assignment = `${variableName}: list[RequestPreflightRule] = `;
  const assignmentIndex = source.indexOf(assignment);
  if (assignmentIndex === -1) {
    throw new Error(`Missing generated Python preflight list ${variableName}`);
  }
  const listStart = source.indexOf('[', assignmentIndex + assignment.length);
  if (listStart === -1) {
    throw new Error(`Missing generated Python preflight list body for ${variableName}`);
  }
  const listEnd = findMatchingBracket(source, listStart, '[', ']');
  if (listEnd === -1) {
    throw new Error(`Unclosed generated Python preflight list ${variableName}`);
  }
  const literal = source
    .slice(listStart, listEnd + 1)
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null');
  const rules = JSON.parse(literal) as Array<{
    operation_id: string;
    query?: Array<{
      name: string;
      enum?: string[];
      format?: string;
      integer?: boolean;
      maximum?: number;
      minimum?: number;
      max_length?: number;
    }>;
    body?: Array<{
      path: string[];
      type?: string;
      enum?: string[];
      format?: string;
      minimum?: number;
      maximum?: number;
      integer?: boolean;
      min_items?: number;
      max_items?: number;
      max_length?: number;
    }>;
  }>;
  return rules.map((rule) => ({
    service,
    operationId: rule.operation_id,
    query: rule.query?.map((query) => ({
      name: query.name,
      enum: query.enum,
      format: query.format,
      integer: query.integer,
      maximum: query.maximum,
      minimum: query.minimum,
      maxLength: query.max_length,
    })),
    body: rule.body?.map((body) => ({
      path: body.path,
      type: body.type,
      enum: body.enum,
      format: body.format,
      minimum: body.minimum,
      maximum: body.maximum,
      integer: body.integer,
      minItems: body.min_items,
      maxItems: body.max_items,
      maxLength: body.max_length,
    })),
  }));
}

function findMatchingBracket(
  source: string,
  start: number,
  open: '[' | '{' | '(',
  close: ']' | '}' | ')',
): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const ch = source[index];
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
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function readCombinedSource(repoRoot: string, files: string[]): string {
  return files.map((file) => readFileSync(resolve(repoRoot, file), 'utf8')).join('\n');
}

function arrayEquals(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function finiteDomainGapToSemanticGap(gap: FiniteDomainGap): SemanticGapCoverage {
  return {
    id: gap.id,
    source: 'finite-domain-ledger',
    domainKeys: gap.domainKeys.map(String).sort(),
    operationIds: [...gap.operationIds].sort(),
    proofFile: gap.proofFile,
    evidencePattern: gap.evidencePattern,
    observedBehavior: gap.observedBehavior,
    requiredBehavior: gap.requiredBehavior,
  };
}

function boundaryGapToSemanticGap(gap: BoundaryGap): SemanticGapCoverage {
  return {
    id: gap.id,
    source: 'boundary-ledger',
    domainKeys: gap.domainKeys.map(String).sort(),
    operationIds: [...gap.operationIds].sort(),
    proofFile: gap.proofFile,
    evidencePattern: gap.evidencePattern,
    observedBehavior: gap.observedBehavior,
    requiredBehavior: gap.requiredBehavior,
  };
}

function readJson<T>(repoRoot: string, relPath: string): T {
  return JSON.parse(readFileSync(resolve(repoRoot, relPath), 'utf8')) as T;
}

function tagFromOperation(entry: ManifestEntry): string {
  const prefix = entry.operationId.match(/^([A-Za-z]+)Controller_/)?.[1];
  if (prefix) return prefix;
  if (entry.operationId === 'healthCheck') return 'Health';
  if (entry.operationId === 'validateApiKey') return 'Auth';
  if (/governance|approval/i.test(entry.operationId)) return 'Governance';
  return 'Unknown';
}

class OperationMatcher {
  private readonly byId = new Map<string, SpecOperation>();
  private readonly candidates: Array<{
    operation: SpecOperation;
    regex: RegExp;
  }>;

  constructor(operations: SpecOperation[]) {
    this.candidates = operations
      .map((operation) => ({
        operation,
        regex: pathPatternRegex(operation.pathPattern),
      }))
      .sort((left, right) =>
        compareOperationRouteSpecificity(left.operation, right.operation) ||
        left.operation.operationId.localeCompare(right.operation.operationId),
      );
    for (const operation of operations) {
      this.byId.set(operation.operationId, operation);
    }
  }

  byOperationId(operationId: string): SpecOperation | undefined {
    return this.byId.get(operationId);
  }

  match(call: ExtractedCall): SpecOperation | undefined {
    if (!call.verb || !call.rawPath) return undefined;
    const path = normalizeConcretePath(call.rawPath);
    const service = call.serviceHint ?? inferServiceFromPath(path);
    const verb = call.verb.toLowerCase();
    return this.candidates.find(
      ({ operation, regex }) =>
        operation.service === service &&
        operation.verb === verb &&
        regex.test(path),
    )?.operation;
  }

  matchAll(call: ExtractedCall): SpecOperation[] {
    if (!call.verb || !call.rawPath) return [];
    const path = normalizeConcretePath(call.rawPath);
    const service = call.serviceHint ?? inferServiceFromPath(path);
    const verb = call.verb.toLowerCase();
    return this.candidates
      .filter(
        ({ operation, regex }) =>
          operation.service === service &&
          operation.verb === verb &&
          regex.test(path),
      )
      .map((entry) => entry.operation);
  }
}

function buildGeneratedMethodMap(repoRoot: string, matcher: OperationMatcher): Map<string, SpecOperation> {
  const methodMap = new Map<string, SpecOperation>();
  const files: Array<{ service: 'backend' | 'core'; relPath: string }> = [
    { service: 'backend', relPath: 'ts/src/client/generated/wrapper-methods.ts' },
    { service: 'core', relPath: 'ts/src/core-client/generated/wrapper-methods.ts' },
  ];

  for (const { service, relPath } of files) {
    const source = readFileSync(resolve(repoRoot, relPath), 'utf8');
    const methodRe =
      /async\s+([A-Za-z0-9_]+)\([^)]*\):\s+Promise<ResponseOf<"([^"]+)",\s*"([^"]+)">>/g;
    for (const match of source.matchAll(methodRe)) {
      const [, methodName, path, verb] = match;
      const operation = matcher.match({ serviceHint: service, verb, rawPath: path, call: methodName });
      if (operation) setMethodOperation(methodMap, service, methodName, operation);
    }
  }

  addMethodAliases(repoRoot, methodMap, matcher);
  return methodMap;
}

function methodKey(service: 'backend' | 'core', methodName: string): string {
  return `${service}:${methodName}`;
}

function setMethodOperation(
  methodMap: Map<string, SpecOperation>,
  service: 'backend' | 'core',
  methodName: string,
  operation: SpecOperation,
): void {
  methodMap.set(methodKey(service, methodName), operation);
  const existing = methodMap.get(methodName);
  if (!existing) {
    methodMap.set(methodName, operation);
    return;
  }
  if (existing.service !== operation.service || existing.operationId !== operation.operationId) {
    methodMap.delete(methodName);
  }
}

function resolveMethodOperation(
  methodMap: Map<string, SpecOperation>,
  call: ExtractedCall,
): SpecOperation | undefined {
  if (!call.methodName) return undefined;
  if (call.serviceHint) {
    return methodMap.get(methodKey(call.serviceHint, call.methodName));
  }
  return methodMap.get(call.methodName);
}

function addMethodAliases(
  repoRoot: string,
  methodMap: Map<string, SpecOperation>,
  matcher: OperationMatcher,
): void {
  const files: Array<{ service: 'backend' | 'core'; relPath: string }> = [
    { service: 'backend', relPath: 'ts/src/client/client.ts' },
    { service: 'core', relPath: 'ts/src/core-client/core-client.ts' },
  ];
  for (const { service, relPath } of files) {
    const source = readFileSync(resolve(repoRoot, relPath), 'utf8');
    const aliasRe = /async\s+([A-Za-z0-9_]+)\([^)]*\)[^{]*\{([\s\S]*?)^\s*\}/gm;
    for (const match of source.matchAll(aliasRe)) {
      const [, aliasName, body] = match;
      const inner = body.match(/this\.([A-Za-z0-9_]+)\(/)?.[1];
      const innerOperation = inner
        ? methodMap.get(methodKey(service, inner)) ?? methodMap.get(inner)
        : undefined;
      if (innerOperation && !methodMap.has(methodKey(service, aliasName))) {
        setMethodOperation(methodMap, service, aliasName, innerOperation);
        continue;
      }

      const request = body.match(
        /this\.request\(\s*(['"])(GET|POST|PUT|PATCH|DELETE)\1\s*,\s*(['"`])([^'"`]+)\3/i,
      );
      if (!request || methodMap.has(methodKey(service, aliasName))) {
        continue;
      }
      const operation = matcher.match({
        serviceHint: service,
        verb: request[2],
        rawPath: request[4],
        call: aliasName,
      });
      if (operation) {
        setMethodOperation(methodMap, service, aliasName, operation);
      }
    }
  }
}

function readE2eTestBlocks(repoRoot: string): TestBlock[] {
  const out: TestBlock[] = [];
  for (const filePath of walk(resolve(repoRoot, 'tests/e2e')).filter((file) => file.endsWith('.test.ts'))) {
    const source = readFileSync(filePath, 'utf8');
    const relFile = relative(repoRoot, filePath);
    for (const block of extractTestBlocks(source)) {
      out.push({ file: relFile, ...block });
    }
  }
  return out;
}

function readAllTestBlocks(repoRoot: string): TestBlock[] {
  const out: TestBlock[] = [];
  for (const dir of ['tests/e2e', 'tests/unit', 'tests/contract', 'tests/hook-integration']) {
    const absDir = resolve(repoRoot, dir);
    if (!statSync(absDir, { throwIfNoEntry: false })) continue;
    for (const filePath of walk(absDir).filter((file) => file.endsWith('.test.ts'))) {
      const source = readFileSync(filePath, 'utf8');
      const relFile = relative(repoRoot, filePath);
      for (const block of extractTestBlocks(source)) {
        out.push({ file: relFile, ...block });
      }
    }
  }
  return out;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
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

export function extractLocalStackTestBlocksForTesting(source: string): Array<{ name: string; source: string }> {
  return extractTestBlocks(source);
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

function classifyTestBlock(source: string): {
  proofLevel: Exclude<ProofLevel, 'none'>;
  reasons: string[];
} {
  const executableSource = stripScenarioProofMarkerAssertions(stripCodeComments(source));
  const normalized = executableSource.replace(/\s+/g, ' ');
  const title = extractTestTitle(source);
  const reasons: string[] = [];
  const hasBehavioralAssertion = hasExecutableBehavioralAssertion(normalized);
  const hasExecutableAssertion = hasBehavioralAssertion || hasExecutablePrimitiveAssertion(normalized);
  const multiStatusOutcome = getMultiStatusAllowanceOutcome(normalized);
  if (hasConditionalSkipPath(normalized)) {
    reasons.push('conditional skip or early-return assertion path');
    return { proofLevel: 'smoke', reasons };
  }
  if (multiStatusOutcome === 'negative') {
    reasons.push('multi-status negative-path allowance');
    return { proofLevel: 'negative-path', reasons };
  }
  if (multiStatusOutcome === 'mixed') {
    reasons.push('multi-status mixed success/failure allowance');
    return { proofLevel: 'smoke', reasons };
  }
  if (hasNegativeProofTitle(title)) {
    if (hasExecutableContractBoundaryEvidence(normalized) && hasExecutableAssertion) {
      reasons.push('executable local-stack contract-boundary evidence');
      return { proofLevel: 'conformance', reasons };
    }
    reasons.push('test-title negative-path proof marker');
    return { proofLevel: 'negative-path', reasons };
  }
  if (
    hasConformanceProofTitle(title) &&
    hasExecutableConformanceEvidence(normalized) &&
    hasExecutableAssertion
  ) {
    reasons.push('test-title conformance proof marker with executable generated-spec or persisted-ledger evidence');
    return { proofLevel: 'conformance', reasons };
  }
  if (hasExecutableConformanceEvidence(normalized) && hasExecutableAssertion) {
    reasons.push('executable generated-spec or persisted-ledger conformance evidence');
    return { proofLevel: 'conformance', reasons };
  }
  if (/may return 500|endpoint is reachable|not hang\/crash|status\)\.toBeDefined\(\)/i.test(normalized)) {
    reasons.push('reachable/status-only assertion');
    return { proofLevel: 'smoke', reasons };
  }
  if (/OpenBoxApiError|CoreApiError|Should have thrown|status\)\.not\.toBe\(0\)|toBe\(40[0-9]\)|toBe\(42[0-9]\)|toContain\(\(err as/i.test(normalized)) {
    reasons.push('negative-path assertion');
    return { proofLevel: 'negative-path', reasons };
  }
  if (hasBehavioralAssertion) {
    reasons.push('response shape or persisted-state assertion');
    return { proofLevel: 'behavioral', reasons };
  }
  reasons.push('status-only assertion');
  return { proofLevel: 'smoke', reasons };
}

export function classifyLocalStackTestBlockForTesting(source: string): {
  proofLevel: Exclude<ProofLevel, 'none'>;
  reasons: string[];
} {
  return classifyTestBlock(source);
}

function stripScenarioProofMarkerAssertions(source: string): string {
  const sourceFile = ts.createSourceFile(
    'local-stack-proof-block.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const ranges: Array<[number, number]> = [];
  const visit = (node: ts.Node) => {
    const expressionText = ts.isExpressionStatement(node)
      ? node.expression.getText(sourceFile).trim()
      : '';
    if (
      ts.isExpressionStatement(node) &&
      expressionText.startsWith('expect(') &&
      node.getText(sourceFile).includes('SCENARIO_PROOF:')
    ) {
      ranges.push([node.getFullStart(), node.getEnd()]);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (ranges.length === 0) return source;

  let out = source;
  for (const [start, end] of ranges.sort((left, right) => right[0] - left[0])) {
    out = `${out.slice(0, start)}${' '.repeat(end - start)}${out.slice(end)}`;
  }
  return out;
}

export function extractLocalStackCallsForTesting(source: string, file: string) {
  return extractExecutableCalls(source, file);
}

export function localStackBlockIncludesEvidencePatternForTesting(
  source: string,
  pattern: string,
): boolean {
  return testSourceIncludesEvidencePattern(source, pattern);
}

export function localStackTestBlockIncludesEvidencePatternForTesting(
  name: string,
  source: string,
  pattern: string,
): boolean {
  return blockIncludesPattern({ file: '__test__.ts', name, source }, pattern);
}

export function localStackBlockIncludesScenarioMarkerForTesting(
  source: string,
  marker: string,
): boolean {
  return blockIncludesMarker({ file: '__test__.ts', name: '__test__', source }, marker);
}

export function localStackBlockHasScenarioEvidenceForTesting(
  source: string,
  evidencePatterns: readonly string[],
): boolean {
  return blockHasScenarioEvidence(
    { file: '__test__.ts', name: '__test__', source },
    evidencePatterns,
  );
}

export function providerGuardTestRefMatchesBlockForTesting(
  guardTest: string,
  block: TestBlock,
): boolean {
  return resolveProviderGuardTestRef({ provider: '__test__', guardTest }, [block]).length > 0;
}

function extractTestTitle(source: string): string {
  const match = source.match(/\b(?:it|test)\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1\s*,/);
  return match?.[2] ?? '';
}

function hasNegativeProofTitle(title: string): boolean {
  return /\bNEGATIVE(?::|_[A-Z_]*PROOF:)/.test(title);
}

function hasConformanceProofTitle(title: string): boolean {
  return /\b(?:CONFORMANCE|CONTRACT_BOUNDARY|BOUNDARY_PROOF|EXHAUSTIVE|EXHAUSTIVE_SPEC_PROOF|EXHAUSTIVE_BOUNDARY_PROOF)(?::|_[A-Z_]*PROOF:)/.test(title);
}

function hasExecutableBehavioralAssertion(normalizedSource: string): boolean {
  return /toHaveProperty|toEqual|arrayContaining|objectContaining|\.find\(|\.toMatch(?:Object)?\(|\.toBeGreaterThan|\.toBeGreaterThanOrEqual|\.toBeLessThan|\.toContain\(|(?:body|response)\.data(?:\?\.|\.)[A-Za-z_$]|(?:body|response)\.data\)\.toBe\(|result\.[A-Za-z_]|expectValidationOrThrottle\(/.test(normalizedSource);
}

function hasExecutablePrimitiveAssertion(normalizedSource: string): boolean {
  return /\.toBe\(|\.toBeDefined\(|\.toBeTruthy\(|\.toBeFalsy\(|\.toHaveLength\(/.test(normalizedSource);
}

function hasExecutableConformanceEvidence(normalizedSource: string): boolean {
  return /\bmake[A-Za-z0-9]+ConformanceCases?\(|\bGOVERNANCE_(?:SPEC|BOUNDARY)_DOMAINS\.|\bUSAGE_NORMALIZATION_SURFACE\.|\brunLocalStackSql\(|\b(?:backendOperation|coreOperation)\(|\boperationPath\(|\bensure[A-Za-z0-9]+Ledger\b/.test(normalizedSource);
}

function hasConditionalSkipPath(normalizedSource: string): boolean {
  return /console\.log\([^)]*skipp|skipping assertions|No [A-Za-z0-9_ -]+ found[^)]*skipping/i.test(normalizedSource);
}

function getMultiStatusAllowanceOutcome(
  normalizedSource: string,
): 'mixed' | 'negative' | undefined {
  const match = normalizedSource.match(/expect\(\s*\[([^\]]+)\]\s*\)\.toContain\([^)]*(?:body|response)\.status/);
  if (!match) return undefined;
  const statuses = [...match[1].matchAll(/\b([1-5][0-9]{2})\b/g)]
    .map((entry) => Number(entry[1]));
  if (statuses.length < 2) return undefined;
  const hasSuccess = statuses.some((status) => status >= 200 && status < 300);
  const hasFailure = statuses.some((status) => status >= 400);
  if (hasSuccess && hasFailure) return 'mixed';
  if (hasFailure) return 'negative';
  return undefined;
}

function hasExecutableContractBoundaryEvidence(normalizedSource: string): boolean {
  return /requires JWT authentication|API keys are not accepted|not enabled|read:user|delete:user|create:user|invite:user|update:user|assign:role|remove:role|send-welcome-email|user_ids|webhooks/.test(normalizedSource);
}

function extractExecutableCalls(source: string, file: string): ExtractedCall[] {
  return extractCalls(stripCodeComments(source), file);
}

function extractCalls(source: string, file: string): ExtractedCall[] {
  const calls: ExtractedCall[] = [];
  const operationVars = extractOperationVars(source);
  const sourceFile = ts.createSourceFile(
    `local-stack-conformance-${file.replace(/[^A-Za-z0-9_.-]/g, '-')}`,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const cliCall = extractCliCall(node);
      if (cliCall) {
        calls.push(cliCall);
      } else {
        const propertyCall = extractPropertyCall(node, file, operationVars);
        if (propertyCall) calls.push(propertyCall);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return calls;
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const IGNORED_METHOD_TARGETS = new Set(['expect', 'JSON', 'Array', 'Math', 'Date', 'Promise']);

function extractPropertyCall(
  node: ts.CallExpression,
  file: string,
  operationVars: Map<string, string>,
): ExtractedCall | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  if (!ts.isIdentifier(node.expression.expression)) return undefined;

  const target = node.expression.expression.text;
  const methodName = node.expression.name.text;

  if (HTTP_METHODS.has(methodName)) {
    const firstArgument = node.arguments[0];
    const operationVar = firstArgument
      ? operationVarFromOperationPathArgument(firstArgument) ?? operationVarFromPathAccess(firstArgument)
      : undefined;
    if (operationVar) {
      const operationId = operationVars.get(operationVar);
      if (!operationId) return undefined;
      return {
        serviceHint: inferServiceFromCallTarget(target, file),
        verb: methodName,
        operationId,
        call: operationVarFromOperationPathArgument(firstArgument)
          ? `${target}.${methodName}(operationPath(${operationVar}.path))`
          : `${target}.${methodName}(${operationVar}.path)`,
      };
    }

    const rawPath = firstArgument ? literalPathText(firstArgument) : undefined;
    if (!rawPath) return undefined;
    return {
      serviceHint: inferServiceFromCallTarget(target, file),
      verb: methodName,
      rawPath,
      call: `${target}.${methodName}(${rawPath})`,
    };
  }

  if (IGNORED_METHOD_TARGETS.has(target)) return undefined;
  if (!isGeneratedSdkMethodTarget(target, file)) return undefined;
  return {
    serviceHint: inferServiceFromCallTarget(target, file),
    methodName,
    call: `${target}.${methodName}()`,
  };
}

function isGeneratedSdkMethodTarget(target: string, file: string): boolean {
  if (/openbox-client\.test\.ts$/.test(file)) return target === 'client';
  if (/core-client\.test\.ts$/.test(file)) return target === 'client' || target === 'badClient';
  return false;
}

function extractCliCall(node: ts.CallExpression): ExtractedCall | undefined {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'runCli') return undefined;
  const argv = node.arguments[0];
  if (!argv || !ts.isArrayLiteralExpression(argv)) return undefined;

  const args = argv.elements.map((element) => literalText(element));
  if (args[0] !== 'api') return undefined;
  if (args[1] !== 'backend' && args[1] !== 'core') return undefined;
  if (!args[2]) return undefined;

  return {
    serviceHint: args[1],
    operationId: args[2],
    call: `openbox api ${args[1]} ${args[2]}`,
  };
}

function operationVarFromOperationPathArgument(argument: ts.Expression): string | undefined {
  if (
    ts.isCallExpression(argument) &&
    ts.isIdentifier(argument.expression) &&
    argument.expression.text === 'operationPath'
  ) {
    return operationVarFromPathAccess(argument.arguments[0]);
  }

  if (ts.isTemplateExpression(argument)) {
    for (const span of argument.templateSpans) {
      const operationVar = operationVarFromOperationPathArgument(span.expression);
      if (operationVar) return operationVar;
    }
  }

  return undefined;
}

function operationVarFromPathAccess(node: ts.Node | undefined): string | undefined {
  if (!node || !ts.isPropertyAccessExpression(node)) return undefined;
  if (node.name.text !== 'path') return undefined;
  return ts.isIdentifier(node.expression) ? node.expression.text : undefined;
}

function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function literalPathText(node: ts.Node): string | undefined {
  const direct = literalText(node);
  if (direct) return direct;
  if (!ts.isTemplateExpression(node)) return undefined;

  let raw = node.head.text;
  for (const span of node.templateSpans) {
    raw += '${value}';
    raw += span.literal.text;
  }
  return raw;
}

function extractOperationVars(source: string): Map<string, string> {
  const conformanceCaseOperationIds = new Map<string, string>();
  const regoConformanceCaseRe =
    /\bconst\s+([A-Za-z0-9_]+)\s*=\s*makeEvaluateRegoConformanceCase\(\s*\)/g;
  for (const match of source.matchAll(regoConformanceCaseRe)) {
    conformanceCaseOperationIds.set(`${match[1]}.operationId`, 'PolicyController_evaluate');
  }

  const approvalConformanceCaseRe =
    /\bconst\s+([A-Za-z0-9_]+)\s*=\s*(?:makeRequireApprovalPolicyConformanceCase|makeApprovalExpirationConformanceCase)\(\s*\)/g;
  for (const match of source.matchAll(approvalConformanceCaseRe)) {
    conformanceCaseOperationIds.set(`${match[1]}.createPolicyOperationId`, 'AgentController_createPolicy');
    conformanceCaseOperationIds.set(`${match[1]}.pendingApprovalsOperationId`, 'AgentController_getPendingApprovals');
    conformanceCaseOperationIds.set(`${match[1]}.organizationApprovalsOperationId`, 'OrganizationController_getApprovals');
    conformanceCaseOperationIds.set(`${match[1]}.decideApprovalOperationId`, 'AgentController_decideApproval');
    conformanceCaseOperationIds.set(`${match[1]}.approvalHistoryOperationId`, 'AgentController_getApprovalHistory');
    conformanceCaseOperationIds.set(`${match[1]}.evaluateOperationId`, 'evaluateGovernance');
    conformanceCaseOperationIds.set(`${match[1]}.pollOperationId`, 'pollApproval');
  }

  const opaConformanceCaseRe =
    /\bconst\s+([A-Za-z0-9_]+)\s*=\s*(?:makeOpaVerdictMatrixConformanceCase|makeOpaAliasDecisionConformanceCase|makeOpaUnsupportedConstrainConformanceCase|makeOpaUnavailableFailClosedConformanceCase)\(\s*\)/g;
  for (const match of source.matchAll(opaConformanceCaseRe)) {
    conformanceCaseOperationIds.set(`${match[1]}.createPolicyOperationId`, 'AgentController_createPolicy');
    conformanceCaseOperationIds.set(`${match[1]}.evaluateOperationId`, 'evaluateGovernance');
  }

  const goalSignalConformanceCaseRe =
    /\bconst\s+([A-Za-z0-9_]+)\s*=\s*makeGoalSignalOrderConformanceCase\(\s*\)/g;
  for (const match of source.matchAll(goalSignalConformanceCaseRe)) {
    conformanceCaseOperationIds.set(`${match[1]}.evaluateOperationId`, 'evaluateGovernance');
  }

  const goalDriftConformanceCaseRe =
    /\bconst\s+([A-Za-z0-9_]+)\s*=\s*makeGoalDriftDetectedConformanceCase\(\s*\)/g;
  for (const match of source.matchAll(goalDriftConformanceCaseRe)) {
    conformanceCaseOperationIds.set(`${match[1]}.recentDriftsOperationId`, 'AgentController_getRecentDriftEvents');
    conformanceCaseOperationIds.set(`${match[1]}.driftLogsOperationId`, 'AgentController_getDriftEvents');
    conformanceCaseOperationIds.set(`${match[1]}.trendOperationId`, 'AgentController_getGoalAlignmentTrend');
    conformanceCaseOperationIds.set(`${match[1]}.sessionStatsOperationId`, 'AgentController_getSessionGoalAlignmentStats');
  }

  const operationVars = new Map<string, string>();
  const operationRe =
    /\bconst\s+([A-Za-z0-9_]+)\s*=\s*(?:backendOperation|coreOperation)\(\s*(?:(['"])([^'"]+)\2|([A-Za-z0-9_]+)\.([A-Za-z0-9_]+))\s*\)/g;
  for (const match of source.matchAll(operationRe)) {
    const [, variableName, , literalOperationId, caseVariableName, casePropertyName] = match;
    const operationId =
      literalOperationId ||
      conformanceCaseOperationIds.get(`${caseVariableName}.${casePropertyName}`);
    if (operationId) operationVars.set(variableName, operationId);
  }
  return operationVars;
}

function inferServiceFromCallTarget(
  target: string,
  file: string,
): 'backend' | 'core' | undefined {
  const lowerTarget = target.toLowerCase();
  if (lowerTarget.includes('core')) return 'core';
  if (lowerTarget.includes('backend')) return 'backend';
  if (/core-(client|governance)\.test\.ts$/.test(file)) return 'core';
  if (/openbox-client\.test\.ts$/.test(file)) return 'backend';
  return undefined;
}

function inferServiceFromPath(path: string): 'backend' | 'core' {
  return path === '/' || path.startsWith('/api/v1/') ? 'core' : 'backend';
}

function normalizeConcretePath(rawPath: string): string {
  return rawPath
    .replace(/\$\{[^}]+\}/g, 'value')
    .replace(/\{x\}/g, 'value')
    .split('?')[0];
}

function pathPatternRegex(pathPattern: string): RegExp {
  const escaped = pathPattern
    .split('{x}')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]+');
  return new RegExp(`^${escaped}$`);
}

function operationRouteSpecificity(operation: SpecOperation): {
  literalSegments: number;
  totalSegments: number;
  literalCharacters: number;
} {
  const segments = operation.pathPattern.split('/').filter(Boolean);
  const literalSegments = segments.filter((segment) => segment !== '{x}');
  return {
    literalSegments: literalSegments.length,
    totalSegments: segments.length,
    literalCharacters: literalSegments.join('/').length,
  };
}

function compareOperationRouteSpecificity(left: SpecOperation, right: SpecOperation): number {
  const leftScore = operationRouteSpecificity(left);
  const rightScore = operationRouteSpecificity(right);
  return (
    rightScore.literalSegments - leftScore.literalSegments ||
    rightScore.totalSegments - leftScore.totalSegments ||
    rightScore.literalCharacters - leftScore.literalCharacters
  );
}

function sameOperationRouteSpecificity(left: SpecOperation, right: SpecOperation): boolean {
  return compareOperationRouteSpecificity(left, right) === 0;
}

function maxProofLevel(levels: ProofLevel[]): ProofLevel {
  let best: ProofLevel = 'none';
  for (const level of levels) {
    if (PROOF_ORDER[level] > PROOF_ORDER[best]) best = level;
  }
  return best;
}

function summarizeSmokeHits(coverage: OperationCoverage[]): SmokeOperationHit[] {
  return coverage
    .flatMap((entry) =>
      entry.hits
        .filter((hit) => hit.proofLevel === 'smoke')
        .map((hit) => ({
          operationId: entry.operation.operationId,
          file: hit.file,
          testName: hit.testName,
          call: hit.call,
        })),
    )
    .sort((left, right) =>
      `${left.operationId}\0${left.file}\0${left.testName}\0${left.call}`.localeCompare(
        `${right.operationId}\0${right.file}\0${right.testName}\0${right.call}`,
      ),
    );
}

function summarizeObjective(
  spec: LocalStackObjectiveSpec,
  coverageByOperationId: Map<string, OperationCoverage>,
): ObjectiveCoverage {
  const operationIds = [...spec.operationIds].sort();
  const coverage = operationIds
    .map((operationId) => coverageByOperationId.get(operationId))
    .filter((entry): entry is OperationCoverage => Boolean(entry));
  const missingOperationIds = operationIds.filter(
    (operationId) => !coverageByOperationId.has(operationId),
  );
  const proofCounts: Record<ProofLevel, number> = {
    none: 0,
    smoke: 0,
    'negative-path': 0,
    behavioral: 0,
    conformance: 0,
  };
  for (const entry of coverage) {
    proofCounts[entry.proofLevel]++;
  }
  return {
    id: spec.id,
    label: spec.label,
    minimumProofLevel: spec.minimumProofLevel,
    operationIds,
    operationCount: operationIds.length,
    proofCounts,
    missingOperationIds: coverage
      .filter((entry) => entry.proofLevel === 'none')
      .map((entry) => entry.operation.operationId)
      .concat(missingOperationIds)
      .sort(),
    smokeOnlyOperationIds: coverage
      .filter((entry) => entry.proofLevel === 'smoke')
      .map((entry) => entry.operation.operationId)
      .sort(),
    behavioralOrBetterOperationIds: coverage
      .filter((entry) => PROOF_ORDER[entry.proofLevel] >= PROOF_ORDER.behavioral)
      .map((entry) => entry.operation.operationId)
      .sort(),
    conformanceOperationIds: coverage
      .filter((entry) => entry.proofLevel === 'conformance')
      .map((entry) => entry.operation.operationId)
      .sort(),
    underConformanceOperationIds: coverage
      .filter((entry) => PROOF_ORDER[entry.proofLevel] < PROOF_ORDER[spec.minimumProofLevel])
      .map((entry) => entry.operation.operationId)
      .concat(missingOperationIds)
      .sort(),
  };
}

function summarizeOperationManifestDuplicates(operations: SpecOperation[]): Pick<
  ScenarioMatrixCoverage,
  | 'duplicateOperationIdRefs'
  | 'duplicateServiceOperationIdRefs'
  | 'duplicateOperationRouteRefs'
  | 'duplicateOperationPathPatternRefs'
> {
  return {
    duplicateOperationIdRefs: duplicateKeys(operations, (operation) => operation.operationId),
    duplicateServiceOperationIdRefs: duplicateKeys(
      operations,
      (operation) => `${operation.service}:${operation.operationId}`,
    ),
    duplicateOperationRouteRefs: duplicateKeys(
      operations,
      (operation) =>
        `${operation.service}:${operation.verb.toUpperCase()}:${operation.path}`,
    ),
    duplicateOperationPathPatternRefs: duplicateKeys(
      operations,
      (operation) =>
        `${operation.service}:${operation.verb.toUpperCase()}:${operation.pathPattern}`,
    ),
  };
}

function summarizeOperationRouteResolution(
  operations: SpecOperation[],
  matcher: OperationMatcher,
): Pick<
  ScenarioMatrixCoverage,
  'operationRouteResolutionMismatchRefs' | 'ambiguousOperationRouteTieRefs'
> {
  const operationRouteResolutionMismatchRefs: string[] = [];
  const ambiguousOperationRouteTieRefs: string[] = [];

  for (const operation of operations) {
    const call = {
      serviceHint: operation.service,
      verb: operation.verb,
      rawPath: operation.path,
      call: operation.operationId,
    } satisfies ExtractedCall;
    const resolved = matcher.match(call);
    if (resolved?.operationId !== operation.operationId) {
      operationRouteResolutionMismatchRefs.push(
        `${operation.service}:${operation.verb}:${operation.path}:${operation.operationId}->${resolved?.operationId ?? '__missing__'}`,
      );
    }

    const matches = matcher.matchAll(call);
    if (matches.length > 1 && sameOperationRouteSpecificity(matches[0], matches[1])) {
      ambiguousOperationRouteTieRefs.push(
        `${operation.service}:${operation.verb}:${operation.path}:${matches
          .map((entry) => entry.operationId)
          .join('|')}`,
      );
    }
  }

  return {
    operationRouteResolutionMismatchRefs: uniqueSorted(operationRouteResolutionMismatchRefs),
    ambiguousOperationRouteTieRefs: uniqueSorted(ambiguousOperationRouteTieRefs),
  };
}

function summarizeProviderGuards(
  fixture: ProviderCapabilitiesFixture,
  allBlocks: TestBlock[],
): ProviderGuardCoverage[] {
  const groups: Array<[string, ProviderGuardEntry[] | undefined]> = [
    ['approvals-hitl', fixture.hitlCapabilityGuards],
    ['guardrails', fixture.guardrailCapabilityGuards],
    ['opa-rules', fixture.policyEvaluationGuards],
    ['tracing', fixture.tracingCapabilityGuards],
    ['usage-cost', fixture.usageCostCapabilityGuards],
  ];

  return groups.map(([capability, guards]) => {
    const matrixProviderTiers = (fixture.providerCapabilityMatrix ?? [])
      .filter((entry) => entry.capability === capability)
      .map((entry) => ({ provider: entry.provider, tier: entry.tier }))
      .sort((left, right) => left.provider.localeCompare(right.provider));
    const matrixTierByProvider = new Map(
      matrixProviderTiers.map((entry) => [entry.provider, entry.tier]),
    );
    const matrixProviders = uniqueSorted(
      matrixProviderTiers.map((entry) => entry.provider),
    );
    const guardTestRefs = (guards ?? [])
      .map((guard) => ({ provider: guard.provider, guardTest: guard.guardTest }))
      .sort((left, right) =>
        `${left.provider}:${left.guardTest}`.localeCompare(`${right.provider}:${right.guardTest}`),
      );
    const guardProviderTiers = (guards ?? [])
      .map((guard) => ({ provider: guard.provider, tier: guard.tier }))
      .sort((left, right) =>
        `${left.provider}:${left.tier}`.localeCompare(`${right.provider}:${right.tier}`),
      );
    const guardProviders = uniqueSorted((guards ?? []).map((guard) => guard.provider));
    const guardsByProvider = new Map<string, ProviderGuardEntry[]>();
    for (const guard of guards ?? []) {
      const providerGuards = guardsByProvider.get(guard.provider) ?? [];
      providerGuards.push(guard);
      guardsByProvider.set(guard.provider, providerGuards);
    }
    const providerTierMismatchRefs = uniqueSorted(
      (guards ?? []).flatMap((guard) => {
        const expectedTier = matrixTierByProvider.get(guard.provider) ?? '__missing__';
        const actualTier = guard.tier ?? '__missing__';
        return expectedTier === actualTier
          ? []
          : [`${capability}:${guard.provider}:${expectedTier}->${actualTier}`];
      }),
    );
    const duplicateProviderCapabilityGuardProviderRefs = uniqueSorted(
      [...guardsByProvider.entries()]
        .filter(([, providerGuards]) => providerGuards.length > 1)
        .map(([provider]) => `${capability}:${provider}`),
    );
    const providersByGuardTest = new Map<string, string[]>();
    for (const ref of guardTestRefs) {
      const providers = providersByGuardTest.get(ref.guardTest) ?? [];
      providers.push(ref.provider);
      providersByGuardTest.set(ref.guardTest, providers);
    }
    const sharedGuardTestRefs = [...providersByGuardTest.entries()]
      .map(([guardTest, providers]) => ({
        guardTest,
        providers: [...new Set(providers)].sort((left, right) => left.localeCompare(right)),
      }))
      .filter((entry) => entry.providers.length > 1)
      .sort((left, right) => left.guardTest.localeCompare(right.guardTest));
    const proofBlocksByRef = guardTestRefs.map((ref) => ({
      ref,
      blocks: resolveProviderGuardTestRef(ref, allBlocks),
    }));
    const missingGuardTestRefs = proofBlocksByRef
      .filter((entry) => entry.blocks.length === 0)
      .map((entry) => entry.ref)
      .sort((left, right) =>
        `${left.provider}:${left.guardTest}`.localeCompare(`${right.provider}:${right.guardTest}`),
      );
    return {
      capability,
      guardCount: guards?.length ?? 0,
      providers: guardProviders,
      matrixProviderTiers,
      matrixProviders,
      missingProviderCapabilityGuardProviders: missing(matrixProviders, guardProviders),
      unexpectedProviderCapabilityGuardProviders: unexpected(guardProviders, matrixProviders),
      providerTierMismatchRefs,
      duplicateProviderCapabilityGuardProviderRefs,
      guardProviderTiers,
      guardTestRefs,
      sharedGuardTestRefs,
      guardTests: [...new Set((guards ?? []).map((guard) => guard.guardTest))].sort(),
      proofFiles: [...new Set((guards ?? []).map((guard) => guard.guardTest.split('#')[0]))].sort(),
      guardProofBlockKeys: [
        ...new Set(proofBlocksByRef.flatMap((entry) => entry.blocks.map(testBlockKey))),
      ].sort(),
      missingGuardTestRefs,
    };
  });
}

function summarizeUnknownScenarioProofMarkers(
  e2eBlocks: TestBlock[],
  specs: ReadonlyArray<Pick<LocalStackScenarioPathSpec, 'id'>>,
): string[] {
  const knownScenarioIds = new Set(specs.map((entry) => entry.id));
  const refs: string[] = [];
  for (const block of e2eBlocks) {
    const source = stripCodeComments(block.source);
    const markerRe = /SCENARIO_PROOF:\s*([A-Za-z0-9_.-]+)/gi;
    for (const match of source.matchAll(markerRe)) {
      const scenarioId = match[1];
      if (knownScenarioIds.has(scenarioId)) continue;
      refs.push(`${scenarioId}:${block.file}#${block.name}`);
    }
  }
  return uniqueSorted(refs);
}

export function unknownScenarioProofMarkerRefsForTesting(
  source: string,
  knownScenarioIds: readonly string[],
): string[] {
  return summarizeUnknownScenarioProofMarkers(
    [{ file: '__test__.ts', name: '__test__', source }],
    knownScenarioIds.map((id) => ({ id })),
  );
}

function summarizeConformanceExceptions(
  fixture: ProviderCapabilitiesFixture,
): ConformanceException[] {
  const exceptionTiers = new Set(['observe-only', 'out-of-scope', 'diagnose-only']);
  return (fixture.providerCapabilityMatrix ?? [])
    .filter((entry) => exceptionTiers.has(entry.tier))
    .map((entry) => ({
      id: `${entry.provider}:${entry.capability}:${entry.tier}`,
      capability: entry.capability,
      provider: entry.provider,
      tier: entry.tier,
      reason:
        entry.closureDecision ??
        entry.status ??
        entry.rationale ??
        `${entry.provider} ${entry.capability} is ${entry.tier} in the generated provider capability matrix.`,
      source: 'codegen/fixtures/provider-capabilities.json',
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function summarizeCapabilityOutcomes(
  coverage: OperationCoverage[],
  providerGuards: ProviderGuardCoverage[],
  exceptions: ConformanceException[],
  semanticGaps: SemanticGapCoverage[],
  outcomeSpecs: ReadonlyArray<OutcomeSpecInput>,
): CapabilityOutcomeCoverage[] {
  const coverageByOperationId = new Map(
    coverage.map((entry) => [entry.operation.operationId, entry]),
  );
  const guardsByCapability = new Map(
    providerGuards.map((entry) => [entry.capability, entry]),
  );

  return outcomeSpecs.map((spec) => {
    const operationIds = [...(spec.operationIds ?? [])];
    const providerGuardCapabilities = [...(spec.providerGuardCapabilities ?? [])];
    const exceptionCapabilities = [...(spec.exceptionCapabilities ?? [])];
    const entries = operationIds
      .map((operationId) => coverageByOperationId.get(operationId))
      .filter((entry): entry is OperationCoverage => Boolean(entry));
    const missingOperationIds = operationIds.filter(
      (operationId) => !coverageByOperationId.has(operationId),
    );
    const underProvenOperationIds = entries
      .filter((entry) =>
        PROOF_ORDER[entry.proofLevel] < PROOF_ORDER[spec.minimumProofLevel],
      )
      .map((entry) => entry.operation.operationId)
      .sort();
    const proofCounts = countProofLevels(entries);
    const providerGuardEntries = providerGuardCapabilities
      .map((capability) => guardsByCapability.get(capability))
      .filter((entry): entry is ProviderGuardCoverage => Boolean(entry));
    const missingProviderGuardCapabilities = providerGuardCapabilities.filter((capability) => {
      const guard = guardsByCapability.get(capability);
      return (
        !guard ||
        guard.guardCount === 0 ||
        guard.proofFiles.length === 0 ||
        guard.guardProofBlockKeys.length !== guard.guardTests.length ||
        guard.missingGuardTestRefs.length > 0
      );
    });
    const missingProviderGuardTestRefs = providerGuardEntries
      .flatMap((guard) =>
        guard.missingGuardTestRefs.map((ref) => ({
          capability: guard.capability,
          provider: ref.provider,
          guardTest: ref.guardTest,
        })),
      )
      .sort((left, right) =>
        `${left.capability}:${left.provider}:${left.guardTest}`.localeCompare(
          `${right.capability}:${right.provider}:${right.guardTest}`,
        ),
      );
    const providerGuardProofBlockKeys = [
      ...new Set(providerGuardEntries.flatMap((guard) => guard.guardProofBlockKeys)),
    ].sort();
    const exceptionIds = exceptions
      .filter((entry) => exceptionCapabilities.includes(entry.capability))
      .map((entry) => entry.id)
      .sort();
    const semanticGapIds = semanticGaps
      .filter((gap) =>
        gap.operationIds.some((operationId) => operationIds.includes(operationId)),
      )
      .map((gap) => gap.id)
      .sort();

    return {
      id: spec.id,
      label: spec.label,
      source: spec.source,
      minimumProofLevel: spec.minimumProofLevel,
      operationIds,
      providerGuardCapabilities,
      exceptionCapabilities,
      providerGuardProofBlockKeys,
      missingProviderGuardCapabilities,
      missingProviderGuardTestRefs,
      proofCounts,
      underProvenOperationIds,
      missingOperationIds,
      semanticGapIds,
      exceptionIds,
      status:
        underProvenOperationIds.length === 0 &&
        missingOperationIds.length === 0 &&
        missingProviderGuardCapabilities.length === 0 &&
        missingProviderGuardTestRefs.length === 0 &&
        semanticGapIds.length === 0
          ? 'proven'
          : 'incomplete',
    };
  });
}

function summarizeScenarioPaths(
  specs: LocalStackScenarioPathSpec[],
  e2eBlocks: TestBlock[],
  allBlocks: TestBlock[],
  coverage: OperationCoverage[],
  providerGuards: ProviderGuardCoverage[],
): ScenarioPathCoverage[] {
  const coverageByOperationId = new Map(
    coverage.map((entry) => [entry.operation.operationId, entry]),
  );
  const providerGuardsByCapability = new Map(
    providerGuards.map((entry) => [entry.capability, entry]),
  );

  return specs.map((spec) => {
    const requiredProofLevel = normalizeProofLevel(spec.requiredProofLevel);
    const operationEntries = spec.operationIds
      .map((operationId) => coverageByOperationId.get(operationId))
      .filter((entry): entry is OperationCoverage => Boolean(entry));
    const missingOperationIds = spec.operationIds.filter(
      (operationId) => !coverageByOperationId.has(operationId),
    );
    const duplicateScenarioOperationIds = spec.localStackRequired
      ? duplicates(spec.operationIds)
      : [];
    const duplicateScenarioAxisIds = duplicates(spec.axes);
    const operationEvidencePatternIds = (spec.operationEvidencePatterns ?? [])
      .map((entry) => entry.operationId);
    const missingOperationEvidencePatternIds = spec.localStackRequired
      ? missing(spec.operationIds, operationEvidencePatternIds)
      : [];
    const unknownOperationEvidencePatternIds = spec.localStackRequired
      ? unexpected(operationEvidencePatternIds, spec.operationIds)
      : [];
    const duplicateOperationEvidencePatternIds = spec.localStackRequired
      ? duplicates(operationEvidencePatternIds)
      : [];
    const underProvenOperationIds = operationEntries
      .filter((entry) =>
        PROOF_ORDER[entry.proofLevel] < PROOF_ORDER[requiredProofLevel],
      )
      .map((entry) => entry.operation.operationId)
      .sort();
    const evidenceBlocks = spec.localStackRequired ? e2eBlocks : allBlocks;
    const requiredOperationBlockKeys = new Set(
      operationEntries.flatMap((entry) => entry.hits.map(operationHitBlockKey)),
    );
    const operationBackedEvidenceBlocks =
      spec.localStackRequired && spec.operationIds.length > 0
        ? evidenceBlocks.filter((block) => requiredOperationBlockKeys.has(testBlockKey(block)))
        : evidenceBlocks;
    const markerPattern = `SCENARIO_PROOF: ${spec.id}`;
    const markerBlocks = operationBackedEvidenceBlocks.filter((block) =>
      blockIncludesMarker(block, markerPattern),
    );
    const scenarioProofMarkerBlockKeys = [...new Set(markerBlocks.map(testBlockKey))].sort();
    const markerEvidenceBlocks = markerBlocks.filter((block) =>
      blockHasScenarioEvidence(block, spec.evidencePatterns),
    );
    const markerOnlyProofBlockKeys = [
      ...new Set(
        markerBlocks
          .filter((block) => !blockHasScenarioEvidence(block, spec.evidencePatterns))
          .map(testBlockKey),
      ),
    ].sort();
    const requiresScenarioProofMarker = spec.localStackRequired;
    const missingScenarioProofMarker =
      requiresScenarioProofMarker && scenarioProofMarkerBlockKeys.length === 0;
    const fullEvidenceBlocks = operationBackedEvidenceBlocks.filter((block) =>
      spec.evidencePatterns.every((pattern) => blockIncludesPattern(block, pattern)),
    );
    const matchingBlocks = markerBlocks.length > 0 ? markerEvidenceBlocks : fullEvidenceBlocks;
    const hasAllEvidencePatterns = spec.evidencePatterns.every((pattern) =>
      matchingBlocks.some((block) => blockIncludesPattern(block, pattern)),
    );
    const proofLevel = maxProofLevel(
      hasAllEvidencePatterns
        ? matchingBlocks.map((block) => classifyTestBlock(block.source).proofLevel)
        : [],
    );
    const operationProofLevel = maxProofLevel(
      operationEntries.map((entry) => entry.proofLevel),
    );
    const matchedEvidencePatterns = [
      markerPattern,
      ...spec.evidencePatterns,
    ]
      .filter((pattern) => matchingBlocks.some((block) => blockIncludesPattern(block, pattern)))
      .sort();
    const assertedEvidencePatternBlockKeys = spec.evidencePatterns.map((pattern) => ({
      pattern,
      blockKeys: [
        ...new Set(
          matchingBlocks
            .filter((block) => blockHasAssertedEvidencePattern(block, pattern))
            .map(testBlockKey),
        ),
      ].sort(),
    }));
    const assertedEvidencePatterns = assertedEvidencePatternBlockKeys
      .filter((entry) => entry.blockKeys.length > 0)
      .map((entry) => entry.pattern)
      .sort();
    const assertedEvidencePatternSet = new Set(assertedEvidencePatterns);
    const weakEvidencePatterns = spec.evidencePatterns
      .filter(
        (pattern) =>
          matchingBlocks.some((block) => blockIncludesPattern(block, pattern)) &&
          !assertedEvidencePatternSet.has(pattern),
      )
      .sort();
    const missingAssertedEvidence =
      spec.localStackRequired &&
      spec.evidencePatterns.some((pattern) => !assertedEvidencePatternSet.has(pattern));
    const proofFiles = [...new Set(matchingBlocks.map((block) => block.file))].sort();
    const proofTestNames = [...new Set(matchingBlocks.map((block) => block.name))].sort();
    const proofBlockKeys = [...new Set(matchingBlocks.map(testBlockKey))].sort();
    const evidencePatternBlockKeys = spec.evidencePatterns.map((pattern) => ({
      pattern,
      blockKeys: [
        ...new Set(
          matchingBlocks
            .filter((block) => blockIncludesPattern(block, pattern))
            .map(testBlockKey),
        ),
      ].sort(),
    }));
    const proofBlockKeySet = new Set(proofBlockKeys);
    const matchingBlocksByKey = new Map(
      matchingBlocks.map((block) => [testBlockKey(block), block]),
    );
    const operationProofs = operationEntries.map((entry) => {
      const requiredOperationEvidencePatterns = operationEvidencePatternsFor(
        spec,
        entry.operation.operationId,
      );
      const countedHits = entry.hits.filter(
        (hit) =>
          proofBlockKeySet.has(operationHitBlockKey(hit)) &&
          PROOF_ORDER[hit.proofLevel] >= PROOF_ORDER[requiredProofLevel],
      );
      const operationBlockKeys = uniqueSorted(countedHits.map(operationHitBlockKey));
      const operationBlocks = operationBlockKeys
        .map((blockKey) => matchingBlocksByKey.get(blockKey))
        .filter((block): block is TestBlock => Boolean(block));
      const operationEvidencePatternBlockKeys = requiredOperationEvidencePatterns.map((pattern) => ({
        pattern,
        blockKeys: uniqueSorted(
          operationBlocks
            .filter((block) => blockIncludesPattern(block, pattern))
            .map(testBlockKey),
        ),
      }));
      const assertedEvidencePatternBlockKeys = requiredOperationEvidencePatterns.map((pattern) => ({
        pattern,
        blockKeys: uniqueSorted(
          operationBlocks
            .filter((block) => blockHasAssertedEvidencePattern(block, pattern))
            .map(testBlockKey),
        ),
      }));
      const matchedOperationEvidencePatterns = operationEvidencePatternBlockKeys
        .filter((entry) => entry.blockKeys.length > 0)
        .map((entry) => entry.pattern)
        .sort();
      const missingOperationEvidencePatterns = operationEvidencePatternBlockKeys
        .filter((entry) => entry.blockKeys.length === 0)
        .map((entry) => entry.pattern)
        .sort();
      const assertedOperationEvidencePatterns = assertedEvidencePatternBlockKeys
        .filter((entry) => entry.blockKeys.length > 0)
        .map((entry) => entry.pattern)
        .sort();
      const assertedOperationEvidencePatternSet = new Set(assertedOperationEvidencePatterns);
      const missingAssertedOperationEvidencePatterns = requiredOperationEvidencePatterns
        .filter((pattern) => !assertedOperationEvidencePatternSet.has(pattern))
        .sort();
      const weakOperationEvidencePatterns = matchedOperationEvidencePatterns
        .filter((pattern) => !assertedOperationEvidencePatternSet.has(pattern))
        .sort();
      const generatedConformanceBlockKeys = uniqueSorted(
        operationBlocks
          .filter(blockHasGeneratedScenarioConformanceEvidence)
          .map(testBlockKey),
      );
      const operationProofLevel = maxProofLevel(countedHits.map((hit) => hit.proofLevel));
      return {
        operationId: entry.operation.operationId,
        proofLevel: operationProofLevel,
        requiredEvidencePatterns: requiredOperationEvidencePatterns,
        proofBlockKeys: operationBlockKeys,
        proofFiles: uniqueSorted(operationBlocks.map((block) => block.file)),
        proofTestNames: uniqueSorted(operationBlocks.map((block) => block.name)),
        matchedEvidencePatterns: matchedOperationEvidencePatterns,
        missingEvidencePatterns: missingOperationEvidencePatterns,
        assertedEvidencePatterns: assertedOperationEvidencePatterns,
        weakEvidencePatterns: weakOperationEvidencePatterns,
        assertedEvidencePatternBlockKeys,
        evidencePatternBlockKeys: operationEvidencePatternBlockKeys,
        generatedConformanceBlockKeys,
        missingProofBlock: operationBlockKeys.length === 0,
        underProven: PROOF_ORDER[operationProofLevel] < PROOF_ORDER[requiredProofLevel],
        missingEvidence: missingOperationEvidencePatterns.length > 0,
        missingAssertedEvidence: missingAssertedOperationEvidencePatterns.length > 0,
      };
    });
    const proofOperationIds = operationEntries
      .filter((entry) =>
        entry.hits.some(
          (hit) =>
            proofBlockKeySet.has(operationHitBlockKey(hit)) &&
            PROOF_ORDER[hit.proofLevel] >= PROOF_ORDER[requiredProofLevel],
        ),
      )
      .map((entry) => entry.operation.operationId)
      .sort();
    const missingProofOperationIds = spec.localStackRequired
      ? spec.operationIds.filter((operationId) => !proofOperationIds.includes(operationId)).sort()
      : [];
    const missingOperationEvidenceIds = spec.localStackRequired
      ? operationProofs
          .filter((entry) => entry.missingEvidence)
          .map((entry) => entry.operationId)
          .sort()
      : [];
    const missingAssertedOperationEvidenceIds = spec.localStackRequired
      ? operationProofs
          .filter((entry) => entry.missingAssertedEvidence)
          .map((entry) => entry.operationId)
          .sort()
      : [];
    const providerGuard = providerGuardsByCapability.get(spec.capability);
    const providerGuardTestRefs = providerGuard?.guardTestRefs ?? [];
    const providerGuardProofBlocksByRef = providerGuardTestRefs.map((ref) => ({
      ref,
      blocks: resolveProviderGuardTestRef(ref, allBlocks),
    }));
    const missingProviderGuardTestRefs = providerGuardProofBlocksByRef
      .filter((entry) => entry.blocks.length === 0)
      .map((entry) => entry.ref)
      .sort((left, right) =>
        `${left.provider}:${left.guardTest}`.localeCompare(`${right.provider}:${right.guardTest}`),
      );
    const providerGuardProofBlockKeys = [
      ...new Set(
        providerGuardProofBlocksByRef.flatMap((entry) => entry.blocks.map(testBlockKey)),
      ),
    ].sort();
    const requiresProviderGuardProof =
      !spec.localStackRequired && Boolean(providerGuard && providerGuard.guardTestRefs.length > 0);
    const providerProofAvailable =
      requiresProviderGuardProof &&
      hasAllEvidencePatterns &&
      PROOF_ORDER[proofLevel] >= PROOF_ORDER[requiredProofLevel] &&
      Boolean(providerGuard && providerGuard.guardTestRefs.length > 0 && providerGuard.proofFiles.length > 0) &&
      missingProviderGuardTestRefs.length === 0;
    const contractBoundaryProofAvailable =
      !spec.localStackRequired &&
      !requiresProviderGuardProof &&
      !providerProofAvailable &&
      PROOF_ORDER[proofLevel] >= PROOF_ORDER[requiredProofLevel];
    const effectiveProofLevel = providerProofAvailable
      ? maxProofLevel([proofLevel, requiredProofLevel])
      : proofLevel;
    const effectiveProofFiles = providerProofAvailable
      ? [...new Set([...proofFiles, ...(providerGuard?.proofFiles ?? [])])].sort()
      : proofFiles;
    const effectiveUnderProvenOperationIds = spec.localStackRequired
      ? underProvenOperationIds
      : [];
    const effectiveMissingOperationIds = spec.localStackRequired
      ? missingOperationIds
      : [];
    const status =
      PROOF_ORDER[effectiveProofLevel] >= PROOF_ORDER[requiredProofLevel] &&
      effectiveMissingOperationIds.length === 0 &&
      effectiveUnderProvenOperationIds.length === 0 &&
      missingProofOperationIds.length === 0 &&
      duplicateScenarioOperationIds.length === 0 &&
      missingOperationEvidencePatternIds.length === 0 &&
      unknownOperationEvidencePatternIds.length === 0 &&
      duplicateOperationEvidencePatternIds.length === 0 &&
      missingOperationEvidenceIds.length === 0 &&
      missingAssertedOperationEvidenceIds.length === 0 &&
      !missingAssertedEvidence &&
      !missingScenarioProofMarker &&
      (!requiresProviderGuardProof || providerProofAvailable)
        ? 'proven'
        : 'incomplete';
    const proofSource = spec.localStackRequired
      ? 'local-stack-e2e'
      : requiresProviderGuardProof
        ? 'provider-guard-fixture'
      : contractBoundaryProofAvailable
        ? 'contract-boundary'
        : 'contract-boundary';

    return {
      ...spec,
      requiredProofLevel,
      proofLevel: effectiveProofLevel,
      operationProofLevel,
      proofSource,
      proofFiles: effectiveProofFiles,
      proofTestNames,
      scenarioProofMarker: markerPattern,
      scenarioProofMarkerBlockKeys,
      markerOnlyProofBlockKeys,
      missingScenarioProofMarker,
      providerGuardTestRefs: providerProofAvailable ? providerGuardTestRefs : [],
      providerGuardProofBlockKeys: providerProofAvailable ? providerGuardProofBlockKeys : [],
      missingProviderGuardTestRefs,
      proofBlockKeys,
      proofOperationIds,
      missingProofOperationIds,
      duplicateScenarioOperationIds,
      duplicateScenarioAxisIds,
      missingOperationEvidencePatternIds,
      unknownOperationEvidencePatternIds,
      duplicateOperationEvidencePatternIds,
      operationProofs,
      missingOperationEvidenceIds,
      missingAssertedOperationEvidenceIds,
      matchedEvidencePatterns,
      assertedEvidencePatterns,
      weakEvidencePatterns,
      missingAssertedEvidence,
      assertedEvidencePatternBlockKeys,
      evidencePatternBlockKeys,
      underProvenOperationIds: effectiveUnderProvenOperationIds,
      missingOperationIds: effectiveMissingOperationIds,
      status,
      missingReason:
        status === 'proven'
          ? undefined
          : scenarioMissingReason(
              spec,
              requiredProofLevel,
              proofLevel,
              missingOperationIds,
              underProvenOperationIds,
              missingProofOperationIds,
              duplicateScenarioOperationIds,
              missingOperationEvidencePatternIds,
              unknownOperationEvidencePatternIds,
              duplicateOperationEvidencePatternIds,
              missingOperationEvidenceIds,
              missingAssertedOperationEvidenceIds,
              missingAssertedEvidence,
              missingScenarioProofMarker,
              missingProviderGuardTestRefs,
            ),
    };
  });
}

function summarizeScenarioMatrixContract(
  contract: LocalStackScenarioMatrixContract | undefined,
  coverage: OperationCoverage[],
  scenarioPaths: ScenarioPathCoverage[],
  outcomes: CapabilityOutcomeCoverage[],
  objectives: ObjectiveCoverage[],
  providerGuards: ProviderGuardCoverage[],
  semanticGaps: SemanticGapCoverage[],
  sdkSemanticGapClosures: SdkSemanticGapClosure[],
  backendCoreGapRemediationTargets: BackendCoreGapRemediationTarget[],
  requestConstraints: RequestConstraintConformance,
  operationManifestDuplicateRefs: Pick<
    ScenarioMatrixCoverage,
    | 'duplicateOperationIdRefs'
    | 'duplicateServiceOperationIdRefs'
    | 'duplicateOperationRouteRefs'
    | 'duplicateOperationPathPatternRefs'
  >,
  operationRouteResolutionRefs: Pick<
    ScenarioMatrixCoverage,
    'operationRouteResolutionMismatchRefs' | 'ambiguousOperationRouteTieRefs'
  >,
  unknownScenarioProofMarkerRefs: string[],
  providerDomains: ProviderCapabilityDomains,
  localStackDomains: LocalStackScenarioDomains,
): ScenarioMatrixCoverage {
  const resolvedContract = contract ?? {
    id: '__missing_local_stack_scenario_matrix__',
    description: 'Missing generated local-stack scenario matrix contract.',
    requiredCapabilities: [],
    requiredCategories: [],
    requiredAxes: [],
    requiredLocalStackAxes: [],
    requiredCategoryAxes: [],
    localStackScenarioIds: [],
    providerOwnedScenarioIds: [],
    requiredOutcomeIds: [],
    requiredOutcomeSpecs: [],
    requiredObjectiveIds: [],
    requiredObjectiveSpecs: [],
    transportOrFeatureGatedOperationIds: [],
    requestConstraintEvidenceSpecs: [],
    requestConstraintDomainSpecs: [],
    sdkGeneratedPreflightOnlyConstraintKeys: [],
    rawBackendCoreSemanticGaps: [],
    requiredSharedProviderGuardProofCapabilities: [],
    requiredSdkSemanticGapClosureTargets: [],
    providerGuardSharedProofPolicy: 'missing generated contract',
    localStackAxisPolicy: 'missing generated contract',
    rawSemanticGapPolicy: 'missing generated contract',
    backendCoreGapStatusPolicy: 'missing generated contract',
    backendCoreGapRemediationPolicy: 'missing generated contract',
  };
  const actualCapabilities = uniqueSorted(scenarioPaths.map((entry) => entry.capability));
  const actualCategories = uniqueSorted(scenarioPaths.map((entry) => entry.category));
  const actualAxes = uniqueSorted(scenarioPaths.flatMap((entry) => entry.axes));
  const actualLocalStackAxes = uniqueSorted(
    scenarioPaths
      .filter((entry) => entry.localStackRequired)
      .flatMap((entry) => entry.axes),
  );
  const provenLocalStackAxes = uniqueSorted(
    scenarioPaths
      .filter((entry) => entry.localStackRequired && entry.status === 'proven')
      .flatMap((entry) => entry.axes),
  );
  const actualLocalStackScenarioIds = uniqueSorted(
    scenarioPaths.filter((entry) => entry.localStackRequired).map((entry) => entry.id),
  );
  const actualProviderOwnedScenarioIds = uniqueSorted(
    scenarioPaths.filter((entry) => !entry.localStackRequired).map((entry) => entry.id),
  );
  const sharedProviderGuardProofCapabilities = uniqueSorted(
    providerGuards
      .filter((entry) => entry.sharedGuardTestRefs.length > 0)
      .map((entry) => entry.capability),
  );
  const missingProviderCapabilityGuardProviderRefs = uniqueSorted(
    providerGuards.flatMap((entry) =>
      entry.missingProviderCapabilityGuardProviders.map(
        (provider) => `${entry.capability}:${provider}`,
      ),
    ),
  );
  const unexpectedProviderCapabilityGuardProviderRefs = uniqueSorted(
    providerGuards.flatMap((entry) =>
      entry.unexpectedProviderCapabilityGuardProviders.map(
        (provider) => `${entry.capability}:${provider}`,
      ),
    ),
  );
  const providerGuardTierMismatchRefs = uniqueSorted(
    providerGuards.flatMap((entry) => entry.providerTierMismatchRefs),
  );
  const duplicateProviderCapabilityGuardProviderRefs = uniqueSorted(
    providerGuards.flatMap((entry) => entry.duplicateProviderCapabilityGuardProviderRefs),
  );
  const missingSharedProviderGuardProofCapabilities = missing(
    resolvedContract.requiredSharedProviderGuardProofCapabilities,
    sharedProviderGuardProofCapabilities,
  );
  const unexpectedSharedProviderGuardProofCapabilities = unexpected(
    sharedProviderGuardProofCapabilities,
    resolvedContract.requiredSharedProviderGuardProofCapabilities,
  );
  const outcomeIds = new Set(outcomes.map((entry) => entry.id));
  const outcomeById = new Map(outcomes.map((entry) => [entry.id, entry]));
  const objectiveIds = new Set(objectives.map((entry) => entry.id));
  const objectiveById = new Map(objectives.map((entry) => [entry.id, entry]));
  const operationIds = new Set(coverage.map((entry) => entry.operation.operationId));
  const requiredOutcomeIds = new Set(resolvedContract.requiredOutcomeIds);
  const incompleteScenarioIds = scenarioPaths
    .filter((entry) => entry.status !== 'proven')
    .map((entry) => entry.id)
    .sort();
  const missingOutcomeIds = resolvedContract.requiredOutcomeIds
    .filter((id) => !outcomeIds.has(id))
    .sort();
  const requiredOutcomeSpecIds = resolvedContract.requiredOutcomeSpecs
    .map((entry) => entry.id)
    .sort((left, right) => left.localeCompare(right));
  const outcomeSpecMismatchRefs = [
    ...missing(resolvedContract.requiredOutcomeIds, requiredOutcomeSpecIds).map(
      (id) => `${id}:missing-generated-outcome-spec`,
    ),
    ...unexpected(requiredOutcomeSpecIds, resolvedContract.requiredOutcomeIds).map(
      (id) => `${id}:unexpected-generated-outcome-spec`,
    ),
    ...resolvedContract.requiredOutcomeSpecs.flatMap((spec) => {
      const outcome = outcomeById.get(spec.id);
      if (!outcome) return [`${spec.id}:missing-outcome-coverage`];
      return [
        spec.label === outcome.label ? undefined : `${spec.id}:label`,
        spec.source === outcome.source ? undefined : `${spec.id}:source`,
        spec.minimumProofLevel === outcome.minimumProofLevel
          ? undefined
          : `${spec.id}:minimumProofLevel`,
        sortedEqual(spec.operationIds, outcome.operationIds) ? undefined : `${spec.id}:operationIds`,
        sortedEqual(spec.providerGuardCapabilities, outcome.providerGuardCapabilities)
          ? undefined
          : `${spec.id}:providerGuardCapabilities`,
        sortedEqual(spec.exceptionCapabilities, outcome.exceptionCapabilities)
          ? undefined
          : `${spec.id}:exceptionCapabilities`,
      ].filter((entry): entry is string => Boolean(entry));
    }),
  ].sort((left, right) => left.localeCompare(right));
  const requiredObjectiveSpecIds = resolvedContract.requiredObjectiveSpecs
    .map((entry) => entry.id)
    .sort((left, right) => left.localeCompare(right));
  const missingObjectiveIds = resolvedContract.requiredObjectiveIds
    .filter((id) => !objectiveIds.has(id))
    .sort();
  const objectiveSpecMismatchRefs = [
    ...missing(resolvedContract.requiredObjectiveIds, requiredObjectiveSpecIds).map(
      (id) => `${id}:missing-generated-objective-spec`,
    ),
    ...unexpected(requiredObjectiveSpecIds, resolvedContract.requiredObjectiveIds).map(
      (id) => `${id}:unexpected-generated-objective-spec`,
    ),
    ...resolvedContract.requiredObjectiveSpecs.flatMap((spec) => {
      const objective = objectiveById.get(spec.id);
      if (!objective) return [`${spec.id}:missing-objective-coverage`];
      return [
        spec.label === objective.label ? undefined : `${spec.id}:label`,
        spec.minimumProofLevel === objective.minimumProofLevel
          ? undefined
          : `${spec.id}:minimumProofLevel`,
        sortedEqual(spec.operationIds, objective.operationIds)
          ? undefined
          : `${spec.id}:operationIds`,
      ].filter((entry): entry is string => Boolean(entry));
    }),
  ].sort((left, right) => left.localeCompare(right));
  const unknownTransportOrFeatureGatedOperationIds =
    resolvedContract.transportOrFeatureGatedOperationIds
      .filter((operationId) => !operationIds.has(operationId))
      .sort((left, right) => left.localeCompare(right));
  const incompleteOutcomeIds = outcomes
    .filter((entry) => requiredOutcomeIds.has(entry.id))
    .filter((entry) => entry.status !== 'proven' && entry.semanticGapIds.length === 0)
    .map((entry) => entry.id)
    .sort();
  const rawSemanticGapOutcomeRefs = outcomes
    .filter((entry) => requiredOutcomeIds.has(entry.id))
    .filter((entry) => entry.status !== 'proven' && entry.semanticGapIds.length > 0)
    .map((entry) => ({
      outcomeId: entry.id,
      semanticGapIds: [...entry.semanticGapIds].sort(),
    }))
    .sort((left, right) => left.outcomeId.localeCompare(right.outcomeId));
  const rawSemanticGapOutcomeIds = rawSemanticGapOutcomeRefs
    .map((entry) => entry.outcomeId)
    .sort();
  const unclosedSemanticGapIds = semanticGaps
    .filter((gap) =>
      resolvedContract.requiredSdkSemanticGapClosureTargets.some((target) =>
        !sdkSemanticGapClosures.some((closure) =>
          closure.semanticGapId === gap.id &&
          closure.sdkTarget === target &&
          closure.status === 'proven',
        ),
      ),
    )
    .map((gap) => gap.id)
    .sort();
  const semanticGapIds = semanticGaps.map((entry) => entry.id).sort();
  const generatedBackendCoreGapIds = resolvedContract.rawBackendCoreSemanticGaps
    .map((entry) => entry.id)
    .sort();
  const duplicateSemanticGapRefs = duplicates(semanticGaps.map((entry) => entry.id)).map(
    (id) => `semanticGaps:${id}`,
  );
  const duplicateGeneratedBackendCoreGapRefs = duplicates(
    resolvedContract.rawBackendCoreSemanticGaps.map((entry) => entry.id),
  ).map((id) => `rawBackendCoreSemanticGaps:${id}`);
  const backendCoreGapRemediationTargetIds = backendCoreGapRemediationTargets
    .map((entry) => entry.gapId)
    .sort();
  const duplicateBackendCoreGapRemediationTargetRefs = duplicates(
    backendCoreGapRemediationTargets.map((entry) => entry.gapId),
  ).map((id) => `backendCoreGapRemediationTargets:${id}`);
  const missingGeneratedBackendCoreGapIds = missing(semanticGapIds, generatedBackendCoreGapIds);
  const unexpectedGeneratedBackendCoreGapIds = unexpected(generatedBackendCoreGapIds, semanticGapIds);
  const missingBackendCoreGapRemediationTargetIds = missing(
    semanticGapIds,
    backendCoreGapRemediationTargetIds,
  );
  const unexpectedBackendCoreGapRemediationTargetIds = unexpected(
    backendCoreGapRemediationTargetIds,
    semanticGapIds,
  );
  const backendCoreGapRemediationRefRefs = summarizeBackendCoreGapRemediationRefRefs(
    backendCoreGapRemediationTargets,
  );
  const semanticGapsById = new Map(semanticGaps.map((entry) => [entry.id, entry]));
  const remediationTargetsByGapId = new Map(
    backendCoreGapRemediationTargets.map((entry) => [entry.gapId, entry]),
  );
  const backendCoreGapSpecMismatchRefs = resolvedContract.rawBackendCoreSemanticGaps
    .flatMap((spec) => {
      const gap = semanticGapsById.get(spec.id);
      const target = remediationTargetsByGapId.get(spec.id);
      if (!gap || !target) return [];
      return [
        spec.source === gap.source ? undefined : `${spec.id}:source`,
        sortedEqual(spec.domainKeys, gap.domainKeys) ? undefined : `${spec.id}:domainKeys`,
        sortedEqual(spec.services, target.services) ? undefined : `${spec.id}:services`,
        sortedEqual(spec.operationIds, gap.operationIds) ? undefined : `${spec.id}:operationIds`,
        sortedEqual(spec.operationIds, target.operationIds) ? undefined : `${spec.id}:targetOperationIds`,
        sortedEqual(spec.requestConstraintKeys, target.requestConstraintKeys)
          ? undefined
          : `${spec.id}:requestConstraintKeys`,
        spec.rawProofFile === gap.proofFile ? undefined : `${spec.id}:rawProofFile`,
        spec.rawProofFile === target.rawProofFile ? undefined : `${spec.id}:targetRawProofFile`,
        spec.rawEvidencePattern === gap.evidencePattern
          ? undefined
          : `${spec.id}:rawEvidencePattern`,
        spec.rawEvidencePattern === target.rawEvidencePattern
          ? undefined
          : `${spec.id}:targetRawEvidencePattern`,
        spec.observedBehavior === gap.observedBehavior ? undefined : `${spec.id}:observedBehavior`,
        spec.observedBehavior === target.observedBehavior
          ? undefined
          : `${spec.id}:targetObservedBehavior`,
        spec.requiredBehavior === gap.requiredBehavior ? undefined : `${spec.id}:requiredBehavior`,
        spec.requiredBehavior === target.requiredBehavior
          ? undefined
          : `${spec.id}:targetRequiredBehavior`,
        spec.requiredRawRejection === target.requiredRawRejection
          ? undefined
          : `${spec.id}:requiredRawRejection`,
        sortedEqual(spec.remediationRefs, target.remediationRefs)
          ? undefined
          : `${spec.id}:remediationRefs`,
        sortedEqual(spec.sdkClosureTargets, target.sdkClosureTargets)
          ? undefined
          : `${spec.id}:sdkClosureTargets`,
      ].filter((entry): entry is string => Boolean(entry));
    })
    .sort((left, right) => left.localeCompare(right));
  const missingRawProofConstraintKeyRefs = backendCoreGapRemediationTargets
    .flatMap((target) =>
      target.missingRawProofConstraintKeys.map((key) => `${target.gapId}:${key}`),
    )
    .sort((left, right) => left.localeCompare(right));
  const unclassifiedRequestConstraintRefs = requestConstraints.unclassified
    .map((entry) => entry.key)
    .sort((left, right) => left.localeCompare(right));
  const sdkGeneratedPreflightOnlyConstraintRefs = requestConstraints.constraints
    .filter((entry) => entry.disposition === 'sdk-generated-preflight')
    .map((entry) => entry.key)
    .sort((left, right) => left.localeCompare(right));
  const missingRequestConstraintRawGapClosureRefs = [
    ...requestConstraints.summary.missingRawSemanticGapClosures,
  ].sort((left, right) => left.localeCompare(right));
  const unknownGeneratedRequestConstraintEvidenceRefs = [
    ...requestConstraints.summary.unknownGeneratedEvidenceConstraintKeys,
  ].sort((left, right) => left.localeCompare(right));
  const unknownGeneratedRequestConstraintDomainRefs = [
    ...requestConstraints.summary.unknownGeneratedDomainConstraintKeys.map(
      (key) => `constraint:${key}`,
    ),
    ...requestConstraints.summary.unknownGeneratedDomainKeys.map((key) => `domain:${key}`),
  ].sort((left, right) => left.localeCompare(right));
  const unknownSdkGeneratedPreflightOnlyConstraintRefs = [
    ...requestConstraints.summary.unknownSdkGeneratedPreflightOnlyConstraintKeys,
  ].sort((left, right) => left.localeCompare(right));
  const missingTransportGatedPublicWrapperClosureRefs =
    requestConstraints.transportGatedPublicWrapperClosures
      .filter((entry) => entry.status !== 'proven')
      .map((entry) => `${entry.sdkTarget}:${entry.proofFile}`)
      .sort((left, right) => left.localeCompare(right));
  const missingCapabilities = missing(resolvedContract.requiredCapabilities, actualCapabilities);
  const unexpectedCapabilities = unexpected(actualCapabilities, resolvedContract.requiredCapabilities);
  const missingCategories = missing(resolvedContract.requiredCategories, actualCategories);
  const unexpectedCategories = unexpected(actualCategories, resolvedContract.requiredCategories);
  const missingAxes = missing(resolvedContract.requiredAxes, actualAxes);
  const unexpectedAxes = unexpected(actualAxes, resolvedContract.requiredAxes);
  const providerDomainRefs = summarizeProviderCapabilityDomainRefs(
    resolvedContract,
    scenarioPaths,
    outcomes,
    providerGuards,
    providerDomains,
  );
  const localStackDomainRefs = summarizeLocalStackScenarioDomainRefs(
    resolvedContract,
    scenarioPaths,
    outcomes,
    localStackDomains,
  );
  const missingLocalStackAxes = missing(resolvedContract.requiredLocalStackAxes, actualLocalStackAxes);
  const incompleteLocalStackAxes = missing(resolvedContract.requiredLocalStackAxes, provenLocalStackAxes);
  const categoryAxisCoverage = resolvedContract.requiredCategoryAxes
    .map((requiredCategory) => {
      const categoryScenarioPaths = scenarioPaths.filter(
        (entry) => entry.localStackRequired && entry.category === requiredCategory.category,
      );
      const presentAxes = uniqueSorted(categoryScenarioPaths.flatMap((entry) => entry.axes));
      const provenAxes = uniqueSorted(
        categoryScenarioPaths
          .filter((entry) => entry.status === 'proven')
          .flatMap((entry) => entry.axes),
      );
      return {
        category: requiredCategory.category,
        requiredAxes: [...requiredCategory.axes].sort((left, right) => left.localeCompare(right)),
        presentAxes,
        provenAxes,
        missingAxes: missing(requiredCategory.axes, presentAxes),
        incompleteAxes: missing(requiredCategory.axes, provenAxes),
      };
    })
    .sort((left, right) => left.category.localeCompare(right.category));
  const missingCategoryAxisRefs = uniqueSorted(
    categoryAxisCoverage.flatMap((entry) =>
      entry.missingAxes.map((axis) => `${entry.category}:${axis}`),
    ),
  );
  const incompleteCategoryAxisRefs = uniqueSorted(
    categoryAxisCoverage.flatMap((entry) =>
      entry.incompleteAxes.map((axis) => `${entry.category}:${axis}`),
    ),
  );
  const missingLocalStackScenarioIds = missing(
    resolvedContract.localStackScenarioIds,
    actualLocalStackScenarioIds,
  );
  const unexpectedLocalStackScenarioIds = unexpected(
    actualLocalStackScenarioIds,
    resolvedContract.localStackScenarioIds,
  );
  const missingProviderOwnedScenarioIds = missing(
    resolvedContract.providerOwnedScenarioIds,
    actualProviderOwnedScenarioIds,
  );
  const unexpectedProviderOwnedScenarioIds = unexpected(
    actualProviderOwnedScenarioIds,
    resolvedContract.providerOwnedScenarioIds,
  );
  const underConformanceLocalStackRequiredProofLevelRefs = scenarioPaths
    .filter((entry) => entry.localStackRequired)
    .filter((entry) => PROOF_ORDER[entry.requiredProofLevel] < PROOF_ORDER.conformance)
    .map((entry) => `${entry.id}:${entry.requiredProofLevel}`)
    .sort();
  const underConformanceLocalStackOutcomeRefs = outcomes
    .filter((entry) => entry.source === 'local-stack-e2e')
    .filter((entry) => PROOF_ORDER[entry.minimumProofLevel] < PROOF_ORDER.conformance)
    .map((entry) => `${entry.id}:${entry.minimumProofLevel}`)
    .sort();
  const underConformanceOperationRefs = coverage
    .filter((entry) => PROOF_ORDER[entry.proofLevel] < PROOF_ORDER.conformance)
    .map((entry) => `${entry.operation.service}:${entry.operation.operationId}:${entry.proofLevel}`)
    .sort();
  const underConformanceObjectiveOperationRefs = objectives
    .flatMap((entry) =>
      entry.underConformanceOperationIds.map((operationId) => `${entry.id}:${operationId}`),
    )
    .sort();
  const duplicateScenarioPathRefs = duplicates(scenarioPaths.map((entry) => entry.id));
  const duplicateOutcomeRefs = duplicates(outcomes.map((entry) => entry.id));
  const duplicateScenarioMatrixContractRefs = uniqueSorted([
    ...duplicates(resolvedContract.requiredCapabilities).map((id) => `requiredCapabilities:${id}`),
    ...duplicates(resolvedContract.requiredCategories).map((id) => `requiredCategories:${id}`),
    ...duplicates(resolvedContract.requiredAxes).map((id) => `requiredAxes:${id}`),
    ...duplicates(resolvedContract.requiredLocalStackAxes).map(
      (id) => `requiredLocalStackAxes:${id}`,
    ),
    ...duplicates(resolvedContract.localStackScenarioIds).map(
      (id) => `localStackScenarioIds:${id}`,
    ),
    ...duplicates(resolvedContract.providerOwnedScenarioIds).map(
      (id) => `providerOwnedScenarioIds:${id}`,
    ),
    ...duplicates(resolvedContract.requiredOutcomeIds).map((id) => `requiredOutcomeIds:${id}`),
    ...duplicates(resolvedContract.requiredOutcomeSpecs.map((entry) => entry.id)).map(
      (id) => `requiredOutcomeSpecs:${id}`,
    ),
    ...duplicates(resolvedContract.requiredObjectiveIds).map((id) => `requiredObjectiveIds:${id}`),
    ...duplicates(resolvedContract.requiredObjectiveSpecs.map((entry) => entry.id)).map(
      (id) => `requiredObjectiveSpecs:${id}`,
    ),
    ...duplicates(resolvedContract.transportOrFeatureGatedOperationIds).map(
      (id) => `transportOrFeatureGatedOperationIds:${id}`,
    ),
    ...duplicates(resolvedContract.requestConstraintEvidenceSpecs.map((entry) => entry.id)).map(
      (id) => `requestConstraintEvidenceSpecs:${id}`,
    ),
    ...resolvedContract.requestConstraintEvidenceSpecs.flatMap((entry) =>
      duplicates(entry.requestConstraintKeys).map(
        (key) => `requestConstraintEvidenceSpecs:${entry.id}:${key}`,
      ),
    ),
    ...duplicates(resolvedContract.requestConstraintDomainSpecs.map((entry) => entry.domainKey)).map(
      (id) => `requestConstraintDomainSpecs:${id}`,
    ),
    ...resolvedContract.requestConstraintDomainSpecs.flatMap((entry) =>
      duplicates(entry.requestConstraintKeys).map(
        (key) => `requestConstraintDomainSpecs:${entry.domainKey}:${key}`,
      ),
    ),
    ...duplicates(resolvedContract.sdkGeneratedPreflightOnlyConstraintKeys).map(
      (id) => `sdkGeneratedPreflightOnlyConstraintKeys:${id}`,
    ),
    ...duplicates(resolvedContract.requiredSharedProviderGuardProofCapabilities).map(
      (id) => `requiredSharedProviderGuardProofCapabilities:${id}`,
    ),
    ...duplicates(resolvedContract.requiredSdkSemanticGapClosureTargets).map(
      (id) => `requiredSdkSemanticGapClosureTargets:${id}`,
    ),
    ...duplicates(resolvedContract.requiredCategoryAxes.map((entry) => entry.category)).map(
      (id) => `requiredCategoryAxes:${id}`,
    ),
    ...resolvedContract.requiredCategoryAxes.flatMap((entry) =>
      duplicates(entry.axes).map((axis) => `requiredCategoryAxes:${entry.category}:${axis}`),
    ),
  ]);
  const duplicateScenarioOperationRefs = uniqueSorted(
    scenarioPaths.flatMap((entry) =>
      entry.duplicateScenarioOperationIds.map((operationId) => `${entry.id}:${operationId}`),
    ),
  );
  const duplicateScenarioAxisRefs = uniqueSorted(
    scenarioPaths.flatMap((entry) =>
      entry.duplicateScenarioAxisIds.map((axis) => `${entry.id}:${axis}`),
    ),
  );
  const missingOperationEvidencePatternRefs = uniqueSorted(
    scenarioPaths.flatMap((entry) =>
      entry.missingOperationEvidencePatternIds.map((operationId) => `${entry.id}:${operationId}`),
    ),
  );
  const unknownOperationEvidencePatternRefs = uniqueSorted(
    scenarioPaths.flatMap((entry) =>
      entry.unknownOperationEvidencePatternIds.map((operationId) => `${entry.id}:${operationId}`),
    ),
  );
  const duplicateOperationEvidencePatternRefs = uniqueSorted(
    scenarioPaths.flatMap((entry) =>
      entry.duplicateOperationEvidencePatternIds.map((operationId) => `${entry.id}:${operationId}`),
    ),
  );
  const blockers = [
    operationManifestDuplicateRefs.duplicateOperationIdRefs,
    operationManifestDuplicateRefs.duplicateServiceOperationIdRefs,
    operationManifestDuplicateRefs.duplicateOperationRouteRefs,
    operationManifestDuplicateRefs.duplicateOperationPathPatternRefs,
    operationRouteResolutionRefs.operationRouteResolutionMismatchRefs,
    operationRouteResolutionRefs.ambiguousOperationRouteTieRefs,
    missingCapabilities,
    unexpectedCapabilities,
    missingCategories,
    unexpectedCategories,
    missingAxes,
    unexpectedAxes,
    localStackDomainRefs.unknownScenarioCategoryRefs,
    localStackDomainRefs.unknownScenarioAxisRefs,
    localStackDomainRefs.unknownScenarioProofLevelRefs,
    localStackDomainRefs.unknownOutcomeSourceRefs,
    localStackDomainRefs.unknownOutcomeProofLevelRefs,
    localStackDomainRefs.unknownScenarioMatrixCategoryRefs,
    localStackDomainRefs.unknownScenarioMatrixAxisRefs,
    localStackDomainRefs.unknownScenarioMatrixProofLevelRefs,
    localStackDomainRefs.unknownSdkSemanticGapClosureTargetRefs,
    providerDomainRefs.unknownScenarioCapabilityRefs,
    providerDomainRefs.unknownOutcomeCapabilityRefs,
    providerDomainRefs.unknownScenarioMatrixCapabilityRefs,
    providerDomainRefs.unknownProviderGuardCapabilityRefs,
    providerDomainRefs.unknownProviderGuardProviderRefs,
    providerDomainRefs.unknownProviderGuardTierRefs,
    missingLocalStackAxes,
    incompleteLocalStackAxes,
    outcomeSpecMismatchRefs,
    missingObjectiveIds,
    objectiveSpecMismatchRefs,
    unknownTransportOrFeatureGatedOperationIds,
    missingProviderCapabilityGuardProviderRefs,
    unexpectedProviderCapabilityGuardProviderRefs,
    providerGuardTierMismatchRefs,
    duplicateProviderCapabilityGuardProviderRefs,
    missingSharedProviderGuardProofCapabilities,
    unexpectedSharedProviderGuardProofCapabilities,
    missingCategoryAxisRefs,
    incompleteCategoryAxisRefs,
    missingLocalStackScenarioIds,
    unexpectedLocalStackScenarioIds,
    missingProviderOwnedScenarioIds,
    unexpectedProviderOwnedScenarioIds,
    underConformanceLocalStackRequiredProofLevelRefs,
    unknownScenarioProofMarkerRefs,
    duplicateScenarioPathRefs,
    duplicateOutcomeRefs,
    duplicateScenarioMatrixContractRefs,
    duplicateScenarioOperationRefs,
    duplicateScenarioAxisRefs,
    underConformanceOperationRefs,
    underConformanceObjectiveOperationRefs,
    underConformanceLocalStackOutcomeRefs,
    missingOperationEvidencePatternRefs,
    unknownOperationEvidencePatternRefs,
    duplicateOperationEvidencePatternRefs,
    incompleteScenarioIds,
    missingOutcomeIds,
    incompleteOutcomeIds,
    unclosedSemanticGapIds,
    duplicateSemanticGapRefs,
    duplicateGeneratedBackendCoreGapRefs,
    duplicateBackendCoreGapRemediationTargetRefs,
    missingGeneratedBackendCoreGapIds,
    unexpectedGeneratedBackendCoreGapIds,
    backendCoreGapSpecMismatchRefs,
    backendCoreGapRemediationRefRefs.missingBackendCoreGapRemediationRefRefs,
    backendCoreGapRemediationRefRefs.invalidBackendCoreGapRemediationRefRefs,
    backendCoreGapRemediationRefRefs.serviceMismatchBackendCoreGapRemediationRefRefs,
    backendCoreGapRemediationRefRefs.duplicateBackendCoreGapRemediationRefRefs,
    backendCoreGapRemediationRefRefs.missingBackendCoreGapRemediationFileRefs,
    backendCoreGapRemediationRefRefs.invalidBackendCoreGapRemediationLineRefs,
    missingRawProofConstraintKeyRefs,
    unclassifiedRequestConstraintRefs,
    sdkGeneratedPreflightOnlyConstraintRefs,
    missingRequestConstraintRawGapClosureRefs,
    unknownGeneratedRequestConstraintEvidenceRefs,
    unknownGeneratedRequestConstraintDomainRefs,
    unknownSdkGeneratedPreflightOnlyConstraintRefs,
    missingTransportGatedPublicWrapperClosureRefs,
    missingBackendCoreGapRemediationTargetIds,
    unexpectedBackendCoreGapRemediationTargetIds,
  ];

  return {
    ...resolvedContract,
    status: blockers.every((entries) => entries.length === 0) ? 'proven' : 'incomplete',
    semanticGapIds,
    backendCoreGapStatus: semanticGaps.length === 0 ? 'gap-free' : 'known-gaps',
    knownBackendCoreGapIds: semanticGapIds,
    backendCoreGapRemediationTargetIds,
    generatedBackendCoreGapIds,
    duplicateSemanticGapRefs,
    duplicateGeneratedBackendCoreGapRefs,
    duplicateBackendCoreGapRemediationTargetRefs,
    missingGeneratedBackendCoreGapIds,
    unexpectedGeneratedBackendCoreGapIds,
    backendCoreGapSpecMismatchRefs,
    ...backendCoreGapRemediationRefRefs,
    missingBackendCoreGapRemediationTargetIds,
    unexpectedBackendCoreGapRemediationTargetIds,
    ...operationManifestDuplicateRefs,
    ...operationRouteResolutionRefs,
    missingCapabilities,
    unexpectedCapabilities,
    missingCategories,
    unexpectedCategories,
    missingAxes,
    unexpectedAxes,
    ...localStackDomainRefs,
    ...providerDomainRefs,
    missingLocalStackAxes,
    incompleteLocalStackAxes,
    outcomeSpecMismatchRefs,
    missingObjectiveIds,
    objectiveSpecMismatchRefs,
    unknownTransportOrFeatureGatedOperationIds,
    missingProviderCapabilityGuardProviderRefs,
    unexpectedProviderCapabilityGuardProviderRefs,
    providerGuardTierMismatchRefs,
    duplicateProviderCapabilityGuardProviderRefs,
    sharedProviderGuardProofCapabilities,
    missingSharedProviderGuardProofCapabilities,
    unexpectedSharedProviderGuardProofCapabilities,
    categoryAxisCoverage,
    missingCategoryAxisRefs,
    incompleteCategoryAxisRefs,
    missingLocalStackScenarioIds,
    unexpectedLocalStackScenarioIds,
    missingProviderOwnedScenarioIds,
    unexpectedProviderOwnedScenarioIds,
    underConformanceLocalStackRequiredProofLevelRefs,
    unknownScenarioProofMarkerRefs,
    duplicateScenarioPathRefs,
    duplicateOutcomeRefs,
    duplicateScenarioMatrixContractRefs,
    duplicateScenarioOperationRefs,
    duplicateScenarioAxisRefs,
    underConformanceOperationRefs,
    underConformanceObjectiveOperationRefs,
    underConformanceLocalStackOutcomeRefs,
    missingOperationEvidencePatternRefs,
    unknownOperationEvidencePatternRefs,
    duplicateOperationEvidencePatternRefs,
    incompleteScenarioIds,
    missingOutcomeIds,
    incompleteOutcomeIds,
    rawSemanticGapOutcomeIds,
    rawSemanticGapOutcomeRefs,
    unclosedSemanticGapIds,
    missingRawProofConstraintKeyRefs,
    unclassifiedRequestConstraintRefs,
    sdkGeneratedPreflightOnlyConstraintRefs,
    missingRequestConstraintRawGapClosureRefs,
    unknownGeneratedRequestConstraintEvidenceRefs,
    unknownGeneratedRequestConstraintDomainRefs,
    unknownSdkGeneratedPreflightOnlyConstraintRefs,
    missingTransportGatedPublicWrapperClosureRefs,
  };
}

type ProviderDomainContractSlice = Pick<
  LocalStackScenarioMatrixContract,
  | 'requiredCapabilities'
  | 'requiredSharedProviderGuardProofCapabilities'
  | 'requiredOutcomeSpecs'
>;

type LocalStackDomainContractSlice = Pick<
  LocalStackScenarioMatrixContract,
  | 'requiredCategories'
  | 'requiredAxes'
  | 'requiredLocalStackAxes'
  | 'requiredCategoryAxes'
  | 'requiredOutcomeSpecs'
  | 'requiredObjectiveSpecs'
  | 'requiredSdkSemanticGapClosureTargets'
>;

function summarizeLocalStackScenarioDomainRefs(
  contract: LocalStackDomainContractSlice,
  scenarioPaths: ReadonlyArray<Pick<ScenarioPathCoverage, 'id' | 'category' | 'axes' | 'requiredProofLevel'>>,
  outcomes: ReadonlyArray<Pick<CapabilityOutcomeCoverage, 'id' | 'source' | 'minimumProofLevel'>>,
  localStackDomains: LocalStackScenarioDomains,
): LocalStackScenarioDomainRefs {
  const categoryIds = new Set(localStackDomains.categoryIds);
  const axisIds = new Set(localStackDomains.axisIds);
  const proofLevels = new Set(localStackDomains.proofLevels);
  const outcomeSources = new Set(localStackDomains.outcomeSources);
  const sdkClosureTargets = new Set(localStackDomains.sdkSemanticGapClosureTargets);

  return {
    unknownScenarioCategoryRefs: uniqueSorted(
      scenarioPaths
        .filter((entry) => !categoryIds.has(entry.category))
        .map((entry) => `${entry.id}:${entry.category}`),
    ),
    unknownScenarioAxisRefs: uniqueSorted(
      scenarioPaths.flatMap((entry) =>
        entry.axes
          .filter((axis) => !axisIds.has(axis))
          .map((axis) => `${entry.id}:${axis}`),
      ),
    ),
    unknownScenarioProofLevelRefs: uniqueSorted(
      scenarioPaths
        .filter((entry) => !proofLevels.has(entry.requiredProofLevel))
        .map((entry) => `${entry.id}:${entry.requiredProofLevel}`),
    ),
    unknownOutcomeSourceRefs: uniqueSorted(
      outcomes
        .filter((entry) => !outcomeSources.has(entry.source))
        .map((entry) => `${entry.id}:${entry.source}`),
    ),
    unknownOutcomeProofLevelRefs: uniqueSorted(
      outcomes
        .filter((entry) => !proofLevels.has(entry.minimumProofLevel))
        .map((entry) => `${entry.id}:${entry.minimumProofLevel}`),
    ),
    unknownScenarioMatrixCategoryRefs: uniqueSorted([
      ...contract.requiredCategories
        .filter((category) => !categoryIds.has(category))
        .map((category) => `requiredCategories:${category}`),
      ...contract.requiredCategoryAxes
        .filter((entry) => !categoryIds.has(entry.category))
        .map((entry) => `requiredCategoryAxes:${entry.category}`),
    ]),
    unknownScenarioMatrixAxisRefs: uniqueSorted([
      ...contract.requiredAxes
        .filter((axis) => !axisIds.has(axis))
        .map((axis) => `requiredAxes:${axis}`),
      ...contract.requiredLocalStackAxes
        .filter((axis) => !axisIds.has(axis))
        .map((axis) => `requiredLocalStackAxes:${axis}`),
      ...contract.requiredCategoryAxes.flatMap((entry) =>
        entry.axes
          .filter((axis) => !axisIds.has(axis))
          .map((axis) => `requiredCategoryAxes:${entry.category}:${axis}`),
      ),
    ]),
    unknownScenarioMatrixProofLevelRefs: uniqueSorted([
      ...contract.requiredOutcomeSpecs
        .filter((entry) => !proofLevels.has(entry.minimumProofLevel))
        .map((entry) => `requiredOutcomeSpecs:${entry.id}:minimumProofLevel:${entry.minimumProofLevel}`),
      ...contract.requiredObjectiveSpecs
        .filter((entry) => !proofLevels.has(entry.minimumProofLevel))
        .map((entry) => `requiredObjectiveSpecs:${entry.id}:minimumProofLevel:${entry.minimumProofLevel}`),
    ]),
    unknownSdkSemanticGapClosureTargetRefs: uniqueSorted(
      contract.requiredSdkSemanticGapClosureTargets
        .filter((target) => !sdkClosureTargets.has(target))
        .map((target) => `requiredSdkSemanticGapClosureTargets:${target}`),
    ),
  };
}

export function localStackScenarioDomainRefsForTesting(
  input: {
    contract: LocalStackDomainContractSlice;
    scenarioPaths: ReadonlyArray<
      Pick<ScenarioPathCoverage, 'id' | 'category' | 'axes' | 'requiredProofLevel'>
    >;
    outcomes: ReadonlyArray<Pick<CapabilityOutcomeCoverage, 'id' | 'source' | 'minimumProofLevel'>>;
    localStackDomains: LocalStackScenarioDomains;
  },
): LocalStackScenarioDomainRefs {
  return summarizeLocalStackScenarioDomainRefs(
    input.contract,
    input.scenarioPaths,
    input.outcomes,
    input.localStackDomains,
  );
}

function summarizeProviderCapabilityDomainRefs(
  contract: ProviderDomainContractSlice,
  scenarioPaths: ReadonlyArray<Pick<ScenarioPathCoverage, 'id' | 'capability'>>,
  outcomes: ReadonlyArray<
    Pick<CapabilityOutcomeCoverage, 'id' | 'providerGuardCapabilities' | 'exceptionCapabilities'>
  >,
  providerGuards: ReadonlyArray<
    Pick<
      ProviderGuardCoverage,
      'capability' | 'providers' | 'matrixProviderTiers' | 'guardProviderTiers'
    >
  >,
  providerDomains: ProviderCapabilityDomains,
): ProviderCapabilityDomainRefs {
  const canonicalCapabilityIds = new Set(providerDomains.capabilityIds);
  const canonicalProviderIds = new Set(providerDomains.providerIds);
  const canonicalSupportTiers = new Set(providerDomains.supportTiers);

  return {
    unknownScenarioCapabilityRefs: uniqueSorted(
      scenarioPaths
        .filter((entry) => !canonicalCapabilityIds.has(entry.capability))
        .map((entry) => `${entry.id}:${entry.capability}`),
    ),
    unknownOutcomeCapabilityRefs: uniqueSorted(
      outcomes.flatMap((outcome) => [
        ...outcome.providerGuardCapabilities
          .filter((capability) => !canonicalCapabilityIds.has(capability))
          .map((capability) => `${outcome.id}:providerGuardCapabilities:${capability}`),
        ...outcome.exceptionCapabilities
          .filter((capability) => !canonicalCapabilityIds.has(capability))
          .map((capability) => `${outcome.id}:exceptionCapabilities:${capability}`),
      ]),
    ),
    unknownScenarioMatrixCapabilityRefs: uniqueSorted([
      ...contract.requiredCapabilities
        .filter((capability) => !canonicalCapabilityIds.has(capability))
        .map((capability) => `requiredCapabilities:${capability}`),
      ...contract.requiredSharedProviderGuardProofCapabilities
        .filter((capability) => !canonicalCapabilityIds.has(capability))
        .map((capability) => `requiredSharedProviderGuardProofCapabilities:${capability}`),
      ...contract.requiredOutcomeSpecs.flatMap((spec) => [
        ...spec.providerGuardCapabilities
          .filter((capability) => !canonicalCapabilityIds.has(capability))
          .map(
            (capability) =>
              `requiredOutcomeSpecs:${spec.id}:providerGuardCapabilities:${capability}`,
          ),
        ...spec.exceptionCapabilities
          .filter((capability) => !canonicalCapabilityIds.has(capability))
          .map(
            (capability) =>
              `requiredOutcomeSpecs:${spec.id}:exceptionCapabilities:${capability}`,
          ),
      ]),
    ]),
    unknownProviderGuardCapabilityRefs: uniqueSorted(
      providerGuards
        .filter((entry) => !canonicalCapabilityIds.has(entry.capability))
        .map((entry) => entry.capability),
    ),
    unknownProviderGuardProviderRefs: uniqueSorted(
      providerGuards.flatMap((entry) => [
        ...entry.providers
          .filter((provider) => !canonicalProviderIds.has(provider))
          .map((provider) => `${entry.capability}:guard:${provider}`),
        ...entry.guardProviderTiers
          .filter(({ provider }) => !canonicalProviderIds.has(provider))
          .map(({ provider }) => `${entry.capability}:guardTier:${provider}`),
        ...entry.matrixProviderTiers
          .filter(({ provider }) => !canonicalProviderIds.has(provider))
          .map(({ provider }) => `${entry.capability}:matrix:${provider}`),
      ]),
    ),
    unknownProviderGuardTierRefs: uniqueSorted(
      providerGuards.flatMap((entry) => [
        ...entry.guardProviderTiers
          .filter(({ tier }) => !canonicalSupportTiers.has(tier))
          .map(({ provider, tier }) => `${entry.capability}:guard:${provider}:${tier}`),
        ...entry.matrixProviderTiers
          .filter(({ tier }) => !canonicalSupportTiers.has(tier))
          .map(({ provider, tier }) => `${entry.capability}:matrix:${provider}:${tier}`),
      ]),
    ),
  };
}

export function providerCapabilityDomainRefsForTesting(
  input: {
    contract: ProviderDomainContractSlice;
    scenarioPaths: ReadonlyArray<Pick<ScenarioPathCoverage, 'id' | 'capability'>>;
    outcomes: ReadonlyArray<
      Pick<CapabilityOutcomeCoverage, 'id' | 'providerGuardCapabilities' | 'exceptionCapabilities'>
    >;
    providerGuards: ReadonlyArray<
      Pick<
        ProviderGuardCoverage,
        'capability' | 'providers' | 'matrixProviderTiers' | 'guardProviderTiers'
      >
    >;
    providerDomains: ProviderCapabilityDomains;
  },
): ProviderCapabilityDomainRefs {
  return summarizeProviderCapabilityDomainRefs(
    input.contract,
    input.scenarioPaths,
    input.outcomes,
    input.providerGuards,
    input.providerDomains,
  );
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function missing(required: readonly string[], actual: readonly string[]): string[] {
  const actualSet = new Set(actual);
  return uniqueSorted(required.filter((entry) => !actualSet.has(entry)));
}

function unexpected(actual: readonly string[], required: readonly string[]): string[] {
  const requiredSet = new Set(required);
  return uniqueSorted(actual.filter((entry) => !requiredSet.has(entry)));
}

function duplicates(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return uniqueSorted(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([value]) => value),
  );
}

function duplicateKeys<T>(values: readonly T[], keyFor: (value: T) => string): string[] {
  return duplicates(values.map(keyFor));
}

function sortedEqual(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = uniqueSorted(left);
  const sortedRight = uniqueSorted(right);
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((entry, index) => entry === sortedRight[index])
  );
}

function normalizeProofLevel(level: string): ProofLevel {
  return level in PROOF_ORDER ? level as ProofLevel : 'conformance';
}

function blockIncludesPattern(block: TestBlock, pattern: string): boolean {
  const haystack = stripProofMetadata(block.source).toLowerCase();
  return haystack.includes(pattern.toLowerCase());
}

function rawProofBlockIncludesPattern(block: TestBlock, pattern: string): boolean {
  return `${block.name}\n${block.source}`.toLowerCase().includes(pattern.toLowerCase());
}

function blockHasAssertedEvidencePattern(block: TestBlock, pattern: string): boolean {
  const patternText = pattern.toLowerCase();
  const source = stripCodeComments(block.source);
  const sourceFile = ts.createSourceFile(
    'local-stack-proof-block.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isExpressionStatement(node)) {
      const text = node.getText(sourceFile);
      if (
        text.includes('expect(') &&
        !text.includes('SCENARIO_PROOF:') &&
        text.toLowerCase().includes(patternText)
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function blockHasScenarioEvidence(
  block: TestBlock,
  evidencePatterns: readonly string[],
): boolean {
  if (evidencePatterns.some((pattern) => blockIncludesPattern(block, pattern))) {
    return true;
  }

  return blockHasGeneratedScenarioConformanceEvidence(block);
}

function blockHasGeneratedScenarioConformanceEvidence(block: TestBlock): boolean {
  const normalized = stripScenarioProofMarkerAssertions(stripCodeComments(block.source)).replace(
    /\s+/g,
    ' ',
  );
  return (
    hasExecutableConformanceEvidence(normalized) &&
    hasExecutablePrimitiveAssertion(normalized)
  );
}

function operationEvidencePatternsFor(
  spec: LocalStackScenarioPathSpec,
  operationId: string,
): string[] {
  const operationEvidence = spec.operationEvidencePatterns?.find(
    (entry) => entry.operationId === operationId,
  );
  return operationEvidence?.evidencePatterns.length
    ? [...operationEvidence.evidencePatterns]
    : [];
}

function blockIncludesMarker(block: TestBlock, pattern: string): boolean {
  return exactMarkerPattern(pattern).test(stripCodeComments(block.source));
}

function exactMarkerPattern(pattern: string): RegExp {
  return new RegExp(`(?:^|[^A-Za-z0-9_-])${escapeRegex(pattern)}(?:$|[^A-Za-z0-9_-])`, 'i');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function testSourceIncludesEvidencePattern(source: string, pattern: string): boolean {
  return stripProofMetadata(source).toLowerCase().includes(pattern.toLowerCase());
}

function stripProofMetadata(source: string): string {
  return stripTestTitles(stripScenarioProofMarkerAssertions(stripCodeComments(source)));
}

function stripTestTitles(source: string): string {
  const sourceFile = ts.createSourceFile(
    'local-stack-proof-block.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const ranges: Array<[number, number]> = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      isTestCallExpression(node.expression) &&
      node.arguments.length > 0
    ) {
      const title = node.arguments[0];
      if (ts.isStringLiteralLike(title) || ts.isNoSubstitutionTemplateLiteral(title)) {
        ranges.push([title.getStart(sourceFile), title.getEnd()]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (ranges.length === 0) return source;

  let out = source;
  for (const [start, end] of ranges.sort((left, right) => right[0] - left[0])) {
    out = `${out.slice(0, start)}${' '.repeat(end - start)}${out.slice(end)}`;
  }
  return out;
}

function isTestCallExpression(expression: ts.Expression): boolean {
  return ts.isIdentifier(expression) && (expression.text === 'it' || expression.text === 'test');
}

function testBlockKey(block: TestBlock): string {
  return `${block.file}\0${block.name}`;
}

function resolveProviderGuardTestRef(
  ref: ProviderGuardCoverage['guardTestRefs'][number],
  blocks: TestBlock[],
): TestBlock[] {
  const [file, title] = ref.guardTest.split('#');
  if (!file || !title) return [];
  return blocks.filter(
    (block) =>
      block.file === file &&
      block.name === title &&
      PROOF_ORDER[classifyTestBlock(block.source).proofLevel] >= PROOF_ORDER.behavioral,
  );
}

function operationHitBlockKey(hit: E2eOperationHit): string {
  return `${hit.file}\0${hit.testName}`;
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

function scenarioMissingReason(
  spec: LocalStackScenarioPathSpec,
  requiredProofLevel: ProofLevel,
  proofLevel: ProofLevel,
  missingOperationIds: string[],
  underProvenOperationIds: string[],
  missingProofOperationIds: string[],
  duplicateScenarioOperationIds: string[],
  missingOperationEvidencePatternIds: string[],
  unknownOperationEvidencePatternIds: string[],
  duplicateOperationEvidencePatternIds: string[],
  missingOperationEvidenceIds: string[],
  missingAssertedOperationEvidenceIds: string[],
  missingAssertedEvidence = false,
  missingScenarioProofMarker = false,
  missingProviderGuardTestRefs: ProviderGuardCoverage['guardTestRefs'] = [],
): string {
  const reasons: string[] = [];
  if (PROOF_ORDER[proofLevel] < PROOF_ORDER[requiredProofLevel]) {
    reasons.push(
      `missing ${requiredProofLevel} e2e evidence matching ${spec.evidencePatterns.join(' | ')}`,
    );
  }
  if (missingOperationIds.length > 0) {
    reasons.push(`missing generated operations: ${missingOperationIds.join(', ')}`);
  }
  if (underProvenOperationIds.length > 0) {
    reasons.push(`under-proven generated operations: ${underProvenOperationIds.join(', ')}`);
  }
  if (missingProofOperationIds.length > 0) {
    reasons.push(
      `missing scenario proof blocks for generated operations: ${missingProofOperationIds.join(', ')}`,
    );
  }
  if (duplicateScenarioOperationIds.length > 0) {
    reasons.push(`duplicate generated scenario operations: ${duplicateScenarioOperationIds.join(', ')}`);
  }
  if (missingOperationEvidencePatternIds.length > 0) {
    reasons.push(
      `missing generated operation evidence metadata: ${missingOperationEvidencePatternIds.join(', ')}`,
    );
  }
  if (unknownOperationEvidencePatternIds.length > 0) {
    reasons.push(
      `unknown generated operation evidence metadata: ${unknownOperationEvidencePatternIds.join(', ')}`,
    );
  }
  if (duplicateOperationEvidencePatternIds.length > 0) {
    reasons.push(
      `duplicate generated operation evidence metadata: ${duplicateOperationEvidencePatternIds.join(', ')}`,
    );
  }
  if (missingOperationEvidenceIds.length > 0) {
    reasons.push(
      `missing scenario evidence in proof blocks for generated operations: ${missingOperationEvidenceIds.join(', ')}`,
    );
  }
  if (missingAssertedOperationEvidenceIds.length > 0) {
    reasons.push(
      `missing asserted scenario evidence for generated operations: ${missingAssertedOperationEvidenceIds.join(', ')}`,
    );
  }
  if (missingAssertedEvidence) {
    reasons.push('missing asserted scenario-level evidence patterns');
  }
  if (missingScenarioProofMarker) {
    reasons.push(`missing executable scenario proof marker: SCENARIO_PROOF: ${spec.id}`);
  }
  if (missingProviderGuardTestRefs.length > 0) {
    reasons.push(
      `missing executable provider guard refs: ${missingProviderGuardTestRefs
        .map((ref) => `${ref.provider}:${ref.guardTest}`)
        .join(', ')}`,
    );
  }
  return reasons.join('; ');
}

function countProofLevels(entries: OperationCoverage[]): Record<ProofLevel, number> {
  const proofCounts: Record<ProofLevel, number> = {
    none: 0,
    smoke: 0,
    'negative-path': 0,
    behavioral: 0,
    conformance: 0,
  };
  for (const entry of entries) {
    proofCounts[entry.proofLevel]++;
  }
  return proofCounts;
}
