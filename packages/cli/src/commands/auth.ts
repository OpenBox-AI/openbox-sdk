import { Command } from 'commander';
import {
  getClient,
  loadFeatures,
  loadPermissions,
  saveFeatures,
  saveTokens,
  savePermissions,
} from '../config.js';
import type { FeatureMap } from '../config.js';
import { resolveEnv, resolveUrls } from '../environments.js';
import { output } from '../output.js';
import type { EnvName } from '../environments.js';

async function fetchAndCachePermissions(
  env: EnvName,
  accessToken: string,
  apiUrl: string,
): Promise<{ orgId?: string; permissions?: string[] } | undefined> {
  try {
    const res = await fetch(`${apiUrl}/auth/profile`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Openbox-Client': 'openbox-cli',
      },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { permissions?: unknown };
    const data = (body as { data?: { permissions?: unknown; orgId?: string } }).data ?? body;
    const perms = (data as { permissions?: unknown }).permissions;
    const orgId = (data as { orgId?: unknown }).orgId;
    const list = Array.isArray(perms)
      ? perms.filter((p): p is string => typeof p === 'string')
      : undefined;
    if (list) savePermissions(env, list);
    return {
      orgId: typeof orgId === 'string' ? orgId : undefined,
      permissions: list,
    };
  } catch {
    return undefined;
  }
}

async function fetchAndCacheFeatures(
  env: EnvName,
  accessToken: string,
  apiUrl: string,
  orgId: string,
): Promise<FeatureMap | undefined> {
  try {
    const res = await fetch(
      `${apiUrl}/organization/${encodeURIComponent(orgId)}/features`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Openbox-Client': 'openbox-cli',
        },
      },
    );
    if (!res.ok) return undefined;
    const body = (await res.json()) as { data?: unknown };
    const data = body.data ?? body;
    if (!data || typeof data !== 'object') return undefined;
    const features: FeatureMap = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (typeof v === 'boolean') features[k] = v;
    }
    if (Object.keys(features).length === 0) return undefined;
    saveFeatures(env, features);
    return features;
  } catch {
    return undefined;
  }
}

function deepFindToken(
  obj: unknown,
  keys: readonly string[],
  depth = 0,
): string | undefined {
  if (depth > 6 || obj == null) return undefined;
  if (typeof obj === 'string') {
    // Some apps stash the refresh token as a raw string at a top-level key.
    return undefined;
  }
  if (typeof obj !== 'object') return undefined;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (keys.includes(k) && typeof v === 'string' && v.length > 20) return v;
    const nested = deepFindToken(v, keys, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

const RT_KEYS = ['refresh_token', 'refreshToken', 'refreshtoken'];
const AT_KEYS = ['access_token', 'accessToken', 'accesstoken'];

async function browserLogin(platformUrl: string, env: EnvName, verbose = false) {
  const { chromium } = await import('playwright');

  console.error(`Opening browser for login (${env}: ${platformUrl})...`);

  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext();
  const page = await context.newPage();

  const TIMEOUT_MS = 300_000;
  const POLL_MS = 500;
  const deadline = Date.now() + TIMEOUT_MS;
  const { apiUrl } = resolveUrls(env);

  let accessToken: string | undefined;
  let refreshToken: string | undefined;
  let userClosed = false;
  const tokenResponseHits: string[] = [];

  browser.on('disconnected', () => {
    userClosed = true;
  });

  // Capture refresh token from ANY JSON response whose body contains one.
  // No URL filter - Keycloak, NextAuth callbacks, BFF proxies all end up here.
  context.on('response', async (res) => {
    try {
      const ct = res.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      const body = await res.json().catch(() => null);
      if (!body || typeof body !== 'object') return;
      const at = deepFindToken(body, AT_KEYS);
      const rt = deepFindToken(body, RT_KEYS);
      if (at || rt) {
        tokenResponseHits.push(res.url());
        if (verbose) console.error(`[token-response] ${res.url()} at=${!!at} rt=${!!rt}`);
      }
      if (at && !accessToken) accessToken = at;
      if (rt) refreshToken = rt; // always take the latest (rotated) refresh token
    } catch {
      /* noop */
    }
  });

  // Fallback: pick up the access token from any Bearer header the SPA emits.
  context.on('request', (req) => {
    if (accessToken) return;
    const authHeader = req.headers()['authorization'];
    if (!authHeader?.toLowerCase().startsWith('bearer ')) return;
    const token = authHeader.slice(7).trim();
    if (token.length < 20) return;
    if (!req.url().startsWith(apiUrl)) return; // only trust tokens sent to our backend
    accessToken = token;
  });

  try {
    await page.goto(platformUrl);
    console.error('Waiting for login - complete the flow in the browser...');

    while (Date.now() < deadline && !userClosed && !accessToken) {
      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    if (userClosed && !accessToken) throw new Error('Browser was closed before login completed');
    if (!accessToken) throw new Error('Login timed out after 5 minutes');

    // Give the SPA a moment after the first Bearer appears - the token exchange
    // response often arrives microseconds later and carries refresh_token.
    if (!refreshToken) await new Promise((r) => setTimeout(r, 2000));

    // Last-ditch: sweep cookies + local/session storage for a refresh token.
    if (!refreshToken) {
      try {
        const cookies = await context.cookies();
        for (const c of cookies) {
          if (RT_KEYS.includes(c.name.toLowerCase()) && c.value.length > 20) {
            refreshToken = c.value;
            break;
          }
          // Keycloak-js often writes JSON-encoded values into cookies
          try {
            const parsed = JSON.parse(c.value);
            const rt = deepFindToken(parsed, RT_KEYS);
            if (rt) {
              refreshToken = rt;
              break;
            }
          } catch {
            /* not json */
          }
        }
      } catch {
        /* noop */
      }
    }
    if (!refreshToken) {
      try {
        refreshToken = await page.evaluate(
          ([rtKeys]) => {
            const probe = (store: Storage): string | undefined => {
              for (let i = 0; i < store.length; i++) {
                const key = store.key(i);
                if (!key) continue;
                const v = store.getItem(key);
                if (!v) continue;
                if (rtKeys.includes(key.toLowerCase()) && v.length > 20) return v;
                try {
                  const parsed = JSON.parse(v);
                  const walk = (o: unknown): string | undefined => {
                    if (!o || typeof o !== 'object') return undefined;
                    for (const [k, val] of Object.entries(o as Record<string, unknown>)) {
                      if (rtKeys.includes(k.toLowerCase()) && typeof val === 'string' && val.length > 20) return val;
                      if (typeof val === 'object') {
                        const r = walk(val);
                        if (r) return r;
                      }
                    }
                    return undefined;
                  };
                  const found = walk(parsed);
                  if (found) return found;
                } catch {
                  /* not json */
                }
              }
              return undefined;
            };
            return probe(localStorage) ?? probe(sessionStorage);
          },
          [RT_KEYS],
        );
      } catch {
        /* noop */
      }
    }

    saveTokens(env, accessToken, refreshToken);

    // Cache permissions so pre-flight checks can surface "you lack X" locally.
    const profile = await fetchAndCachePermissions(env, accessToken, apiUrl);
    const perms = profile?.permissions;

    // Cache feature flags per env - these gate api-key / webhook / sso
    // controllers server-side via @RequireFeature in openbox-backend.
    let features: FeatureMap | undefined;
    if (profile?.orgId) {
      features = await fetchAndCacheFeatures(env, accessToken, apiUrl, profile.orgId);
    }

    if (refreshToken) {
      console.error(`Login successful! Token saved for environment: ${env}`);
      if (perms) {
        console.error(`  Cached ${perms.length} permissions for pre-flight checks.`);
      }
      if (features) {
        const fmt = Object.entries(features)
          .map(([k, v]) => `${k}=${v ? 'on' : 'off'}`)
          .join(', ');
        console.error(`  Features for this env: ${fmt}`);
      }
      console.error(
        '  Note: refresh token captured and stored, but auto-refresh is currently DISABLED',
      );
      console.error(
        '  pending upstream /auth/refresh fixes. Re-login when the access token expires.',
      );
    } else {
      console.error(
        `Login successful! Token saved for environment: ${env} (WARNING: no refresh token captured).`,
      );
      console.error(
        `  Token-bearing responses seen (${tokenResponseHits.length}): ${tokenResponseHits.slice(0, 5).join(', ') || '<none>'}`,
      );
      console.error(
        `  Re-run with --verbose for full response URL dump, or report this output so we can map the refresh-token source.`,
      );
    }
    await browser.close();
  } finally {
    if (!userClosed) await browser.close().catch(() => {});
  }
}

export function registerAuthCommands(program: Command) {
  const auth = program.command('auth').description('Authentication');

  auth
    .command('login')
    .description('Login via browser (opens platform login page)')
    .option('--browser', 'Open browser for login', true)
    .option('--url <url>', 'Override platform URL (defaults to env-specific URL)')
    .option('--verbose', 'Log every JSON response containing a token (debugging)')
    .action(async (opts) => {
      try {
        const env = resolveEnv();
        const platformUrl = opts.url || resolveUrls(env).platformUrl;
        await browserLogin(platformUrl, env, !!opts.verbose);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  auth
    .command('permissions')
    .alias('perms')
    .description("Show cached permissions for the current env (or --all / --compare)")
    .option('--all', 'Show permissions for every cached env')
    .option('--compare <env>', 'Compare the current env against another (diff)')
    .option('--refresh', 'Re-fetch permissions from /auth/profile before printing')
    .action(async (opts) => {
      try {
        const envs: EnvName[] = opts.all ? ['production', 'staging'] : [resolveEnv()];

        if (opts.refresh) {
          for (const env of envs) {
            try {
              const client = getClient(env);
              const profile = (await client.getProfile()) as { permissions?: string[] };
              if (Array.isArray(profile.permissions)) {
                savePermissions(env, profile.permissions);
              }
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[${env}] refresh failed: ${msg}`);
            }
          }
        }

        for (const env of envs) {
          const perms = loadPermissions(env);
          console.log(`# ${env} (${perms.length} permission${perms.length === 1 ? '' : 's'})`);
          for (const p of [...perms].sort()) console.log(`  ${p}`);
          console.log('');
        }

        if (opts.compare) {
          const other = opts.compare as EnvName;
          if (other !== 'production' && other !== 'staging') {
            console.error(`--compare must be 'production' or 'staging', got '${other}'`);
            process.exit(1);
          }
          const current = resolveEnv();
          const a = new Set(loadPermissions(current));
          const b = new Set(loadPermissions(other));
          const onlyA = [...a].filter((p) => !b.has(p)).sort();
          const onlyB = [...b].filter((p) => !a.has(p)).sort();
          console.log(`# diff: ${current} vs ${other}`);
          console.log(`only in ${current} (${onlyA.length}):`);
          for (const p of onlyA) console.log(`  + ${p}`);
          console.log(`only in ${other} (${onlyB.length}):`);
          for (const p of onlyB) console.log(`  - ${p}`);
        }
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  auth
    .command('features')
    .description('Show cached per-env feature flags (api_keys / webhooks / sso)')
    .option('--all', 'Show features for every cached env')
    .option('--refresh', 'Re-fetch from /organization/{orgId}/features before printing')
    .action(async (opts) => {
      try {
        const envs: EnvName[] = opts.all ? ['production', 'staging'] : [resolveEnv()];
        if (opts.refresh) {
          for (const env of envs) {
            try {
              const tokens = (await import('../config.js')).loadTokens(env);
              const { apiUrl } = resolveUrls(env);
              const profile = await fetchAndCachePermissions(env, tokens.accessToken, apiUrl);
              if (profile?.orgId) {
                await fetchAndCacheFeatures(env, tokens.accessToken, apiUrl, profile.orgId);
              }
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[${env}] refresh failed: ${msg}`);
            }
          }
        }
        for (const env of envs) {
          const features = loadFeatures(env);
          const keys = Object.keys(features).sort();
          console.log(`# ${env} (${keys.length} feature${keys.length === 1 ? '' : 's'})`);
          if (keys.length === 0) {
            console.log('  (none cached - run `openbox auth login` or re-run with --refresh)');
          } else {
            for (const k of keys) console.log(`  ${k.padEnd(18)} ${features[k] ? 'on' : 'off'}`);
          }
          console.log('');
        }
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  auth
    .command('profile')
    .description('Get current user profile')
    .action(async () => {
      try {
        const env = resolveEnv();
        const client = getClient(env);
        const data = (await client.getProfile()) as { permissions?: unknown };
        // Opportunistically refresh the cache whenever /auth/profile is called.
        if (Array.isArray((data as { permissions?: unknown }).permissions)) {
          const perms = ((data as { permissions?: unknown[] }).permissions ?? []).filter(
            (p): p is string => typeof p === 'string',
          );
          savePermissions(env, perms);
        }
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  auth
    .command('set-token <token> [refreshToken]')
    .description('Save access token (and optional refresh token) to tokens file')
    .action(async (token: string, refreshToken?: string) => {
      try {
        const env = resolveEnv();
        saveTokens(env, token, refreshToken);
        console.error(`Token saved for environment: ${env}`);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  auth
    .command('refresh')
    .description('Refresh access token (currently broken upstream - see command output)')
    .action(async () => {
      console.error(
        [
          'openbox auth refresh is DISABLED.',
          '',
          'The upstream /auth/refresh endpoint has two known bugs that prevent',
          'successful refresh even with valid credentials:',
          '  • openbox-backend passes the wrong claim as the identity-provider realm',
          '  • openbox-fe sends the request body in snake_case while the backend DTO',
          '    expects camelCase',
          '',
          'Both fixes need to land upstream before auto-refresh can be re-enabled.',
          'Until then, the recovery path is: openbox auth login  (browser-based)',
          'or: openbox auth set-token <token>  (paste).',
          '',
          'Once the fixes are deployed, flip REFRESH_ENABLED in src/client.ts to true.',
        ].join('\n'),
      );
      process.exit(2);
    });

  auth
    .command('change-password')
    .description('Change password')
    .requiredOption('--current <password>', 'Current password')
    .requiredOption('--new <password>', 'New password')
    .requiredOption('--org-id <orgId>', 'Organization ID')
    .action(async (opts) => {
      try {
        const data = await getClient().changePassword({
          currentPassword: opts.current,
          newPassword: opts.new,
          orgId: opts.orgId,
        });
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  auth
    .command('roles')
    .description('Get current user roles')
    .action(async () => {
      try {
        const data = await getClient().getUserRoles();
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
