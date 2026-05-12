// Pin the cursor/agent-trace v0.1.0 wire shape; fields, hash
// determinism, JSONL round-trip, IO error tolerance.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRecord,
  hashContent,
  readTraceLog,
  writeTraceRecord,
  TRACE_SPEC_VERSION,
  type TraceRecord,
} from '../../ts/src/agent-trace';

describe('agent-trace.buildRecord', () => {
  it('produces a record with the spec-pinned shape', () => {
    const r = buildRecord({
      filePath: '/Users/dev/repo/src/foo.ts',
      startLine: 5,
      endLine: 10,
      content: 'console.log("hi")\n',
      contributorType: 'ai',
      modelId: 'anthropic/claude-opus-4-5-20251101',
      workspaceRoot: '/Users/dev/repo',
      tool: { name: 'openbox', version: '0.1.0' },
    });
    expect(r.version).toBe(TRACE_SPEC_VERSION);
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.tool).toEqual({ name: 'openbox', version: '0.1.0' });
    expect(r.files).toHaveLength(1);
    expect(r.files[0].path).toBe('src/foo.ts');
    const conv = r.files[0].conversations[0];
    expect(conv.contributor).toEqual({
      type: 'ai',
      model_id: 'anthropic/claude-opus-4-5-20251101',
    });
    expect(conv.ranges[0]).toEqual({
      start_line: 5,
      end_line: 10,
      content_hash: hashContent('console.log("hi")\n'),
    });
  });

  it('omits contributor.model_id when not supplied', () => {
    const r = buildRecord({
      filePath: '/x/foo.ts',
      startLine: 1,
      endLine: 1,
      content: 'x',
      contributorType: 'human',
    });
    expect(r.files[0].conversations[0].contributor).toEqual({ type: 'human' });
    expect((r.files[0].conversations[0].contributor as any).model_id).toBeUndefined();
  });

  it('falls back to the absolute path when workspaceRoot is absent', () => {
    const r = buildRecord({
      filePath: '/absolute/path/file.ts',
      startLine: 1,
      endLine: 1,
      content: 'x',
      contributorType: 'unknown',
    });
    expect(r.files[0].path).toBe('/absolute/path/file.ts');
  });

  it('content_hash is deterministic for the same input', () => {
    const a = hashContent('hello world');
    const b = hashContent('hello world');
    const c = hashContent('hello worldX');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('emits VCS metadata when supplied', () => {
    const r = buildRecord({
      filePath: '/x/y.ts',
      startLine: 1,
      endLine: 1,
      content: 'x',
      contributorType: 'ai',
      vcs: { type: 'git', revision: 'deadbeef' },
    });
    expect(r.vcs).toEqual({ type: 'git', revision: 'deadbeef' });
  });
});

describe('agent-trace JSONL log', () => {
  let dir: string;
  let logFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-trace-test-'));
    logFile = join(dir, 'trace.jsonl');
  });

  function newRecord(content: string): TraceRecord {
    return buildRecord({
      filePath: 'foo.ts',
      startLine: 1,
      endLine: 1,
      content,
      contributorType: 'ai',
    });
  }

  it('append + read round-trips records', () => {
    const a = newRecord('a');
    const b = newRecord('b');
    writeTraceRecord(a, { logFile });
    writeTraceRecord(b, { logFile });
    const back = readTraceLog({ logFile });
    expect(back).toHaveLength(2);
    expect(back[0].id).toBe(a.id);
    expect(back[1].id).toBe(b.id);
  });

  it('readTraceLog returns [] when the file is absent', () => {
    expect(readTraceLog({ logFile: join(dir, 'never-written.jsonl') })).toEqual([]);
  });

  it('readTraceLog skips malformed lines without throwing', () => {
    const ok = newRecord('ok');
    writeTraceRecord(ok, { logFile });
    // Append a corrupt line
    require('node:fs').appendFileSync(logFile, 'not valid json\n', 'utf-8');
    writeTraceRecord(newRecord('after'), { logFile });
    const back = readTraceLog({ logFile });
    expect(back).toHaveLength(2);
  });

  it('writeTraceRecord swallows IO errors (telemetry must never break the caller)', () => {
    // Point at a path that can't be created (a file path nested
    // under another file). writeTraceRecord must NOT throw.
    const root = join(dir, 'a-file');
    require('node:fs').writeFileSync(root, 'x', 'utf-8');
    const trapped = join(root, 'inside-a-file', 'trace.jsonl');
    expect(() => writeTraceRecord(newRecord('x'), { logFile: trapped })).not.toThrow();
    expect(existsSync(trapped)).toBe(false);
  });

  it('record file mode is 0600 (sensitive content hash + paths)', () => {
    if (process.platform === 'win32') return; // mode bits ignored on Windows
    writeTraceRecord(newRecord('sensitive'), { logFile });
    const stat = require('node:fs').statSync(logFile);
    // 0o777 mask
    expect((stat.mode & 0o777) & 0o077).toBe(0);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});
