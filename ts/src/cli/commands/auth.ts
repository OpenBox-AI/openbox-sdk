import { Command } from 'commander';
import { OpenBoxClient } from '../../client/index.js';
import {
  getClient,
  loadFeatures,
  loadPermissions,
  saveFeatures,
  saveTokens,
  savePermissions,
  clearTokens,
  hasTokens,
} from '../config.js';
import type { FeatureMap } from '../config.js';
import { resolveEnv, resolveUrls } from '../../env/index.js';
import { output } from '../output.js';
import type { EnvName } from '../../env/index.js';
import { reportAndExit } from '../../validators/index.js';
import { EXIT, bailWith } from '../exit-codes.js';
import { isNonInteractive, requireYesForDestructive } from '../non-interactive.js';

// Build an OpenBoxClient against a freshly-captured token (saveTokens
// hasn't been called yet, so getClient() can't do this for us).
function clientFor(env: EnvName, apiUrl: string, accessToken: string): OpenBoxClient {
  return new OpenBoxClient({
    apiUrl,
    env,
    accessToken,
    clientName: 'openbox-cli',
  });
}

async function fetchAndCachePermissions(
  env: EnvName,
  accessToken: string,
  apiUrl: string,
): Promise<{ orgId?: string; permissions?: string[] } | undefined> {
  try {
    const profile = (await clientFor(env, apiUrl, accessToken).getProfile()) as {
      permissions?: unknown;
      orgId?: unknown;
    };
    const perms = profile?.permissions;
    const orgId = profile?.orgId;
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
    const data = (await clientFor(env, apiUrl, accessToken).getOrgFeatures(orgId)) as
      | Record<string, unknown>
      | null
      | undefined;
    if (!data || typeof data !== 'object') return undefined;
    const features: FeatureMap = {};
    for (const [k, v] of Object.entries(data)) {
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

function safeOrigin(u: string): string | undefined {
  try {
    return new URL(u).origin;
  } catch {
    return undefined;
  }
}

async function browserLogin(platformUrl: string, env: EnvName, verbose = false) {
  const { chromium } = await import('playwright');

  console.error(`Opening browser for login (${env}: ${platformUrl})...`);

  // Try the platform's most common Chrome distribution, fall back to
  // Edge (Windows default), then Playwright's bundled chromium so the
  // command works on any OS that has *one* of these installed without
  // requiring the user to download Playwright browsers up front.
  const channels =
    process.platform === 'win32'
      ? ['msedge', 'chrome', undefined]
      : process.platform === 'darwin'
        ? ['chrome', 'msedge', undefined]
        : ['chrome', 'chromium', undefined];

  let browser: import('playwright').Browser | null = null;
  let lastErr: unknown;
  for (const channel of channels) {
    try {
      browser = await chromium.launch({ headless: false, channel });
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!browser) {
    throw new Error(
      `Failed to launch any browser channel (${channels.filter(Boolean).join(', ')}). ` +
        `Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}. ` +
        `Install Chrome/Edge, or run: npx playwright install chromium`,
    );
  }
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

  // Capture tokens only from responses whose origin we trust. Without this,
  // any third-party script/iframe emitting a token-shaped JSON field would be
  // scraped into ~/.openbox/tokens. Trusted origins: the platform URL (where
  // the auth UI lives), the backend API URL, and the Keycloak realm origin
  // the platform SPA redirects to. Everything else is dropped.
  const trustedOrigins = new Set<string>();
  const platformOrigin = safeOrigin(platformUrl);
  const apiOrigin = safeOrigin(apiUrl);
  if (platformOrigin) trustedOrigins.add(platformOrigin);
  if (apiOrigin) trustedOrigins.add(apiOrigin);
  // Keycloak token exchange hits the realm's /protocol/openid-connect/token;
  // add any origin the platform page navigates to that matches `*/realms/*`.
  page.on('framenavigated', (frame) => {
    const o = safeOrigin(frame.url());
    if (o && frame.url().includes('/realms/')) trustedOrigins.add(o);
  });

  context.on('response', async (res) => {
    try {
      const origin = safeOrigin(res.url());
      if (!origin || !trustedOrigins.has(origin)) return;
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
    // Note: a --browser/--no-browser flag previously existed here but
    // its `opts.browser` was never read by the action body. Removed in
    // post-audit cleanup. Use --non-interactive (or set CI=1 /
    // OPENBOX_NONINTERACTIVE=1) to skip the browser launch and print
    // the auth URL + set-token instructions instead.
    .option('--url <url>', 'Override platform URL (defaults to env-specific URL)')
    .option('--verbose', 'Log every JSON response containing a token (debugging)')
    .action(async (opts) => {
      try {
        const env = resolveEnv();
        const platformUrl = opts.url || resolveUrls(env).platformUrl;
        // Non-interactive bail: browser flow needs a human. Fail loudly with
        // a useful path forward instead of hanging indefinitely on a chromium
        // window that nobody can click.
        if (isNonInteractive()) {
          console.error(
            'auth login needs an interactive terminal (browser-based flow).',
          );
          console.error(`Open this URL on a machine with a browser:`);
          console.error(`  ${platformUrl}/login`);
          console.error(
            `Then bring the token back via one of:`,
          );
          console.error(
            `  openbox --env ${env} auth set-token "<access-token>" "<refresh-token>"`,
          );
          console.error(`  OPENBOX_ACCESS_TOKEN=<access-token> openbox <command>`);
          bailWith(EXIT.AUTH);
        }
        await browserLogin(platformUrl, env, !!opts.verbose);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  auth
    .command('logout')
    .description('Invalidate the session on the server and clear local tokens')
    .option('--all', 'Log out from every cached env (production + staging + local)')
    .action(async (opts) => {
      try {
        requireYesForDestructive('auth logout');
        const envs: EnvName[] = opts.all ? ['production', 'staging', 'local'] : [resolveEnv()];
        for (const env of envs) {
          // Skip the server call when no tokens exist for this env - calling
          // `getClient` would hard-exit via `loadTokens`, which would prevent
          // `--all` from reaching the next env. This is also the right UX:
          // "nothing to log out" is a no-op, not an error.
          if (!hasTokens(env)) {
            console.error(`[${env}] no local tokens - skipping`);
            continue;
          }
          // Best-effort server-side revoke. If the token is already expired
          // or the network is down, the local cleanup still needs to run -
          // otherwise a user in a stuck state can never `auth logout`.
          try {
            await getClient(env).logout();
            console.error(`[${env}] server session invalidated`);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[${env}] server logout failed (${msg}) - clearing local tokens anyway`);
          }
          clearTokens(env);
          console.error(`[${env}] local tokens cleared`);
        }
      } catch (err: any) {
        reportAndExit(err);
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
        const envs: EnvName[] = opts.all ? ['production', 'staging', 'local'] : [resolveEnv()];

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
          if (other !== 'production' && other !== 'staging' && other !== 'local') {
            console.error(`--compare must be 'production' | 'staging' | 'local', got '${other}'`);
            bailWith(EXIT.USAGE);
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
        reportAndExit(err);
      }
    });

  auth
    .command('features')
    .description('Show cached per-env feature flags (api_keys / webhooks / sso)')
    .option('--all', 'Show features for every cached env')
    .option('--refresh', 'Re-fetch from /organization/{orgId}/features before printing')
    .action(async (opts) => {
      try {
        const envs: EnvName[] = opts.all ? ['production', 'staging', 'local'] : [resolveEnv()];
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
        reportAndExit(err);
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
        reportAndExit(err);
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
        reportAndExit(err);
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
      bailWith(EXIT.GENERIC);
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
        reportAndExit(err);
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
        reportAndExit(err);
      }
    });

  auth
    .command('forgot-password')
    .description('Trigger password-reset email for an account')
    .requiredOption('--email <email>', 'Account email')
    .requiredOption('--realm <realm>', 'Keycloak realm slug')
    .action(async (opts) => {
      try {
        const data = await getClient().forgotPassword({
          email: opts.email,
          realm: opts.realm,
        });
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  auth
    .command('reset-password')
    .description('Complete a password reset with the email token')
    .requiredOption('--token <token>', 'Token received in the reset email')
    .requiredOption('--new-password <password>', 'New password')
    .action(async (opts) => {
      try {
        const data = await getClient().resetPassword({
          token: opts.token,
          newPassword: opts.newPassword,
        });
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });
}
