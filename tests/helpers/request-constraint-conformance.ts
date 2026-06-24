import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  REQUEST_PREFLIGHT_RULES as BACKEND_REQUEST_PREFLIGHT_RULES,
} from '../../ts/src/client/generated/request-preflight.js';
import {
  REQUEST_PREFLIGHT_RULES as CORE_REQUEST_PREFLIGHT_RULES,
} from '../../ts/src/core-client/generated/request-preflight.js';
import {
  LOCAL_STACK_SCENARIO_MATRIX,
  type RawBackendCoreSemanticGapSpec,
} from '../../ts/src/governance/generated/capability-matrix.js';
import {
  BOUNDARY_CONFORMANCE_EVIDENCE,
  BOUNDARY_CONFORMANCE_GAPS,
  GOVERNANCE_BOUNDARY_DOMAINS,
  type BoundaryDomainKey,
} from './boundary-conformance';
import {
  FINITE_DOMAIN_EVIDENCE,
  FINITE_DOMAIN_GAPS,
} from './finite-domain-conformance';
import {
  GOVERNANCE_SPEC_DOMAINS,
  type GovernanceSpecDomainKey,
} from './governance-spec-domains';

type Service = 'backend' | 'core';
type ConstraintKind =
  | 'enum'
  | 'format'
  | 'integer'
  | 'maximum'
  | 'maxItems'
  | 'maxLength'
  | 'minimum'
  | 'minItems'
  | 'type';

type Disposition =
  | 'local-stack-e2e'
  | 'raw-semantic-gap-sdk-closed'
  | 'transport-or-feature-gated'
  | 'sdk-generated-preflight';

interface QueryRule {
  name: string;
  type?: string;
  format?: string;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  integer?: boolean;
}

interface BodyRule extends Omit<QueryRule, 'name'> {
  path: readonly string[];
  minItems?: number;
  maxItems?: number;
}

interface RequestRule {
  operationId: string;
  query?: readonly QueryRule[];
  body?: readonly BodyRule[];
}

export interface RequestConstraint {
  key: string;
  service: Service;
  operationId: string;
  location: string;
  kind: ConstraintKind;
  value: unknown;
}

export interface RequestConstraintClassification extends RequestConstraint {
  disposition: Disposition;
  evidenceIds: string[];
  semanticGapIds: string[];
  domainKeys: string[];
}

export interface TransportGatedPublicWrapperClosure {
  sdkTarget: 'typescript' | 'python';
  proofFile: string;
  evidencePatterns: string[];
  missingEvidencePatterns: string[];
  constraintKeys: string[];
  status: 'proven' | 'missing';
}

export interface RequestConstraintConformance {
  generatedBy: 'tests/helpers/request-constraint-conformance.ts';
  sources: string[];
  constraints: RequestConstraintClassification[];
  unclassified: RequestConstraint[];
  transportGatedPublicWrapperClosures: TransportGatedPublicWrapperClosure[];
  summary: {
    totalConstraints: number;
    byDisposition: Record<Disposition, number>;
    knownRawSemanticGaps: string[];
    provenRawSemanticGapClosures: string[];
    missingRawSemanticGapClosures: string[];
    transportGatedPublicWrapperClosures: {
      constraintCount: number;
      total: number;
      proven: number;
      missing: number;
    };
    sdkGeneratedPreflightOnly: number;
    unknownGeneratedEvidenceConstraintKeys: string[];
    unknownGeneratedDomainConstraintKeys: string[];
    unknownGeneratedDomainKeys: string[];
    unknownSdkGeneratedPreflightOnlyConstraintKeys: string[];
  };
}

const DISPOSITIONS: Disposition[] = [
  'local-stack-e2e',
  'raw-semantic-gap-sdk-closed',
  'transport-or-feature-gated',
  'sdk-generated-preflight',
];

const RAW_BACKEND_CORE_SEMANTIC_GAPS: readonly RawBackendCoreSemanticGapSpec[] =
  LOCAL_STACK_SCENARIO_MATRIX.rawBackendCoreSemanticGaps;

const RAW_BACKEND_CORE_SEMANTIC_GAPS_BY_CONSTRAINT_KEY: ReadonlyMap<
  string,
  (typeof RAW_BACKEND_CORE_SEMANTIC_GAPS)[number]
> = new Map(
  RAW_BACKEND_CORE_SEMANTIC_GAPS.flatMap((gap) =>
    gap.requestConstraintKeys.map((key) => [key, gap] as const),
  ),
);

const TRANSPORT_OR_FEATURE_GATED_OPERATIONS: ReadonlySet<string> = new Set(
  LOCAL_STACK_SCENARIO_MATRIX.transportOrFeatureGatedOperationIds,
);

const REQUEST_CONSTRAINT_EVIDENCE_IDS_BY_CONSTRAINT_KEY = new Map<string, string[]>();
for (const spec of LOCAL_STACK_SCENARIO_MATRIX.requestConstraintEvidenceSpecs) {
  for (const key of spec.requestConstraintKeys) {
    const ids = REQUEST_CONSTRAINT_EVIDENCE_IDS_BY_CONSTRAINT_KEY.get(key) ?? [];
    ids.push(spec.id);
    REQUEST_CONSTRAINT_EVIDENCE_IDS_BY_CONSTRAINT_KEY.set(key, ids);
  }
}

const REQUEST_CONSTRAINT_DOMAIN_KEYS_BY_CONSTRAINT_KEY = new Map<string, string[]>();
for (const spec of LOCAL_STACK_SCENARIO_MATRIX.requestConstraintDomainSpecs) {
  for (const key of spec.requestConstraintKeys) {
    const domainKeys = REQUEST_CONSTRAINT_DOMAIN_KEYS_BY_CONSTRAINT_KEY.get(key) ?? [];
    domainKeys.push(spec.domainKey);
    REQUEST_CONSTRAINT_DOMAIN_KEYS_BY_CONSTRAINT_KEY.set(key, domainKeys);
  }
}

const SDK_GENERATED_PREFLIGHT_ONLY_CONSTRAINT_KEYS: ReadonlySet<string> = new Set(
  LOCAL_STACK_SCENARIO_MATRIX.sdkGeneratedPreflightOnlyConstraintKeys,
);

export function buildRequestConstraintConformance(): RequestConstraintConformance {
  const constraints = extractGeneratedRequestConstraints();
  const constraintKeys = new Set(constraints.map((entry) => entry.key));
  const generatedEvidenceConstraintKeys = uniqueSorted(
    LOCAL_STACK_SCENARIO_MATRIX.requestConstraintEvidenceSpecs.flatMap(
      (entry) => entry.requestConstraintKeys,
    ),
  );
  const generatedDomainConstraintKeys = uniqueSorted(
    LOCAL_STACK_SCENARIO_MATRIX.requestConstraintDomainSpecs.flatMap(
      (entry) => entry.requestConstraintKeys,
    ),
  );
  const generatedDomainKeys = uniqueSorted(
    LOCAL_STACK_SCENARIO_MATRIX.requestConstraintDomainSpecs.map((entry) => entry.domainKey),
  );
  const classified = constraints.map(classifyConstraint);
  const unclassified = classified
    .filter((entry): entry is RequestConstraint => !('disposition' in entry))
    .map((entry) => ({
      key: entry.key,
      service: entry.service,
      operationId: entry.operationId,
      location: entry.location,
      kind: entry.kind,
      value: entry.value,
    }));
  const proven = classified
    .filter((entry): entry is RequestConstraintClassification => Boolean(entry.disposition))
    .sort((left, right) => left.key.localeCompare(right.key));

  const byDisposition = Object.fromEntries(
    DISPOSITIONS.map((disposition) => [
      disposition,
      proven.filter((entry) => entry.disposition === disposition).length,
    ]),
  ) as Record<Disposition, number>;
  const knownRawSemanticGaps = expectedRawSemanticGapIds();
  const provenRawSemanticGapClosures = [...new Set(
    proven.flatMap((entry) => entry.semanticGapIds),
  )].sort();
  const transportGatedConstraints = proven.filter(
    (entry) => entry.disposition === 'transport-or-feature-gated',
  );
  const transportGatedPublicWrapperClosures =
    summarizeTransportGatedPublicWrapperClosures(transportGatedConstraints);
  const provenTransportGatedTargets = transportGatedPublicWrapperClosures.filter(
    (entry) => entry.status === 'proven',
  ).length;
  const missingTransportGatedTargets =
    transportGatedPublicWrapperClosures.length - provenTransportGatedTargets;

  return {
    generatedBy: 'tests/helpers/request-constraint-conformance.ts',
    sources: [
      'ts/src/client/generated/request-preflight.ts',
      'ts/src/core-client/generated/request-preflight.ts',
      'ts/src/governance/generated/capability-matrix.ts',
      'tests/helpers/finite-domain-conformance.ts',
      'tests/helpers/boundary-conformance.ts',
      'tests/unit/client.test.ts',
      'tests/unit/request-preflight-conformance.test.ts',
      'python/tests/test_request_preflight.py',
    ],
    constraints: proven,
    unclassified,
    transportGatedPublicWrapperClosures,
    summary: {
      totalConstraints: constraints.length,
      byDisposition,
      knownRawSemanticGaps,
      provenRawSemanticGapClosures,
      missingRawSemanticGapClosures: knownRawSemanticGaps.filter(
        (id) => !provenRawSemanticGapClosures.includes(id),
      ),
      transportGatedPublicWrapperClosures: {
        constraintCount: transportGatedConstraints.length,
        total: transportGatedConstraints.length * transportGatedPublicWrapperClosures.length,
        proven: transportGatedConstraints.length * provenTransportGatedTargets,
        missing: transportGatedConstraints.length * missingTransportGatedTargets,
      },
      sdkGeneratedPreflightOnly: byDisposition['sdk-generated-preflight'],
      unknownGeneratedEvidenceConstraintKeys: generatedEvidenceConstraintKeys.filter(
        (key) => !constraintKeys.has(key),
      ),
      unknownGeneratedDomainConstraintKeys: generatedDomainConstraintKeys.filter(
        (key) => !constraintKeys.has(key),
      ),
      unknownGeneratedDomainKeys: generatedDomainKeys.filter(
        (key) => !isKnownGeneratedDomainKey(key),
      ),
      unknownSdkGeneratedPreflightOnlyConstraintKeys:
        LOCAL_STACK_SCENARIO_MATRIX.sdkGeneratedPreflightOnlyConstraintKeys.filter(
          (key) => !constraintKeys.has(key),
        ),
    },
  };
}

function summarizeTransportGatedPublicWrapperClosures(
  constraints: RequestConstraintClassification[],
): TransportGatedPublicWrapperClosure[] {
  const constraintKeys = constraints.map((entry) => entry.key).sort();
  return [
    {
      sdkTarget: 'typescript' as const,
      proofFile: 'tests/unit/client.test.ts',
      evidencePatterns: [
        'rejects transport-gated generated constraints through public wrappers before fetch',
        'const ledger = buildRequestConstraintConformance();',
        'ledger.constraints.filter',
        "entry.disposition === 'transport-or-feature-gated'",
        'requestConstraintKeys(constraints)',
        "entry.sdkTarget === 'typescript'",
        'wrapperArgsForConstraint',
        'expect(fetchMock).not.toHaveBeenCalled()',
      ],
    },
    {
      sdkTarget: 'python' as const,
      proofFile: 'python/tests/test_request_preflight.py',
      evidencePatterns: [
        'test_python_public_backend_methods_block_transport_gated_constraints_before_transport',
        '_transport_gated_public_method_constraints',
        'BACKEND_ENDPOINT_MANIFEST',
        '_transport_gated_public_method_constraint_keys',
        'assert case_keys == _transport_gated_public_method_constraint_keys()',
        'assert requests == []',
      ],
    },
  ].map((target) => {
    const source = readOptionalSource(target.proofFile);
    const missingEvidencePatterns = target.evidencePatterns.filter(
      (pattern) => !source.includes(pattern),
    );
    return {
      ...target,
      missingEvidencePatterns,
      constraintKeys,
      status:
        constraintKeys.length > 0 && missingEvidencePatterns.length === 0
          ? 'proven'
          : 'missing',
    };
  });
}

function readOptionalSource(relPath: string): string {
  try {
    return readFileSync(resolve(process.cwd(), relPath), 'utf8');
  } catch {
    return '';
  }
}

function expectedRawSemanticGapIds(): string[] {
  return RAW_BACKEND_CORE_SEMANTIC_GAPS.map((entry) => entry.id).filter(unique).sort();
}

function classifyConstraint(
  constraint: RequestConstraint,
): RequestConstraintClassification | (RequestConstraint & { disposition?: undefined }) {
  const semanticGapIds = semanticGapIdsForConstraint(constraint);
  if (semanticGapIds.length > 0) {
    return {
      ...constraint,
      disposition: 'raw-semantic-gap-sdk-closed',
      evidenceIds: semanticGapIds,
      semanticGapIds,
      domainKeys: domainKeysForConstraint(constraint),
    };
  }

  if (TRANSPORT_OR_FEATURE_GATED_OPERATIONS.has(constraint.operationId)) {
    return {
      ...constraint,
      disposition: 'transport-or-feature-gated',
      evidenceIds: evidenceIdsForConstraint(constraint),
      semanticGapIds: [],
      domainKeys: domainKeysForConstraint(constraint),
    };
  }

  const evidenceIds = evidenceIdsForConstraint(constraint);
  if (evidenceIds.length > 0) {
    return {
      ...constraint,
      disposition: 'local-stack-e2e',
      evidenceIds,
      semanticGapIds: [],
      domainKeys: domainKeysForConstraint(constraint),
    };
  }

  if (isSdkGeneratedPreflightConstraint(constraint)) {
    return {
      ...constraint,
      disposition: 'sdk-generated-preflight',
      evidenceIds: ['generated-request-preflight-unit'],
      semanticGapIds: [],
      domainKeys: [],
    };
  }

  return constraint;
}

function extractGeneratedRequestConstraints(): RequestConstraint[] {
  return [
    ...extractServiceConstraints('backend', BACKEND_REQUEST_PREFLIGHT_RULES),
    ...extractServiceConstraints('core', CORE_REQUEST_PREFLIGHT_RULES),
  ].sort((left, right) => left.key.localeCompare(right.key));
}

function extractServiceConstraints(
  service: Service,
  rules: readonly RequestRule[],
): RequestConstraint[] {
  const out: RequestConstraint[] = [];
  for (const rule of rules) {
    for (const query of rule.query ?? []) {
      const location = `query.${query.name}`;
      for (const [kind, value] of executableConstraintEntries(query, false)) {
        out.push(makeConstraint(service, rule.operationId, location, kind, value));
      }
    }
    for (const body of rule.body ?? []) {
      const location = `body.${body.path.join('.')}`;
      for (const [kind, value] of executableConstraintEntries(body, true)) {
        out.push(makeConstraint(service, rule.operationId, location, kind, value));
      }
    }
  }
  return out;
}

function executableConstraintEntries(
  rule: QueryRule | BodyRule,
  includeType: boolean,
): Array<[ConstraintKind, unknown]> {
  const entries: Array<[ConstraintKind, unknown]> = [];
  if (includeType && rule.type) entries.push(['type', rule.type]);
  if (rule.enum) entries.push(['enum', [...rule.enum]]);
  if (rule.format) entries.push(['format', rule.format]);
  if (rule.integer) entries.push(['integer', true]);
  if (rule.maximum !== undefined) entries.push(['maximum', rule.maximum]);
  if ('maxItems' in rule && rule.maxItems !== undefined) entries.push(['maxItems', rule.maxItems]);
  if (rule.maxLength !== undefined) entries.push(['maxLength', rule.maxLength]);
  if (rule.minimum !== undefined) entries.push(['minimum', rule.minimum]);
  if ('minItems' in rule && rule.minItems !== undefined) entries.push(['minItems', rule.minItems]);
  return entries;
}

function makeConstraint(
  service: Service,
  operationId: string,
  location: string,
  kind: ConstraintKind,
  value: unknown,
): RequestConstraint {
  return {
    key: `${service}:${operationId}:${location}:${kind}`,
    service,
    operationId,
    location,
    kind,
    value,
  };
}

function semanticGapIdsForConstraint(constraint: RequestConstraint): string[] {
  return rawSemanticGapsForConstraint(constraint)
    .map((entry) => entry.id)
    .filter(unique)
    .sort();
}

function rawSemanticGapsForConstraint(constraint: RequestConstraint) {
  return [RAW_BACKEND_CORE_SEMANTIC_GAPS_BY_CONSTRAINT_KEY.get(constraint.key)]
    .filter((entry): entry is (typeof RAW_BACKEND_CORE_SEMANTIC_GAPS)[number] => Boolean(entry));
}

function evidenceIdsForConstraint(constraint: RequestConstraint): string[] {
  const rawGapIds = new Set(expectedRawSemanticGapIds());
  return [
    ...domainKeysForConstraint(constraint).flatMap(evidenceIdsForDomainKey),
    ...(REQUEST_CONSTRAINT_EVIDENCE_IDS_BY_CONSTRAINT_KEY.get(constraint.key) ?? []),
  ].filter(unique).filter((id) => !rawGapIds.has(id)).sort();
}

function domainKeysForConstraint(constraint: RequestConstraint): string[] {
  return [
    ...rawSemanticGapsForConstraint(constraint).flatMap((entry) => entry.domainKeys),
    ...(REQUEST_CONSTRAINT_DOMAIN_KEYS_BY_CONSTRAINT_KEY.get(constraint.key) ?? []),
  ].filter(unique).sort();
}

function evidenceIdsForDomainKey(domainKey: string): string[] {
  const [kind, key] = domainKey.split(':') as ['finite' | 'boundary', string];
  if (kind === 'finite') {
    return [
      ...FINITE_DOMAIN_EVIDENCE
        .filter((entry) => entry.domainKeys.includes(key as GovernanceSpecDomainKey))
        .map((entry) => entry.id),
      ...FINITE_DOMAIN_GAPS
        .filter((entry) => entry.domainKeys.includes(key as GovernanceSpecDomainKey))
        .map((entry) => entry.id),
      ...BOUNDARY_CONFORMANCE_EVIDENCE
        .filter((entry) =>
          entry.executablePatterns.some((pattern) =>
            pattern.includes(`GOVERNANCE_SPEC_DOMAINS.${key}`) ||
            pattern.includes(`invalidGovernanceSpecMember('${key}')`) ||
            pattern.includes(`invalidNumericGovernanceSpecMember('${key}')`),
          ),
        )
        .map((entry) => entry.id),
    ];
  }

  return [
    ...BOUNDARY_CONFORMANCE_EVIDENCE
      .filter((entry) => entry.domainKeys.includes(key as BoundaryDomainKey))
      .map((entry) => entry.id),
    ...BOUNDARY_CONFORMANCE_GAPS
      .filter((entry) => entry.domainKeys.includes(key as BoundaryDomainKey))
      .map((entry) => entry.id),
  ];
}

function isSdkGeneratedPreflightConstraint(constraint: RequestConstraint): boolean {
  return SDK_GENERATED_PREFLIGHT_ONLY_CONSTRAINT_KEYS.has(constraint.key);
}

function isKnownGeneratedDomainKey(domainKey: string): boolean {
  const parts = domainKey.split(':');
  if (parts.length !== 2) return false;
  const [kind, key] = parts;
  if (kind === 'finite') return key in GOVERNANCE_SPEC_DOMAINS;
  if (kind === 'boundary') return key in GOVERNANCE_BOUNDARY_DOMAINS;
  return false;
}

function unique<T>(value: T, index: number, array: T[]): boolean {
  return array.indexOf(value) === index;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
