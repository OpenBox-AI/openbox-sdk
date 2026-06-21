import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function readSpec(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function extractAliasBody(source: string, aliasName: string): string {
  const cleaned = stripComments(source);
  const match = cleaned.match(new RegExp(`alias\\s+${aliasName}\\s*=([\\s\\S]*?);`));
  if (!match) throw new Error(`Missing TypeSpec alias ${aliasName}`);
  return match[1];
}

function extractModelBody(source: string, modelName: string): string {
  const cleaned = stripComments(source);
  const match = cleaned.match(new RegExp(`model\\s+${modelName}\\s*{([\\s\\S]*?)\\n}`));
  if (!match) throw new Error(`Missing TypeSpec model ${modelName}`);
  return match[1];
}

function extractStringAliasMembers(source: string, aliasName: string): string[] {
  const body = extractAliasBody(source, aliasName);
  return [...body.matchAll(/"([^"]+)"|`([^`]+)`/g)].map((match) => match[1] ?? match[2]);
}

function extractTypeAliasMembers(source: string, aliasName: string): string[] {
  return extractAliasBody(source, aliasName)
    .split('|')
    .map((member) => member.trim())
    .filter(Boolean);
}

function resolveStringAliasMembers(source: string, aliasName: string): string[] {
  const body = extractAliasBody(source, aliasName).trim();
  const directMembers = [...body.matchAll(/"([^"]+)"|`([^`]+)`/g)]
    .map((match) => match[1] ?? match[2]);
  if (directMembers.length > 0) return directMembers;

  const aliases = body
    .split('|')
    .map((member) => member.trim())
    .filter(Boolean);
  return aliases.flatMap((member) => resolveStringAliasMembers(source, member));
}

function extractEnumMembers(source: string, enumName: string): string[] {
  const cleaned = stripComments(source);
  const match = cleaned.match(new RegExp(`enum\\s+${enumName}\\s*{([\\s\\S]*?)}`));
  if (!match) throw new Error(`Missing TypeSpec enum ${enumName}`);

  return match[1]
    .split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter(Boolean)
    .map((line) => line.match(/^`([^`]+)`/)?.[1] ?? line.match(/^([A-Za-z_][A-Za-z0-9_-]*)/)?.[1])
    .filter((member): member is string => Boolean(member));
}

function extractNumericModelFieldMembers(
  source: string,
  modelName: string,
  fieldName: string,
): number[] {
  const body = extractModelBody(source, modelName);
  const match = body.match(new RegExp(`${fieldName}\\s*:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing TypeSpec field ${modelName}.${fieldName}`);
  return [...match[1].matchAll(/\b\d+\b/g)].map((entry) => Number(entry[0]));
}

function extractStringModelFieldMembers(
  source: string,
  modelName: string,
  fieldName: string,
): string[] {
  const body = extractModelBody(source, modelName);
  const match = body.match(new RegExp(`${fieldName}\\??\\s*:\\s*([\\s\\S]*?);`));
  if (!match) throw new Error(`Missing TypeSpec field ${modelName}.${fieldName}`);
  return [...new Set(
    [...match[1].matchAll(/"([^"]+)"|`([^`]+)`/g)].map((entry) => entry[1] ?? entry[2]),
  )];
}

function extractOperationParameters(source: string, operationName: string): string {
  const cleaned = stripComments(source);
  const opStart = cleaned.indexOf(`op ${operationName}(`);
  if (opStart === -1) throw new Error(`Missing TypeSpec operation ${operationName}`);
  const paramsStart = cleaned.indexOf('(', opStart);
  if (paramsStart === -1) throw new Error(`Missing TypeSpec operation parameters ${operationName}`);

  let depth = 0;
  let quote: '"' | '`' | null = null;
  let escaped = false;
  for (let i = paramsStart; i < cleaned.length; i++) {
    const ch = cleaned[i];
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
    if (ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') {
      depth--;
      if (depth === 0) return cleaned.slice(paramsStart + 1, i);
    }
  }
  throw new Error(`Unterminated TypeSpec operation parameters ${operationName}`);
}

function extractStringOperationParameterMembers(
  source: string,
  operationName: string,
  parameterName: string,
): string[] {
  const parameters = extractOperationParameters(source, operationName);
  const match = parameters.match(
    new RegExp(`${parameterName}\\??\\s*:\\s*([\\s\\S]*?)(?:,\\s*(?:@|[A-Za-z_]|$)|$)`),
  );
  if (!match) throw new Error(`Missing TypeSpec parameter ${operationName}.${parameterName}`);
  const typeExpression = match[1].split('=')[0];
  return [...typeExpression.matchAll(/"([^"]+)"|`([^`]+)`/g)].map((entry) => entry[1] ?? entry[2]);
}

const backendMain = readSpec('specs/typespec/backend/main.tsp');
const backendResponses = readSpec('specs/typespec/backend/responses.tsp');
const coreMain = readSpec('specs/typespec/core/main.tsp');
const governCapabilities = readSpec('specs/typespec/govern/capabilities.tsp');
const governRulesProjection = readSpec('specs/typespec/govern/rules-projection.tsp');

export const GOVERNANCE_SPEC_DOMAINS = Object.freeze({
  guardrailTypes: extractStringAliasMembers(backendMain, 'GuardrailType'),
  guardrailProcessingStages: extractStringAliasMembers(backendMain, 'ProcessingStage'),
  behaviorRuleTriggers: extractStringAliasMembers(backendResponses, 'BehaviorRuleTrigger'),
  behaviorRuleStateInputVariants: extractTypeAliasMembers(backendResponses, 'BehaviorRuleStateInput'),
  behaviorRuleStateMembers: resolveStringAliasMembers(backendResponses, 'BehaviorRuleStateInput'),
  behaviorRuleVerdicts: extractNumericModelFieldMembers(
    backendMain,
    'CreateBehaviorRuleDto',
    'verdict',
  ),
  approvalStatuses: extractStringOperationParameterMembers(
    backendMain,
    'AgentController_getPendingApprovals',
    'status',
  ),
  approvalDecisionActions: extractStringOperationParameterMembers(
    backendMain,
    'AgentController_decideApproval',
    'action',
  ),
  sessionStatuses: extractStringOperationParameterMembers(
    backendMain,
    'AgentController_getSessions',
    'status',
  ),
  sessionDurations: extractStringOperationParameterMembers(
    backendMain,
    'AgentController_getSessions',
    'duration',
  ),
  trustHistoryDurations: extractStringOperationParameterMembers(
    backendMain,
    'AgentController_getAgentTrustHistories',
    'duration',
  ),
  auditEventTypes: extractStringModelFieldMembers(backendMain, 'PreviewExportDto', 'eventTypes'),
  auditResults: extractStringModelFieldMembers(backendMain, 'ExportAuditLogsDto', 'result'),
  auditExportStatuses: extractStringOperationParameterMembers(
    backendMain,
    'OrganizationController_getExportHistory',
    'status',
  ),
  agentAttestationModes: extractStringModelFieldMembers(
    backendMain,
    'CreateAgentDto',
    'attestation_mode',
  ),
  apiKeyPermissions: extractStringModelFieldMembers(backendMain, 'CreateApiKeyDto', 'permissions'),
  webhookChannels: extractStringModelFieldMembers(backendMain, 'CreateWebhookDto', 'channel'),
  organizationTimezones: extractStringModelFieldMembers(
    backendMain,
    'UpdateOrganizationSettingsDto',
    'timezone',
  ),
  welcomeEmailTypes: extractStringModelFieldMembers(backendMain, 'SendWelcomeEmailDto', 'type'),
  webhookEventTypes: extractStringAliasMembers(backendResponses, 'WebhookEventType'),
  ssoMethods: extractStringModelFieldMembers(backendResponses, 'SsoStatus', 'method'),
  demoSetupStatuses: extractStringModelFieldMembers(backendResponses, 'DemoSetupStatus', 'status'),
  coreEventTypes: extractEnumMembers(coreMain, 'EventType'),
  coreAuthEnvironments: extractStringModelFieldMembers(
    coreMain,
    'AgentValidationResponse',
    'environment',
  ),
  coreGuardrailsInputTypes: extractStringModelFieldMembers(coreMain, 'GuardrailsResult', 'input_type'),
  coreGuardrailFieldStatuses: extractStringModelFieldMembers(coreMain, 'GuardrailFieldResult', 'status'),
  coreVerdicts: extractEnumMembers(coreMain, 'Verdict'),
  coreLegacyActions: extractEnumMembers(coreMain, 'LegacyAction'),
  openboxProviderIds: extractEnumMembers(governCapabilities, 'OpenBoxProviderId'),
  openboxSupportTiers: extractEnumMembers(governCapabilities, 'OpenBoxSupportTier'),
  openboxCapabilityIds: extractEnumMembers(governCapabilities, 'OpenBoxCapabilityId'),
  referenceProviderParityClosureStatuses: extractEnumMembers(
    governCapabilities,
    'ReferenceProviderParityClosureStatus',
  ),
  referenceProviderRuntimePromotionDecisions: extractEnumMembers(
    governCapabilities,
    'ReferenceProviderRuntimePromotionDecision',
  ),
  ruleTriggers: extractEnumMembers(governRulesProjection, 'RuleTrigger'),
  ruleSeverities: extractEnumMembers(governRulesProjection, 'RuleSeverity'),
  projectedRuleSources: extractStringModelFieldMembers(
    governRulesProjection,
    'ProjectedRule',
    'source',
  ),
});

export interface GovernanceSpecDomainProvenance {
  source: string;
  selector: string;
  extractor:
    | 'alias'
    | 'resolved-alias'
    | 'type-alias'
    | 'enum'
    | 'model-field'
    | 'operation-parameter';
}

export const GOVERNANCE_SPEC_DOMAIN_PROVENANCE = Object.freeze({
  guardrailTypes: {
    source: 'specs/typespec/backend/main.tsp',
    selector: 'alias GuardrailType',
    extractor: 'alias',
  },
  guardrailProcessingStages: {
    source: 'specs/typespec/backend/main.tsp',
    selector: 'alias ProcessingStage',
    extractor: 'alias',
  },
  behaviorRuleTriggers: {
    source: 'specs/typespec/backend/responses.tsp',
    selector: 'alias BehaviorRuleTrigger',
    extractor: 'alias',
  },
  behaviorRuleStateInputVariants: {
    source: 'specs/typespec/backend/responses.tsp',
    selector: 'alias BehaviorRuleStateInput',
    extractor: 'type-alias',
  },
  behaviorRuleStateMembers: {
    source: 'specs/typespec/backend/responses.tsp',
    selector: 'alias BehaviorRuleStateInput',
    extractor: 'resolved-alias',
  },
  behaviorRuleVerdicts: {
    source: 'specs/typespec/backend/main.tsp',
    selector: 'model CreateBehaviorRuleDto.verdict',
    extractor: 'model-field',
  },
  approvalStatuses: {
    source: 'specs/typespec/backend/main.tsp',
    selector: 'op AgentController_getPendingApprovals.status',
    extractor: 'operation-parameter',
  },
  approvalDecisionActions: {
    source: 'specs/typespec/backend/main.tsp',
    selector: 'op AgentController_decideApproval.action',
    extractor: 'operation-parameter',
  },
  sessionStatuses: {
    source: 'specs/typespec/backend/main.tsp',
    selector: 'op AgentController_getSessions.status',
    extractor: 'operation-parameter',
  },
  sessionDurations: {
    source: 'specs/typespec/backend/main.tsp',
    selector: 'op AgentController_getSessions.duration',
    extractor: 'operation-parameter',
  },
  trustHistoryDurations: {
    source: 'specs/typespec/backend/main.tsp',
    selector: 'op AgentController_getAgentTrustHistories.duration',
    extractor: 'operation-parameter',
  },
  auditEventTypes: {
    source: 'specs/typespec/backend/main.tsp',
    selector: 'model PreviewExportDto.eventTypes',
    extractor: 'model-field',
  },
  auditResults: {
    source: 'specs/typespec/backend/main.tsp',
    selector: 'model ExportAuditLogsDto.result',
    extractor: 'model-field',
  },
  auditExportStatuses: {
    source: 'specs/typespec/backend/main.tsp',
    selector: 'op OrganizationController_getExportHistory.status',
    extractor: 'operation-parameter',
  },
  agentAttestationModes: {
    source: 'specs/typespec/backend/main.tsp',
    selector: 'model CreateAgentDto.attestation_mode',
    extractor: 'model-field',
  },
  apiKeyPermissions: {
    source: 'specs/typespec/backend/main.tsp',
    selector: 'model CreateApiKeyDto.permissions',
    extractor: 'model-field',
  },
  webhookChannels: {
    source: 'specs/typespec/backend/main.tsp',
    selector: 'model CreateWebhookDto.channel',
    extractor: 'model-field',
  },
  organizationTimezones: {
    source: 'specs/typespec/backend/main.tsp',
    selector: 'model UpdateOrganizationSettingsDto.timezone',
    extractor: 'model-field',
  },
  welcomeEmailTypes: {
    source: 'specs/typespec/backend/main.tsp',
    selector: 'model SendWelcomeEmailDto.type',
    extractor: 'model-field',
  },
  webhookEventTypes: {
    source: 'specs/typespec/backend/responses.tsp',
    selector: 'alias WebhookEventType',
    extractor: 'alias',
  },
  ssoMethods: {
    source: 'specs/typespec/backend/responses.tsp',
    selector: 'model SsoStatus.method',
    extractor: 'model-field',
  },
  demoSetupStatuses: {
    source: 'specs/typespec/backend/responses.tsp',
    selector: 'model DemoSetupStatus.status',
    extractor: 'model-field',
  },
  coreEventTypes: {
    source: 'specs/typespec/core/main.tsp',
    selector: 'enum EventType',
    extractor: 'enum',
  },
  coreAuthEnvironments: {
    source: 'specs/typespec/core/main.tsp',
    selector: 'model AgentValidationResponse.environment',
    extractor: 'model-field',
  },
  coreGuardrailsInputTypes: {
    source: 'specs/typespec/core/main.tsp',
    selector: 'model GuardrailsResult.input_type',
    extractor: 'model-field',
  },
  coreGuardrailFieldStatuses: {
    source: 'specs/typespec/core/main.tsp',
    selector: 'model GuardrailFieldResult.status',
    extractor: 'model-field',
  },
  coreVerdicts: {
    source: 'specs/typespec/core/main.tsp',
    selector: 'enum Verdict',
    extractor: 'enum',
  },
  coreLegacyActions: {
    source: 'specs/typespec/core/main.tsp',
    selector: 'enum LegacyAction',
    extractor: 'enum',
  },
  openboxProviderIds: {
    source: 'specs/typespec/govern/capabilities.tsp',
    selector: 'enum OpenBoxProviderId',
    extractor: 'enum',
  },
  openboxSupportTiers: {
    source: 'specs/typespec/govern/capabilities.tsp',
    selector: 'enum OpenBoxSupportTier',
    extractor: 'enum',
  },
  openboxCapabilityIds: {
    source: 'specs/typespec/govern/capabilities.tsp',
    selector: 'enum OpenBoxCapabilityId',
    extractor: 'enum',
  },
  referenceProviderParityClosureStatuses: {
    source: 'specs/typespec/govern/capabilities.tsp',
    selector: 'enum ReferenceProviderParityClosureStatus',
    extractor: 'enum',
  },
  referenceProviderRuntimePromotionDecisions: {
    source: 'specs/typespec/govern/capabilities.tsp',
    selector: 'enum ReferenceProviderRuntimePromotionDecision',
    extractor: 'enum',
  },
  ruleTriggers: {
    source: 'specs/typespec/govern/rules-projection.tsp',
    selector: 'enum RuleTrigger',
    extractor: 'enum',
  },
  ruleSeverities: {
    source: 'specs/typespec/govern/rules-projection.tsp',
    selector: 'enum RuleSeverity',
    extractor: 'enum',
  },
  projectedRuleSources: {
    source: 'specs/typespec/govern/rules-projection.tsp',
    selector: 'model ProjectedRule.source',
    extractor: 'model-field',
  },
} satisfies Record<keyof typeof GOVERNANCE_SPEC_DOMAINS, GovernanceSpecDomainProvenance>);

export type GovernanceSpecDomainKey = keyof typeof GOVERNANCE_SPEC_DOMAINS;

export interface DiscoveredFiniteTypeSpecDomain {
  source: string;
  selector: string;
  values: string[];
  matchingDomainKey?: string;
}

const FINITE_DISCOVERY_SOURCES = [
  'specs/typespec/backend/main.tsp',
  'specs/typespec/backend/responses.tsp',
  'specs/typespec/core/main.tsp',
  'specs/typespec/govern/capabilities.tsp',
  'specs/typespec/govern/rules-projection.tsp',
] as const;

export function discoverFiniteTypeSpecDomains(
  extraDomains: Record<string, readonly unknown[]> = {},
): DiscoveredFiniteTypeSpecDomain[] {
  const knownDomains = {
    ...GOVERNANCE_SPEC_DOMAINS,
    ...extraDomains,
  } as Record<string, readonly unknown[]>;
  const knownDomainKeys = Object.keys(knownDomains);
  return FINITE_DISCOVERY_SOURCES.flatMap((source) => {
    const text = stripComments(readSpec(source));
    return [
      ...discoverAliasFiniteDomains(source, text),
      ...discoverEnumFiniteDomains(source, text),
      ...discoverModelFieldFiniteDomains(source, text),
      ...discoverOperationParameterFiniteDomains(source, text),
    ];
  })
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

function discoverAliasFiniteDomains(
  source: string,
  text: string,
): DiscoveredFiniteTypeSpecDomain[] {
  return [...text.matchAll(/alias\s+([A-Za-z_][A-Za-z0-9_]*)\s*=([\s\S]*?);/g)]
    .map((match) => ({
      source,
      selector: `alias ${match[1]}`,
      values: uniqueSortedStrings(extractStringLiterals(match[2])),
    }))
    .filter((entry) => entry.values.length > 0);
}

function discoverEnumFiniteDomains(
  source: string,
  text: string,
): DiscoveredFiniteTypeSpecDomain[] {
  return [...text.matchAll(/enum\s+([A-Za-z_][A-Za-z0-9_]*)\s*{([\s\S]*?)}/g)]
    .map((match) => ({
      source,
      selector: `enum ${match[1]}`,
      values: uniqueSortedStrings(
        match[2]
          .split('\n')
          .map((line) => line.trim().replace(/,$/, ''))
          .filter(Boolean)
          .map((line) =>
            line.match(/^`([^`]+)`/)?.[1] ??
            line.match(/^([A-Za-z_][A-Za-z0-9_-]*)/)?.[1],
          )
          .filter((value): value is string => Boolean(value)),
      ),
    }))
    .filter((entry) => entry.values.length > 0);
}

function discoverModelFieldFiniteDomains(
  source: string,
  text: string,
): DiscoveredFiniteTypeSpecDomain[] {
  return [...text.matchAll(/model\s+([A-Za-z_][A-Za-z0-9_]*)\s*{([\s\S]*?)\n}/g)]
    .flatMap((modelMatch) => {
      const modelName = modelMatch[1];
      const body = modelMatch[2];
      return [...body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\??\s*:\s*([^;]+);/g)]
        .map((fieldMatch) => ({
          source,
          selector: `model ${modelName}.${fieldMatch[1]}`,
          values: uniqueSortedStrings(
            extractStringLiterals(fieldMatch[2].split('=')[0] ?? ''),
          ),
        }))
        .filter((entry) => entry.values.length > 0);
    });
}

function discoverOperationParameterFiniteDomains(
  source: string,
  text: string,
): DiscoveredFiniteTypeSpecDomain[] {
  return [...text.matchAll(/op\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*:/g)]
    .flatMap((operationMatch) => {
      const operationName = operationMatch[1];
      const parameters = operationMatch[2];
      return [...parameters.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\??\s*:\s*([^,\n]+(?:\|[^,\n]+)*)/g)]
        .map((parameterMatch) => ({
          source,
          selector: `op ${operationName}.${parameterMatch[1]}`,
          values: uniqueSortedStrings(
            extractStringLiterals(parameterMatch[2].split('=')[0] ?? ''),
          ),
        }))
        .filter((entry) => entry.values.length > 0);
    });
}

function extractStringLiterals(text: string): string[] {
  return [...text.matchAll(/"([^"]+)"|`([^`]+)`/g)].map((match) => match[1] ?? match[2]);
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
