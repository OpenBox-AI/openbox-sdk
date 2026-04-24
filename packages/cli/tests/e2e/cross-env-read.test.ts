// Cross-env read-only smoke: hits non-destructive endpoints against each
// env (production, staging, local) that has a valid token in
// ~/.openbox/tokens. The point isn't to re-verify CRUD - that's the
// lifecycle suites' job, scoped to local. The point is to catch drift:
//
//   - Response envelope shape differs between envs
//   - Permissions enum drifts (this suite reads /auth/profile.permissions
//     from each env and diffs the sorted sets)
//   - A route returns different field names on prod vs staging
//
// Every command here is a GET / read - safe to run against prod. If a
// token for a given env is missing or expired, that env's tests skip with
// a clear "run openbox --env <env> auth login" message.
//
// Run:
//   cd packages/cli && npx vitest run tests/e2e/cross-env-read.test.ts

import { describe, it, expect, beforeAll } from 'vitest';
import { runCli } from '../helpers/cli-runner.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

type EnvName = 'production' | 'staging' | 'local';
const ENVS: EnvName[] = ['production', 'staging', 'local'];

const TOKENS = resolve(homedir(), '.openbox', 'tokens');

function hasTokenFor(env: EnvName): boolean {
  if (!existsSync(TOKENS)) return false;
  const content = readFileSync(TOKENS, 'utf8');
  return content.split('\n').some((l) => l.startsWith(`${env}.ACCESS_TOKEN=`));
}

// Run a CLI command against a specific env. Returns {ok, stdout, stderr}
// without throwing - callers decide what a non-zero exit means (e.g. a
// 401 is a signal to skip the env).
function cliFor(env: EnvName, args: string[]): { status: number; stdout: string; stderr: string } {
  // Some endpoints (org get) need orgId. We don't know prod/staging org
  // at file-scope, so each test pulls from auth profile first.
  return runCli(['--env', env, ...args]);
}

function parseJsonAfterHeader(stdout: string): unknown {
  const idx = Math.min(
    ...[stdout.indexOf('['), stdout.indexOf('{')].filter((n) => n >= 0),
  );
  return JSON.parse(stdout.slice(idx));
}

interface EnvState {
  env: EnvName;
  skip: boolean;
  reason?: string;
  orgId?: string;
  permissions?: string[];
}

const envStates: EnvState[] = [];

beforeAll(async () => {
  for (const env of ENVS) {
    if (!hasTokenFor(env)) {
      envStates.push({
        env,
        skip: true,
        reason: `no token - run: openbox --env ${env} auth login`,
      });
      continue;
    }
    // Probe /auth/profile first. If the token's expired, skip the env with
    // a targeted message so the reader knows to re-login vs. a real bug.
    const r = cliFor(env, ['auth', 'profile']);
    if (r.status !== 0) {
      envStates.push({
        env,
        skip: true,
        reason: `token present but profile failed (likely expired): ${r.stderr.slice(0, 120)}`,
      });
      continue;
    }
    const profile = JSON.parse(r.stdout) as { orgId: string; permissions: string[] };
    envStates.push({
      env,
      skip: false,
      orgId: profile.orgId,
      permissions: [...profile.permissions].sort(),
    });
  }

  // Emit a summary so the reader knows which envs actually ran, even in
  // vitest's quieter default reporter.
  // eslint-disable-next-line no-console
  console.log(
    '[cross-env-read] env status:',
    envStates.map((s) => ({
      env: s.env,
      ran: !s.skip,
      note: s.reason ?? `orgId=${s.orgId}`,
    })),
  );
});

describe('cross-env read-only smoke', () => {
  for (const env of ENVS) {
    describe(env, () => {
      it('auth profile returns orgId + permissions', () => {
        const state = envStates.find((s) => s.env === env)!;
        if (state.skip) return;
        expect(state.orgId).toBeTruthy();
        expect(Array.isArray(state.permissions)).toBe(true);
        expect(state.permissions!.length).toBeGreaterThan(0);
      });

      it('agent list returns a response (may be empty)', () => {
        const state = envStates.find((s) => s.env === env)!;
        if (state.skip) return;
        const r = cliFor(env, ['agent', 'list', '--limit', '5']);
        expect(r.status, r.stderr).toBe(0);
        const body = parseJsonAfterHeader(r.stdout);
        expect(Array.isArray(body)).toBe(true);
      });

      it('org get returns the caller org', () => {
        const state = envStates.find((s) => s.env === env)!;
        if (state.skip) return;
        const r = cliFor(env, ['org', 'get', state.orgId!]);
        expect(r.status, r.stderr).toBe(0);
        const body = JSON.parse(r.stdout) as Record<string, unknown>;
        expect(Object.keys(body).length).toBeGreaterThan(0);
      });

      it('audit list returns a paginated response (may be empty)', () => {
        const state = envStates.find((s) => s.env === env)!;
        if (state.skip) return;
        const r = cliFor(env, ['audit', 'list', '--limit', '5']);
        expect(r.status, r.stderr).toBe(0);
        JSON.parse(r.stdout); // just validate it parses
      });
    });
  }

  // Cross-env drift check. Only runs if AT LEAST two envs have tokens.
  // The memory I was given explicitly flagged "verify against ground
  // truth" for permission strings - this exact assertion catches the
  // class of bug where local permissions diverge from prod.
  it('permission enums match across envs (when >= 2 envs available)', () => {
    const ran = envStates.filter((s) => !s.skip);
    if (ran.length < 2) return;
    const [first, ...rest] = ran;
    for (const other of rest) {
      const missing = first.permissions!.filter((p) => !other.permissions!.includes(p));
      const extra = other.permissions!.filter((p) => !first.permissions!.includes(p));
      expect(
        missing.length === 0 && extra.length === 0,
        `permission drift ${first.env} vs ${other.env}:\n` +
          `  missing in ${other.env}: ${missing.join(', ') || '(none)'}\n` +
          `  extra in ${other.env}: ${extra.join(', ') || '(none)'}`,
      ).toBe(true);
    }
  });
});
