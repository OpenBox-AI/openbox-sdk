// Span content + halt-mark side effects.
//
// `buildSpan(host, type, input)` (ts/src/governance/spans.ts) is
// what every adapter funnels through to send a behavior-routable
// envelope. The classifier on the backend matches behavior rules
// on `semantic_type` and the OTel-style attributes (`file.path`,
// `http.method`, `shell.command`, `gen_ai.system`). If those
// fields are wrong, behavior rules silently no-op and the
// adapter looks like it's doing nothing. The matrix tests catch
// some of that end-to-end; this file pins the contract directly.
//
// The halt-mark test pairs with: when preToolUse returns a halt
// verdict, the adapter marks the session as halted via the
// session resolver. The next hook on the same session id then
// allocates a fresh workflow/runId pair.

import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSpan } from '../../ts/src/governance/spans.js';
import {
  resolveSessionByKey,
  peekSessionByKey,
  markHaltedByKey,
} from '../../ts/src/session/resolver.js';

describe('buildSpan content per SpanType', () => {
  it('llm spans carry POST + openai URL + gen_ai.system=host + module=host', () => {
    const span = buildSpan('claude-code', 'llm', { prompt: 'hi' });
    expect(span.semantic_type).toBe('llm_completion');
    expect(span.module).toBe('claude-code');
    const attrs = span.attributes as Record<string, unknown>;
    expect(attrs['gen_ai.system']).toBe('claude-code');
    expect(attrs['http.method']).toBe('POST');
    expect(attrs['http.url']).toContain('openai.com');
  });

  it('llm spans preserve Claude input/output token usage when provided', () => {
    const span = buildSpan('claude-code', 'llm', {
      prompt: 'hi',
      model: 'claude-opus-4-8',
      usage: {
        inputTokens: 123,
        outputTokens: 45,
      },
    });
    expect(span.input_tokens).toBe(123);
    expect(span.output_tokens).toBe(45);
    expect(span.model).toBe('claude-opus-4-8');
    const attrs = span.attributes as Record<string, unknown>;
    expect(attrs['gen_ai.usage.input_tokens']).toBe(123);
    expect(attrs['gen_ai.usage.output_tokens']).toBe(45);
  });

  it('file_read spans carry file.path + file.operation=read + module=host', () => {
    const span = buildSpan('claude-code', 'file_read', { file_path: '/etc/hostname' });
    expect(span.semantic_type).toBe('file_read');
    expect(span.module).toBe('claude-code');
    expect(span.file_path).toBe('/etc/hostname');
    expect(span.file_mode).toBe('r');
    const attrs = span.attributes as Record<string, unknown>;
    expect(attrs['file.path']).toBe('/etc/hostname');
    expect(attrs['file.operation']).toBe('read');
  });

  it('file_write spans carry file.path + file.operation=write', () => {
    const span = buildSpan('claude-code', 'file_write', { file_path: '/tmp/x' });
    expect(span.semantic_type).toBe('file_write');
    expect(span.module).toBe('claude-code');
    expect(span.file_mode).toBe('w');
    const attrs = span.attributes as Record<string, unknown>;
    expect(attrs['file.path']).toBe('/tmp/x');
    expect(attrs['file.operation']).toBe('write');
  });

  it('file_delete spans carry file.path + file.operation=delete', () => {
    const span = buildSpan('claude-code', 'file_delete', { file_path: '/tmp/x' });
    expect(span.semantic_type).toBe('file_delete');
    expect(span.module).toBe('claude-code');
    const attrs = span.attributes as Record<string, unknown>;
    expect(attrs['file.operation']).toBe('delete');
  });

  it('shell spans carry shell.command + cwd, classify as internal', () => {
    const span = buildSpan('claude-code', 'shell', { command: 'echo hi', cwd: '/tmp' });
    expect(span.semantic_type).toBe('internal');
    expect(span.module).toBe('claude-code');
    const attrs = span.attributes as Record<string, unknown>;
    expect(attrs['shell.command']).toBe('echo hi');
    expect(attrs['shell.cwd']).toBe('/tmp');
  });

  it('mcp spans classify as llm_tool_call with gen_ai.system=mcp', () => {
    const span = buildSpan('claude-code', 'mcp', {
      tool_name: 'check_governance',
      tool_input: { foo: 'bar' },
    });
    expect(span.semantic_type).toBe('llm_tool_call');
    expect(span.module).toBe('claude-code');
    const attrs = span.attributes as Record<string, unknown>;
    expect(attrs['gen_ai.system']).toBe('mcp');
  });

  it('http spans set semantic_type per method and stamp the URL', () => {
    const get = buildSpan('claude-code', 'http', { method: 'GET', url: 'https://example.com' });
    expect(get.semantic_type).toBe('http_get');
    const post = buildSpan('claude-code', 'http', { method: 'POST', url: 'https://example.com' });
    expect(post.semantic_type).toBe('http_post');
    const attrs = post.attributes as Record<string, unknown>;
    expect(attrs['http.method']).toBe('POST');
    expect(attrs['http.url']).toBe('https://example.com');
    expect(post.module).toBe('claude-code');
  });

  it('common span shape: span_id + trace_id are 16/32 hex chars, status OK', () => {
    const span = buildSpan('claude-code', 'llm', { prompt: 'x' });
    expect(typeof span.span_id).toBe('string');
    expect((span.span_id as string).length).toBe(16);
    expect((span.trace_id as string).length).toBe(32);
    const status = span.status as { code: string };
    expect(status.code).toBe('OK');
  });
});

describe('session resolver halt-mark', () => {
  it('marks a session halted; the next resolve allocates a fresh workflow/runId', () => {
    const cfg = { sessionDir: mkdtempSync(path.join(tmpdir(), 'obx-halt-')) };
    const first = resolveSessionByKey('s-halt-1', cfg);
    // Second resolve returns the same IDs while the session is healthy.
    const second = resolveSessionByKey('s-halt-1', cfg);
    expect(second).toEqual(first);

    markHaltedByKey('s-halt-1', cfg);
    const peeked = peekSessionByKey('s-halt-1', cfg);
    expect(peeked?.halted).toBe(true);

    // After halt, resolve allocates fresh IDs.
    const third = resolveSessionByKey('s-halt-1', cfg);
    expect(third.workflowId).not.toBe(first.workflowId);
    expect(third.runId).not.toBe(first.runId);
  });

  it('clearing a missing session is a no-op', () => {
    const cfg = { sessionDir: mkdtempSync(path.join(tmpdir(), 'obx-halt-clear-')) };
    expect(() => markHaltedByKey('does-not-exist', cfg)).not.toThrow();
    expect(peekSessionByKey('does-not-exist', cfg)).toBeNull();
  });
});
