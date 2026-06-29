import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  CANONICAL_SPAN,
  CANONICAL_AGENT_IDENTITY,
  CANONICAL_SDK_VOCAB,
} from '../../ts/src/core-client/generated/govern.js';
import { API_KEY_PATTERN } from '../../ts/src/env/generated/env-bindings.js';

const repoRoot = resolve(__dirname, '../..');
const readJson = (rel: string) =>
  JSON.parse(readFileSync(resolve(repoRoot, rel), 'utf8'));

// TDD lock on the canonical contract values — the expected outcomes every SDK
// (TS + Python) must emit. If the TypeSpec @spanContract/@agentIdentityContract/
// @sdkVocab source changes a value, this fails loudly instead of drifting.
describe('canonical contract values (spec-driven, expected outcomes)', () => {
  test('CANONICAL_SPAN caps/sentinels/headers/kinds/status are exactly canonical', () => {
    expect(CANONICAL_SPAN.caps).toEqual({
      httpBody: 8192,
      fileData: 4096,
      dbStatement: 2000,
      functionArg: 2000,
    });
    expect(CANONICAL_SPAN.truncationSuffix).toBe('...[truncated]');
    expect(CANONICAL_SPAN.redactedSentinel).toBe('[REDACTED]');
    // exact 7-key sensitive set, no substring heuristics
    expect([...CANONICAL_SPAN.sensitiveHeaders].sort()).toEqual(
      [
        'authorization',
        'cookie',
        'proxy-authorization',
        'set-cookie',
        'www-authenticate',
        'x-api-key',
        'x-auth-token',
      ].sort(),
    );
    expect(CANONICAL_SPAN.spanKind).toEqual({
      file_operation: 'INTERNAL',
      http_request: 'CLIENT',
      db_query: 'CLIENT',
      function_call: 'INTERNAL',
    });
    expect(CANONICAL_SPAN.statusCode).toEqual({ unset: 'UNSET', error: 'ERROR' });
  });

  test('CANONICAL_SPAN sql verbs + behavior triggers + semantic map', () => {
    expect(CANONICAL_SPAN.sqlVerbs).toEqual([
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP',
      'ALTER', 'TRUNCATE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'EXPLAIN',
    ]);
    expect(CANONICAL_SPAN.behaviorTriggers).toContain('http_get');
    expect(CANONICAL_SPAN.behaviorTriggers).toContain('database_select');
    expect(CANONICAL_SPAN.behaviorTriggers).toContain('llm_completion');
    expect(CANONICAL_SPAN.semanticType.static.llm).toBe('llm_completion');
    expect(CANONICAL_SPAN.semanticType.httpByMethod.post).toBe('http_post');
    expect(CANONICAL_SPAN.semanticType.dbByOperation.select).toBe(
      'database_select',
    );
  });

  test('CANONICAL_AGENT_IDENTITY signing contract is exactly canonical', () => {
    expect(CANONICAL_AGENT_IDENTITY.headers).toEqual({
      did: 'X-OpenBox-Agent-DID',
      timestamp: 'X-OpenBox-Agent-Timestamp',
      nonce: 'X-OpenBox-Agent-Nonce',
      bodySha256: 'X-OpenBox-Body-SHA256',
      signature: 'X-OpenBox-Agent-Signature',
      sdkVersion: 'X-OpenBox-SDK-Version',
    });
    // canonical request string order — must match Python identity.py exactly
    expect(CANONICAL_AGENT_IDENTITY.canonicalRequestFields).toEqual([
      'method', 'pathname', 'timestamp', 'nonce', 'bodySha256',
    ]);
    expect(CANONICAL_AGENT_IDENTITY.didPattern).toBe(
      '^did:aip:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    );
    expect(new RegExp(CANONICAL_AGENT_IDENTITY.didPattern, 'i').test(
      'did:aip:00000000-0000-0000-0000-000000000000',
    )).toBe(true);
  });

  test('CANONICAL_SDK_VOCAB retryable statuses + guardrail aliases', () => {
    expect(CANONICAL_SDK_VOCAB.retryableStatuses).toEqual([429, 500, 502, 503, 504]);
    const g = CANONICAL_SDK_VOCAB.guardrailTypeAliases as Record<string, string>;
    expect(g.pii).toBe('1');
    expect(g.nsfw).toBe('2');
    expect(g.toxicity).toBe('3');
    expect(g.ban_list).toBe('4');
    expect(g.regex).toBe('5');
  });

  test('API_KEY_PATTERN matches obx_(live|test)_<48hex>', () => {
    expect(API_KEY_PATTERN.test(`obx_live_${'a'.repeat(48)}`)).toBe(true);
    expect(API_KEY_PATTERN.test(`obx_test_${'0'.repeat(48)}`)).toBe(true);
    expect(API_KEY_PATTERN.test('obx_key_short')).toBe(false);
  });

  // The consumed TS constants MUST equal the generated JSON artifacts the Python
  // SDK vendors — so TS and Python physically derive from one source.
  test('consumed constants equal the generated JSON artifacts (TS↔Python source)', () => {
    expect(CANONICAL_SPAN).toEqual(
      readJson('specs/generated/span-contract.json'),
    );
    expect(CANONICAL_AGENT_IDENTITY).toEqual(
      readJson('specs/generated/agent-identity-contract.json'),
    );
  });
});
