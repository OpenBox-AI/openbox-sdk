import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveConnection,
  endpointsFromStackUrl,
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
    OPENBOX_STACK_URL: process.env.OPENBOX_STACK_URL,
    OPENBOX_STACK_NAME: process.env.OPENBOX_STACK_NAME,
  };

  beforeEach(() => {
    delete process.env.OPENBOX_API_URL;
    delete process.env.OPENBOX_CORE_URL;
    delete process.env.OPENBOX_PLATFORM_URL;
    delete process.env.OPENBOX_AUTH_URL;
    delete process.env.OPENBOX_STACK_URL;
    delete process.env.OPENBOX_STACK_NAME;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('derives service endpoints from a stack URL', () => {
    expect(endpointsFromStackUrl('https://ipsum.lat')).toEqual({
      apiUrl: 'https://api.ipsum.lat/ob',
      coreUrl: 'https://core.ipsum.lat/ob',
      authUrl: 'https://auth.ipsum.lat/ob',
      platformUrl: 'https://ipsum.lat',
    });
    expect(endpointsFromStackUrl('api.ipsum.lat/path/?q=1#frag')).toEqual({
      apiUrl: 'https://api.ipsum.lat/ob',
      coreUrl: 'https://core.ipsum.lat/ob',
      authUrl: 'https://auth.ipsum.lat/ob',
      platformUrl: 'https://api.ipsum.lat/path',
    });
  });

  it('uses explicit API and core URLs without an environment selector', () => {
    process.env.OPENBOX_API_URL = 'https://api.ipsum.lat/ob';
    process.env.OPENBOX_CORE_URL = 'https://core.ipsum.lat/ob';
    process.env.OPENBOX_PLATFORM_URL = 'https://app.ipsum.lat/';
    process.env.OPENBOX_AUTH_URL = 'https://auth.ipsum.lat/';
    process.env.OPENBOX_STACK_NAME = 'staging';
    const connection = resolveConnection();
    expect(connection.source).toBe('explicit');
    expect(connection.apiUrl).toBe('https://api.ipsum.lat/ob');
    expect(connection.coreUrl).toBe('https://core.ipsum.lat/ob');
    expect(connection.platformUrl).toBe('https://app.ipsum.lat/');
    expect(connection.authUrl).toBe('https://auth.ipsum.lat/');
    expect(connection.displayName).toBe('staging');
  });

  it('derives stack connections and lets explicit URLs override stack endpoints', () => {
    process.env.OPENBOX_STACK_URL = 'localhost:3000/base/';
    const stack = resolveConnection();
    expect(stack.source).toBe('stack-url');
    expect(stack.apiUrl).toBe('https://api.localhost/ob');
    expect(stack.platformUrl).toBe('https://localhost:3000/base');

    const explicit = resolveConnection({
      stackUrl: 'https://ipsum.lat',
      apiUrl: 'http://localhost:8080/api/',
      coreUrl: 'http://127.0.0.1:8086/core/',
      platformUrl: 'http://localhost:3000',
      authUrl: 'http://localhost:3001',
      displayName: 'local',
    });
    expect(explicit).toMatchObject({
      source: 'explicit',
      apiUrl: 'http://localhost:8080/api',
      coreUrl: 'http://127.0.0.1:8086/core',
      platformUrl: 'http://localhost:3000',
      authUrl: 'http://localhost:3001',
      displayName: 'local',
    });
  });

  it('rejects empty and insecure service URLs outside loopback hosts', () => {
    expect(() => endpointsFromStackUrl('')).toThrow('stack URL cannot be empty');
    expect(() => endpointsFromStackUrl('http://ipsum.lat')).toThrow(
      'must use https://',
    );
    expect(() =>
      resolveConnection({
        apiUrl: '   ',
        coreUrl: 'https://core.ipsum.lat',
      }),
    ).toThrow('OPENBOX_API_URL cannot be empty');
    expect(() =>
      resolveConnection({
        apiUrl: 'http://api.ipsum.lat',
        coreUrl: 'https://core.ipsum.lat',
      }),
    ).toThrow('OPENBOX_API_URL must use https://');
  });

  it('requires API and core URLs when no stack URL is present', () => {
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

  it('ignores legacy dotted env-scoped lines', () => {
    const store = parseTokenStore('production.API_KEY=legacy\nAPI_KEY=current\n');
    expect(store.apiKey).toBe('current');
    expect(Object.keys(store)).toEqual(['apiKey']);
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
  const original = process.env.OPENBOX_CLIENT_VARIANT;

  beforeEach(() => {
    delete process.env.OPENBOX_CLIENT_VARIANT;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.OPENBOX_CLIENT_VARIANT;
    else process.env.OPENBOX_CLIENT_VARIANT = original;
  });

  it('returns the bare base when no variant is set', () => {
    expect(resolveClientName('openbox-cli')).toBe('openbox-cli');
  });

  it('appends an explicit variant argument', () => {
    expect(resolveClientName('openbox-cli', 'claude-code')).toBe('openbox-cli/claude-code');
  });

  it('falls back to OPENBOX_CLIENT_VARIANT', () => {
    process.env.OPENBOX_CLIENT_VARIANT = 'codex';
    expect(resolveClientName('openbox-cli')).toBe('openbox-cli/codex');
  });

  it('rejects variants with disallowed chars and warns', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveClientName('openbox-cli', 'bad variant!')).toBe('openbox-cli');
    expect(warn).toHaveBeenCalled();
  });
});
