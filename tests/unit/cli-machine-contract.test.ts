// Locks the machine-mode contract for tools / MCP / agents:
//   - stdout = exactly one JSON document (or empty for silenced helpers)
//   - stderr = empty on success; single-line `{"error":{...}}` on failure
//   - colors / progress / banners / cargo-style multi-line errors are silenced
//
// Driven by isMachineMode(), which returns true when `--json` is on
// the command line OR stdout is not a TTY. Tests force the flag via
// argv override; vitest's stdout isn't a TTY anyway, so machineMode is
// already true in test runs — but we set the flag explicitly so the
// intent is self-documenting.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  output,
  outputList,
  error,
  warn,
  note,
  banner,
  info,
  action,
  success,
  row,
  summary,
  kv,
  table,
} from '../../ts/src/cli/output';
import { setArgvForTesting } from '../../ts/src/cli/non-interactive';

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, '');

function captured(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((c: unknown[]) => stripAnsi(String(c[0])));
}

describe('machine-mode output contract', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setArgvForTesting(['node', 'openbox', '--json']);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    setArgvForTesting(null);
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  // ─── stdout = exactly one JSON document ───────────────────────────

  it('output() emits a single JSON document on stdout', () => {
    output({ a: 1, b: 'x' });
    expect(captured(logSpy)).toEqual(['{\n  "a": 1,\n  "b": "x"\n}']);
    expect(captured(errSpy)).toEqual([]);
  });

  it('outputList drops the stderr count line in machine mode', () => {
    outputList([{ id: 1 }, { id: 2 }], 'agents');
    expect(captured(errSpy)).toEqual([]); // no `2 agents` count
    expect(logSpy.mock.calls[0][0]).toContain('"id": 1');
  });

  it('outputList drops the count for envelope-shaped responses too', () => {
    outputList({ data: [{ x: 1 }], total: 1 }, 'rows');
    expect(captured(errSpy)).toEqual([]);
    expect(logSpy.mock.calls[0][0]).toContain('"x": 1');
  });

  it('kv emits one JSON object on stdout', () => {
    kv({ env: 'live', org: 'acme' });
    const parsed = JSON.parse(captured(logSpy)[0]);
    expect(parsed).toEqual({ env: 'live', org: 'acme' });
    expect(captured(errSpy)).toEqual([]);
  });

  it('table emits one JSON array of header-keyed objects on stdout', () => {
    table(['name', 'tier'], [
      ['alpha', 'gold'],
      ['beta', 'silver'],
    ]);
    const parsed = JSON.parse(captured(logSpy)[0]);
    expect(parsed).toEqual([
      { name: 'alpha', tier: 'gold' },
      { name: 'beta', tier: 'silver' },
    ]);
    expect(captured(errSpy)).toEqual([]);
  });

  // ─── stdout is silent for human-only helpers ──────────────────────

  it('info / action / success / row / summary all silent on stdout', () => {
    info('hello');
    action('Installing', 'extension');
    success('done!');
    row('extension', 'installed', 'host: cursor');
    summary({ installed: 2, skipped: 0, failed: 0 });
    expect(captured(logSpy)).toEqual([]);
    expect(captured(errSpy)).toEqual([]);
  });

  // ─── stderr is silent for human-only helpers ──────────────────────

  it('warn / note / banner all silent on stderr', () => {
    warn('something to know about');
    note('metrics: {...}');
    banner('Important', ['line one', 'line two']);
    expect(captured(logSpy)).toEqual([]);
    expect(captured(errSpy)).toEqual([]);
  });

  // ─── error = single-line JSON on stderr ───────────────────────────

  it('error emits single-line {error:{message}} JSON on stderr', () => {
    error('missing required argument <agentId>');
    expect(captured(logSpy)).toEqual([]);
    const lines = captured(errSpy);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toEqual({
      error: { message: 'missing required argument <agentId>' },
    });
  });

  it('error trailers (help / detail / hint / see) all land in the JSON payload', () => {
    error('boom', {
      help: 'try the other thing',
      detail: 'server returned 500',
      hint: 'see logs',
      see: 'docs/runbook',
    });
    const parsed = JSON.parse(captured(errSpy)[0]);
    expect(parsed).toEqual({
      error: {
        message: 'boom',
        detail: 'server returned 500',
        help: 'try the other thing',
        hint: 'see logs',
        see: 'docs/runbook',
      },
    });
  });

  it('error strips trailing period from message before serializing', () => {
    error('bang.');
    const parsed = JSON.parse(captured(errSpy)[0]);
    expect(parsed.error.message).toBe('bang');
  });
});

describe('TTY-mode output is unchanged when --json is absent', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setArgvForTesting(['node', 'openbox']); // no --json
    // Force isTTY = true so isMachineMode returns false even though
    // vitest's stdout is normally non-TTY. The CLI process runs as a
    // human-facing terminal in this branch.
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    setArgvForTesting(null);
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      configurable: true,
    });
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('outputList still emits the count line on stderr', () => {
    outputList([{ a: 1 }, { a: 2 }], 'rows');
    expect(captured(errSpy)).toEqual(['2 rows']);
    expect(logSpy.mock.calls[0][0]).toContain('"a": 1');
  });

  it('error emits cargo-style multi-line stderr (NOT JSON)', () => {
    error('boom', { help: 'try X' });
    const lines = captured(errSpy);
    expect(lines[0]).toBe('error: boom');
    // Multi-line, not JSON. Confirm by checking the output isn't
    // parseable as a single JSON document.
    expect(() => JSON.parse(lines[0])).toThrow();
  });

  it('warn emits `warn:` line on stderr in TTY mode', () => {
    warn('drift');
    expect(captured(errSpy)[0]).toBe('warn: drift');
  });

  it('info emits prose to stdout in TTY mode', () => {
    info('Using bundle at /path');
    expect(captured(logSpy)).toEqual(['Using bundle at /path']);
  });
});
