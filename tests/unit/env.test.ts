import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveConnection,
  parseTokenStore,
  serializeTokenStore,
  resolveClientName,
} from '../../ts/src/env/index.js';

describe('@openbox-ai/openbox-sdk/env URL resolution', () => {
  const original = {
    OPENBOX_API_URL: process.env.OPENBOX_API_URL,
    OPENBOX_CORE_URL: process.env.OPENBOX_CORE_URL,
    OPENBOX_PLATFORM_URL: process.env.OPENBOX_PLATFORM_URL,
    OPENBOX_AUTH_URL: process.env.OPENBOX_AUTH_URL,
  };

  beforeEach(() => {
    delete process.env.OPENBOX_API_URL;
    delete process.env.OPENBOX_CORE_URL;
    delete process.env.OPENBOX_PLATFORM_URL;
    delete process.env.OPENBOX_AUTH_URL;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('uses explicit API and core URLs without an environment selector', () => {
    process.env.OPENBOX_API_URL = 'https://api.example.test';
    process.env.OPENBOX_CORE_URL = 'https://core.example.test';
    process.env.OPENBOX_PLATFORM_URL = 'https://platform.example.invalid/';
    process.env.OPENBOX_AUTH_URL = 'https://auth.example.test/';
    const connection = resolveConnection();
    expect(connection.source).toBe('explicit');
    expect(connection.apiUrl).toBe('https://api.example.test');
    expect(connection.coreUrl).toBe('https://core.example.test');
    expect(connection.platformUrl).toBe('https://platform.example.invalid/');
    expect(connection.authUrl).toBe('https://auth.example.test/');
  });

  it('uses explicit option URLs over process env URLs', () => {
    process.env.OPENBOX_API_URL = 'https://api.example.test';
    process.env.OPENBOX_CORE_URL = 'https://core.example.test';
    const explicit = resolveConnection({
      apiUrl: 'http://localhost:8080/api/',
      coreUrl: 'http://127.0.0.1:8086/core/',
      platformUrl: 'http://localhost:3000',
      authUrl: 'http://localhost:3001',
    });
    expect(explicit).toMatchObject({
      source: 'explicit',
      apiUrl: 'http://localhost:8080/api',
      coreUrl: 'http://127.0.0.1:8086/core',
      platformUrl: 'http://localhost:3000',
      authUrl: 'http://localhost:3001',
    });
  });

  it('rejects empty and insecure service URLs outside loopback hosts', () => {
    expect(() =>
      resolveConnection({
        apiUrl: '   ',
        coreUrl: 'https://core.example.test',
      }),
    ).toThrow('OPENBOX_API_URL cannot be empty');
    expect(() =>
      resolveConnection({
        apiUrl: 'http://api.example.test',
        coreUrl: 'https://core.example.test',
      }),
    ).toThrow('OPENBOX_API_URL must use https://');
  });

  it('requires API and core URLs', () => {
    expect(() => resolveConnection()).toThrow(/OPENBOX_API_URL is required/);
  });
});

describe('@openbox-ai/openbox-sdk/env token-codec', () => {
  it('parses a flat token store', () => {
    const store = parseTokenStore(
      'ACCESS_TOKEN=abc\nREFRESH_TOKEN=def\nAPI_KEY=obx_key_test\nUPDATED_AT=2026-01-01T00:00:00Z\nPERMISSIONS=Admin, create:agent,, \nFEATURES=webhooks:true,sso:false,badpair\nUNKNOWN=ignored\n',
    );
    expect(store.accessToken).toBe('abc');
    expect(store.refreshToken).toBe('def');
    expect(store.apiKey).toBe('obx_key_test');
    expect(store.permissions).toEqual(['Admin', 'create:agent']);
    expect(store.features).toEqual({ webhooks: true, sso: false, badpair: false });
  });

  it('round-trips through serialize', () => {
    const store = parseTokenStore('API_KEY=obx_key_test\nUPDATED_AT=ts\n');
    expect(parseTokenStore(serializeTokenStore(store))).toEqual(store);
    expect(serializeTokenStore({})).toBe('');
    expect(
      serializeTokenStore({
        accessToken: 'access',
        refreshToken: '',
        apiKey: '',
        updatedAt: undefined,
        permissions: [],
        features: {},
      }),
    ).toBe('ACCESS_TOKEN=access\nREFRESH_TOKEN=\nUPDATED_AT=\n');
    expect(parseTokenStore('REFRESH_TOKEN=\nAPI_KEY=\n')).toEqual({
      refreshToken: undefined,
      apiKey: undefined,
    });
  });
});

describe('@openbox-ai/openbox-sdk/env resolveClientName', () => {
  it('returns the bare base when no variant is set', () => {
    expect(resolveClientName('openbox-cli')).toBe('openbox-cli');
  });

  it('appends an explicit variant argument', () => {
    expect(resolveClientName('openbox-cli', 'claude-code')).toBe('openbox-cli/claude-code');
  });

  it('rejects variants with disallowed chars and warns', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveClientName('openbox-cli', 'bad variant!')).toBe('openbox-cli');
    expect(warn).toHaveBeenCalled();
  });
});
