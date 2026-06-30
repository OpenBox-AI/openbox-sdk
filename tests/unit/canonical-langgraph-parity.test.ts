import { describe, expect, test } from 'vitest';
import { buildSpan } from '../../ts/src/governance/spans.js';

// Proves the shared buildSpan emits the canonical langgraph-py span shape 1:1 for
// EVERY host — no superset. The canonical Python hooks (_build_{file,http,db}_span_data,
// tracing.py) define these field sets; a span may carry only the envelope + its
// hook_type's canonical root fields, with no SDK-synthetic openbox.*/gen_ai./span_type.

const ENVELOPE = new Set([
  'span_id', 'trace_id', 'parent_span_id', 'name', 'kind', 'stage',
  'start_time', 'end_time', 'duration_ns', 'attributes', 'status', 'events',
  'hook_type', 'error',
]);
const BY_HOOK: Record<string, Set<string>> = {
  file_operation: new Set([
    'file_path', 'file_mode', 'file_operation', 'data', 'bytes_read',
    'bytes_written', 'lines_count', 'operations',
    'file_total_bytes_read', 'file_total_bytes_written',
  ]),
  http_request: new Set([
    'http_method', 'http_url', 'request_body', 'request_headers',
    'response_body', 'response_headers', 'http_status_code',
  ]),
  db_query: new Set([
    'db_system', 'db_name', 'db_operation', 'db_statement',
    'server_address', 'server_port', 'rowcount',
  ]),
  function_call: new Set(['function', 'module', 'args', 'result']),
};

// Every host that consumes the shared builder.
const HOSTS = ['copilotkit', 'cursor', 'claude-code', 'codex', 'anthropic', 'openai', 'n8n'];

function assertCanonical(span: Record<string, unknown>): void {
  const hook = span.hook_type as string;
  const allowed = BY_HOOK[hook];
  expect(allowed, `unknown hook_type ${hook}`).toBeDefined();
  // (1) no superset root keys
  for (const key of Object.keys(span)) {
    expect(
      ENVELOPE.has(key) || allowed.has(key),
      `superset root key "${key}" on ${hook} span`,
    ).toBe(true);
  }
  // (2) no SDK-synthetic attributes
  const attrs = span.attributes as Record<string, unknown>;
  for (const key of Object.keys(attrs)) {
    expect(
      key.startsWith('openbox.') || key.startsWith('gen_ai.'),
      `superset attribute "${key}"`,
    ).toBe(false);
  }
  // (3) no span_type root field (Core derives it from hook_type)
  expect(span.span_type).toBeUndefined();
  // (4) canonical envelope present
  expect(span.status).toMatchObject({ code: expect.any(String) });
  expect(Array.isArray(span.events)).toBe(true);
}

describe('canonical langgraph-py span parity — every host, no superset', () => {
  const CASES: Array<{ type: Parameters<typeof buildSpan>[1]; input: Record<string, unknown>; hook: string; statics: Record<string, unknown> }> = [
    { type: 'file_open', hook: 'file_operation', input: { file_path: '/vault/secret.txt', file_mode: 'r', stage: 'started' }, statics: { name: 'file.open', kind: 'INTERNAL', hook_type: 'file_operation', file_operation: 'open', file_mode: 'r' } },
    { type: 'file_read', hook: 'file_operation', input: { file_path: '/vault/secret.txt', file_mode: 'r', data: 'hello', stage: 'completed' }, statics: { name: 'file.read', kind: 'INTERNAL', hook_type: 'file_operation', file_operation: 'read' } },
    { type: 'http', hook: 'http_request', input: { method: 'POST', url: 'https://api.example.com/x', stage: 'started' }, statics: { kind: 'CLIENT', hook_type: 'http_request', http_method: 'POST' } },
    { type: 'db', hook: 'db_query', input: { db_system: 'sqlite', db_operation: 'SELECT', db_statement: 'SELECT * FROM t', stage: 'completed' }, statics: { kind: 'CLIENT', hook_type: 'db_query', db_operation: 'SELECT', db_system: 'sqlite', name: 'SELECT' } },
    { type: 'llm', hook: 'http_request', input: { model: 'gpt-4', url: 'https://api.openai.com/v1/chat/completions', usage: { input_tokens: 10, output_tokens: 5 }, stage: 'completed' }, statics: { kind: 'CLIENT', hook_type: 'http_request', http_method: 'POST' } },
  ];

  for (const host of HOSTS) {
    for (const c of CASES) {
      test(`${host} / ${c.type} is canonical 1:1 (no superset)`, () => {
        const span = buildSpan(host, c.type, c.input as never);
        assertCanonical(span);
        expect(span).toMatchObject(c.statics);
      });
    }
  }

  test('LLM provider call collapses to a plain http_request span (no token telemetry)', () => {
    const span = buildSpan('copilotkit', 'llm', {
      model: 'gpt-4',
      url: 'https://api.openai.com/v1/chat/completions',
      usage: { input_tokens: 10, output_tokens: 5, cost_usd: 0.01 },
      stage: 'completed',
    } as never);
    // hook_type is http_request; NONE of the token/cost/model telemetry survives
    expect(span.hook_type).toBe('http_request');
    for (const k of ['input_tokens', 'output_tokens', 'cost_usd', 'model', 'usage', 'model_provider', 'provider']) {
      expect(span[k], `LLM telemetry root field "${k}" must be gone`).toBeUndefined();
    }
    const attrs = span.attributes as Record<string, unknown>;
    expect(Object.keys(attrs).some((k) => k.startsWith('openbox.') || k.startsWith('gen_ai.'))).toBe(false);
  });
});
