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
import { BACKEND_ENDPOINT_MANIFEST } from '../../ts/client/src/generated/endpoint-manifest.js';
import { CORE_ENDPOINT_MANIFEST } from '../../ts/core-client/src/generated/endpoint-manifest.js';

interface Entry {
  operationId: string;
  path: string;
  verb: string;
  pathPattern: string;
}

// Map the client's helper verb to the HTTP verb. `del` was named to avoid
// the JS reserved word.
const VERB_ALIAS: Record<string, string> = {
  get: 'get',
  post: 'post',
  put: 'put',
  patch: 'patch',
  del: 'delete',
};

function extractCoveredEndpoints(source: string): Set<string> {
  const out = new Set<string>();

  // Pattern 1: `this.<verb>(\`<path>\`, ...)` or `this.<verb>('<path>', ...)`
  const helperRe = /this\.(get|post|put|patch|del)\(\s*([`'"])([^`'"]+)\2/g;
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

const cases: CoverageCase[] = [
  {
    serviceName: 'OpenBoxClient',
    manifest: BACKEND_ENDPOINT_MANIFEST as readonly Entry[],
    source: readFileSync(resolve(repoRoot, 'ts/client/src/client.ts'), 'utf8'),
    // Empty by design. The previous round allowlisted six endpoints
    // (the `/health` probe, three OAuth-flow POSTs, registration, and
    // welcome-email firing) on the grounds that "the browser drives the
    // flow." That argument doesn't hold - the SDK doesn't drive the
    // browser, but every HTTP call before and after a redirect is still
    // an HTTP call the SDK can wrap. Headless callers (CLI scripts,
    // mobile sign-in screens, integration tests) need them and now have
    // them. The Keycloak redirect URL itself is a navigation, not an
    // endpoint, and never appears in BACKEND_ENDPOINT_MANIFEST.
    allowlist: new Set<string>(),
  },
  {
    serviceName: 'OpenBoxCoreClient',
    manifest: CORE_ENDPOINT_MANIFEST as readonly Entry[],
    source: readFileSync(resolve(repoRoot, 'ts/core-client/src/core-client.ts'), 'utf8'),
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
