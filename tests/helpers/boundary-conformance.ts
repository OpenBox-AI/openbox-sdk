import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();

function readSpec(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function extractModelBody(source: string, modelName: string): string {
  const cleaned = stripComments(source);
  const match = cleaned.match(new RegExp(`model\\s+${modelName}\\s*{([\\s\\S]*?)\\n}`));
  if (!match) throw new Error(`Missing TypeSpec model ${modelName}`);
  return match[1];
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

function extractRequiredModelFields(source: string, modelNames: readonly string[]) {
  return modelNames.flatMap((modelName) => {
    const body = extractModelBody(source, modelName);
    return body
      .split('\n')
      .map((line) => line.trim())
      .map((line) => line.replace(/^(@[A-Za-z0-9_]+(?:\([^)]*\))?\s*)+/, ''))
      .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^;]+);$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => ({
        modelName,
        fieldName: match[1],
        type: match[2].trim(),
      }));
  });
}

function extractNumericBoundaries(source: string, modelNames: readonly string[]): NumericBoundary[] {
  return modelNames.flatMap((modelName) => {
    const body = extractModelBody(source, modelName);
    return [...body.matchAll(
      /@minValue\((-?\d+(?:\.\d+)?)\)(?:\s*@maxValue\((-?\d+(?:\.\d+)?)\))?\s+([A-Za-z_][A-Za-z0-9_]*)\??\s*:\s*([^;]+);/g,
    )].map((match) => ({
      modelName,
      fieldName: match[3],
      min: Number(match[1]),
      max: match[2] === undefined ? undefined : Number(match[2]),
      type: match[4].trim(),
    }));
  });
}

function extractStringLengthBoundaries(
  source: string,
  modelNames: readonly string[],
): StringLengthBoundary[] {
  return modelNames.flatMap((modelName) => {
    const body = extractModelBody(source, modelName);
    return [...body.matchAll(
      /@maxLength\((\d+)\)\s+([A-Za-z_][A-Za-z0-9_]*)\??\s*:\s*([^;]+);/g,
    )].map((match) => ({
      modelName,
      fieldName: match[2],
      max: Number(match[1]),
      type: match[3].trim(),
    }));
  });
}

function extractArrayItemBoundaries(
  source: string,
  modelNames: readonly string[],
): ArrayItemBoundary[] {
  return modelNames.flatMap((modelName) => {
    const body = extractModelBody(source, modelName);
    return [...body.matchAll(
      /@minItems\((\d+)\)\s+@maxItems\((\d+)\)\s+([A-Za-z_][A-Za-z0-9_]*)\??\s*:\s*([^;]+);/g,
    )].map((match) => ({
      modelName,
      fieldName: match[3],
      min: Number(match[1]),
      max: Number(match[2]),
      type: match[4].trim(),
    }));
  });
}

function extractFormatBoundaries(
  source: string,
  modelNames: readonly string[],
): FormatBoundary[] {
  return modelNames.flatMap((modelName) => {
    const body = extractModelBody(source, modelName);
    return [...body.matchAll(
      /@format\("([^"]+)"\)\s+([A-Za-z_][A-Za-z0-9_]*)\??\s*:\s*([^;]+);/g,
    )].map((match) => ({
      modelName,
      fieldName: match[2],
      format: match[1],
      type: match[3].trim(),
    }));
  });
}

export interface NumericBoundary {
  modelName: string;
  fieldName: string;
  min: number;
  max?: number;
  type: string;
}

export interface StringLengthBoundary {
  modelName: string;
  fieldName: string;
  max: number;
  type: string;
}

export interface ArrayItemBoundary {
  modelName: string;
  fieldName: string;
  min: number;
  max: number;
  type: string;
}

export interface FormatBoundary {
  modelName: string;
  fieldName: string;
  format: string;
  type: string;
}

export interface AivssBoundaryField extends NumericBoundary {
  path: readonly [string, string];
}

export type BoundaryDomainKey = keyof typeof GOVERNANCE_BOUNDARY_DOMAINS;

interface BoundaryFieldCoverage {
  domainKey: BoundaryDomainKey;
  modelName: string;
  fieldName: string;
}

interface BoundaryEvidence {
  id: string;
  domainKeys: BoundaryDomainKey[];
  coveredFields?: BoundaryFieldCoverage[];
  source: 'typespec' | 'typespec-and-local-stack-probe';
  proofMode: 'exhaustive-local-stack-e2e' | 'boundary-local-stack-e2e';
  proofFile: string;
  evidencePattern: string;
  executablePatterns: string[];
}

export interface BoundaryGap {
  id: string;
  domainKeys: BoundaryDomainKey[];
  operationIds: string[];
  coveredFields?: BoundaryFieldCoverage[];
  proofFile: string;
  evidencePattern: string;
  executablePatterns: string[];
  observedBehavior: string;
  requiredBehavior: string;
}

const backendMain = readSpec('specs/typespec/backend/main.tsp');
const coreMain = readSpec('specs/typespec/core/main.tsp');

const AIVSS_PATHS: Record<string, Record<string, readonly [string, string]>> = {
  BaseSecurityDto: {
    attack_vector: ['base_security', 'attack_vector'],
    attack_complexity: ['base_security', 'attack_complexity'],
    privileges_required: ['base_security', 'privileges_required'],
    user_interaction: ['base_security', 'user_interaction'],
    scope: ['base_security', 'scope'],
  },
  AISpecificDto: {
    model_robustness: ['ai_specific', 'model_robustness'],
    data_sensitivity: ['ai_specific', 'data_sensitivity'],
    ethical_impact: ['ai_specific', 'ethical_impact'],
    decision_criticality: ['ai_specific', 'decision_criticality'],
    adaptability: ['ai_specific', 'adaptability'],
  },
  ImpactDto: {
    confidentiality_impact: ['impact', 'confidentiality_impact'],
    integrity_impact: ['impact', 'integrity_impact'],
    availability_impact: ['impact', 'availability_impact'],
    safety_impact: ['impact', 'safety_impact'],
  },
};

function toAivssBoundaryField(boundary: NumericBoundary): AivssBoundaryField {
  const path = AIVSS_PATHS[boundary.modelName]?.[boundary.fieldName];
  if (!path) throw new Error(`Missing AIVSS field path for ${boundary.modelName}.${boundary.fieldName}`);
  return { ...boundary, path };
}

export const AIVSS_NUMERIC_BOUNDARIES = extractNumericBoundaries(backendMain, [
  'BaseSecurityDto',
  'AISpecificDto',
  'ImpactDto',
]).map(toAivssBoundaryField);

export const GOAL_ALIGNMENT_NUMERIC_BOUNDARIES = extractNumericBoundaries(backendMain, [
  'GoalAlignmentConfigDto',
]);

export const BEHAVIOR_RULE_NUMERIC_BOUNDARIES = extractNumericBoundaries(backendMain, [
  'CreateBehaviorRuleDto',
]);

export const TRUST_THRESHOLD_NUMERIC_BOUNDARIES = extractNumericBoundaries(backendMain, [
  'CreateGuardrailDto',
  'UpdateGuardrailDto',
  'CreatePolicyDto',
  'UpdatePolicyDto',
  'CreateBehaviorRuleDto',
  'UpdateBehavioralRuleDto',
]).filter((entry) => entry.fieldName === 'trust_threshold');

export const BACKEND_STRING_LENGTH_BOUNDARIES = extractStringLengthBoundaries(backendMain, [
  'CreatePolicyDto',
  'CreateTeamDto',
]);

export const BACKEND_ARRAY_ITEM_BOUNDARIES = extractArrayItemBoundaries(backendMain, [
  'RemoveMembersDto',
]);

export const BACKEND_UUID_FORMAT_BOUNDARIES = extractFormatBoundaries(backendMain, [
  'CreateBehaviorRuleDto',
  'UpdateBehavioralRuleDto',
]).filter((entry) => entry.format === 'uuid');

export const CORE_NUMERIC_BOUNDARIES = extractNumericBoundaries(coreMain, [
  'GovernanceEventPayload',
  'GovernanceVerdictResponse',
  'AGETrustScore',
]);

export const GOVERNANCE_BOUNDARY_DOMAINS = Object.freeze({
  requiredBodyFields: extractRequiredModelFields(backendMain, [
    'LoginDto',
    'LogoutDto',
    'ForgotPasswordDto',
    'ResetPasswordDto',
    'ChangePasswordDto',
    'RefreshDto',
    'CreateOrganizationDto',
  ]),
  aivssNumericFields: AIVSS_NUMERIC_BOUNDARIES,
  goalAlignmentThresholds: GOAL_ALIGNMENT_NUMERIC_BOUNDARIES,
  goalAlignmentModels: extractStringModelFieldMembers(
    backendMain,
    'GoalAlignmentConfigDto',
    'llama_firewall_model',
  ),
  goalAlignmentDriftActions: extractStringModelFieldMembers(
    backendMain,
    'GoalAlignmentConfigDto',
    'drift_detection_action',
  ),
  goalAlignmentEvaluationFrequencies: extractStringModelFieldMembers(
    backendMain,
    'GoalAlignmentConfigDto',
    'evaluation_frequency',
  ),
  behaviorRuleNumericFields: BEHAVIOR_RULE_NUMERIC_BOUNDARIES,
  trustThresholdFields: TRUST_THRESHOLD_NUMERIC_BOUNDARIES,
  backendStringLengthFields: BACKEND_STRING_LENGTH_BOUNDARIES,
  backendArrayItemFields: BACKEND_ARRAY_ITEM_BOUNDARIES,
  backendUuidFormatFields: BACKEND_UUID_FORMAT_BOUNDARIES,
  coreNumericFields: CORE_NUMERIC_BOUNDARIES,
  trustImpacts: extractStringModelFieldMembers(backendMain, 'CreateGuardrailDto', 'trust_impact'),
  backendOpenJsonFields: extractOpenJsonFields(backendMain, [
    'CreateAgentDto',
    'UpdateAgentDto',
    'CreateGuardrailDto',
    'UpdateGuardrailDto',
    'CreatePolicyDto',
    'TestGuardrailDto',
    'EvaluateRegoDto',
  ]),
  coreOpenJsonFields: extractOpenJsonFields(coreMain, [
    'GovernanceEventPayload',
    'SpanData',
    'SpanEvent',
  ]),
});

function extractOpenJsonFields(source: string, modelNames: readonly string[]) {
  return modelNames.flatMap((modelName) => {
    const body = extractModelBody(source, modelName);
    return body
      .split('\n')
      .map((line) => line.trim())
      .map((line) => line.replace(/^(@[A-Za-z0-9_]+(?:\([^)]*\))?\s*)+/, ''))
      .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)\??\s*:\s*([^;]+);$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => ({
        modelName,
        fieldName: match[1],
        type: match[2].trim(),
      }))
      .filter((entry) =>
        /\bunknown\b|\{\}|Record<unknown>|SpanData\[]/.test(entry.type),
      );
  });
}

export type JsonValueClass = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';

export interface JsonValueClassCase {
  kind: JsonValueClass;
  value: unknown;
}

export const JSON_VALUE_CLASS_CASES: JsonValueClassCase[] = [
  { kind: 'null', value: null },
  { kind: 'boolean', value: true },
  { kind: 'number', value: 42 },
  { kind: 'string', value: 'json-value-string' },
  { kind: 'array', value: ['array-item', 1, null, { nested: true }] },
  { kind: 'object', value: { nested: { flag: true }, list: [1, 'two', false] } },
];

export function makeJsonObjectValueClassPayload(): Record<string, unknown> {
  return Object.fromEntries(
    JSON_VALUE_CLASS_CASES.map((entry) => [`${entry.kind}_value`, entry.value]),
  );
}

export function makeJsonArrayValueClassPayload(): unknown[] {
  return JSON_VALUE_CLASS_CASES.map((entry) => entry.value);
}

export function invalidBoundarySpecMember(domainKey: BoundaryDomainKey): string {
  const candidate = `__invalid_${domainKey}__`;
  const domain = GOVERNANCE_BOUNDARY_DOMAINS[domainKey] as readonly unknown[];
  if (domain.includes(candidate)) {
    throw new Error(`Invalid boundary sentinel collides with ${String(domainKey)}`);
  }
  return candidate;
}

export function overMaxLengthString(modelName: string, fieldName: string): string {
  const boundary = (GOVERNANCE_BOUNDARY_DOMAINS.backendStringLengthFields as readonly StringLengthBoundary[])
    .find((entry) => entry.modelName === modelName && entry.fieldName === fieldName);
  if (!boundary) throw new Error(`Missing ${modelName}.${fieldName} maxLength boundary`);
  return 'x'.repeat(boundary.max + 1);
}

export function invalidUuidString(modelName: string, fieldName: string): string {
  const boundary = (GOVERNANCE_BOUNDARY_DOMAINS.backendUuidFormatFields as readonly FormatBoundary[])
    .find((entry) => entry.modelName === modelName && entry.fieldName === fieldName);
  if (!boundary) throw new Error(`Missing ${modelName}.${fieldName} uuid boundary`);
  return `not-a-${boundary.format}`;
}

export interface AivssIntegerMemberCase {
  id: string;
  field: AivssBoundaryField;
  value: number;
  config: Record<string, any>;
}

export interface AivssInvalidBoundaryCase {
  id: string;
  field: AivssBoundaryField;
  value: number;
  reason: 'below-min' | 'above-max' | 'fractional';
  config: Record<string, any>;
}

export function makeAivssConfigWithField(field: AivssBoundaryField, value: number): Record<string, any> {
  const config = makeAivssConfig('min');
  config[field.path[0]][field.path[1]] = value;
  return config;
}

export function makeAivssConfig(boundary: 'min' | 'max'): Record<string, any> {
  const config: Record<string, any> = {
    base_security: {},
    ai_specific: {},
    impact: {},
  };

  for (const field of AIVSS_NUMERIC_BOUNDARIES) {
    config[field.path[0]][field.path[1]] = boundary === 'min' ? field.min : field.max;
  }

  return config;
}

export function makeAivssIntegerMemberCases(): AivssIntegerMemberCase[] {
  return AIVSS_NUMERIC_BOUNDARIES.flatMap((field) => {
    if (field.max === undefined) throw new Error(`AIVSS field ${field.fieldName} must have max`);
    const values = Array.from(
      { length: field.max - field.min + 1 },
      (_, offset) => field.min + offset,
    );
    return values.map((value) => ({
      id: `${field.modelName}.${field.fieldName}=${value}`,
      field,
      value,
      config: makeAivssConfigWithField(field, value),
    }));
  });
}

export function expectedAivssIntegerMemberCaseCount(): number {
  return AIVSS_NUMERIC_BOUNDARIES.reduce((total, field) => {
    if (field.max === undefined) throw new Error(`AIVSS field ${field.fieldName} must have max`);
    return total + field.max - field.min + 1;
  }, 0);
}

export function makeAivssInvalidBoundaryCases(): AivssInvalidBoundaryCase[] {
  return AIVSS_NUMERIC_BOUNDARIES.flatMap((field) => {
    if (field.max === undefined) throw new Error(`AIVSS field ${field.fieldName} must have max`);
    return [
      {
        id: `${field.modelName}.${field.fieldName}<min`,
        field,
        value: field.min - 1,
        reason: 'below-min' as const,
        config: makeAivssConfigWithField(field, field.min - 1),
      },
      {
        id: `${field.modelName}.${field.fieldName}>max`,
        field,
        value: field.max + 1,
        reason: 'above-max' as const,
        config: makeAivssConfigWithField(field, field.max + 1),
      },
      {
        id: `${field.modelName}.${field.fieldName}=fractional`,
        field,
        value: field.min + 0.5,
        reason: 'fractional' as const,
        config: makeAivssConfigWithField(field, field.min + 0.5),
      },
    ];
  });
}

export function expectedAivssInvalidBoundaryCaseCount(): number {
  return AIVSS_NUMERIC_BOUNDARIES.length * 3;
}

export interface GoalAlignmentConfigCase {
  id: string;
  config: Record<string, any>;
}

export function makeGoalAlignmentFiniteConfigCases(): GoalAlignmentConfigCase[] {
  return GOVERNANCE_BOUNDARY_DOMAINS.goalAlignmentModels.flatMap((llama_firewall_model) =>
    GOVERNANCE_BOUNDARY_DOMAINS.goalAlignmentDriftActions.flatMap((drift_detection_action) =>
      GOVERNANCE_BOUNDARY_DOMAINS.goalAlignmentEvaluationFrequencies.map((evaluation_frequency) => ({
        id: `${llama_firewall_model}:${drift_detection_action}:${evaluation_frequency}`,
        config: {
          alignment_threshold: 70,
          llama_firewall_model,
          drift_detection_action,
          evaluation_frequency,
        },
      })),
    ),
  );
}

export function expectedGoalAlignmentFiniteConfigCaseCount(): number {
  return (
    GOVERNANCE_BOUNDARY_DOMAINS.goalAlignmentModels.length *
    GOVERNANCE_BOUNDARY_DOMAINS.goalAlignmentDriftActions.length *
    GOVERNANCE_BOUNDARY_DOMAINS.goalAlignmentEvaluationFrequencies.length
  );
}

export function makeGoalAlignmentThresholdBoundaryCases(): {
  valid: GoalAlignmentConfigCase[];
  invalid: GoalAlignmentConfigCase[];
} {
  const threshold = GOVERNANCE_BOUNDARY_DOMAINS.goalAlignmentThresholds.find(
    (entry) => entry.fieldName === 'alignment_threshold',
  );
  if (!threshold || threshold.max === undefined) {
    throw new Error('Missing GoalAlignmentConfigDto.alignment_threshold bounds');
  }
  const base = {
    llama_firewall_model: GOVERNANCE_BOUNDARY_DOMAINS.goalAlignmentModels[0],
    drift_detection_action: GOVERNANCE_BOUNDARY_DOMAINS.goalAlignmentDriftActions[0],
    evaluation_frequency: GOVERNANCE_BOUNDARY_DOMAINS.goalAlignmentEvaluationFrequencies[0],
  };
  return {
    valid: [threshold.min, threshold.max].map((alignment_threshold) => ({
      id: `alignment_threshold=${alignment_threshold}`,
      config: { ...base, alignment_threshold },
    })),
    invalid: [threshold.min - 1, threshold.max + 1].map((alignment_threshold) => ({
      id: `alignment_threshold=${alignment_threshold}`,
      config: { ...base, alignment_threshold },
    })),
  };
}

export function makeBehaviorRuleBoundaryCases() {
  const priority = requiredBoundary('priority');
  const timeWindow = requiredBoundary('time_window');
  const approvalTimeout = requiredBoundary('approval_timeout');
  const trustThreshold = TRUST_THRESHOLD_NUMERIC_BOUNDARIES.find(
    (entry) => entry.modelName === 'CreateBehaviorRuleDto',
  );
  if (!trustThreshold) throw new Error('Missing CreateBehaviorRuleDto.trust_threshold bounds');

  return {
    valid: [
      { id: 'priority-min', overrides: { priority: priority.min }, expect: { priority: priority.min } },
      { id: 'priority-max', overrides: { priority: priority.max }, expect: { priority: priority.max } },
      {
        id: 'time-window-min',
        overrides: { time_window: timeWindow.min },
        expect: { time_window: timeWindow.min },
      },
      {
        id: 'approval-timeout-min',
        overrides: { verdict: 2, approval_timeout: approvalTimeout.min },
        expect: { verdict: 2, approval_timeout: approvalTimeout.min },
      },
      {
        id: 'trust-threshold-null',
        overrides: { trust_threshold: null },
        expect: { trust_threshold: null },
      },
      {
        id: 'trust-threshold-min',
        overrides: { trust_threshold: trustThreshold.min },
        expect: { trust_threshold: trustThreshold.min },
      },
    ],
    invalid: [
      { id: 'priority-below-min', overrides: { priority: priority.min - 1 } },
      { id: 'priority-above-max', overrides: { priority: Number(priority.max) + 1 } },
      { id: 'time-window-below-min', overrides: { time_window: timeWindow.min - 1 } },
      {
        id: 'approval-timeout-below-min',
        overrides: { verdict: 2, approval_timeout: approvalTimeout.min - 1 },
      },
      { id: 'approval-timeout-required', overrides: { verdict: 2, approval_timeout: undefined } },
      { id: 'trust-threshold-below-min', overrides: { trust_threshold: trustThreshold.min - 1 } },
    ],
  };
}

function requiredBoundary(fieldName: string): NumericBoundary {
  const boundary = BEHAVIOR_RULE_NUMERIC_BOUNDARIES.find((entry) => entry.fieldName === fieldName);
  if (!boundary) throw new Error(`Missing CreateBehaviorRuleDto.${fieldName} bounds`);
  return boundary;
}

export function makeTrustThresholdBoundaryCases(modelName: string): {
  valid: Array<{ id: string; trust_threshold: number | null }>;
  invalid: Array<{ id: string; trust_threshold: number }>;
} {
  const boundary = TRUST_THRESHOLD_NUMERIC_BOUNDARIES.find(
    (entry) => entry.modelName === modelName,
  );
  if (!boundary) throw new Error(`Missing ${modelName}.trust_threshold bounds`);
  return {
    valid: [
      { id: `${modelName}.trust_threshold=null`, trust_threshold: null },
      { id: `${modelName}.trust_threshold=min`, trust_threshold: boundary.min },
    ],
    invalid: [
      { id: `${modelName}.trust_threshold<min`, trust_threshold: boundary.min - 1 },
      { id: `${modelName}.trust_threshold<min-1`, trust_threshold: boundary.min - 2 },
    ],
  };
}

function coverFields(
  domainKey: BoundaryDomainKey,
  modelNames: readonly string[],
  fieldNames?: readonly string[],
): BoundaryFieldCoverage[] {
  const fields = GOVERNANCE_BOUNDARY_DOMAINS[domainKey] as ReadonlyArray<{
    modelName?: string;
    fieldName?: string;
  }>;
  return fields
    .filter((entry) => entry.modelName && entry.fieldName)
    .filter((entry) => modelNames.includes(entry.modelName!))
    .filter((entry) => !fieldNames || fieldNames.includes(entry.fieldName!))
    .map((entry) => ({
      domainKey,
      modelName: entry.modelName!,
      fieldName: entry.fieldName!,
    }));
}

export const BOUNDARY_CONFORMANCE_EVIDENCE: BoundaryEvidence[] = [
  {
    id: 'auth-required-body-fields',
    domainKeys: ['requiredBodyFields'],
    coveredFields: coverFields('requiredBodyFields', [
      'LoginDto',
      'LogoutDto',
      'ForgotPasswordDto',
      'ResetPasswordDto',
      'ChangePasswordDto',
      'RefreshDto',
    ]),
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/auth.test.ts',
    evidencePattern: 'CONTRACT_BOUNDARY: auth DTOs reject every missing required field from TypeSpec',
    executablePatterns: [
      "requiredFields('LoginDto')",
      "requiredFields('LogoutDto')",
      "requiredFields('ForgotPasswordDto')",
      "requiredFields('ResetPasswordDto')",
      "requiredFields('ChangePasswordDto')",
      "requiredFields('RefreshDto')",
      'withoutField(',
      'expectValidationOrThrottle(',
    ],
  },
  {
    id: 'organization-registration-required-body-fields',
    domainKeys: ['requiredBodyFields'],
    coveredFields: coverFields('requiredBodyFields', ['CreateOrganizationDto']),
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/organization.test.ts',
    evidencePattern: 'CONTRACT_BOUNDARY: POST /organization/register validates every required registration field',
    executablePatterns: [
      'GOVERNANCE_BOUNDARY_DOMAINS.requiredBodyFields',
      "entry.modelName === 'CreateOrganizationDto'",
      'delete body[field]',
      'expect(result.status, field).toBe(422)',
    ],
  },
  {
    id: 'aivss-numeric-scale-members',
    domainKeys: ['aivssNumericFields'],
    coveredFields: coverFields('aivssNumericFields', [
      'BaseSecurityDto',
      'AISpecificDto',
      'ImpactDto',
    ]),
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/aivss.test.ts',
    evidencePattern: 'EXHAUSTIVE_BOUNDARY_PROOF: AIVSS numeric rubric fields',
    executablePatterns: [
      'makeAivssIntegerMemberCases()',
      'expectedAivssIntegerMemberCaseCount()',
      'expect(cases).toHaveLength(expectedAivssIntegerMemberCaseCount())',
      "backendOperation('AgentController_getAivssScore')",
      'client.post(operation.path',
    ],
  },
  {
    id: 'aivss-numeric-invalid-boundaries',
    domainKeys: ['aivssNumericFields'],
    coveredFields: coverFields('aivssNumericFields', [
      'BaseSecurityDto',
      'AISpecificDto',
      'ImpactDto',
    ]),
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/aivss.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: AIVSS numeric rubric fields reject outside and fractional values',
    executablePatterns: [
      'makeAivssInvalidBoundaryCases()',
      'expectedAivssInvalidBoundaryCaseCount()',
      'expect(cases).toHaveLength(expectedAivssInvalidBoundaryCaseCount())',
      'expect(body.status, testCase.id).toBe(422)',
    ],
  },
  {
    id: 'goal-alignment-finite-product-and-thresholds',
    domainKeys: [
      'goalAlignmentModels',
      'goalAlignmentDriftActions',
      'goalAlignmentEvaluationFrequencies',
    ],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/goal-alignment.test.ts',
    evidencePattern: 'EXHAUSTIVE_BOUNDARY_PROOF: GoalAlignmentConfigDto finite option product',
    executablePatterns: [
      'makeGoalAlignmentFiniteConfigCases()',
      'expectedGoalAlignmentFiniteConfigCaseCount()',
      'expect(cases).toHaveLength(expectedGoalAlignmentFiniteConfigCaseCount())',
      'goal_alignment_config',
    ],
  },
  {
    id: 'goal-alignment-finite-option-invalid-members',
    domainKeys: [
      'goalAlignmentModels',
      'goalAlignmentDriftActions',
      'goalAlignmentEvaluationFrequencies',
    ],
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/goal-alignment.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: GoalAlignmentConfigDto finite options reject out-of-domain values',
    executablePatterns: [
      "invalidBoundarySpecMember('goalAlignmentModels')",
      "invalidBoundarySpecMember('goalAlignmentDriftActions')",
      "invalidBoundarySpecMember('goalAlignmentEvaluationFrequencies')",
      'expect(body.status, testCase.id).toBe(422)',
    ],
  },
  {
    id: 'goal-alignment-threshold-boundaries',
    domainKeys: ['goalAlignmentThresholds'],
    coveredFields: coverFields('goalAlignmentThresholds', ['GoalAlignmentConfigDto']),
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/goal-alignment.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: GoalAlignmentConfigDto threshold bounds are enforced',
    executablePatterns: [
      'makeGoalAlignmentThresholdBoundaryCases()',
      'cases.valid',
      'cases.invalid',
      'expect(body.status, testCase.id).toBe(422)',
    ],
  },
  {
    id: 'behavior-rule-numeric-boundaries',
    domainKeys: ['behaviorRuleNumericFields', 'trustThresholdFields'],
    coveredFields: [
      ...coverFields('behaviorRuleNumericFields', ['CreateBehaviorRuleDto']),
      ...coverFields('trustThresholdFields', ['CreateBehaviorRuleDto']),
    ],
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/behavior-rules.test.ts',
    evidencePattern: 'EXHAUSTIVE_BOUNDARY_PROOF: behavior-rule numeric boundaries',
    executablePatterns: [
      'makeBehaviorRuleBoundaryCases()',
      'cases.valid',
      'cases.invalid',
      'expect(body.status, testCase.id).toBe(422)',
    ],
  },
  {
    id: 'behavior-rule-trust-impact-members',
    domainKeys: ['trustImpacts'],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/behavior-rules.test.ts',
    evidencePattern: 'EXHAUSTIVE_BOUNDARY_PROOF: behavior-rule trust impact members',
    executablePatterns: [
      'GOVERNANCE_BOUNDARY_DOMAINS.trustImpacts',
      'trust_impact',
      'expect(body.status, trust_impact).toBe(200)',
    ],
  },
  {
    id: 'behavior-rule-update-trust-threshold-boundaries',
    domainKeys: ['trustThresholdFields'],
    coveredFields: coverFields('trustThresholdFields', ['UpdateBehavioralRuleDto']),
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/behavior-rules.test.ts',
    evidencePattern: 'EXHAUSTIVE_BOUNDARY_PROOF: behavior-rule update trust threshold boundaries',
    executablePatterns: [
      "makeTrustThresholdBoundaryCases('UpdateBehavioralRuleDto')",
      'cases.valid',
      'cases.invalid',
      'expect(body.status, `update:${testCase.id}`).toBe(422)',
    ],
  },
  {
    id: 'behavior-rule-invalid-finite-fields',
    domainKeys: [],
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/behavior-rules.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: behavior-rule finite fields reject out-of-domain values',
    executablePatterns: [
      "invalidGovernanceSpecMember('behaviorRuleTriggers')",
      "invalidGovernanceSpecMember('behaviorRuleStateMembers')",
      "invalidNumericGovernanceSpecMember('behaviorRuleVerdicts')",
      "invalidBoundarySpecMember('trustImpacts')",
      'expect(body.status, dto.rule_name).toBe(422)',
    ],
  },
  {
    id: 'guardrail-run-test-type-outcome-product',
    domainKeys: [],
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/guardrails.test.ts',
    evidencePattern: 'EXHAUSTIVE_BOUNDARY_PROOF: GuardrailController_runTest covers every guardrail type and outcome',
    executablePatterns: [
      'const guardrailRunTestCases = makeGuardrailRunTestConformanceCases()',
      'GOVERNANCE_SPEC_DOMAINS.guardrailTypes',
      'GOVERNANCE_SPEC_DOMAINS.coreGuardrailFieldStatuses',
      'expectedFieldStatuses',
      'observedStatuses',
      'observedGuardrailTypeStatuses',
      'observedGuardrailTypeStatusPairs',
      'GOVERNANCE_SPEC_DOMAINS.guardrailTypes.length * expectedFieldStatuses.length',
    ],
  },
  {
    id: 'guardrail-trust-impact-thresholds',
    domainKeys: ['trustImpacts', 'trustThresholdFields'],
    coveredFields: coverFields('trustThresholdFields', ['CreateGuardrailDto', 'UpdateGuardrailDto']),
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/guardrails.test.ts',
    evidencePattern: 'EXHAUSTIVE_BOUNDARY_PROOF: guardrail trust impact and threshold boundaries',
    executablePatterns: [
      "makeTrustThresholdBoundaryCases('CreateGuardrailDto')",
      "makeTrustThresholdBoundaryCases('UpdateGuardrailDto')",
      'GOVERNANCE_BOUNDARY_DOMAINS.trustImpacts',
      'expect(body.status, `${trust_impact}:${testCase.id}`).toBe(200)',
    ],
  },
  {
    id: 'guardrail-invalid-finite-fields',
    domainKeys: [],
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/guardrails.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: guardrail finite enum fields reject out-of-domain values',
    executablePatterns: [
      "invalidGovernanceSpecMember('guardrailTypes')",
      "invalidGovernanceSpecMember('guardrailProcessingStages')",
      "invalidBoundarySpecMember('trustImpacts')",
      'expect(body.status, dto.name).toBe(422)',
    ],
  },
  {
    id: 'policy-evaluate-nested-input-and-invalid-rego',
    domainKeys: [],
    source: 'typespec-and-local-stack-probe',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/policies.test.ts',
    evidencePattern: 'BOUNDARY_PROOF: PolicyController_evaluate handles nested Rego v1 input',
    executablePatterns: [
      'PolicyController_evaluate',
      'input.user.role',
      'expect(allowBody.status).toBe(200)',
      'expect(invalidBody.status).toBe(500)',
    ],
  },
  {
    id: 'policy-string-max-length-fields',
    domainKeys: ['backendStringLengthFields'],
    coveredFields: coverFields('backendStringLengthFields', ['CreatePolicyDto']),
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/policies.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: policy string maxLength fields reject over-limit values',
    executablePatterns: [
      "overMaxLengthString('CreatePolicyDto', 'name')",
      "overMaxLengthString('CreatePolicyDto', 'description')",
      'expect(body.status, testCase.id).toBe(422)',
    ],
  },
  {
    id: 'policy-trust-impact-thresholds',
    domainKeys: ['trustImpacts', 'trustThresholdFields'],
    coveredFields: coverFields('trustThresholdFields', ['CreatePolicyDto', 'UpdatePolicyDto']),
    source: 'typespec',
    proofMode: 'exhaustive-local-stack-e2e',
    proofFile: 'tests/e2e/policies.test.ts',
    evidencePattern: 'BOUNDARY_PROOF: policy trust impact and threshold boundaries',
    executablePatterns: [
      "makeTrustThresholdBoundaryCases('CreatePolicyDto')",
      "makeTrustThresholdBoundaryCases('UpdatePolicyDto')",
      'GOVERNANCE_BOUNDARY_DOMAINS.trustImpacts',
      'expect(body.status, `${trust_impact}:${testCase.id}`).toBe(200)',
    ],
  },
  {
    id: 'team-string-max-length-fields',
    domainKeys: ['backendStringLengthFields'],
    coveredFields: coverFields('backendStringLengthFields', ['CreateTeamDto']),
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/teams.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: team string maxLength fields reject over-limit values',
    executablePatterns: [
      "overMaxLengthString('CreateTeamDto', 'name')",
      "overMaxLengthString('CreateTeamDto', 'description')",
      "overMaxLengthString('CreateTeamDto', 'icon')",
      'expect(body.status, testCase.id).toBe(422)',
    ],
  },
  {
    id: 'query-min-date-and-limit-boundaries',
    domainKeys: [],
    source: 'typespec-and-local-stack-probe',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/organization.test.ts',
    evidencePattern: 'BOUNDARY_PROOF: organization query numeric/date boundaries',
    executablePatterns: [
      "backendOperation('OrganizationController_getGovernanceFeed')",
      "backendOperation('OrganizationController_getTrustDriftLanes')",
      "backendOperation('OrganizationController_getAuditLogs')",
      '?limit=1',
      '?limit=0',
      'startDate=not-a-date',
    ],
  },
  {
    id: 'behavior-rule-dependency-uuid-format',
    domainKeys: ['backendUuidFormatFields'],
    coveredFields: coverFields('backendUuidFormatFields', [
      'CreateBehaviorRuleDto',
      'UpdateBehavioralRuleDto',
    ]),
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/behavior-rules.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: behavior-rule dependency UUID format is enforced',
    executablePatterns: [
      'invalidUuidString(',
      "'CreateBehaviorRuleDto'",
      "'UpdateBehavioralRuleDto'",
      "'dependency_base_rule_id'",
      'expect(createBody.status).toBe(422)',
      'expect(updateBody.status).toBe(422)',
    ],
  },
  {
    id: 'core-governance-attempt-integer-request-boundary',
    domainKeys: [],
    source: 'typespec-and-local-stack-probe',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: core governance attempt rejects fractional and nonnumeric values',
    executablePatterns: [
      'attempt: 0.5',
      'FractionalAttemptProbe',
      "attempt: 'not-an-integer'",
      'NonnumericAttemptProbe',
      'expect([400, 422]',
    ],
  },
  {
    id: 'core-governance-response-numeric-boundaries',
    domainKeys: ['coreNumericFields'],
    coveredFields: coverFields('coreNumericFields', [
      'GovernanceVerdictResponse',
    ]),
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'POST /api/v1/governance/evaluate returns response with verdict',
    executablePatterns: [
      'GOVERNANCE_BOUNDARY_DOMAINS.coreNumericFields',
      'expectRange(response.data.risk_score, 0, 1',
      "fieldName: 'risk_score'",
    ],
  },
  {
    id: 'core-governance-age-trust-score-boundaries',
    domainKeys: ['coreNumericFields'],
    coveredFields: coverFields('coreNumericFields', [
      'AGETrustScore',
    ]),
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'CONFORMANCE: sends the goal signal before the first governed action and surfaces AGE fallback',
    executablePatterns: [
      'conformanceCase.goalSignalEvent.workflow_id',
      'conformanceCase.firstGovernedEvent.workflow_id',
      "conformanceCase.goalSignalEvent.signal_name).toBe('openbox_goal')",
      'conformanceCase.goalSignalEvent.activity_input',
      'conformanceCase.goalSignalEvent.signal_args',
      'expect(observedOrder).toEqual',
      'actionResponse.data.age_result',
      'age_result.trust_score.trust_tier',
      'expectRange(',
    ],
  },
  {
    id: 'core-governance-telemetry-numeric-request-boundaries',
    domainKeys: [],
    source: 'typespec-and-local-stack-probe',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: core governance numeric telemetry fields reject invalid request types',
    executablePatterns: [
      'CORE_TELEMETRY_TOP_LEVEL_NUMERIC_FIELDS',
      'CORE_TELEMETRY_SPAN_NUMERIC_FIELDS',
      "[field]: 'not-a-number'",
      'expectedInvalidTelemetryCaseCount()',
      'expect(cases).toHaveLength(expectedInvalidTelemetryCaseCount())',
      'expect([400, 422]',
    ],
  },
  {
    id: 'core-governance-timestamp-type-request-boundary',
    domainKeys: [],
    source: 'typespec-and-local-stack-probe',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: core governance timestamp rejects non-string values',
    executablePatterns: [
      'timestamp: 12345',
      'InvalidTimestampTypeProbe',
      'expect([400, 422]',
    ],
  },
  {
    id: 'backend-query-pagination-search-request-boundaries',
    domainKeys: [],
    source: 'typespec-and-local-stack-probe',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/request-query-boundaries.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: generated backend pagination and search query constraints reject invalid values or expose raw gaps',
    executablePatterns: [
      'BACKEND_REQUEST_PREFLIGHT_RULES.length',
      "testCase.queryName === 'pattern'",
      'expectedBoundaryCaseCount()',
      'expect(cases).toHaveLength(expectedBoundaryCaseCount())',
      'await rawBoundaryGet(client, testCase)',
    ],
  },
  {
    id: 'agent-create-config-json-value-classes',
    domainKeys: ['backendOpenJsonFields'],
    coveredFields: coverFields('backendOpenJsonFields', ['CreateAgentDto']),
    source: 'typespec-and-local-stack-probe',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/agent-crud.test.ts',
    evidencePattern: 'creates an agent',
    executablePatterns: [
      'makeJsonObjectValueClassPayload()',
      'body.data.agent.config',
    ],
  },
  {
    id: 'agent-update-config-json-value-classes',
    domainKeys: ['backendOpenJsonFields'],
    coveredFields: coverFields('backendOpenJsonFields', ['UpdateAgentDto']),
    source: 'typespec-and-local-stack-probe',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/agent-crud.test.ts',
    evidencePattern: 'updates agent',
    executablePatterns: [
      'config = { updated: makeJsonObjectValueClassPayload() }',
      'expect(body.data).toMatchObject',
      'config,',
    ],
  },
  {
    id: 'policy-open-json-value-classes',
    domainKeys: ['backendOpenJsonFields'],
    coveredFields: coverFields('backendOpenJsonFields', [
      'CreatePolicyDto',
      'EvaluateRegoDto',
    ]),
    source: 'typespec-and-local-stack-probe',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/policies.test.ts',
    evidencePattern: 'BOUNDARY_PROOF: backend open JSON fields preserve every JSON value class',
    executablePatterns: [
      'makeJsonObjectValueClassPayload()',
      'body.data.input',
      'body.data.config',
      'evaluateResponse',
    ],
  },
  {
    id: 'guardrail-open-json-value-classes',
    domainKeys: ['backendOpenJsonFields'],
    coveredFields: coverFields('backendOpenJsonFields', ['TestGuardrailDto']),
    source: 'typespec-and-local-stack-probe',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/guardrails.test.ts',
    evidencePattern: 'BOUNDARY_PROOF: TestGuardrailDto preserves every JSON value class',
    executablePatterns: [
      'makeJsonObjectValueClassPayload()',
      'raw_params',
      'raw_settings',
      'raw_logs',
    ],
  },
  {
    id: 'guardrail-persisted-open-json-value-classes',
    domainKeys: ['backendOpenJsonFields'],
    coveredFields: coverFields('backendOpenJsonFields', [
      'CreateGuardrailDto',
      'UpdateGuardrailDto',
    ]),
    source: 'typespec-and-local-stack-probe',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/guardrails.test.ts',
    evidencePattern: 'BOUNDARY_PROOF: guardrail create/update params and settings preserve every JSON value class',
    executablePatterns: [
      'makeJsonObjectValueClassPayload()',
      'createBody.data.params',
      'updateBody.data.params',
      'updateBody.data.settings',
    ],
  },
  {
    id: 'core-governance-json-value-classes',
    domainKeys: ['coreOpenJsonFields'],
    coveredFields: coverFields('coreOpenJsonFields', [
      'GovernanceEventPayload',
      'SpanData',
      'SpanEvent',
    ]),
    source: 'typespec-and-local-stack-probe',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'BOUNDARY_PROOF: core governance open JSON payload fields accept wrapped and bare JSON value classes',
    executablePatterns: [
      'makeJsonObjectValueClassPayload()',
      'makeJsonArrayValueClassPayload()',
      'activity_input',
      'span_count',
      'bareObjectInputResponse',
    ],
  },
  {
    id: 'core-governance-invalid-finite-fields',
    domainKeys: [],
    source: 'typespec',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: core governance finite event_type rejects out-of-domain values',
    executablePatterns: [
      "invalidGovernanceSpecMember('coreEventTypes')",
      'expect(response.status, testCase.label).toBeLessThan(500)',
    ],
  },
  {
    id: 'core-governance-open-string-metadata',
    domainKeys: [],
    source: 'typespec-and-local-stack-probe',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'BOUNDARY_PROOF: core governance open string metadata fields accept noncanonical values',
    executablePatterns: [
      '__noncanonical_status__',
      '__noncanonical_stage__',
      '__noncanonical_hook_type__',
      'expect(response.status).toBe(200)',
    ],
  },
  {
    id: 'remove-members-array-item-boundaries',
    domainKeys: ['backendArrayItemFields'],
    coveredFields: coverFields('backendArrayItemFields', ['RemoveMembersDto']),
    source: 'typespec-and-local-stack-probe',
    proofMode: 'boundary-local-stack-e2e',
    proofFile: 'tests/e2e/organization.test.ts',
    evidencePattern: 'BOUNDARY_PROOF: remove-members validates memberIds after local user-admin grant',
    executablePatterns: [
      "withTemporaryApiKeyPermissions(['delete:user']",
      "backendOperation('OrganizationController_removeMembers')",
      "body: { memberIds: [] }",
      "body: { memberIds: 'not-array' }",
      'length: 101',
      'expect(result.status, testCase.name).toBe(422)',
    ],
  },
];

export const BOUNDARY_CONFORMANCE_GAPS: BoundaryGap[] = [
  {
    id: 'core-governance-attempt-min-not-rejected',
    domainKeys: ['coreNumericFields'],
    operationIds: ['evaluateGovernance'],
    coveredFields: coverFields('coreNumericFields', [
      'GovernanceEventPayload',
    ]).filter((entry) => entry.fieldName === 'attempt'),
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'SEMANTIC_GAP_PROOF: core governance attempt below min is accepted by local stack',
    executablePatterns: [
      "coreOperation('evaluateGovernance')",
      'const rawAttemptConstraints = rawCoreGovernanceConstraintsFromLedger(',
      'core-governance-attempt-min-not-rejected',
      'core:evaluateGovernance:body.attempt:minimum',
      'attempt: 0',
      'expect(response.status).toBe(200)',
      "expect(response.data).toHaveProperty('verdict')",
    ],
    observedBehavior:
      'The local Core stack accepts GovernanceEventPayload.attempt=0 with a 200 governed response.',
    requiredBehavior:
      'GovernanceEventPayload.attempt has TypeSpec @minValue(1) and should reject values below 1.',
  },
  {
    id: 'core-governance-timestamp-format-not-rejected',
    domainKeys: [],
    operationIds: ['evaluateGovernance'],
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'SEMANTIC_GAP_PROOF: core governance timestamp format accepts invalid date-time values',
    executablePatterns: [
      'const rawTimestampConstraints = rawCoreGovernanceConstraintsFromLedger(',
      'core-governance-timestamp-format-not-rejected',
      'core:evaluateGovernance:body.timestamp:format',
      'timestamp: \'not-a-date-time\'',
      'expect(response.status).toBe(200)',
      "expect(response.data).toHaveProperty('verdict')",
    ],
    observedBehavior:
      'The local Core stack accepts GovernanceEventPayload.timestamp values that are not valid date-time strings.',
    requiredBehavior:
      'GovernanceEventPayload.timestamp is OpenAPI format=date-time and should reject invalid date-time strings.',
  },
  {
    id: 'core-governance-cost-type-not-rejected',
    domainKeys: [],
    operationIds: ['evaluateGovernance'],
    proofFile: 'tests/e2e/core-governance.test.ts',
    evidencePattern: 'SEMANTIC_GAP_PROOF: core governance cost accepts nonnumeric values',
    executablePatterns: [
      'const rawCostConstraints = rawCoreGovernanceConstraintsFromLedger(',
      'core-governance-cost-type-not-rejected',
      'core:evaluateGovernance:body.cost_usd:format',
      'core:evaluateGovernance:body.cost_usd:type',
      "cost_usd: 'not-a-number'",
      'expect(response.status).toBe(200)',
      "expect(response.data).toHaveProperty('verdict')",
    ],
    observedBehavior:
      'The local Core stack accepts GovernanceEventPayload.cost_usd values that are not numeric.',
    requiredBehavior:
      'GovernanceEventPayload.cost_usd is OpenAPI type=number format=double and should reject nonnumeric values.',
  },
  {
    id: 'backend-agent-evaluations-query-boundaries-not-rejected',
    domainKeys: [],
    operationIds: ['AgentController_getAgentEvaluations'],
    proofFile: 'tests/e2e/request-query-boundaries.test.ts',
    evidencePattern: 'NEGATIVE_BOUNDARY_PROOF: generated backend pagination and search query constraints reject invalid values or expose raw gaps',
    executablePatterns: [
      'RAW_SEMANTIC_GAP_OPERATIONS',
      "'AgentController_getAgentEvaluations'",
      'expectedAgentEvaluationConstraintKeys',
      'backend:AgentController_getAgentEvaluations:query.page:minimum',
      'backend:AgentController_getAgentEvaluations:query.pattern:maxLength',
      'backend:AgentController_getAgentEvaluations:query.perPage:minimum',
      'rawSemanticGapBoundaryConstraintsFromLedger()',
      'expectedBoundaryConstraintKeysFromLedger()',
      'testCase.constraintKey',
      "testCase.operationId === 'AgentController_getAgentEvaluations'",
      'semanticGapCases.every',
      'expectedBoundaryCaseCount()',
      'expect(cases).toHaveLength(expectedBoundaryCaseCount())',
    ],
    observedBehavior:
      'The local backend accepts AgentController_getAgentEvaluations page, perPage, and pattern values outside the generated OpenAPI request constraints.',
    requiredBehavior:
      'AgentController_getAgentEvaluations query.page, query.perPage, and query.pattern have generated request constraints and should reject values outside those bounds.',
  },
];

export function assertBoundaryConformanceEvidenceFiles(repoRoot = process.cwd()): void {
  for (const entry of BOUNDARY_CONFORMANCE_EVIDENCE) {
    for (const key of entry.domainKeys) {
      const domain = GOVERNANCE_BOUNDARY_DOMAINS[key];
      if (!Array.isArray(domain) || domain.length === 0) {
        throw new Error(`Boundary domain ${String(key)} is empty for ${entry.id}`);
      }
    }
    for (const field of entry.coveredFields ?? []) {
      assertBoundaryFieldExists(field, entry.id);
    }
    const source = readFileSync(resolve(repoRoot, entry.proofFile), 'utf8');
    const missingPatterns = missingExecutableEvidencePatterns(
      source,
      entry.evidencePattern,
      entry.executablePatterns,
    );
    if (missingPatterns.length > 0) {
      throw new Error(
        `Missing executable boundary evidence for ${entry.id}: ${missingPatterns.join(', ')}`,
      );
    }
  }

  for (const gap of BOUNDARY_CONFORMANCE_GAPS) {
    for (const key of gap.domainKeys) {
      const domain = GOVERNANCE_BOUNDARY_DOMAINS[key];
      if (!Array.isArray(domain) || domain.length === 0) {
        throw new Error(`Boundary gap domain ${String(key)} is empty for ${gap.id}`);
      }
    }
    for (const field of gap.coveredFields ?? []) {
      assertBoundaryFieldExists(field, gap.id);
    }
    const source = readFileSync(resolve(repoRoot, gap.proofFile), 'utf8');
    const missingPatterns = missingExecutableEvidencePatterns(
      source,
      gap.evidencePattern,
      gap.executablePatterns,
    );
    if (missingPatterns.length > 0) {
      throw new Error(
        `Missing executable boundary gap evidence for ${gap.id}: ${missingPatterns.join(', ')}`,
      );
    }
    if (gap.operationIds.length === 0) {
      throw new Error(`Boundary gap ${gap.id} must name affected operation IDs`);
    }
    if (gap.executablePatterns.length === 0) {
      throw new Error(`Boundary gap ${gap.id} lacks executable patterns`);
    }
  }
}

export function boundaryFieldCoverageKey(field: BoundaryFieldCoverage): string {
  return `${String(field.domainKey)}:${field.modelName}.${field.fieldName}`;
}

export function requiredBoundaryFieldCoverageKeys(): string[] {
  return [
    ...fieldKeys('requiredBodyFields'),
    ...fieldKeys('aivssNumericFields'),
    ...fieldKeys('goalAlignmentThresholds'),
    ...fieldKeys('behaviorRuleNumericFields'),
    ...fieldKeys('backendOpenJsonFields'),
    ...fieldKeys('coreOpenJsonFields'),
    ...fieldKeys('trustThresholdFields'),
    ...fieldKeys('backendStringLengthFields'),
    ...fieldKeys('backendArrayItemFields'),
    ...fieldKeys('backendUuidFormatFields'),
    ...fieldKeys('coreNumericFields'),
  ].sort();
}

export function evidencedBoundaryFieldCoverageKeys(): string[] {
  return [...new Set([
    ...BOUNDARY_CONFORMANCE_EVIDENCE.flatMap((entry) => entry.coveredFields ?? []),
    ...BOUNDARY_CONFORMANCE_GAPS.flatMap((entry) => entry.coveredFields ?? []),
  ].map(boundaryFieldCoverageKey))].sort();
}

function fieldKeys(domainKey: BoundaryDomainKey): string[] {
  return (GOVERNANCE_BOUNDARY_DOMAINS[domainKey] as ReadonlyArray<{
    modelName?: string;
    fieldName?: string;
  }>)
    .filter((entry) => entry.modelName && entry.fieldName)
    .map((entry) => boundaryFieldCoverageKey({
      domainKey,
      modelName: entry.modelName!,
      fieldName: entry.fieldName!,
    }));
}

function assertBoundaryFieldExists(field: BoundaryFieldCoverage, evidenceId: string): void {
  const key = boundaryFieldCoverageKey(field);
  if (!fieldKeys(field.domainKey).includes(key)) {
    throw new Error(`Boundary evidence ${evidenceId} references unknown field ${key}`);
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
