import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ENVIRONMENTS,
  resolveEnv,
  resolveUrls,
  parseTokenStore,
  serializeTokenStore,
} from '../../packages/env/src/index.js';

describe('openbox-sdk/env environments', () => {
  describe('ENVIRONMENTS', () => {
    it('exposes all three envs with the expected URL shape', () => {
      for (const env of ['production', 'staging', 'local'] as const) {
        const cfg = ENVIRONMENTS[env];
        expect(cfg.apiUrl).toMatch(/^https?:\/\//);
        expect(cfg.coreUrl).toMatch(/^https?:\/\//);
        expect(cfg.platformUrl).toMatch(/^https?:\/\//);
      }
    });

    it('has distinct URLs across envs (no copy-paste drift)', () => {
      const apiUrls = new Set([
        ENVIRONMENTS.production.apiUrl,
        ENVIRONMENTS.staging.apiUrl,
        ENVIRONMENTS.local.apiUrl,
      ]);
      expect(apiUrls.size).toBe(3);
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
      expect(out).toContain('production.ACCESS_TOKEN=p');
      expect(out).not.toContain('staging.');
    });

    it('writes empty REFRESH_TOKEN line when refresh is undefined', () => {
      const out = serializeTokenStore({ production: { accessToken: 'p' } });
      expect(out).toContain('production.REFRESH_TOKEN=\n');
    });

    it('omits PERMISSIONS line when array is empty', () => {
      const out = serializeTokenStore({
        production: { accessToken: 'p', permissions: [] },
      });
      expect(out).not.toContain('PERMISSIONS');
    });
  });
});
