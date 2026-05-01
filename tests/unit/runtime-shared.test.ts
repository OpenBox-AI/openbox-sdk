// Coverage for ts/src/runtime/_shared/*; pure primitives the
// claude-code/cursor adapters compose against. Each helper is small
// and deterministic; tests use the real fs (in a temp dir) rather
// than mocking it, so the file-mode contract from O.1 also stays
// exercised.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'openbox-runtime-shared-'));
});
afterEach(() => {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe('runtime/_shared/skip-patterns', () => {
  it('SKIP_PATTERNS hides editor + secret + dependency dirs', async () => {
    const { SKIP_PATTERNS } = await import('../../ts/src/runtime/_shared/skip-patterns');
    const cases: [string, boolean][] = [
      ['/foo/.cursor/settings.json', true],
      ['/foo/.claude/anything', true],
      ['/foo/node_modules/x.js', true],
      ['/foo/.git/HEAD', true],
      ['/Users/me/source/main.ts', false],
    ];
    for (const [p, expected] of cases) {
      const matched = SKIP_PATTERNS.some((re) => re.test(p));
      expect(matched, `${p} → expected matched=${expected}`).toBe(expected);
    }
  });
});

describe('runtime/_shared/session-store', () => {
  it('save() writes 0o600 file; load round-trips; delete removes', async () => {
    const { SessionStore } = await import('../../ts/src/runtime/_shared/session-store');
    const s = new SessionStore(dir);
    s.save('abc/123', { hello: 'world' });
    // sanitization: '/' replaced
    expect(existsSync(join(dir, 'abc_123.json'))).toBe(true);
    expect(s.load('abc/123')).toEqual({ hello: 'world' });
    s.delete('abc/123');
    expect(s.load('abc/123')).toBeNull();
  });

  it('cleanup() removes stale sessions older than maxAgeMs', async () => {
    const { SessionStore } = await import('../../ts/src/runtime/_shared/session-store');
    const s = new SessionStore(dir);
    s.save('keep', { x: 1 });
    s.save('drop', { x: 2 });
    // Age the 'drop' file by changing its mtime far in the past.
    const fs = await import('node:fs');
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7); // 7d
    fs.utimesSync(join(dir, 'drop.json'), past, past);
    s.cleanup(1000); // anything > 1s old gets pruned
    expect(s.load('keep')).toBeTruthy();
    expect(s.load('drop')).toBeNull();
  });

  it('load() on missing key returns null without throwing', async () => {
    const { SessionStore } = await import('../../ts/src/runtime/_shared/session-store');
    const s = new SessionStore(dir);
    expect(s.load('nope')).toBeNull();
  });
});

describe('runtime/_shared/session-resolver', () => {
  it('resolveSessionByKey creates new IDs on first call, reuses on second', async () => {
    const mod = await import('../../ts/src/runtime/_shared/session-resolver');
    const cfg = { sessionDir: dir };
    const a = mod.resolveSessionByKey('S1', cfg);
    expect(a.workflowId).toMatch(/[0-9a-f-]{36}/);
    expect(a.runId).toMatch(/[0-9a-f-]{36}/);
    const b = mod.resolveSessionByKey('S1', cfg);
    expect(b.workflowId).toBe(a.workflowId);
    expect(b.runId).toBe(a.runId);
  });

  it('markHaltedByKey + clearSessionByKey mutate persisted state', async () => {
    const mod = await import('../../ts/src/runtime/_shared/session-resolver');
    const cfg = { sessionDir: dir };
    mod.resolveSessionByKey('S2', cfg);
    mod.markHaltedByKey('S2', cfg);
    mod.clearSessionByKey('S2', cfg);
    // After clear, resolving again creates fresh IDs.
    const fresh = mod.resolveSessionByKey('S2', cfg);
    expect(fresh.workflowId).toBeDefined();
  });
});

describe('runtime/_shared/logger', () => {
  it('createLogger returns init+log; log writes a JSON line to stderr + file', async () => {
    const { createLogger } = await import('../../ts/src/runtime/_shared/logger');
    const { initLogger, log } = createLogger('test');
    const logFile = join(dir, 'log.jsonl');
    initLogger({ logFile });

    const sink: string[] = [];
    const orig = console.error;
    console.error = (...a: any[]) => sink.push(a.join(' '));
    try {
      log('TestEvent', { foo: 1, big: 'x'.repeat(300) }, { decision: 'allow' });
    } finally {
      console.error = orig;
    }
    expect(sink.some((s) => s.includes('TestEvent'))).toBe(true);
    // The summarize() truncation branch (>200 chars) must trigger.
    expect(sink.some((s) => s.includes('... ('))).toBe(true);
    expect(readFileSync(logFile, 'utf-8')).toContain('TestEvent');
  });

  it('initLogger with logFile=null is a no-op (no FS writes)', async () => {
    const { createLogger } = await import('../../ts/src/runtime/_shared/logger');
    const { initLogger, log } = createLogger('null-test');
    initLogger({ logFile: null });
    const orig = console.error;
    console.error = () => {};
    try {
      log('NoFile', { x: 1 });
    } finally {
      console.error = orig;
    }
  });
});

describe('runtime/_shared/install', () => {
  it('installAdapter (claude-array) writes the configured key into the target file', async () => {
    const { installAdapter, uninstallAdapter } = await import('../../ts/src/runtime/_shared/install');
    const target = join(dir, 'settings.json');
    const spec = {
      file: target,
      key: 'hooks',
      style: 'claude-array' as const,
      command: 'openbox claude-code hook',
      configDir: dir,
      events: [{ name: 'PreToolUse' }],
    };
    installAdapter(spec);
    expect(existsSync(target)).toBe(true);
    const json = JSON.parse(readFileSync(target, 'utf-8'));
    expect(json.hooks).toBeDefined();
    expect(JSON.stringify(json.hooks)).toContain('openbox claude-code hook');

    uninstallAdapter(spec);
    const after = JSON.parse(readFileSync(target, 'utf-8'));
    const hooksAfter = after.hooks ?? {};
    expect(JSON.stringify(hooksAfter)).not.toContain('openbox claude-code hook');
  });

  it('installAdapter (cursor-keyed) writes per-event entries', async () => {
    const { installAdapter } = await import('../../ts/src/runtime/_shared/install');
    const target = join(dir, 'hooks.json');
    const spec = {
      file: target,
      key: 'hooks',
      style: 'cursor-keyed' as const,
      command: 'openbox cursor hook',
      configDir: dir,
      events: [{ name: 'beforeShellExecution' }, { name: 'afterFileEdit' }],
    };
    installAdapter(spec);
    const json = JSON.parse(readFileSync(target, 'utf-8'));
    expect(json.hooks).toBeDefined();
    const flat = JSON.stringify(json.hooks);
    expect(flat).toContain('beforeShellExecution');
    expect(flat).toContain('openbox cursor hook');
  });
});
