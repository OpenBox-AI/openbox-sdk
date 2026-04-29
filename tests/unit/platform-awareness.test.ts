// Drift lock for OS / platform awareness.
//
//  - No `process.env.HOME` reads in `ts/src/` - use `os.homedir()` so
//    Windows (where HOME is unset; USERPROFILE is the equivalent) works.
//  - No hardcoded user paths - `/Users/...`, `/home/...`, `\\Users\\...`.
//  - Sensitive file writes (token store, session store, install-time
//    template configs) MUST set mode 0o600 so a shared Unix box doesn't
//    leak them. Windows ignores the bit, but the call still type-checks
//    so future cross-platform tooling has the metadata.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SRC_ROOT = 'ts/src';

function listSourceFiles(root: string): string[] {
  const out = execSync(`find ${root} -type f -name '*.ts'`, { encoding: 'utf-8' });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((p) => !p.endsWith('.d.ts'))
    .filter((p) => !p.includes('/generated/'));
}

describe('platform / OS awareness contract', () => {
  it('no source file reads process.env.HOME (use os.homedir() instead)', () => {
    const files = listSourceFiles(SRC_ROOT);
    const offenders: string[] = [];
    // env-bindings.ts is generated and reads bound env vars; if HOME is
    // ever bound (it shouldn't be) that path is the one place it's OK.
    const allowed = new Set<string>([]);
    for (const file of files) {
      if (allowed.has(file)) continue;
      const src = readFileSync(file, 'utf-8');
      if (/process\.env\.HOME\b/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('no hardcoded user paths in source', () => {
    const files = listSourceFiles(SRC_ROOT);
    const offenders: { file: string; sample: string }[] = [];
    const PATTERNS = [
      /['"]\/Users\/[a-zA-Z0-9_-]+/,
      /['"]\/home\/[a-zA-Z0-9_-]+/,
      /['"]C:\\\\Users\\\\[a-zA-Z0-9_-]+/,
    ];
    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      for (const re of PATTERNS) {
        const m = src.match(re);
        if (m) {
          offenders.push({ file, sample: m[0] });
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('token-store writes carry mode: 0o600', () => {
    const src = readFileSync(`${SRC_ROOT}/cli/config.ts`, 'utf-8');
    // Count writeFileSync calls with 0o600 vs total, instead of slicing
    // syntax (paren-balancing regex is fragile). Token-store writes are
    // file-scope to cli/config.ts so the count comparison is exact.
    const total = (src.match(/\bwriteFileSync\s*\(/g) ?? []).length;
    const secured = (src.match(/\bwriteFileSync\b[^;]*0o600/gs) ?? []).length;
    expect(total).toBeGreaterThanOrEqual(4);
    expect(secured).toBe(total);
  });

  it('session-store and install template writes carry mode: 0o600', () => {
    const sessSrc = readFileSync(`${SRC_ROOT}/runtime/_shared/session-store.ts`, 'utf-8');
    expect(sessSrc).toMatch(/\bwriteFileSync\b[^;]*0o600/s);

    const installSrc = readFileSync(`${SRC_ROOT}/runtime/_shared/install.ts`, 'utf-8');
    // The template-config write (the one that contains a user-pasted
    // API key) MUST be 0o600. The settings.json/hooks.json saveJson is
    // editor-managed - kept at default mode by design.
    expect(installSrc).toContain('mode: 0o600');
  });

  it('agent-keys store writes carry mode: 0o600', () => {
    // The store caches obx_live_*/obx_test_* runtime keys captured by
    // `agent create` and `api-key rotate` post-callbacks. A regression
    // that drops the bit would leave runtime keys world-readable on
    // shared Unix boxes.
    const src = readFileSync(`${SRC_ROOT}/runtime/_shared/agent-keys-store.ts`, 'utf-8');
    const total = (src.match(/\bwriteFileSync\s*\(/g) ?? []).length;
    const secured = (src.match(/\bwriteFileSync\b[^;]*0o600/gs) ?? []).length;
    expect(total).toBeGreaterThanOrEqual(1);
    expect(secured).toBe(total);
  });

  it('config-store writes carry mode: 0o600', () => {
    // The CLI config store layers values into process.env on every
    // command (URL overrides, default flags). Some keys may carry
    // semi-sensitive values (org IDs, custom URLs, client variants),
    // so the file must not be world-readable.
    const src = readFileSync(`${SRC_ROOT}/cli/config-store.ts`, 'utf-8');
    const total = (src.match(/\bwriteFileSync\s*\(/g) ?? []).length;
    const secured = (src.match(/\bwriteFileSync\b[^;]*0o600/gs) ?? []).length;
    expect(total).toBeGreaterThanOrEqual(1);
    expect(secured).toBe(total);
  });

  it('os.homedir() is used wherever a per-user dir is built', () => {
    const claudeSrc = readFileSync(`${SRC_ROOT}/runtime/claude-code/config.ts`, 'utf-8');
    expect(claudeSrc).toContain("from 'node:os'");
    expect(claudeSrc).toContain('os.homedir()');

    const cursorSrc = readFileSync(`${SRC_ROOT}/runtime/cursor/config.ts`, 'utf-8');
    expect(cursorSrc).toContain("from 'node:os'");
    expect(cursorSrc).toContain('os.homedir()');
  });

  it('hook adapters cap stdin at 10MB to prevent OOM on runaway pipes', () => {
    // The emitter writes defaultReadStdin into both runtime adapters.
    // A bug that drops the cap would expose every hook handler to an
    // unbounded buffer. Assert directly on the generated artifacts.
    for (const f of ['claude-code', 'cursor']) {
      const src = readFileSync(`${SRC_ROOT}/core-client/generated/runtime/${f}.ts`, 'utf-8');
      expect(src, `runtime/${f} missing stdin size cap`).toMatch(/MAX_BYTES\s*=\s*10\s*\*\s*1024\s*\*\s*1024/);
      expect(src, `runtime/${f} missing stdin overflow throw`).toMatch(/total > MAX_BYTES/);
    }
  });

  it('resolveUrls rejects http:// to remote hosts in non-local envs', async () => {
    const { resolveUrls } = await import('../../ts/src/env');
    const before = process.env.OPENBOX_API_URL;

    // Remote http:// override on production/staging → reject (real attack
    // vector: CI misconfig points OPENBOX_API_URL at an attacker host).
    process.env.OPENBOX_API_URL = 'http://attacker.example.com';
    try {
      expect(() => resolveUrls('production')).toThrow(/http:\/\//);
      expect(() => resolveUrls('staging')).toThrow(/http:\/\//);
    } finally {
      if (before !== undefined) process.env.OPENBOX_API_URL = before;
      else delete process.env.OPENBOX_API_URL;
    }

    // Loopback http:// must be allowed regardless of env (covers e2e
    // tests that point at local backend with OPENBOX_ENV=production).
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      process.env.OPENBOX_API_URL = `http://${host}:3000`;
      expect(() => resolveUrls('production'), `loopback ${host} must be allowed`).not.toThrow();
    }

    // local env always accepts http://, even to remote hosts (dev workflow).
    process.env.OPENBOX_API_URL = 'http://my-dev-backend.lan';
    expect(() => resolveUrls('local')).not.toThrow();

    if (before !== undefined) process.env.OPENBOX_API_URL = before;
    else delete process.env.OPENBOX_API_URL;
  });

  it('auth login attempts multiple browser channels (cross-platform launch)', () => {
    // The CLI is the only browser-launch site. Asserting the fallback
    // chain is present prevents a "channel: chrome" regression that
    // would silently break Windows/Linux without Chrome installed.
    const src = readFileSync(`${SRC_ROOT}/cli/commands/auth.ts`, 'utf-8');
    expect(src).toContain("process.platform === 'win32'");
    expect(src).toMatch(/msedge|chromium/);
    expect(src).toContain('channels');
  });
});
