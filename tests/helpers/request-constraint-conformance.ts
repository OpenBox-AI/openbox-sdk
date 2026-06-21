import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  REQUEST_PREFLIGHT_RULES as BACKEND_REQUEST_PREFLIGHT_RULES,
} from '../../ts/src/client/generated/request-preflight.js';
import {
  REQUEST_PREFLIGHT_RULES as CORE_REQUEST_PREFLIGHT_RULES,
} from '../../ts/src/core-client/generated/request-preflight.js';
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
  };
}

const DISPOSITIONS: Disposition[] = [
  'local-stack-e2e',
  'raw-semantic-gap-sdk-closed',
  'transport-or-feature-gated',
  'sdk-generated-preflight',
];

const TRANSPORT_OR_FEATURE_GATED_OPERATIONS = new Set([
  'ApiKeyController_create',
  'ApiKeyController_delete',
  'ApiKeyController_get',
  'ApiKeyController_list',
  'ApiKeyController_update',
  'OrganizationController_getMembers',
  'OrganizationController_sendWelcomeEmail',
  'WebhookController_create',
  'WebhookController_delete',
  'WebhookController_get',
  'WebhookController_getDeliveryLogs',
  'WebhookController_list',
  'WebhookController_regenerateSecret',
  'WebhookController_update',
]);

const CORE_TELEMETRY_BODY_FIELDS = new Set([
  'timestamp',
  'input_tokens',
  'output_tokens',
  'total_tokens',
  'cost_usd',
  'span_count',
  'start_time',
  'end_time',
  'duration_ns',
  'http_status_code',
  'server_port',
  'rowcount',
  'bytes_read',
  'bytes_written',
  'lines_count',
]);

export function buildRequestConstraintConformance(): RequestConstraintConformance {
  const constraints = extractGeneratedRequestConstraints();
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
  return [
    ...FINITE_DOMAIN_GAPS.map((entry) => entry.id),
    ...BOUNDARY_CONFORMANCE_GAPS.map((entry) => entry.id),
  ].filter(unique).sort();
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
  if (
    constraint.kind === 'enum' &&
    constraint.location === 'query.status' &&
    [
      'AgentController_getApprovalHistory',
      'AgentController_getPendingApprovals',
      'OrganizationController_getApprovals',
    ].includes(constraint.operationId)
  ) {
    return ['approval-status-invalid-query-not-rejected'];
  }
  if (
    constraint.operationId === 'evaluateGovernance' &&
    constraint.location === 'body.attempt' &&
    constraint.kind === 'minimum'
  ) {
    return ['core-governance-attempt-min-not-rejected'];
  }
  if (
    constraint.operationId === 'evaluateGovernance' &&
    constraint.location === 'body.timestamp' &&
    constraint.kind === 'format'
  ) {
    return ['core-governance-timestamp-format-not-rejected'];
  }
  if (
    constraint.operationId === 'AgentController_getAgentEvaluations' &&
    ['query.page', 'query.pattern', 'query.perPage'].includes(constraint.location)
  ) {
    return ['backend-agent-evaluations-query-boundaries-not-rejected'];
  }
  if (
    constraint.operationId === 'evaluateGovernance' &&
    constraint.location === 'body.cost_usd' &&
    ['format', 'type'].includes(constraint.kind)
  ) {
    return ['core-governance-cost-type-not-rejected'];
  }
  return [];
}

function evidenceIdsForConstraint(constraint: RequestConstraint): string[] {
  const rawGapIds = new Set(expectedRawSemanticGapIds());
  return [
    ...domainKeysForConstraint(constraint).flatMap(evidenceIdsForDomainKey),
    ...extraEvidenceIdsForConstraint(constraint),
  ].filter(unique).filter((id) => !rawGapIds.has(id)).sort();
}

function domainKeysForConstraint(constraint: RequestConstraint): string[] {
  return [
    ...enumDomainKeys(constraint),
    ...boundaryDomainKeys(constraint),
  ].filter(unique).sort();
}

function enumDomainKeys(constraint: RequestConstraint): string[] {
  const enumValues = Array.isArray(constraint.value)
    ? constraint.value
    : constraint.kind === 'type'
      ? enumValuesForConstraintLocation(constraint) ?? []
      : [];
  if (enumValues.length === 0) return [];
  const values = [...new Set(enumValues.map(String))];
  return [
    ...Object.entries(GOVERNANCE_SPEC_DOMAINS)
      .filter(([, domain]) => arrayEquals(values, [...new Set(domain.map(String))]))
      .map(([key]) => `finite:${key}`),
    ...Object.entries(GOVERNANCE_BOUNDARY_DOMAINS)
      .filter(([, domain]) => Array.isArray(domain))
      .filter(([, domain]) => (domain as readonly unknown[]).every((entry) => typeof entry === 'string'))
      .filter(([, domain]) => arrayEquals(values, [...new Set((domain as readonly string[]).map(String))]))
      .map(([key]) => `boundary:${key}`),
  ];
}

function enumValuesForConstraintLocation(constraint: RequestConstraint): readonly string[] | undefined {
  const rules =
    constraint.service === 'backend'
      ? BACKEND_REQUEST_PREFLIGHT_RULES
      : CORE_REQUEST_PREFLIGHT_RULES;
  const rule = rules.find((entry) => entry.operationId === constraint.operationId);
  if (!rule) return undefined;
  if (constraint.location.startsWith('query.')) {
    const name = constraint.location.slice('query.'.length);
    return rule.query?.find((entry) => entry.name === name)?.enum;
  }
  if (constraint.location.startsWith('body.')) {
    const path = constraint.location.slice('body.'.length);
    return rule.body?.find((entry) => entry.path.join('.') === path)?.enum;
  }
  return undefined;
}

function boundaryDomainKeys(constraint: RequestConstraint): string[] {
  const field = constraint.location.split('.').filter((part) => part !== '*').at(-1);
  if (!field) return [];
  const out: string[] = [];

  if (
    GOVERNANCE_BOUNDARY_DOMAINS.aivssNumericFields.some((entry) => entry.fieldName === field)
  ) {
    out.push('boundary:aivssNumericFields');
  }
  if (field === 'alignment_threshold') out.push('boundary:goalAlignmentThresholds');
  if (
    /BehaviorRule/.test(constraint.operationId) &&
    ['approval_timeout', 'priority', 'time_window'].includes(field)
  ) {
    out.push('boundary:behaviorRuleNumericFields');
  }
  if (field === 'trust_threshold') out.push('boundary:trustThresholdFields');
  if (field === 'dependency_base_rule_id') out.push('boundary:backendUuidFormatFields');
  if (
    (constraint.operationId === 'AgentController_createPolicy' &&
      ['description', 'name'].includes(field)) ||
    (constraint.operationId === 'OrganizationController_createTeam' &&
      ['description', 'icon', 'name'].includes(field))
  ) {
    out.push('boundary:backendStringLengthFields');
  }
  if (constraint.operationId === 'OrganizationController_removeMembers' && field === 'memberIds') {
    out.push('boundary:backendArrayItemFields');
  }
  if (constraint.operationId === 'evaluateGovernance' && field === 'attempt') {
    out.push('boundary:coreNumericFields');
  }

  return out;
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

function extraEvidenceIdsForConstraint(constraint: RequestConstraint): string[] {
  if (
    constraint.operationId === 'evaluateGovernance' &&
    constraint.location === 'body.event_type'
  ) {
    return ['core-governance-invalid-finite-fields'];
  }
  if (
    constraint.operationId === 'evaluateGovernance' &&
    constraint.location === 'body.attempt' &&
    ['format', 'integer', 'type'].includes(constraint.kind)
  ) {
    return ['core-governance-attempt-integer-request-boundary'];
  }
  if (
    constraint.operationId === 'evaluateGovernance' &&
    constraint.location === 'body.timestamp' &&
    constraint.kind === 'type'
  ) {
    return ['core-governance-timestamp-type-request-boundary'];
  }
  if (
    constraint.service === 'backend' &&
    ['query.page', 'query.pattern', 'query.perPage'].includes(constraint.location)
  ) {
    return ['backend-query-pagination-search-request-boundaries'];
  }
  if (
    constraint.operationId === 'evaluateGovernance' &&
    constraint.location.startsWith('body.') &&
    constraint.location !== 'body.timestamp' &&
    constraint.location !== 'body.cost_usd' &&
    constraint.location !== 'body.event_type' &&
    constraint.location !== 'body.attempt'
  ) {
    const field = constraint.location.split('.').filter((part) => part !== '*').at(-1);
    if (field && CORE_TELEMETRY_BODY_FIELDS.has(field)) {
      return ['core-governance-telemetry-numeric-request-boundaries'];
    }
  }
  if (constraint.operationId === 'AgentController_getAgentEvaluations') {
    return [];
  }
  return [];
}

function isSdkGeneratedPreflightConstraint(constraint: RequestConstraint): boolean {
  if (
    constraint.location === 'query.page' ||
    constraint.location === 'query.perPage' ||
    constraint.location === 'query.pattern'
  ) {
    return true;
  }
  if (
    constraint.service === 'core' &&
    constraint.operationId === 'evaluateGovernance' &&
    constraint.location.startsWith('body.') &&
    constraint.location !== 'body.event_type' &&
    constraint.location !== 'body.attempt'
  ) {
    const field = constraint.location.split('.').filter((part) => part !== '*').at(-1);
    return field ? CORE_TELEMETRY_BODY_FIELDS.has(field) : false;
  }
  return false;
}

function arrayEquals(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function unique<T>(value: T, index: number, array: T[]): boolean {
  return array.indexOf(value) === index;
}
