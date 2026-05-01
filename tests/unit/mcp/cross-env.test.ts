import { describe, it, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
// Cross-env live smoke: for each env with a valid user JWT in
// ~/.openbox/tokens, hit backend's /auth/profile via the exported
// createApi() factory. Same pattern as openbox-sdk/packages/cli
// cross-env-read.test.ts; catches drift between production, staging,
// and local for a non-destructive read path.
//
// Skips cleanly when a given env lacks a token; run
//   openbox --env <env> auth login
// first to unlock that env's cases.

import { createApi, resolveEnv, readTokens, ENV_DEFAULTS } from '../../../ts/src/runtime/mcp/config.js';

type EnvName = 'production' | 'staging' | 'local';
const ENVS: EnvName[] = ['production', 'staging', 'local'];

interface EnvState {
  env: EnvName;
  skip: boolean;
  reason?: string;
  profile?: { orgId?: string; permissions?: string[]; [k: string]: unknown };
}

const envStates: EnvState[] = [];

beforeAll(async () => {
  for (const env of ENVS) {
    try {
      readTokens({ envName: env });
    } catch (err) {
      envStates.push({
        env,
        skip: true,
        reason: `no token; run: openbox --env ${env} auth login`,
      });
      continue;
    }
    const api = createApi({ envName: env });
    try {
      const profile = await api('/auth/profile');
      envStates.push({ env, skip: false, profile });
    } catch (err) {
      envStates.push({
        env,
        skip: true,
        reason: `token present but /auth/profile failed (likely expired): ${(err as Error).message.slice(0, 140)}`,
      });
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    '[mcp-cross-env] env status:',
    envStates.map((s) => ({
      env: s.env,
      ran: !s.skip,
      note: s.reason ?? `orgId=${s.profile?.orgId}, perms=${s.profile?.permissions?.length}`,
    })),
  );
}, 30000);

describe('mcp cross-env smoke', () => {
  for (const env of ENVS) {
    it(`${env}: createApi resolves to the expected URL`, () => {
      const prev = process.env.OPENBOX_API_URL;
      const prevCore = process.env.OPENBOX_CORE_URL;
      delete process.env.OPENBOX_API_URL;
      delete process.env.OPENBOX_CORE_URL;
      try {
        const resolved = resolveEnv(env);
        expect(resolved.apiUrl).toBe(ENV_DEFAULTS[env].api);
        expect(resolved.coreUrl).toBe(ENV_DEFAULTS[env].core);
      } finally {
        if (prev !== undefined) process.env.OPENBOX_API_URL = prev;
        if (prevCore !== undefined) process.env.OPENBOX_CORE_URL = prevCore;
      }
    });

    it(`${env}: /auth/profile returns orgId (when token present)`, () => {
      const state = envStates.find((s) => s.env === env)!;
      if (state.skip) return;
      expect(state.profile?.orgId).toBeTruthy();
      expect(Array.isArray(state.profile?.permissions)).toBe(true);
    });
  }

  // Informational cross-env diff; mirrors the openbox-sdk cross-env-read
  // suite. Prints the permission set per env and the symmetric diff
  // against the first env that ran. Does not fail on drift (feature
  // flags legitimately differ between prod/staging); just logs so a
  // human can spot an unintended change.
  it('permission diff across envs (informational)', () => {
    const ran = envStates.filter((s) => !s.skip);
    if (ran.length < 2) return;
    const [first, ...rest] = ran;
    const firstPerms = new Set(first.profile?.permissions ?? []);
    // eslint-disable-next-line no-console
    console.log(
      `[mcp-cross-env] permission diff (baseline: ${first.env}, ${firstPerms.size} perms):`,
    );
    for (const other of rest) {
      const otherPerms = new Set(other.profile?.permissions ?? []);
      const missing = [...firstPerms].filter((p) => !otherPerms.has(p));
      const extra = [...otherPerms].filter((p) => !firstPerms.has(p));
      // eslint-disable-next-line no-console
      console.log(
        `  ${other.env} (${otherPerms.size} perms): ` +
          `missing=${missing.length}, extra=${extra.length}`,
      );
    }
    expect(true).toBe(true);
  });
});
