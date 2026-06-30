// Drift lock for OS / platform awareness.
//
//  - No `process.env.HOME` reads in `ts/src/`; shared OpenBox
//    persistence defaults to project-local paths, not user home.
//  - No hardcoded user paths; `/Users/...`, `/home/...`, `\\Users\\...`.
//  - Sensitive file writes (token store, session store, install-time
//    template configs) MUST set mode 0o600 so a shared Unix box doesn't
//    leak them. Windows ignores the bit, but the call still type-checks
//    so future cross-platform tooling has the metadata.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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
  it('no source file reads process.env.HOME', () => {
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

  it('no source file references a home-level OpenBox data root', () => {
    const files = listSourceFiles(SRC_ROOT);
    const offenders: { file: string; sample: string }[] = [];
    const patterns = [/~\/\.openbox/, /homedir\(\)[\s\S]{0,120}\.openbox/];
    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      for (const re of patterns) {
        const m = src.match(re);
        if (m) {
          offenders.push({ file, sample: m[0] });
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the shared secret writer is the single 0o600 authority + consumers route through it', () => {
    // Secret-bearing writes (token store, agent-keys cache, config) route through
    // ONE chokepoint: env/secret-file.ts. It must set 0o600 on create AND chmod
    // existing files (umask-proof). Verify the authority, then that each consumer
    // uses it with NO open-coded writeFileSync that could bypass the bit.
    const secret = readFileSync(`${SRC_ROOT}/env/secret-file.ts`, 'utf-8');
    expect(secret).toMatch(/\bwriteFileSync\b[^;]*0o600/s);
    expect(secret).toMatch(/\bchmodSync\b[^)]*0o600/s);
    for (const f of [
      'file-tokens/index.ts',
      'file-tokens/agent-keys.ts',
      'config/store.ts',
      'config/host-config.ts',
    ]) {
      const src = readFileSync(`${SRC_ROOT}/${f}`, 'utf-8');
      expect(src).toContain('writeSecretFile');
      expect(src.match(/\bwriteFileSync\b/g) ?? []).toHaveLength(0);
    }
  });

  it('not-yet-consolidated CLI/session/install secret writes still carry mode: 0o600', () => {
    // These open-code the write (separate dedup buckets); assert their 0o600.
    for (const f of ['cli/config.ts', 'session/store.ts']) {
      const src = readFileSync(`${SRC_ROOT}/${f}`, 'utf-8');
      const total = (src.match(/\bwriteFileSync\s*\(/g) ?? []).length;
      const secured = (src.match(/\bwriteFileSync\b[^;]*0o600/gs) ?? []).length;
      expect(total).toBeGreaterThanOrEqual(1);
      expect(secured).toBe(total);
    }
    expect(readFileSync(`${SRC_ROOT}/install/from-spec.ts`, 'utf-8')).toContain('mode: 0o600');
  });

  it('host runtime config resolvers do not read per-user hook dirs', () => {
    const claudeSrc = readFileSync(`${SRC_ROOT}/runtime/claude-code/config.ts`, 'utf-8');
    expect(claudeSrc).not.toContain("from 'node:os'");
    expect(claudeSrc).not.toContain('os.homedir()');
    expect(claudeSrc).toContain('claudeCodeRuntimeConfigDir');

    const cursorSrc = readFileSync(`${SRC_ROOT}/runtime/cursor/config.ts`, 'utf-8');
    expect(cursorSrc).not.toContain("from 'node:os'");
    expect(cursorSrc).not.toContain('os.homedir()');
    expect(cursorSrc).toContain('cursorRuntimeConfigDir');

    const codexSrc = readFileSync(`${SRC_ROOT}/runtime/codex/config.ts`, 'utf-8');
    expect(codexSrc).not.toContain("from 'node:os'");
    expect(codexSrc).not.toContain('os.homedir()');
    expect(codexSrc).toContain('codexRuntimeConfigDir');
  });

  it('does not track hook runtime session or log output', () => {
    const ignored = readFileSync('.gitignore', 'utf-8');
    for (const path of [
      '.openbox/claude-code/sessions/',
      '.openbox/claude-code/log/',
      '.openbox/codex/.env',
      '.openbox/codex/sessions/',
      '.openbox/codex/log/',
      '.openbox/cursor/.env',
      '.openbox/cursor/sessions/',
      '.openbox/cursor/log/',
    ]) {
      expect(ignored).toContain(path);
    }

    const tracked = execSync('git ls-files -z', { encoding: 'utf-8' })
      .split('\0')
      .filter(Boolean);
    const offenders = tracked.filter(
      (file) =>
        /^\.openbox\/(?:claude-code|codex|cursor)\/(?:sessions|log)\//.test(file) &&
        existsSync(file),
    );
    expect(offenders).toEqual([]);
  });

  it('hook adapters cap stdin at 10MB to prevent OOM on runaway pipes', () => {
    // The emitter writes defaultReadStdin into both runtime adapters.
    // A bug that drops the cap would expose every hook handler to an
    // unbounded buffer. Assert directly on the generated artifacts.
    for (const f of ['claude-code', 'codex', 'cursor']) {
      const src = readFileSync(`${SRC_ROOT}/core-client/generated/runtime/${f}.ts`, 'utf-8');
      expect(src, `runtime/${f} missing stdin size cap`).toMatch(/MAX_BYTES\s*=\s*10\s*\*\s*1024\s*\*\s*1024/);
      expect(src, `runtime/${f} missing stdin overflow throw`).toMatch(/total > MAX_BYTES/);
    }
  });

  it('resolveConnection rejects http:// to remote hosts', async () => {
    const { resolveConnection } = await import('../../ts/src/env');
    const before = process.env.OPENBOX_API_URL;
    const beforeCore = process.env.OPENBOX_CORE_URL;

    process.env.OPENBOX_API_URL = 'http://attacker.example.com';
    process.env.OPENBOX_CORE_URL = 'https://core.example/ob';
    try {
      expect(() => resolveConnection()).toThrow(/OPENBOX_API_URL must use https/);
    } finally {
      if (before !== undefined) process.env.OPENBOX_API_URL = before;
      else delete process.env.OPENBOX_API_URL;
      if (beforeCore !== undefined) process.env.OPENBOX_CORE_URL = beforeCore;
      else delete process.env.OPENBOX_CORE_URL;
    }

    // Loopback http:// must be allowed for local development.
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      process.env.OPENBOX_API_URL = `http://${host}:3000`;
      process.env.OPENBOX_CORE_URL = `http://${host}:8086`;
      expect(() => resolveConnection(), `loopback ${host} must be allowed`).not.toThrow();
    }

    if (before !== undefined) process.env.OPENBOX_API_URL = before;
    else delete process.env.OPENBOX_API_URL;
    if (beforeCore !== undefined) process.env.OPENBOX_CORE_URL = beforeCore;
    else delete process.env.OPENBOX_CORE_URL;
  });

});
