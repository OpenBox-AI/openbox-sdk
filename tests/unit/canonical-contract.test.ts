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

// TDD lock on the FULL spec-driven contract values (the @spanContract /
// @agentIdentityContract / @sdkVocab decorators). Every value is asserted as a
// complete deep-equal — so any change to a single field in the TypeSpec source
// fails here loudly instead of silently drifting the wire format across SDKs.

// The canonical reference values, written explicitly (TDD expected outcomes).
const EXPECTED_SPAN = {
  caps: { httpBody: 8192, fileData: 4096, dbStatement: 2000, functionArg: 2000 },
  truncationSuffix: '...[truncated]',
  redactedSentinel: '[REDACTED]',
  statusCode: { unset: 'UNSET', error: 'ERROR' },
  behaviorTriggers: [
    'http_get', 'http_post', 'http_put', 'http_patch', 'http_delete', 'http',
    'llm_completion', 'llm_embedding', 'llm_tool_call', 'llm_gen_ai',
    'mcp_tool_call',
    'database_select', 'database_insert', 'database_update', 'database_delete',
    'database_query',
    'file_read', 'file_write', 'file_open', 'file_delete',
    'internal',
  ],
  sqlVerbs: [
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP',
    'ALTER', 'TRUNCATE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'EXPLAIN',
  ],
  sensitiveHeaders: [
    'authorization', 'proxy-authorization', 'cookie', 'set-cookie',
    'www-authenticate', 'x-api-key', 'x-auth-token',
  ],
  spanKind: {
    file_operation: 'INTERNAL',
    http_request: 'CLIENT',
    db_query: 'CLIENT',
    function_call: 'INTERNAL',
  },
  semanticType: {
    static: {
      llm: 'llm_completion',
      llm_embedding: 'llm_embedding',
      llm_tool_call: 'llm_tool_call',
      file_read: 'file_read',
      file_open: 'file_open',
      file_write: 'file_write',
      file_delete: 'file_delete',
      shell: 'internal',
      mcp: 'mcp_tool_call',
    },
    httpByMethod: {
      get: 'http_get',
      post: 'http_post',
      put: 'http_put',
      patch: 'http_patch',
      delete: 'http_delete',
    },
    httpDefault: 'http',
    dbByOperation: {
      select: 'database_select',
      insert: 'database_insert',
      update: 'database_update',
      delete: 'database_delete',
    },
    dbDefault: 'database_query',
  },
};

const EXPECTED_AGENT_IDENTITY = {
  headers: {
    did: 'X-OpenBox-Agent-DID',
    timestamp: 'X-OpenBox-Agent-Timestamp',
    nonce: 'X-OpenBox-Agent-Nonce',
    bodySha256: 'X-OpenBox-Body-SHA256',
    signature: 'X-OpenBox-Agent-Signature',
    sdkVersion: 'X-OpenBox-SDK-Version',
  },
  canonicalRequestFields: ['method', 'pathname', 'timestamp', 'nonce', 'bodySha256'],
  didPattern:
    '^did:aip:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
};

const EXPECTED_SDK_VOCAB = {
  retryableStatuses: [429, 500, 502, 503, 504],
  guardrailTypeAliases: {
    '1': '1', pii: '1', pii_detection: '1',
    '2': '2', nsfw: '2', nsfw_detection: '2', content_safety: '2',
    '3': '3', toxicity: '3', toxicity_detection: '3',
    '4': '4', ban_list: '4', ban_words: '4',
    '5': '5', regex: '5', regex_match: '5',
  },
};

describe('canonical contracts — full value lock (TDD)', () => {
  test('CANONICAL_SPAN equals the canonical reference values, in full', () => {
    expect(CANONICAL_SPAN).toEqual(EXPECTED_SPAN);
  });

  test('CANONICAL_AGENT_IDENTITY equals the canonical signing contract, in full', () => {
    expect(CANONICAL_AGENT_IDENTITY).toEqual(EXPECTED_AGENT_IDENTITY);
    // the DID pattern actually validates a did:aip uuid
    expect(
      new RegExp(CANONICAL_AGENT_IDENTITY.didPattern, 'i').test(
        'did:aip:00000000-0000-0000-0000-000000000000',
      ),
    ).toBe(true);
  });

  test('CANONICAL_SDK_VOCAB equals the canonical sdk vocab, in full', () => {
    expect(CANONICAL_SDK_VOCAB).toEqual(EXPECTED_SDK_VOCAB);
  });

  test('API_KEY_PATTERN matches obx_(live|test)_<48hex> and nothing else', () => {
    expect(API_KEY_PATTERN.test(`obx_live_${'a'.repeat(48)}`)).toBe(true);
    expect(API_KEY_PATTERN.test(`obx_test_${'0'.repeat(48)}`)).toBe(true);
    expect(API_KEY_PATTERN.test(`obx_live_${'a'.repeat(47)}`)).toBe(false);
    expect(API_KEY_PATTERN.test('obx_key_abc')).toBe(false);
  });

  // The consumed TS constants MUST equal the generated JSON artifacts (the source
  // any other language vendors from) — so the spec is the single source.
  test('consumed constants equal the generated JSON artifacts', () => {
    expect(CANONICAL_SPAN).toEqual(readJson('specs/generated/span-contract.json'));
    expect(CANONICAL_AGENT_IDENTITY).toEqual(
      readJson('specs/generated/agent-identity-contract.json'),
    );
  });
});
