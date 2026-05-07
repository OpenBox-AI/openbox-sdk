import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ENVIRONMENTS,
  resolveEnv,
  resolveUrls,
  parseTokenStore,
  serializeTokenStore,
  resolveClientName,
} from '../../ts/src/env/index.js';

describe('openbox-sdk/env environments', () => {
  describe('ENVIRONMENTS', () => {
    it('exposes URLs for production and local with the expected shape', () => {
      for (const env of ['production', 'local'] as const) {
        const cfg = ENVIRONMENTS[env];
        expect(cfg.apiUrl).toMatch(/^https?:\/\//);
        expect(cfg.coreUrl).toMatch(/^https?:\/\//);
        expect(cfg.platformUrl).toMatch(/^https?:\/\//);
      }
    });

    it('staging URLs default to empty strings (configured at runtime via env vars)', () => {
      expect(ENVIRONMENTS.staging.apiUrl).toBe('');
      expect(ENVIRONMENTS.staging.coreUrl).toBe('');
      expect(ENVIRONMENTS.staging.platformUrl).toBe('');
    });

    it('production and local have distinct URLs (no copy-paste drift)', () => {
      const apiUrls = new Set([
        ENVIRONMENTS.production.apiUrl,
        ENVIRONMENTS.local.apiUrl,
      ]);
      expect(apiUrls.size).toBe(2);
    });
  });

  describe('resolveEnv', () => {
    const original = process.env.OPENBOX_ENV;
    afterEach(() => {
      if (original === undefined) delete process.env.OPENBOX_ENV;
      else process.env.OPENBOX_ENV = original;
    });

    it('prefers cliFlag over OPENBOX_ENV', () => {
      process.env.OPENBOX_ENV = 'staging';
      expect(resolveEnv('local')).toBe('local');
    });

    it('falls back to OPENBOX_ENV when no cliFlag', () => {
      process.env.OPENBOX_ENV = 'staging';
      expect(resolveEnv()).toBe('staging');
    });

    it('defaults to production when nothing set', () => {
      delete process.env.OPENBOX_ENV;
      expect(resolveEnv()).toBe('production');
    });

    it('lowercases the input', () => {
      expect(resolveEnv('STAGING')).toBe('staging');
    });
  });

  describe('resolveUrls', () => {
    // tests/setup.ts pre-sets OPENBOX_API_URL/OPENBOX_CORE_URL to prod values
    // for other suites; we need to wipe them before each test here.
    const orig = {
      apiUrl: process.env.OPENBOX_API_URL,
      coreUrl: process.env.OPENBOX_CORE_URL,
      platformUrl: process.env.OPENBOX_PLATFORM_URL,
    };
    beforeEach(() => {
      delete process.env.OPENBOX_API_URL;
      delete process.env.OPENBOX_CORE_URL;
      delete process.env.OPENBOX_PLATFORM_URL;
    });
    afterEach(() => {
      for (const [k, v] of [
        ['OPENBOX_API_URL', orig.apiUrl],
        ['OPENBOX_CORE_URL', orig.coreUrl],
        ['OPENBOX_PLATFORM_URL', orig.platformUrl],
      ] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    it('returns the env defaults when no overrides', () => {
      expect(resolveUrls('production')).toEqual(ENVIRONMENTS.production);
    });

    it('OPENBOX_API_URL overrides only the apiUrl', () => {
      process.env.OPENBOX_API_URL = 'https://custom.example.com';
      const urls = resolveUrls('staging');
      expect(urls.apiUrl).toBe('https://custom.example.com');
      expect(urls.coreUrl).toBe(ENVIRONMENTS.staging.coreUrl);
      expect(urls.platformUrl).toBe(ENVIRONMENTS.staging.platformUrl);
    });
  });
});

describe('openbox-sdk/env token-codec', () => {
  describe('parseTokenStore', () => {
    it('parses a single env entry', () => {
      const store = parseTokenStore(
        'production.ACCESS_TOKEN=abc\nproduction.REFRESH_TOKEN=def\nproduction.UPDATED_AT=2026-01-01T00:00:00Z\n',
      );
      expect(store.production?.accessToken).toBe('abc');
      expect(store.production?.refreshToken).toBe('def');
      expect(store.production?.updatedAt).toBe('2026-01-01T00:00:00Z');
    });

    it('keeps multiple envs side-by-side', () => {
      const store = parseTokenStore(
        'production.ACCESS_TOKEN=p\nstaging.ACCESS_TOKEN=s\nlocal.ACCESS_TOKEN=l\n',
      );
      expect(store.production?.accessToken).toBe('p');
      expect(store.staging?.accessToken).toBe('s');
      expect(store.local?.accessToken).toBe('l');
    });

    it('treats legacy un-prefixed entries as production', () => {
      const store = parseTokenStore(
        'ACCESS_TOKEN=legacy-token\nREFRESH_TOKEN=legacy-refresh\nUPDATED_AT=legacy-ts\n',
      );
      expect(store.production?.accessToken).toBe('legacy-token');
      expect(store.production?.refreshToken).toBe('legacy-refresh');
      expect(store.staging).toBeUndefined();
    });

    it('namespaced production wins over legacy when both present', () => {
      const store = parseTokenStore(
        'ACCESS_TOKEN=legacy\nproduction.ACCESS_TOKEN=namespaced\n',
      );
      expect(store.production?.accessToken).toBe('namespaced');
    });

    it('parses permissions and features lists', () => {
      const store = parseTokenStore(
        'production.ACCESS_TOKEN=t\nproduction.PERMISSIONS=Admin,read:org,create:agent\nproduction.FEATURES=webhooks:true,sso:false\n',
      );
      expect(store.production?.permissions).toEqual(['Admin', 'read:org', 'create:agent']);
      expect(store.production?.features).toEqual({ webhooks: true, sso: false });
    });

    it('ignores unknown env names', () => {
      const store = parseTokenStore('preprod.ACCESS_TOKEN=ghost\nproduction.ACCESS_TOKEN=p\n');
      expect(store.production?.accessToken).toBe('p');
      expect(Object.keys(store)).toEqual(['production']);
    });

    it('round-trips through serialize', () => {
      const original =
        'production.ACCESS_TOKEN=p\nproduction.REFRESH_TOKEN=pr\nproduction.UPDATED_AT=ts\nstaging.ACCESS_TOKEN=s\nstaging.REFRESH_TOKEN=\nstaging.UPDATED_AT=\n';
      const store = parseTokenStore(original);
      const serialized = serializeTokenStore(store);
      expect(parseTokenStore(serialized)).toEqual(store);
    });
  });

  describe('serializeTokenStore', () => {
    it('skips envs with no access token', () => {
      const out = serializeTokenStore({
        production: { accessToken: 'p' },
        staging: { refreshToken: 'orphan' }, // no accessToken
      });
      // Primary env writes un-prefixed lines (no env name visible
      // unless the user opts into multi-env). Non-primary envs skip
      // entirely when they have no credential.
      expect(out).toContain('ACCESS_TOKEN=p');
      expect(out).not.toContain('staging.');
    });

    it('writes empty REFRESH_TOKEN line when refresh is undefined', () => {
      const out = serializeTokenStore({ production: { accessToken: 'p' } });
      expect(out).toContain('REFRESH_TOKEN=\n');
    });

    it('omits PERMISSIONS line when array is empty', () => {
      const out = serializeTokenStore({
        production: { accessToken: 'p', permissions: [] },
      });
      expect(out).not.toContain('PERMISSIONS');
    });
  });
});

describe('openbox-sdk/env resolveClientName', () => {
  const orig = process.env.OPENBOX_CLIENT_VARIANT;
  beforeEach(() => {
    delete process.env.OPENBOX_CLIENT_VARIANT;
  });
  afterEach(() => {
    if (orig === undefined) delete process.env.OPENBOX_CLIENT_VARIANT;
    else process.env.OPENBOX_CLIENT_VARIANT = orig;
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

  it('explicit argument wins over the env var', () => {
    process.env.OPENBOX_CLIENT_VARIANT = 'cursor';
    expect(resolveClientName('openbox-cli', 'claude-code')).toBe('openbox-cli/claude-code');
  });

  it('treats empty / whitespace variant as no variant', () => {
    expect(resolveClientName('openbox-cli', '  ')).toBe('openbox-cli');
    process.env.OPENBOX_CLIENT_VARIANT = '';
    expect(resolveClientName('openbox-cli')).toBe('openbox-cli');
  });

  it('rejects variants with disallowed chars and warns', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveClientName('openbox-cli', 'bad variant!')).toBe('openbox-cli');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('accepts the documented allowed character set', () => {
    expect(resolveClientName('openbox-cli', 'claude-code.v2_alpha+1')).toBe(
      'openbox-cli/claude-code.v2_alpha+1',
    );
  });
});
