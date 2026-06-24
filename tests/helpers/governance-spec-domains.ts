import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

export interface GovernanceSpecDomainProvenance {
  source: string;
  selector: string;
  extractor:
    | 'resolved-alias'
    | 'type-alias'
    | 'enum'
    | 'model-field'
    | 'operation-parameter';
}

export interface GovernanceSpecDomainMap {
  guardrailTypes: readonly string[];
  guardrailProcessingStages: readonly string[];
  behaviorRuleTriggers: readonly string[];
  behaviorRuleStateInputVariants: readonly string[];
  behaviorRuleStateMembers: readonly string[];
  behaviorRuleVerdicts: readonly number[];
  approvalStatuses: readonly string[];
  approvalDecisionActions: readonly string[];
  sessionStatuses: readonly string[];
  sessionDurations: readonly string[];
  trustHistoryDurations: readonly string[];
  auditEventTypes: readonly string[];
  auditResults: readonly string[];
  auditExportStatuses: readonly string[];
  agentAttestationModes: readonly string[];
  apiKeyPermissions: readonly string[];
  webhookChannels: readonly string[];
  organizationTimezones: readonly string[];
  welcomeEmailTypes: readonly string[];
  webhookEventTypes: readonly string[];
  ssoMethods: readonly string[];
  demoSetupStatuses: readonly string[];
  coreEventTypes: readonly string[];
  coreAuthEnvironments: readonly string[];
  coreGuardrailsInputTypes: readonly string[];
  coreGuardrailFieldStatuses: readonly string[];
  coreVerdicts: readonly string[];
  coreLegacyActions: readonly string[];
  openboxProviderIds: readonly string[];
  openboxSupportTiers: readonly string[];
  openboxCapabilityIds: readonly string[];
  claudeCodeGovernanceStatuses: readonly string[];
  localStackScenarioCategories: readonly string[];
  localStackScenarioAxes: readonly string[];
  localStackProofLevels: readonly string[];
  localStackOutcomeSources: readonly string[];
  localGovernanceSpanTypes: readonly string[];
  localGovernanceVerdicts: readonly string[];
  localGovernanceOutcomes: readonly string[];
  localStackUsageWireCaseIds: readonly string[];
  sdkSemanticGapClosureTargets: readonly string[];
  governanceChecklistBoundaryOwners: readonly string[];
  governanceChecklistScopes: readonly string[];
  governanceChecklistRowStatuses: readonly string[];
  referenceProviderParityClosureStatuses: readonly string[];
  referenceProviderRuntimePromotionDecisions: readonly string[];
  ruleTriggers: readonly string[];
  ruleSeverities: readonly string[];
  projectedRuleSources: readonly string[];
}

interface GovernanceDomainsFixture {
  domains: GovernanceSpecDomainMap;
  provenance: Record<keyof GovernanceSpecDomainMap, GovernanceSpecDomainProvenance>;
  discoveredFiniteDomains: DiscoveredFiniteTypeSpecDomain[];
}

const GOVERNANCE_DOMAINS_FIXTURE = JSON.parse(
  readFileSync(resolve(root, 'codegen/fixtures/governance-domains.json'), 'utf8'),
) as GovernanceDomainsFixture;

export const GOVERNANCE_SPEC_DOMAINS = Object.freeze(
  GOVERNANCE_DOMAINS_FIXTURE.domains,
) as Readonly<GovernanceSpecDomainMap>;

export const GOVERNANCE_SPEC_DOMAIN_PROVENANCE = Object.freeze(
  GOVERNANCE_DOMAINS_FIXTURE.provenance,
) as Readonly<Record<keyof GovernanceSpecDomainMap, GovernanceSpecDomainProvenance>>;

export type GovernanceSpecDomainKey = keyof typeof GOVERNANCE_SPEC_DOMAINS;

export interface DiscoveredFiniteTypeSpecDomain {
  source: string;
  selector: string;
  values: string[];
  matchingDomainKey?: string;
}

export function discoverFiniteTypeSpecDomains(
  extraDomains: Record<string, readonly unknown[]> = {},
): DiscoveredFiniteTypeSpecDomain[] {
  const knownDomains = {
    ...GOVERNANCE_SPEC_DOMAINS,
    ...extraDomains,
  } as Record<string, readonly unknown[]>;
  const knownDomainKeys = Object.keys(knownDomains);
  return GOVERNANCE_DOMAINS_FIXTURE.discoveredFiniteDomains
    .map((entry) => ({
      ...entry,
      matchingDomainKey: knownDomainKeys.find((key) =>
        arraySetEquals(
          entry.values,
          knownDomains[key].map(String),
        ),
      ),
    }))
    .sort((left, right) =>
      `${left.source}:${left.selector}`.localeCompare(`${right.source}:${right.selector}`),
    );
}

export function untrackedFiniteTypeSpecDomains(
  extraDomains: Record<string, readonly unknown[]> = {},
): DiscoveredFiniteTypeSpecDomain[] {
  return discoverFiniteTypeSpecDomains(extraDomains).filter((entry) => !entry.matchingDomainKey);
}

function uniqueSortedStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function arraySetEquals(left: readonly string[], right: readonly string[]): boolean {
  const leftSorted = uniqueSortedStrings(left);
  const rightSorted = uniqueSortedStrings(right);
  return (
    leftSorted.length === rightSorted.length &&
    leftSorted.every((value, index) => value === rightSorted[index])
  );
}

export function invalidGovernanceSpecMember(domainKey: GovernanceSpecDomainKey): string {
  const candidate = `__invalid_${domainKey}__`;
  const domain = GOVERNANCE_SPEC_DOMAINS[domainKey] as readonly unknown[];
  if (domain.includes(candidate)) {
    throw new Error(`Invalid finite-domain sentinel collides with ${String(domainKey)}`);
  }
  return candidate;
}

export function invalidNumericGovernanceSpecMember(domainKey: GovernanceSpecDomainKey): number {
  const domain = GOVERNANCE_SPEC_DOMAINS[domainKey] as readonly unknown[];
  const numericMembers = domain.filter((member): member is number => typeof member === 'number');
  if (numericMembers.length === 0) {
    throw new Error(`Finite domain ${String(domainKey)} has no numeric members`);
  }

  let candidate = Math.max(...numericMembers) + 1;
  while (domain.includes(candidate)) candidate++;
  return candidate;
}
