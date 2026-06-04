// Asserts every entry in BACKEND_ENDPOINT_MANIFEST / CORE_ENDPOINT_MANIFEST
// has a matching method on its hand-written wrapper class. The check works
// by extracting every `this.<verb>(<path>, ...)` call (and the legacy
// `this.request(<VERB>, <path>, ...)` form) from the wrapper source,
// normalizing template-literal placeholders to `{x}`, then asserting the
// (verb, path) tuple appears among the extracted calls.
//
// Adding a route to specs/typespec/<service>/main.tsp without a matching
// method here fails this test on the next `npm run specs:compile` cycle.
//
// The allowlists below name endpoints we have a documented reason to skip
// (health checks, internal-only routes). Everything else is required.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/src/client/generated/endpoint-manifest.js';
import { CORE_ENDPOINT_MANIFEST } from '../../ts/src/core-client/generated/endpoint-manifest.js';

interface Entry {
  operationId: string;
  path: string;
  verb: string;
  pathPattern: string;
}

// Map the client's helper verb to the HTTP verb. After the spec-driven
// wrapper-base introduction, helpers are namespaced with an `http` prefix
// (httpGet / httpPost / ...) so they don't clash with API method names
// like `getProfile`. `del` is the legacy short-name on core-client.
const VERB_ALIAS: Record<string, string> = {
  httpGet: 'get',
  httpPost: 'post',
  httpPut: 'put',
  httpPatch: 'patch',
  httpDelete: 'delete',
  get: 'get',
  post: 'post',
  put: 'put',
  patch: 'patch',
  del: 'delete',
};

function extractCoveredEndpoints(source: string): Set<string> {
  const out = new Set<string>();

  // Pattern 1: `this.<helper>(\`<path>\`, ...)`; both `httpGet`/`httpPost`/...
  // (post-spec-driven wrapper) and the legacy `get`/`post`/... shorthands.
  // The optional `<...>` allows for explicit generic-type arguments emitted
  // by the wrapper-base codegen, e.g. `this.httpPatch<ResponseOf<...>>('/path', body)`.
  const helperRe =
    /this\.(httpGet|httpPost|httpPut|httpPatch|httpDelete|get|post|put|patch|del)(?:<[^>]*(?:<[^>]*>[^>]*)*>)?\(\s*([`'"])([^`'"]+)\2/g;
  for (const m of source.matchAll(helperRe)) {
    const verb = VERB_ALIAS[m[1]];
    const rawPath = m[3];
    out.add(verbKey(verb, rawPath));
  }

  // Pattern 2: `this.request('<VERB>', \`<path>\`, ...)`
  const requestRe =
    /this\.request\(\s*['"](GET|POST|PUT|PATCH|DELETE)['"]\s*,\s*([`'"])([^`'"]+)\2/g;
  for (const m of source.matchAll(requestRe)) {
    const verb = m[1].toLowerCase();
    out.add(verbKey(verb, m[3]));
  }

  return out;
}

function verbKey(verb: string, rawPath: string): string {
  // Normalize template-literal placeholders `${id}` → `{x}` so the manifest's
  // `pathPattern` compares equal regardless of variable names.
  const normalized = rawPath.replace(/\$\{[^}]+\}/g, '{x}');
  // Strip trailing query-string (everything after `?`).
  const noQuery = normalized.split('?')[0];
  return `${verb} ${noQuery}`;
}

interface CoverageCase {
  serviceName: string;
  manifest: readonly Entry[];
  source: string;
  /** operationIds we knowingly don't expose on the wrapper. */
  allowlist: ReadonlySet<string>;
}

const repoRoot = resolve(import.meta.dirname, '..', '..');

// Spec-driven wrapper methods now live in the generated base class
// (`wrapper-methods.ts`); the hand-written client.ts only carries
// helper methods + a few overrides. Scan both so the coverage check
// sees every endpoint.
function combinedSource(...paths: string[]): string {
  return paths.map((p) => readFileSync(resolve(repoRoot, p), 'utf8')).join('\n');
}

const cases: CoverageCase[] = [
  {
    serviceName: 'OpenBoxClient',
    manifest: BACKEND_ENDPOINT_MANIFEST as readonly Entry[],
    source: combinedSource(
      'ts/src/client/client.ts',
      'ts/src/client/generated/wrapper-methods.ts',
    ),
    allowlist: new Set<string>(),
  },
  {
    serviceName: 'OpenBoxCoreClient',
    manifest: CORE_ENDPOINT_MANIFEST as readonly Entry[],
    source: combinedSource(
      'ts/src/core-client/core-client.ts',
      'ts/src/core-client/generated/wrapper-methods.ts',
    ),
    allowlist: new Set<string>(),
  },
];

describe.each(cases)('$serviceName covers every spec endpoint', ({ manifest, source, allowlist }) => {
  const covered = extractCoveredEndpoints(source);

  test.each(manifest as Entry[])(
    '$verb $path ($operationId)',
    ({ verb, pathPattern, operationId }) => {
      if (allowlist.has(operationId)) return;
      const key = `${verb} ${pathPattern}`;
      expect(covered, `missing wrapper method for ${key} (operationId: ${operationId})`).toContain(
        key,
      );
    },
  );
});
