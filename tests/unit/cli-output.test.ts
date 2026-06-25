// Format spec for ts/src/cli/output.ts. Locks stream routing,
// prefix shape, and summary format so accidental drift across the CLI
// is caught at the helper layer instead of by every command's tests.
//
// We strip ANSI before asserting because `useColor()` returns true
// outside CI (we run vitest with no special env), and tests should
// describe the structural format, not the color codes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  error,
  warn,
  info,
  action,
  success,
  row,
  summary,
  kv,
  table,
  output,
  outputList,
} from '../../ts/src/cli/output';

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, '');

function captureLog(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((c: unknown[]) => stripAnsi(String(c[0])));
}

describe('output: severity prefixes', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('error writes to stderr with `error:` prefix and no trailing period', () => {
    error('boom.');
    expect(captureLog(logSpy)).toEqual([]);
    expect(captureLog(errSpy)).toEqual(['error: boom']);
  });

  it('error trailers render under a blank separator, in fixed order', () => {
    error('boom', { help: 'do thing', detail: 'body', hint: 'h', see: 'docs/x' });
    expect(captureLog(errSpy)).toEqual([
      'error: boom',
      '',
      'detail: body',
      'help: do thing',
      'hint: h',
      'see: docs/x',
    ]);
  });

  it('error help with newlines hang-indents continuation under the value', () => {
    error('no targets', {
      help: 'pick a subcommand\nvalid:   extension, cursor, claude-code\nexample: openbox install cursor',
    });
    expect(captureLog(errSpy)).toEqual([
      'error: no targets',
      '',
      'help: pick a subcommand',
      '      valid:   extension, cursor, claude-code',
      '      example: openbox install cursor',
    ]);
  });

  it('warn writes to stderr with `warn:` prefix, no trailing period', () => {
    warn('tread carefully.');
    expect(captureLog(errSpy)).toEqual(['warn: tread carefully']);
  });

  it('warn renders optional reference on its own line', () => {
    warn('drift', 'docs/v0.2.0');
    expect(captureLog(errSpy)).toEqual([
      'warn: drift',
      'see: docs/v0.2.0',
    ]);
  });
});

describe('output: stdout helpers', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('info prints plain message to stdout', () => {
    info('Using bundle at /path');
    expect(captureLog(logSpy)).toEqual(['Using bundle at /path']);
  });

  it('action prefixes arrow + ellipsis', () => {
    action('Installing', 'extension');
    expect(captureLog(logSpy)).toEqual(['→ Installing extension…']);
  });

  it('action with no target still ends in ellipsis', () => {
    action('Building bundle');
    expect(captureLog(logSpy)).toEqual(['→ Building bundle…']);
  });

  it('success prefixes `ok:`', () => {
    success('extension installed');
    expect(captureLog(logSpy)).toEqual(['ok: extension installed']);
  });
});

describe('output: row + summary', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('row pads target<14> and status<14> with detail trailing', () => {
    row('extension', 'installed', 'host: cursor');
    expect(captureLog(logSpy)).toEqual([
      'extension     installed     host: cursor',
    ]);
  });

  it('row trims trailing whitespace when no detail given', () => {
    row('mcp', 'skipped');
    expect(captureLog(logSpy)[0]).toBe('mcp           skipped');
  });

  it('row accepts unknown status (rendered plain, no color)', () => {
    row('agent', 'queued', 'id: x');
    expect(captureLog(logSpy)).toEqual([
      'agent         queued        id: x',
    ]);
  });

  it('row separates long target names from status and hang-indents multiline details', () => {
    row('plugin-component-inventory', 'pass', '11 component(s)\n/path/to/component-inventory.json');
    expect(captureLog(logSpy)).toEqual([
      'plugin-component-inventory  pass          11 component(s)',
      '                                          /path/to/component-inventory.json',
    ]);
  });

  it('summary line emits `done.` with key=value parts', () => {
    summary({ installed: 2, skipped: 1, failed: 0 });
    expect(captureLog(logSpy)).toEqual(['done. installed=2 skipped=1 failed=0']);
  });

  it('summary omits keys not present', () => {
    summary({ pass: 3 });
    expect(captureLog(logSpy)).toEqual(['done. pass=3']);
  });

  it('summary with no keys still prints `done.`', () => {
    summary({});
    expect(captureLog(logSpy)).toEqual(['done.']);
  });
});

describe('output: kv + table', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('kv pads keys to widest width', () => {
    kv({ env: 'live', org: 'acme', api: 'https://api.openbox.ai' });
    expect(captureLog(logSpy)).toEqual([
      'env  live',
      'org  acme',
      'api  https://api.openbox.ai',
    ]);
  });

  it('kv skips undefined values', () => {
    kv({ a: 'x', b: undefined, c: 'y' });
    expect(captureLog(logSpy)).toEqual(['a  x', 'c  y']);
  });

  it('table renders headers + dim separator + body rows padded', () => {
    table(
      ['target', 'status'],
      [
        ['extension', 'installed'],
        ['mcp', 'skipped'],
      ],
    );
    const lines = captureLog(logSpy);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('target     status   ');
    expect(lines[1]).toBe('---------  ---------');
    expect(lines[2]).toBe('extension  installed');
    expect(lines[3]).toBe('mcp        skipped  ');
  });
});

describe('output: JSON envelopes (preserved)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('output() prints pretty JSON to stdout', () => {
    output({ a: 1 });
    expect(captureLog(logSpy)).toEqual(['{\n  "a": 1\n}']);
  });

  it('outputList prints count to stderr + array to stdout', () => {
    outputList([{ id: 1 }, { id: 2 }], 'agents');
    expect(captureLog(errSpy)).toEqual(['2 agents']);
    expect(logSpy.mock.calls[0][0]).toContain('"id": 1');
  });
});
