import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpenBoxClient } from '../../ts/src/client/index.js';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { OpenBoxCoreClient } from '../../ts/src/core-client/index.js';
import { CORE_ENDPOINT_MANIFEST } from '../../ts/src/core-client/generated/endpoint-manifest.js';

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
    content?: Record<string, OpenApiMedia>;
  };
  responses?: Record<string, OpenApiResponse>;
}

interface OpenApiParameter {
  name?: string;
  in?: string;
  schema?: OpenApiSchema;
}

interface OpenApiMedia {
  schema?: OpenApiSchema;
}

interface OpenApiResponse {
  content?: Record<string, OpenApiMedia>;
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
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  allOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
}

interface MockRoute {
  service: 'backend' | 'core';
  operationId: string;
  method: string;
  path: string;
  pathPattern: RegExp;
  operation: OpenApiOperation;
  response: MockResponse;
}

interface MockResponse {
  status: number;
  contentType: string | null;
  body: unknown;
}

interface CapturedRequest {
  operationId: string;
  method: string;
  path: string;
}

interface ValidationIssue {
  location: string;
  message: string;
}

interface OpenApiNegativeCase {
  id: string;
  operationId: string;
  method: string;
  path: string;
  options: {
    params?: Record<string, unknown>;
    data?: unknown;
  };
  location: string;
}

const backendOpenApi = readOpenApi('OpenboxBackend.json');
const coreOpenApi = readOpenApi('OpenboxCore.json');
const routes = [
  ...buildRoutes('backend', backendOpenApi),
  ...buildRoutes('core', coreOpenApi),
];
const routesByOperationId = new Map(routes.map((route) => [route.operationId, route]));
const negativeCases = routes.flatMap((route) =>
  openApiNegativeCasesForRoute(route, openApiForRoute(route)),
);

describe('OpenAPI mock contract suite', () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  const captured: CapturedRequest[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      void handleMockRequest(request, response, captured);
    });
    await new Promise<void>((resolveListen) => {
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolveClose();
      });
    });
  });

  it('drives every generated backend and core operation through an OpenAPI mock', async () => {
    const backend = new OpenBoxClient({
      apiUrl: baseUrl,
      apiKey: 'obx_key_openapi_mock',
      retry: { maxRetries: 0 },
      timeoutMs: 5_000,
    });
    const core = new OpenBoxCoreClient({
      apiUrl: baseUrl,
      apiKey: 'obx_test_openapi_mock',
      retry: { maxRetries: 0 },
      timeoutMs: 5_000,
    });

    for (const entry of BACKEND_ENDPOINT_MANIFEST) {
      const route = requireRoute(entry.operationId);
      const result = await backend.requestOperation(
        entry.verb.toUpperCase(),
        concretePath(route.path, route.operation, backendOpenApi),
        requestOptions(route, backendOpenApi),
      );
      expect(result, entry.operationId).toEqual(expectedClientResult(route));
    }

    for (const entry of CORE_ENDPOINT_MANIFEST) {
      const route = requireRoute(entry.operationId);
      let result: unknown;
      try {
        result = await core.requestOperation(
          entry.verb.toUpperCase(),
          concretePath(route.path, route.operation, coreOpenApi),
          requestOptions(route, coreOpenApi),
        );
      } catch (error) {
        throw new Error(`${entry.operationId} failed against OpenAPI mock: ${String(error)}`, {
          cause: error,
        });
      }
      expect(result, entry.operationId).toEqual(expectedClientResult(route));
    }

    expect(captured.map((entry) => entry.operationId).sort()).toEqual(
      [
        ...BACKEND_ENDPOINT_MANIFEST.map((entry) => entry.operationId),
        ...CORE_ENDPOINT_MANIFEST.map((entry) => entry.operationId),
      ].sort(),
    );
  }, 30_000);

  it('rejects every generated OpenAPI query and body constraint violation', async () => {
    expect(negativeCases.length).toBeGreaterThan(0);
    expect(negativeCases.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'AgentController_getPendingApprovals:query.status.enum',
        'AgentController_getApprovalHistory:query.status.enum',
        'OrganizationController_getApprovals:query.status.enum',
        'evaluateGovernance:body.attempt.minimum',
        'OrganizationController_removeMembers:body.memberIds.minItems',
        'OrganizationController_removeMembers:body.memberIds.maxItems',
      ]),
    );

    for (const testCase of negativeCases) {
      const response = await fetch(`${baseUrl}${testCase.path}`, {
        method: testCase.method,
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'obx_key_openapi_mock',
          authorization: 'Bearer obx_test_openapi_mock',
        },
        body: testCase.options.data === undefined
          ? undefined
          : JSON.stringify(testCase.options.data),
      });
      const body = await response.json() as {
        status?: number;
        error?: string;
        issues?: ValidationIssue[];
      };

      expect(response.status, testCase.id).toBe(422);
      expect(body.status, testCase.id).toBe(422);
      expect(body.error, testCase.id).toBe('OpenAPI request validation failed');
      expect(
        body.issues?.some((issue) => issue.location === testCase.location),
        testCase.id,
      ).toBe(true);
    }
  }, 30_000);
});

async function handleMockRequest(
  request: IncomingMessage,
  response: ServerResponse,
  captured: CapturedRequest[],
): Promise<void> {
  const method = request.method?.toUpperCase() ?? 'GET';
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  const path = requestUrl.pathname;
  const route = routes.find(
    (entry) => entry.method === method && entry.pathPattern.test(path),
  );
  if (!route) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: `No mock route for ${method} ${path}` } }));
    return;
  }

  const issues = await validateMockRequest(route, requestUrl, request);
  if (issues.length > 0) {
    response.writeHead(422, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      status: 422,
      error: 'OpenAPI request validation failed',
      issues,
    }));
    return;
  }

  captured.push({ operationId: route.operationId, method, path });
  if (route.response.status === 204) {
    response.writeHead(204);
    response.end();
    return;
  }
  const headers = route.response.contentType
    ? { 'content-type': route.response.contentType }
    : {};
  response.writeHead(route.response.status, headers);
  response.end(
    route.response.contentType?.includes('application/json')
      ? JSON.stringify(route.response.body)
      : String(route.response.body ?? ''),
  );
}

function buildRoutes(
  service: MockRoute['service'],
  openApi: OpenApiDocument,
): MockRoute[] {
  const out: MockRoute[] = [];
  for (const [path, item] of Object.entries(openApi.paths ?? {})) {
    for (const [method, operation] of Object.entries(item)) {
      if (!operation.operationId || !['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
        continue;
      }
      out.push({
        service,
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        pathPattern: new RegExp(pathPattern(path)),
        operation,
        response: responseForOperation(operation, openApi),
      });
    }
  }
  return out;
}

function requestOptions(
  route: MockRoute,
  openApi: OpenApiDocument,
): { params?: Record<string, unknown>; data?: unknown } {
  const params = queryParamsFor(route.operation, openApi);
  const data = requestBodyFor(route.operation, openApi);
  return {
    ...(Object.keys(params).length > 0 ? { params } : {}),
    ...(data !== undefined ? { data } : {}),
  };
}

function queryParamsFor(
  operation: OpenApiOperation,
  openApi: OpenApiDocument,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const parameter of operation.parameters ?? []) {
    if (parameter.in !== 'query' || !parameter.name || !parameter.schema) continue;
    params[parameter.name] = sampleForSchema(resolveSchema(parameter.schema, openApi), openApi);
  }
  return params;
}

function requestBodyFor(operation: OpenApiOperation, openApi: OpenApiDocument): unknown {
  const schema = operation.requestBody?.content?.['application/json']?.schema;
  return schema ? sampleForSchema(resolveSchema(schema, openApi), openApi) : undefined;
}

function responseForOperation(
  operation: OpenApiOperation,
  openApi: OpenApiDocument,
): MockResponse {
  const [status, response] = firstSuccessResponse(operation);
  const content = response?.content ?? {};
  const contentType =
    Object.keys(content).find((entry) => entry.includes('application/json')) ??
    Object.keys(content)[0] ??
    null;
  const schema = contentType ? content[contentType]?.schema : undefined;
  return {
    status,
    contentType,
    body: schema ? sampleForSchema(resolveSchema(schema, openApi), openApi) : '',
  };
}

async function validateMockRequest(
  route: MockRoute,
  requestUrl: URL,
  request: IncomingMessage,
): Promise<ValidationIssue[]> {
  const openApi = openApiForRoute(route);
  const issues: ValidationIssue[] = [];

  for (const parameter of route.operation.parameters ?? []) {
    if (parameter.in !== 'query' || !parameter.name || !parameter.schema) continue;
    const values = requestUrl.searchParams.getAll(parameter.name);
    if (values.length === 0) continue;
    const schema = resolveSchema(parameter.schema, openApi);
    const value = schema.type === 'array' ? values : values[values.length - 1];
    issues.push(...validateValue(value, schema, openApi, `query.${parameter.name}`, true));
  }

  const schema = route.operation.requestBody?.content?.['application/json']?.schema;
  if (schema) {
    const body = await readJsonBody(request);
    issues.push(...validateValue(body, resolveSchema(schema, openApi), openApi, 'body', false));
  }

  return issues;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function validateValue(
  value: unknown,
  schema: OpenApiSchema,
  openApi: OpenApiDocument,
  location: string,
  fromQuery: boolean,
): ValidationIssue[] {
  const resolved = resolveSchema(schema, openApi);
  if (resolved.allOf?.length) {
    return resolved.allOf.flatMap((entry) =>
      validateValue(value, entry, openApi, location, fromQuery),
    );
  }
  if (resolved.oneOf?.length || resolved.anyOf?.length) {
    const variants = resolved.oneOf ?? resolved.anyOf ?? [];
    const variantIssues = variants.map((entry) =>
      validateValue(value, entry, openApi, location, fromQuery),
    );
    return variantIssues.some((entry) => entry.length === 0)
      ? []
      : variantIssues[0] ?? [];
  }

  const issues: ValidationIssue[] = [];
  const comparable = fromQuery && typeof value === 'string' ? coerceQueryValue(value, resolved) : value;

  if (
    resolved.enum?.length &&
    !resolved.enum.some((entry) => String(entry) === String(comparable))
  ) {
    issues.push({
      location,
      message: `must be one of ${resolved.enum.map(String).join(', ')}`,
    });
  }

  if (resolved.type === 'array') {
    if (!Array.isArray(value)) {
      issues.push({ location, message: 'must be an array' });
      return issues;
    }
    if (resolved.minItems !== undefined && value.length < resolved.minItems) {
      issues.push({ location, message: `must contain at least ${resolved.minItems} item(s)` });
    }
    if (resolved.maxItems !== undefined && value.length > resolved.maxItems) {
      issues.push({ location, message: `must contain at most ${resolved.maxItems} item(s)` });
    }
    for (const [index, item] of value.entries()) {
      issues.push(...validateValue(
        item,
        resolved.items ?? { type: 'string' },
        openApi,
        `${location}.${index}`,
        fromQuery,
      ));
    }
    return issues;
  }

  if (resolved.type === 'object' || resolved.properties) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      issues.push({ location, message: 'must be an object' });
      return issues;
    }
    const object = value as Record<string, unknown>;
    for (const field of resolved.required ?? []) {
      if (!(field in object)) {
        issues.push({ location: `${location}.${field}`, message: 'is required' });
      }
    }
    for (const [key, property] of Object.entries(resolved.properties ?? {})) {
      if (key in object) {
        issues.push(...validateValue(object[key], property, openApi, `${location}.${key}`, fromQuery));
      }
    }
    return issues;
  }

  if (resolved.type === 'integer' || resolved.type === 'number') {
    const numberValue = typeof comparable === 'number' ? comparable : Number(comparable);
    if (!Number.isFinite(numberValue)) {
      issues.push({ location, message: 'must be a number' });
      return issues;
    }
    if (resolved.type === 'integer' && !Number.isInteger(numberValue)) {
      issues.push({ location, message: 'must be an integer' });
    }
    if (resolved.minimum !== undefined && numberValue < resolved.minimum) {
      issues.push({ location, message: `must be >= ${resolved.minimum}` });
    }
    if (resolved.maximum !== undefined && numberValue > resolved.maximum) {
      issues.push({ location, message: `must be <= ${resolved.maximum}` });
    }
    return issues;
  }

  if (resolved.type === 'string' || resolved.format) {
    if (typeof comparable !== 'string') {
      issues.push({ location, message: 'must be a string' });
      return issues;
    }
    if (resolved.maxLength !== undefined && comparable.length > resolved.maxLength) {
      issues.push({ location, message: `must be <= ${resolved.maxLength} character(s)` });
    }
    if (
      resolved.format === 'uuid' &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(comparable)
    ) {
      issues.push({ location, message: 'must be a uuid' });
    }
  }

  return issues;
}

function coerceQueryValue(value: string, schema: OpenApiSchema): unknown {
  if (schema.type === 'integer' || schema.type === 'number') return Number(value);
  if (schema.type === 'boolean') return value === 'true' ? true : value === 'false' ? false : value;
  return value;
}

function firstSuccessResponse(operation: OpenApiOperation): readonly [number, OpenApiResponse | undefined] {
  const responses = Object.entries(operation.responses ?? {})
    .map(([status, response]) => [Number(status), response] as const)
    .filter(([status]) => status >= 200 && status < 300)
    .sort(([left], [right]) => left - right);
  return responses[0] ?? [200, undefined];
}

function expectedClientResult(route: MockRoute): unknown {
  if (route.response.status === 204) return '';
  if (!route.response.contentType?.includes('application/json')) return String(route.response.body ?? '');
  if (
    route.service === 'backend' &&
    route.response.body &&
    typeof route.response.body === 'object' &&
    'data' in route.response.body
  ) {
    return (route.response.body as Record<string, unknown>).data;
  }
  return route.response.body;
}

function sampleForSchema(
  schema: OpenApiSchema,
  openApi: OpenApiDocument,
  seen = new Set<string>(),
): unknown {
  if (schema.$ref && seen.has(schema.$ref)) return {};
  const resolved = resolveSchema(schema, openApi, seen);
  if (resolved.$ref) return {};
  if (resolved.enum?.length) return resolved.enum[0];
  if (resolved.allOf?.length) {
    return Object.assign(
      {},
      ...resolved.allOf.map((entry) => sampleForSchema(entry, openApi, new Set(seen))),
    );
  }
  if (resolved.oneOf?.length) return sampleForSchema(resolved.oneOf[0], openApi, new Set(seen));
  if (resolved.anyOf?.length) return sampleForSchema(resolved.anyOf[0], openApi, new Set(seen));

  if (resolved.type === 'array') {
    const length = Math.max(1, resolved.minItems ?? 1);
    return Array.from({ length }, () =>
      sampleForSchema(resolved.items ?? { type: 'string' }, openApi, new Set(seen)),
    );
  }
  if (resolved.type === 'object' || resolved.properties) {
    const required = new Set(resolved.required ?? []);
    return Object.fromEntries(
      Object.entries(resolved.properties ?? {})
        .filter(([key, property]) => !property.$ref || !seen.has(property.$ref) || required.has(key))
        .map(([key, property]) => [
          key,
          sampleForSchema(property, openApi, new Set(seen)),
        ]),
    );
  }
  if (resolved.type === 'integer') return Math.max(1, resolved.minimum ?? 1);
  if (resolved.type === 'number') return Math.max(1, resolved.minimum ?? 1);
  if (resolved.type === 'boolean') return true;
  if (resolved.format === 'uuid') return '00000000-0000-4000-8000-000000000000';
  if (resolved.format === 'date-time') return '2026-06-21T00:00:00.000Z';
  return 'openapi-mock';
}

function openApiNegativeCasesForRoute(
  route: MockRoute,
  openApi: OpenApiDocument,
): OpenApiNegativeCase[] {
  const cases: OpenApiNegativeCase[] = [];
  const basePath = concretePath(route.path, route.operation, openApi);
  const baseOptions = requestOptions(route, openApi);

  for (const parameter of route.operation.parameters ?? []) {
    if (parameter.in !== 'query' || !parameter.name || !parameter.schema) continue;
    const schema = resolveSchema(parameter.schema, openApi);
    for (const testCase of invalidScalarSamples(schema)) {
      cases.push({
        id: `${route.operationId}:query.${parameter.name}.${testCase.kind}`,
        operationId: route.operationId,
        method: route.method,
        path: appendQuery(basePath, {
          ...(baseOptions.params ?? {}),
          [parameter.name]: testCase.value,
        }),
        options: { data: baseOptions.data },
        location: `query.${parameter.name}`,
      });
    }
  }

  const bodySchema = route.operation.requestBody?.content?.['application/json']?.schema;
  if (bodySchema) {
    for (const testCase of invalidBodyCases(resolveSchema(bodySchema, openApi), openApi)) {
      cases.push({
        id: `${route.operationId}:${testCase.location}.${testCase.kind}`,
        operationId: route.operationId,
        method: route.method,
        path: appendQuery(basePath, baseOptions.params ?? {}),
        options: {
          data: replaceAtPath(
            sampleForSchema(resolveSchema(bodySchema, openApi), openApi),
            testCase.path,
            testCase.value,
          ),
        },
        location: testCase.location,
      });
    }
  }

  return cases;
}

function invalidBodyCases(
  schema: OpenApiSchema,
  openApi: OpenApiDocument,
  path: string[] = [],
  seen = new Set<string>(),
): Array<{ location: string; path: string[]; kind: string; value: unknown }> {
  if (path.length > 8) return [];
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return [];
    seen.add(schema.$ref);
  }
  const resolved = resolveSchema(schema, openApi);
  if (resolved.allOf?.length) {
    return resolved.allOf.flatMap((entry) =>
      invalidBodyCases(entry, openApi, path, new Set(seen)),
    );
  }
  if (resolved.oneOf?.length) return invalidBodyCases(resolved.oneOf[0], openApi, path, new Set(seen));
  if (resolved.anyOf?.length) return invalidBodyCases(resolved.anyOf[0], openApi, path, new Set(seen));

  const location = `body${path.length ? `.${path.join('.')}` : ''}`;
  const cases = invalidScalarSamples(resolved).map((entry) => ({
    location,
    path,
    kind: entry.kind,
    value: entry.value,
  }));

  if (resolved.type === 'array') {
    if (resolved.minItems !== undefined) {
      cases.push({
        location,
        path,
        kind: 'minItems',
        value: Array.from({ length: Math.max(0, resolved.minItems - 1) }, () =>
          sampleForSchema(resolved.items ?? { type: 'string' }, openApi),
        ),
      });
    }
    if (resolved.maxItems !== undefined) {
      cases.push({
        location,
        path,
        kind: 'maxItems',
        value: Array.from({ length: resolved.maxItems + 1 }, () =>
          sampleForSchema(resolved.items ?? { type: 'string' }, openApi),
        ),
      });
    }
  }

  if (resolved.properties) {
    for (const [key, property] of Object.entries(resolved.properties)) {
      cases.push(...invalidBodyCases(property, openApi, [...path, key], new Set(seen)));
    }
  }

  return cases;
}

function invalidScalarSamples(schema: OpenApiSchema): Array<{ kind: string; value: unknown }> {
  const samples: Array<{ kind: string; value: unknown }> = [];
  if (schema.enum?.length) {
    samples.push({ kind: 'enum', value: '__openapi_invalid_enum__' });
  }
  if (schema.type === 'integer') {
    samples.push({ kind: 'integer', value: schema.minimum !== undefined ? schema.minimum + 0.5 : 1.5 });
  }
  if (schema.minimum !== undefined) {
    samples.push({ kind: 'minimum', value: schema.minimum - 1 });
  }
  if (schema.maximum !== undefined) {
    samples.push({ kind: 'maximum', value: schema.maximum + 1 });
  }
  if (schema.maxLength !== undefined) {
    samples.push({ kind: 'maxLength', value: 'x'.repeat(schema.maxLength + 1) });
  }
  if (schema.format === 'uuid') {
    samples.push({ kind: 'uuid', value: 'not-a-uuid' });
  }
  return samples;
}

function replaceAtPath(value: unknown, path: string[], replacement: unknown): unknown {
  if (path.length === 0) return replacement;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const [head, ...tail] = path;
  return {
    ...(value as Record<string, unknown>),
    [head]: replaceAtPath((value as Record<string, unknown>)[head], tail, replacement),
  };
}

function appendQuery(path: string, params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) searchParams.append(key, String(item));
    } else {
      searchParams.append(key, String(value));
    }
  }
  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

function openApiForRoute(route: MockRoute): OpenApiDocument {
  return route.service === 'backend' ? backendOpenApi : coreOpenApi;
}

function resolveSchema(
  schema: OpenApiSchema,
  openApi: OpenApiDocument,
  seen = new Set<string>(),
): OpenApiSchema {
  if (!schema.$ref) return schema;
  if (seen.has(schema.$ref)) return {};
  seen.add(schema.$ref);
  const prefix = '#/components/schemas/';
  if (!schema.$ref.startsWith(prefix)) return schema;
  const resolved = openApi.components?.schemas?.[schema.$ref.slice(prefix.length)];
  return resolved ? resolveSchema(resolved, openApi, seen) : schema;
}

function concretePath(path: string, operation: OpenApiOperation, openApi: OpenApiDocument): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const parameter = operation.parameters?.find(
      (entry) => entry.in === 'path' && entry.name === name,
    );
    return encodeURIComponent(
      String(sampleForSchema(resolveSchema(parameter?.schema ?? { type: 'string' }, openApi), openApi)),
    );
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

function requireRoute(operationId: string): MockRoute {
  const route = routesByOperationId.get(operationId);
  if (!route) throw new Error(`Missing OpenAPI mock route for ${operationId}`);
  return route;
}

function readOpenApi(file: string): OpenApiDocument {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'specs/generated/openapi3', file), 'utf8')) as OpenApiDocument;
}
