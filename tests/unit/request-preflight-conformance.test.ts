import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REQUEST_PREFLIGHT_RULES as BACKEND_REQUEST_PREFLIGHT_RULES,
  validateBackendRequest,
} from '../../ts/src/client/generated/request-preflight.js';
import {
  REQUEST_PREFLIGHT_RULES as CORE_REQUEST_PREFLIGHT_RULES,
  validateCoreRequest,
} from '../../ts/src/core-client/generated/request-preflight.js';
import {
  buildRequestConstraintConformance,
} from '../helpers/request-constraint-conformance';

interface OpenApiDocument {
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
  };
}

interface OpenApiOperation {
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, { schema?: OpenApiSchema }>;
  };
}

interface OpenApiParameter {
  name?: string;
  in?: string;
  schema?: OpenApiSchema;
}

interface OpenApiSchema {
  $ref?: string;
  type?: string;
  format?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  maxLength?: number;
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  allOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
}

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
  method: string;
  path: string;
  pathPattern: string;
  query?: readonly QueryRule[];
  body?: readonly BodyRule[];
}

type ScalarRule = Omit<BodyRule, 'path'>;

type ValidateRequest = (
  method: string,
  path: string,
  query?: Record<string, unknown>,
  body?: unknown,
) => void;

type CaseKind =
  | 'arrayType'
  | 'enum'
  | 'enumMember'
  | 'format'
  | 'integer'
  | 'maxItems'
  | 'maxLength'
  | 'maximum'
  | 'minItems'
  | 'minimum'
  | 'type'
  | 'valid';

type CaseCounts = Record<CaseKind, number>;

const CASE_KINDS: CaseKind[] = [
  'arrayType',
  'enum',
  'enumMember',
  'format',
  'integer',
  'maxItems',
  'maxLength',
  'maximum',
  'minItems',
  'minimum',
  'type',
  'valid',
];

describe('generated request preflight conformance', () => {
  it('matches every OpenAPI-derived request constraint exactly', () => {
    expect(normalizeRules(BACKEND_REQUEST_PREFLIGHT_RULES)).toEqual(
      extractRequestRules('specs/generated/openapi3/OpenboxBackend.json'),
    );
    expect(normalizeRules(CORE_REQUEST_PREFLIGHT_RULES)).toEqual(
      extractRequestRules('specs/generated/openapi3/OpenboxCore.json'),
    );
  });

  it('exercises every emitted backend preflight constraint with generated invalid cases', () => {
    const result = exerciseRules(BACKEND_REQUEST_PREFLIGHT_RULES, validateBackendRequest);
    expect(result.ruleCount).toBe(BACKEND_REQUEST_PREFLIGHT_RULES.length);
    expect(result.caseCounts).toEqual(expectedCaseCounts(BACKEND_REQUEST_PREFLIGHT_RULES));
    expect(result.caseCounts.enum).toBeGreaterThan(0);
    expect(result.caseCounts.enumMember).toBeGreaterThan(result.caseCounts.enum);
    expect(result.caseCounts.minimum).toBeGreaterThan(0);
    expect(result.caseCounts.maxLength).toBeGreaterThan(0);
    expect(result.caseCounts.minItems).toBeGreaterThan(0);
    expect(result.caseCounts.arrayType).toBeGreaterThan(0);
    expect(result.caseCounts.type).toBeGreaterThan(0);
  });

  it('exercises every emitted core preflight constraint with generated invalid cases', () => {
    const result = exerciseRules(CORE_REQUEST_PREFLIGHT_RULES, validateCoreRequest);
    expect(result.ruleCount).toBe(1);
    expect(result.caseCounts).toEqual(expectedCaseCounts(CORE_REQUEST_PREFLIGHT_RULES));
    expect(result.caseCounts.enumMember).toBeGreaterThan(result.caseCounts.enum);
    expect(result.caseCounts.enum).toBeGreaterThan(0);
    expect(result.caseCounts.integer).toBeGreaterThan(0);
    expect(result.caseCounts.minimum).toBeGreaterThan(0);
    expect(result.caseCounts.format).toBeGreaterThan(0);
    expect(result.caseCounts.type).toBeGreaterThan(0);
  });

  it('has no raw semantic gap closure constraints after backend/Core validation closure', () => {
    const ledger = buildRequestConstraintConformance();
    const rawGapConstraints = ledger.constraints.filter(
      (entry) => entry.disposition === 'raw-semantic-gap-sdk-closed',
    );

    expect(ledger.summary.missingRawSemanticGapClosures).toEqual([]);
    expect(ledger.summary.provenRawSemanticGapClosures).toEqual(
      ledger.summary.knownRawSemanticGaps,
    );
    expect(rawGapConstraints).toEqual([]);
  });
});

function exerciseRules(rules: readonly RequestRule[], validate: ValidateRequest) {
  const caseCounts = emptyCaseCounts();

  for (const rule of normalizeRules(rules)) {
    for (const queryRule of rule.query ?? []) {
      for (const valid of validValues(queryRule)) {
        validate(rule.method, concretePath(rule.path), { [queryRule.name]: valid });
        caseCounts.valid++;
        if (queryRule.enum) caseCounts.enumMember++;
      }
      for (const testCase of invalidCases(queryRule)) {
        caseCounts[testCase.kind]++;
        expect(
          () => validate(rule.method, concretePath(rule.path), { [queryRule.name]: testCase.value }),
          `${rule.operationId} query.${queryRule.name} ${testCase.kind}`,
        ).toThrow(/RequestPreflightError|must /);
      }
    }

    for (const bodyRule of rule.body ?? []) {
      for (const valid of validValues(bodyRule)) {
        const validBody = bodyWithPathValue(bodyRule.path, valid);
        validate(rule.method, concretePath(rule.path), undefined, validBody);
        caseCounts.valid++;
        if (bodyRule.enum) caseCounts.enumMember++;
      }
      for (const testCase of invalidCases(bodyRule, {
        includeArrayType: true,
        includeBodyType: true,
      })) {
        caseCounts[testCase.kind]++;
        expect(
          () => validate(
            rule.method,
            concretePath(rule.path),
            undefined,
            bodyWithPathValue(bodyRule.path, testCase.value),
          ),
          `${rule.operationId} body.${bodyRule.path.join('.')} ${testCase.kind}`,
        ).toThrow(/RequestPreflightError|must /);
      }
    }
  }

  return { ruleCount: rules.length, caseCounts };
}

function expectedCaseCounts(rules: readonly RequestRule[]): CaseCounts {
  const caseCounts = emptyCaseCounts();
  for (const rule of normalizeRules(rules)) {
    for (const queryRule of rule.query ?? []) {
      const valid = validValues(queryRule);
      caseCounts.valid += valid.length;
      if (queryRule.enum) caseCounts.enumMember += valid.length;
      for (const testCase of invalidCases(queryRule)) {
        caseCounts[testCase.kind]++;
      }
    }
    for (const bodyRule of rule.body ?? []) {
      const valid = validValues(bodyRule);
      caseCounts.valid += valid.length;
      if (bodyRule.enum) caseCounts.enumMember += valid.length;
      for (const testCase of invalidCases(bodyRule, {
        includeArrayType: true,
        includeBodyType: true,
      })) {
        caseCounts[testCase.kind]++;
      }
    }
  }
  return caseCounts;
}

function emptyCaseCounts(): CaseCounts {
  return Object.fromEntries(CASE_KINDS.map((kind) => [kind, 0])) as CaseCounts;
}

function invalidCases(
  rule: ScalarRule,
  opts: { includeArrayType?: boolean; includeBodyType?: boolean } = {},
): Array<{ kind: Exclude<CaseKind, 'enumMember' | 'valid'>; value: unknown }> {
  const cases: Array<{ kind: Exclude<CaseKind, 'enumMember' | 'valid'>; value: unknown }> = [];
  if (opts.includeArrayType && (rule.minItems !== undefined || rule.maxItems !== undefined)) {
    cases.push({ kind: 'arrayType', value: 'not-an-array' });
  }
  if (opts.includeBodyType && rule.type === 'string') {
    cases.push({ kind: 'type', value: 42 });
  }
  if (opts.includeBodyType && (rule.type === 'number' || rule.type === 'integer')) {
    cases.push({ kind: 'type', value: 'not-a-number' });
  }
  if (rule.enum) cases.push({ kind: 'enum', value: '__openbox_invalid_enum__' });
  if (rule.format === 'uuid') cases.push({ kind: 'format', value: 'not-a-uuid' });
  if (rule.format === 'date-time') cases.push({ kind: 'format', value: 'not-a-date-time' });
  if (rule.integer) cases.push({ kind: 'integer', value: fractionalWithinRange(rule) });
  if (rule.minimum !== undefined) cases.push({ kind: 'minimum', value: rule.minimum - 1 });
  if (rule.maximum !== undefined) cases.push({ kind: 'maximum', value: rule.maximum + 1 });
  if (rule.maxLength !== undefined) cases.push({ kind: 'maxLength', value: 'x'.repeat(rule.maxLength + 1) });
  if (rule.minItems !== undefined) {
    cases.push({ kind: 'minItems', value: Array.from({ length: Math.max(0, rule.minItems - 1) }, () => 'item') });
  }
  if (rule.maxItems !== undefined) {
    cases.push({ kind: 'maxItems', value: Array.from({ length: rule.maxItems + 1 }, (_, index) => `item-${index}`) });
  }
  return cases;
}

function validValues(rule: ScalarRule): unknown[] {
  if (rule.enum) return [...rule.enum];
  if (rule.minItems !== undefined || rule.maxItems !== undefined) {
    return uniqueValues([
      ...(rule.minItems !== undefined
        ? [Array.from({ length: rule.minItems }, (_, index) => `item-${index}`)]
        : []),
      ...(rule.maxItems !== undefined
        ? [Array.from({ length: rule.maxItems }, (_, index) => `item-${index}`)]
        : []),
    ]);
  }
  const values: unknown[] = [];
  if (rule.format === 'uuid') values.push('00000000-0000-4000-8000-000000000000');
  if (rule.format === 'date-time') values.push('2026-06-21T00:00:00.000Z');
  if (rule.minimum !== undefined) values.push(rule.integer ? Math.trunc(rule.minimum) : rule.minimum);
  if (rule.maximum !== undefined) values.push(rule.integer ? Math.trunc(rule.maximum) : rule.maximum);
  if (rule.integer && values.length === 0) values.push(1);
  if (rule.type === 'number' && values.length === 0) values.push(0);
  if (rule.maxLength !== undefined) values.push('x'.repeat(rule.maxLength));
  if (values.length === 0) values.push('valid');
  return uniqueValues(values);
}

function uniqueValues(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function fractionalWithinRange(rule: ScalarRule): number {
  const min = rule.minimum ?? 0;
  const candidate = min + 0.5;
  if (rule.maximum !== undefined && candidate > rule.maximum) return rule.maximum - 0.5;
  return candidate;
}

function bodyWithPathValue(path: readonly string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...tail] = path;
  if (head === '*') return [bodyWithPathValue(tail, value)];
  return { [head]: bodyWithPathValue(tail, value) };
}

function concretePath(path: string): string {
  return path.replace(/\{[^}]+\}/g, 'value');
}

function ruleFor(rules: RequestRule[], operationId: string): RequestRule | undefined {
  return rules.find((entry) => entry.operationId === operationId);
}

function extractRequestRules(openApiRelPath: string): RequestRule[] {
  const openApi = JSON.parse(
    readFileSync(resolve(process.cwd(), openApiRelPath), 'utf8'),
  ) as OpenApiDocument;
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
  const out: RequestRule[] = [];
  for (const [path, item] of Object.entries(openApi.paths ?? {})) {
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method) || !operation.operationId) continue;
      const query = collectQueryRules(operation.parameters ?? [], openApi);
      const bodySchema = operation.requestBody?.content?.['application/json']?.schema;
      const body = bodySchema ? collectBodyRules(resolveSchema(bodySchema, openApi), openApi, []) : [];
      if (query.length === 0 && body.length === 0) continue;
      out.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        pathPattern: pathPattern(path),
        query: query.length > 0 ? query : undefined,
        body: body.length > 0 ? body : undefined,
      });
    }
  }
  return normalizeRules(out);
}

function collectQueryRules(parameters: OpenApiParameter[], openApi: OpenApiDocument): QueryRule[] {
  return parameters
    .filter((parameter) => parameter.in === 'query' && parameter.name && parameter.schema)
    .map((parameter) => {
      const constraints = constraintsFromSchema(resolveSchema(parameter.schema!, openApi));
      return constraints ? { name: parameter.name!, ...constraints } : null;
    })
    .filter((entry): entry is QueryRule => Boolean(entry))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function collectBodyRules(
  schema: OpenApiSchema,
  openApi: OpenApiDocument,
  path: string[],
  seen = new Set<string>(),
): BodyRule[] {
  const resolved = resolveSchema(schema, openApi, seen);
  const out: BodyRule[] = [];
  const constraints = constraintsFromSchema(resolved);
  if (path.length > 0 && constraints) out.push({ path, ...constraints });
  for (const branch of [
    ...(resolved.allOf ?? []),
    ...(resolved.oneOf ?? []),
    ...(resolved.anyOf ?? []),
  ]) {
    out.push(...collectBodyRules(branch, openApi, path, new Set(seen)));
  }
  for (const [key, property] of Object.entries(resolved.properties ?? {})) {
    out.push(...collectBodyRules(property, openApi, [...path, key], new Set(seen)));
  }
  if (resolved.items && path.length > 0) {
    out.push(...collectBodyRules(resolved.items, openApi, [...path, '*'], new Set(seen)));
  }
  return out;
}

function constraintsFromSchema(schema: OpenApiSchema): Omit<BodyRule, 'path'> | null {
  const enumValues = (schema.enum ?? [])
    .filter((value): value is string => typeof value === 'string');
  const hasConstraint =
    Boolean(schema.format) ||
    enumValues.length > 0 ||
    typeof schema.minimum === 'number' ||
    typeof schema.maximum === 'number' ||
    typeof schema.maxLength === 'number' ||
    typeof schema.minItems === 'number' ||
    typeof schema.maxItems === 'number' ||
    schema.type === 'integer';
  if (!hasConstraint) return null;
  const out: Omit<BodyRule, 'path'> = {};
  if (schema.type) out.type = schema.type;
  if (schema.format) out.format = schema.format;
  if (enumValues.length > 0) out.enum = enumValues;
  if (typeof schema.minimum === 'number') out.minimum = schema.minimum;
  if (typeof schema.maximum === 'number') out.maximum = schema.maximum;
  if (typeof schema.maxLength === 'number') out.maxLength = schema.maxLength;
  if (typeof schema.minItems === 'number') out.minItems = schema.minItems;
  if (typeof schema.maxItems === 'number') out.maxItems = schema.maxItems;
  if (schema.type === 'integer') out.integer = true;
  return out;
}

function resolveSchema(
  schema: OpenApiSchema,
  openApi: OpenApiDocument,
  seen = new Set<string>(),
): OpenApiSchema {
  if (!schema.$ref) return schema;
  if (seen.has(schema.$ref)) return schema;
  seen.add(schema.$ref);
  const prefix = '#/components/schemas/';
  if (!schema.$ref.startsWith(prefix)) return schema;
  const resolved = openApi.components?.schemas?.[schema.$ref.slice(prefix.length)];
  return resolved ? resolveSchema(resolved, openApi, seen) : schema;
}

function normalizeRules(rules: readonly RequestRule[]): RequestRule[] {
  return rules
    .map((rule) => ({
      ...rule,
      query: rule.query ? [...rule.query].sort((left, right) => left.name.localeCompare(right.name)) : undefined,
      body: rule.body ? [...rule.body].sort((left, right) => left.path.join('.').localeCompare(right.path.join('.'))) : undefined,
    }))
    .sort((left, right) => {
      const byOperation = left.operationId.localeCompare(right.operationId);
      return byOperation !== 0 ? byOperation : left.method.localeCompare(right.method);
    });
}

function pathPattern(path: string): string {
  return `^${path
    .split(/(\{[^}]+\})/g)
    .map((part) =>
      part.startsWith('{') && part.endsWith('}')
        ? '[^/]+'
        : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('')}$`;
}
