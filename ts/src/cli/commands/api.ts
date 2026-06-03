import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { BACKEND_ENDPOINT_MANIFEST } from '../../client/generated/endpoint-manifest.js';
import type { OpenBoxClient } from '../../client/index.js';
import { CORE_ENDPOINT_MANIFEST } from '../../core-client/generated/endpoint-manifest.js';
import type { OpenBoxCoreClient } from '../../core-client/index.js';
import { getClient, getCoreClient } from '../config.js';
import { EXIT, bailWith, exitCodeForStatus } from '../exit-codes.js';
import { error, output, outputList } from '../output.js';

type ServiceName = 'backend' | 'core';
type ManifestEntry =
  | (typeof BACKEND_ENDPOINT_MANIFEST)[number]
  | (typeof CORE_ENDPOINT_MANIFEST)[number];

interface ApiCallOptions {
  params?: string;
  query?: string;
  body?: string;
}

function manifestFor(service: ServiceName): readonly ManifestEntry[] {
  return service === 'backend' ? BACKEND_ENDPOINT_MANIFEST : CORE_ENDPOINT_MANIFEST;
}

export function resolveOperation(service: ServiceName, operationId: string): ManifestEntry {
  const operation = manifestFor(service).find((entry) => entry.operationId === operationId);
  if (!operation) {
    throw new Error(`unknown ${service} operationId: ${operationId}`);
  }
  return operation;
}

export function parseJsonOption(raw: string | undefined, label: string): unknown {
  if (!raw) return undefined;
  const input = raw.startsWith('@') ? readFileSync(raw.slice(1), 'utf-8') : raw;
  try {
    return JSON.parse(input) as unknown;
  } catch (err) {
    throw new Error(`${label} must be valid JSON: ${String((err as Error).message ?? err)}`);
  }
}

export function renderOperationPath(
  template: string,
  params: Record<string, unknown> | undefined,
): string {
  return template.replace(/\{([^}]+)\}/g, (_, rawName: string) => {
    const name = rawName.trim();
    const value = params?.[name];
    if (value === undefined || value === null || value === '') {
      throw new Error(`missing path param '${name}'`);
    }
    return encodeURIComponent(String(value));
  });
}

function appendQuery(url: URL, query: unknown): void {
  if (query === undefined) return;
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw new Error('--query must be a JSON object');
  }
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

export function buildOperationUrl(
  baseUrl: string,
  operation: ManifestEntry,
  params?: Record<string, unknown>,
  query?: unknown,
): string {
  const pathname = renderOperationPath(operation.path, params);
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(pathname.replace(/^\//, ''), base);
  appendQuery(url, query);
  return url.toString();
}

function parseObjectOption(raw: string | undefined, label: string): Record<string, unknown> | undefined {
  const parsed = parseJsonOption(raw, label);
  if (parsed === undefined) return undefined;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

async function callOperation(
  service: ServiceName,
  operationId: string,
  options: ApiCallOptions,
  client: OpenBoxClient | OpenBoxCoreClient,
): Promise<void> {
  let operation: ManifestEntry;
  let params: Record<string, unknown> | undefined;
  let query: Record<string, unknown> | undefined;
  let body: unknown;
  try {
    operation = resolveOperation(service, operationId);
    params = parseObjectOption(options.params, '--params');
    query = parseObjectOption(options.query, '--query');
    body = parseJsonOption(options.body, '--body');
  } catch (err) {
    error(String((err as Error).message ?? err));
    bailWith(EXIT.USAGE);
  }

  try {
    const path = renderOperationPath(operation.path, params);
    const data = await client.requestOperation(operation.verb.toUpperCase(), path, {
      params: query,
      data: body,
    });
    output(data ?? null);
  } catch (err) {
    const status = typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : undefined;
    const bodyDetail = (err as { body?: unknown }).body;
    error(String((err as Error).message ?? err), {
      detail: bodyDetail === undefined ? undefined : JSON.stringify(bodyDetail),
    });
    bailWith(status ? exitCodeForStatus(status) : EXIT.NETWORK);
  }
}

function listOperations(service: ServiceName): void {
  const entries = manifestFor(service).map((entry) => ({
    operationId: entry.operationId,
    verb: entry.verb,
    path: entry.path,
  }));
  outputList(entries, `${service} operations`);
}

export function registerApiCommands(program: Command): void {
  const api = program
    .command('api')
    .description('Call generated OpenBox Backend/Core operations by operationId');

  api
    .command('list')
    .description('List generated operation IDs')
    .argument('<service>', 'backend | core')
    .action((rawService: string) => {
      const service = rawService as ServiceName;
      if (service !== 'backend' && service !== 'core') {
        error(`unknown service '${rawService}'`, { help: 'expected backend or core' });
        bailWith(EXIT.USAGE);
      }
      listOperations(service);
    });

  api
    .command('backend')
    .description('Call a generated Backend operation by operationId')
    .argument('<operationId>')
    .option('--params <json>', 'Path params JSON object, or @file')
    .option('--query <json>', 'Query params JSON object, or @file')
    .option('--body <json>', 'JSON request body, or @file')
    .action((operationId: string, options: ApiCallOptions) =>
      callOperation('backend', operationId, options, getClient()),
    );

  api
    .command('core')
    .description('Call a generated Core operation by operationId')
    .argument('<operationId>')
    .option('--params <json>', 'Path params JSON object, or @file')
    .option('--query <json>', 'Query params JSON object, or @file')
    .option('--body <json>', 'JSON request body, or @file')
    .action((operationId: string, options: ApiCallOptions) =>
      callOperation('core', operationId, options, getCoreClient()),
    );
}
