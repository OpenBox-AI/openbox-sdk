import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readTokens, createApi, setMcpClientName } from '../../../ts/src/runtime/mcp/config.js';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.OPENBOX_API_URL = 'http://localhost:3000';
  process.env.OPENBOX_CORE_URL = 'http://localhost:8086';
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
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

  it('reads flat token entries', () => {
    writeFileSync(tokensPath, 'ACCESS_TOKEN=access\nREFRESH_TOKEN=refresh\nAPI_KEY=obx_key_test\n');
    const tokens = readTokens({ tokensPath });
    expect(tokens.access).toBe('access');
    expect(tokens.refresh).toBe('refresh');
    expect(tokens.apiKey).toBe('obx_key_test');
  });

  it('ignores legacy env-prefixed token entries', () => {
    writeFileSync(tokensPath, 'production.API_KEY=legacy\n');
    expect(() => readTokens({ tokensPath })).toThrow(/No API_KEY/);
  });

  it('throws when the tokens file does not exist', () => {
    expect(() => readTokens({ tokensPath: join(tmpDir, 'does-not-exist') })).toThrow(/No tokens at/);
  });
});

describe('setMcpClientName + createApi header', () => {
  let tmpDir: string;
  let tokensPath: string;
  const origFetch = global.fetch;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mcp-headers-'));
    tokensPath = join(tmpDir, 'tokens');
    writeFileSync(tokensPath, 'ACCESS_TOKEN=fake-jwt\n');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    global.fetch = origFetch;
    setMcpClientName(undefined);
  });

  async function captureHeader(): Promise<string> {
    let captured = '';
    global.fetch = (async (_url: unknown, init: RequestInit) => {
      captured = (init.headers as Record<string, string>)['X-Openbox-Client'] ?? '';
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
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
});
