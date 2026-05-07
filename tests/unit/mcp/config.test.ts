import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
// Tests for the env + token resolver. These don't spin up the MCP
// server; they just exercise the pure functions in ../config.ts.

import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveEnv, readTokens, ENV_DEFAULTS, createApi, setMcpClientName } from '../../../ts/src/runtime/mcp/config.js';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  // Clear every env var this module reads so tests start clean.
  process.env = { ...ORIGINAL_ENV };
  delete process.env.OPENBOX_ENV;
  delete process.env.OPENBOX_API_URL;
  delete process.env.OPENBOX_CORE_URL;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('resolveEnv', () => {
  it('defaults to production when no OPENBOX_ENV is set', () => {
    const env = resolveEnv();
    expect(env.name).toBe('production');
    expect(env.apiUrl).toBe(ENV_DEFAULTS.production.api);
    expect(env.coreUrl).toBe(ENV_DEFAULTS.production.core);
  });

  it('honors OPENBOX_ENV=local', () => {
    process.env.OPENBOX_ENV = 'local';
    const env = resolveEnv();
    expect(env.name).toBe('local');
    expect(env.apiUrl).toBe('http://localhost:3000');
    expect(env.coreUrl).toBe('http://localhost:8086');
  });

  it('honors OPENBOX_ENV=staging', () => {
    process.env.OPENBOX_ENV = 'staging';
    const env = resolveEnv();
    expect(env.name).toBe('staging');
    expect(env.apiUrl).toBe(ENV_DEFAULTS.staging.api);
  });

  it('throws on unknown env name (no silent fallback)', () => {
    process.env.OPENBOX_ENV = 'nonsense';
    // Validation now goes through the SDK's resolveEnv; error format
    // is "Unknown environment: nonsense. Allowed: ..."
    expect(() => resolveEnv()).toThrow(/Unknown environment: nonsense/);
  });

  it('OPENBOX_API_URL / OPENBOX_CORE_URL override defaults', () => {
    process.env.OPENBOX_ENV = 'local';
    process.env.OPENBOX_API_URL = 'http://custom-api:4000';
    process.env.OPENBOX_CORE_URL = 'http://custom-core:4001';
    const env = resolveEnv();
    expect(env.apiUrl).toBe('http://custom-api:4000');
    expect(env.coreUrl).toBe('http://custom-core:4001');
  });

  it('case-insensitive env name', () => {
    process.env.OPENBOX_ENV = 'LOCAL';
    expect(resolveEnv().name).toBe('local');
  });
});

describe('readTokens', () => {
  let tmpDir: string;
  let tokensPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mcp-test-'));
    tokensPath = join(tmpDir, 'tokens');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads production.* entries for the production env', () => {
    writeFileSync(
      tokensPath,
      [
        'production.ACCESS_TOKEN=prod-access',
        'production.REFRESH_TOKEN=prod-refresh',
        'staging.ACCESS_TOKEN=staging-access',
      ].join('\n'),
    );
    const tok = readTokens({ envName: 'production', tokensPath });
    expect(tok.access).toBe('prod-access');
    expect(tok.refresh).toBe('prod-refresh');
  });

  it('reads local.* entries for the local env', () => {
    writeFileSync(
      tokensPath,
      [
        'production.ACCESS_TOKEN=prod-access',
        'local.ACCESS_TOKEN=local-access',
        'local.REFRESH_TOKEN=local-refresh',
      ].join('\n'),
    );
    const tok = readTokens({ envName: 'local', tokensPath });
    expect(tok.access).toBe('local-access');
    expect(tok.refresh).toBe('local-refresh');
  });

  it('does NOT roll legacy flat keys into local env (prevents prod token leak)', () => {
    writeFileSync(
      tokensPath,
      ['ACCESS_TOKEN=legacy-prod', 'ACCESS_TOKEN_WHATEVER=noise'].join('\n'),
    );
    expect(() => readTokens({ envName: 'local', tokensPath })).toThrow(/local/);
  });

  it('DOES roll legacy flat keys into production env (back-compat)', () => {
    writeFileSync(
      tokensPath,
      ['ACCESS_TOKEN=legacy-prod', 'REFRESH_TOKEN=legacy-refresh'].join('\n'),
    );
    const tok = readTokens({ envName: 'production', tokensPath });
    expect(tok.access).toBe('legacy-prod');
    expect(tok.refresh).toBe('legacy-refresh');
  });

  it('throws with a targeted message when the slot is empty for the requested env', () => {
    writeFileSync(tokensPath, 'staging.ACCESS_TOKEN=staging-only');
    expect(() => readTokens({ envName: 'local', tokensPath })).toThrow(
      /No local ACCESS_TOKEN or API_KEY/,
    );
  });

  it('returns api-key only (no ACCESS_TOKEN) when env slot has just an X-API-Key', () => {
    writeFileSync(tokensPath, 'staging.API_KEY=obx_key_test');
    const tok = readTokens({ envName: 'staging', tokensPath });
    expect(tok.access).toBeUndefined();
    expect(tok.apiKey).toBe('obx_key_test');
  });

  it('returns both access + apiKey when both are persisted', () => {
    writeFileSync(
      tokensPath,
      [
        'staging.ACCESS_TOKEN=jwt-staging',
        'staging.REFRESH_TOKEN=refresh-staging',
        'staging.API_KEY=obx_key_test',
      ].join('\n'),
    );
    const tok = readTokens({ envName: 'staging', tokensPath });
    expect(tok.access).toBe('jwt-staging');
    expect(tok.refresh).toBe('refresh-staging');
    expect(tok.apiKey).toBe('obx_key_test');
  });

  it('throws when the tokens file does not exist', () => {
    expect(() =>
      readTokens({ envName: 'local', tokensPath: join(tmpDir, 'does-not-exist') }),
    ).toThrow(/No tokens at/);
  });

  it('ignores blank lines and malformed lines', () => {
    writeFileSync(
      tokensPath,
      [
        '',
        '# comment-like',
        'production.ACCESS_TOKEN=real',
        'not a valid line',
        '   ',
      ].join('\n'),
    );
    const tok = readTokens({ envName: 'production', tokensPath });
    expect(tok.access).toBe('real');
  });
});

describe('setMcpClientName + createApi header', () => {
  // Use a tiny tmp tokens file + monkey-patched fetch to inspect the
  // outgoing X-Openbox-Client header per request.
  let tmpDir: string;
  let tokensPath: string;
  const origFetch = global.fetch;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mcp-headers-'));
    tokensPath = join(tmpDir, 'tokens');
    writeFileSync(tokensPath, 'production.ACCESS_TOKEN=fake-jwt\n');
    process.env.OPENBOX_ENV = 'production';
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    global.fetch = origFetch;
    // Reset module-scoped name so leakage between tests doesn't lie.
    setMcpClientName(undefined);
  });

  async function captureHeader(): Promise<string> {
    let captured = '';
    global.fetch = (async (_url: any, init: any) => {
      captured = init?.headers?.['X-Openbox-Client'] ?? '';
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as any;
    const api = createApi({ tokensPath });
    await api('/auth/profile');
    return captured;
  }

  it('defaults to bare runtime/mcp before initialize', async () => {
    expect(await captureHeader()).toBe('runtime/mcp');
  });

  it('appends the MCP client name once set', async () => {
    setMcpClientName('claude-code');
    expect(await captureHeader()).toBe('runtime/mcp/claude-code');
  });

  it('drops trailing-undefined and empty caller', async () => {
    setMcpClientName('');
    expect(await captureHeader()).toBe('runtime/mcp');
  });

  async function captureAuth(): Promise<{ apiKey?: string; bearer?: string }> {
    let captured: { apiKey?: string; bearer?: string } = {};
    global.fetch = (async (_url: any, init: any) => {
      const h = init?.headers ?? {};
      captured = { apiKey: h['X-API-Key'], bearer: h['Authorization'] };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as any;
    const api = createApi({ tokensPath });
    await api('/auth/profile');
    return captured;
  }

  it('prefers X-API-Key when API_KEY is present', async () => {
    writeFileSync(
      tokensPath,
      ['production.ACCESS_TOKEN=fake-jwt', 'production.API_KEY=obx_key_xyz'].join('\n'),
    );
    const { apiKey, bearer } = await captureAuth();
    expect(apiKey).toBe('obx_key_xyz');
    expect(bearer).toBeUndefined();
  });

  it('falls back to Authorization Bearer when only ACCESS_TOKEN is set', async () => {
    writeFileSync(tokensPath, 'production.ACCESS_TOKEN=fake-jwt\n');
    const { apiKey, bearer } = await captureAuth();
    expect(apiKey).toBeUndefined();
    expect(bearer).toBe('Bearer fake-jwt');
  });

  it('uses X-API-Key when API_KEY is the only credential', async () => {
    writeFileSync(tokensPath, 'production.API_KEY=obx_key_only\n');
    const { apiKey, bearer } = await captureAuth();
    expect(apiKey).toBe('obx_key_only');
    expect(bearer).toBeUndefined();
  });
});
