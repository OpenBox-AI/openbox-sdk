import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { OpenBoxCoreClient } from 'openbox-sdk/core-client';
import { getClient, getTokenPath, loadTokens } from '../config.js';
import { resolveEnv, resolveUrls } from '../environments.js';

type Check = {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  detail: string;
};

function fmt(c: Check): string {
  const mark = c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : c.status === 'warn' ? '!' : '-';
  return `  ${mark} ${c.name.padEnd(32)} ${c.detail}`;
}

async function probeJwtExpiry(token: string): Promise<{ exp: number | null; expired: boolean }> {
  // JWT: base64url-encoded header.payload.signature - decode payload for exp claim.
  const parts = token.split('.');
  if (parts.length !== 3) return { exp: null, expired: false };
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    const exp = typeof payload.exp === 'number' ? payload.exp : null;
    if (exp == null) return { exp: null, expired: false };
    return { exp, expired: exp * 1000 < Date.now() };
  } catch {
    return { exp: null, expired: false };
  }
}

export function registerDoctorCommand(program: Command) {
  program
    .command('doctor')
    .description('Diagnose CLI install: tokens, backend/core reachability, feature state')
    .action(async () => {
      const env = resolveEnv();
      const urls = resolveUrls(env);
      const checks: Check[] = [];

      // 1. Token file exists.
      const tokenPath = getTokenPath();
      checks.push({
        name: 'token file',
        status: existsSync(tokenPath) ? 'pass' : 'fail',
        detail: existsSync(tokenPath) ? tokenPath : `missing - run: openbox auth login`,
      });

      // 2. Token present for env.
      let accessToken: string | undefined;
      try {
        const tokens = loadTokens(env);
        accessToken = tokens.accessToken;
        checks.push({
          name: `${env} access token`,
          status: 'pass',
          detail: `${tokens.accessToken.slice(0, 12)}… (refresh token: ${tokens.refreshToken ? 'present' : 'missing'})`,
        });
      } catch {
        checks.push({
          name: `${env} access token`,
          status: 'fail',
          detail: `missing - run: openbox --env ${env} auth login`,
        });
      }

      // 3. JWT expiry.
      if (accessToken) {
        const { exp, expired } = await probeJwtExpiry(accessToken);
        if (exp == null) {
          checks.push({ name: 'JWT format', status: 'warn', detail: 'not a JWT or malformed (cannot parse exp)' });
        } else {
          const secsLeft = Math.floor((exp * 1000 - Date.now()) / 1000);
          checks.push({
            name: 'JWT expiry',
            status: expired ? 'fail' : secsLeft < 300 ? 'warn' : 'pass',
            detail: expired
              ? `expired ${Math.abs(secsLeft)}s ago - run: openbox --env ${env} auth login`
              : `${secsLeft}s left (exp: ${new Date(exp * 1000).toISOString()})`,
          });
        }
      }

      // 4. Backend reachable + JWT valid. The URL line is informational -
      // emit it as a `skip` with a `-` mark so a user doesn't see a green
      // check next to something that wasn't actually probed.
      checks.push({
        name: `backend URL`,
        status: 'skip',
        detail: urls.apiUrl,
      });
      if (accessToken) {
        try {
          await getClient(env).health();
          checks.push({ name: 'backend /health', status: 'pass', detail: '200 OK' });
        } catch (err: any) {
          checks.push({ name: 'backend /health', status: 'fail', detail: err.message || String(err) });
        }
        try {
          const profile = await getClient(env).getProfile();
          const anyProf = profile as any;
          const email = anyProf.email ?? anyProf.user?.email ?? 'unknown';
          checks.push({ name: 'JWT validation (profile)', status: 'pass', detail: `authenticated as ${email}` });
        } catch (err: any) {
          checks.push({ name: 'JWT validation (profile)', status: 'fail', detail: err.message || String(err) });
        }
      }

      // 5. Core reachable. `/health` is a public endpoint - always probe it.
      // Only the API key validation step needs a key.
      checks.push({ name: 'core URL', status: 'skip', detail: urls.coreUrl });
      const apiKey = process.env.OPENBOX_API_KEY;
      try {
        const core = new OpenBoxCoreClient({ apiUrl: urls.coreUrl, apiKey: apiKey ?? '', env });
        await core.health();
        checks.push({ name: 'core /health', status: 'pass', detail: '200 OK' });
      } catch (err: any) {
        checks.push({ name: 'core /health', status: 'fail', detail: err.message || String(err) });
      }
      if (!apiKey) {
        checks.push({
          name: 'core API key',
          status: 'skip',
          detail: 'set OPENBOX_API_KEY to validate core credentials',
        });
      } else {
        try {
          const core = new OpenBoxCoreClient({ apiUrl: urls.coreUrl, apiKey, env });
          await core.validateApiKey();
          checks.push({ name: 'core API key', status: 'pass', detail: 'valid' });
        } catch (err: any) {
          checks.push({ name: 'core API key', status: 'fail', detail: err.message || String(err) });
        }
      }

      // 6. Legacy tokens (flat format without env prefix - triggers migration).
      try {
        const raw = readFileSync(tokenPath, 'utf-8');
        if (/^ACCESS_TOKEN=/m.test(raw) && !/^production\.ACCESS_TOKEN=/m.test(raw)) {
          checks.push({
            name: 'token format',
            status: 'warn',
            detail: 'legacy flat format detected - will migrate to production.* on next auth command',
          });
        } else {
          checks.push({ name: 'token format', status: 'pass', detail: 'env-namespaced' });
        }
      } catch {
        // already flagged above.
      }

      // Print.
      console.log(`openbox doctor - env=${env}`);
      for (const c of checks) console.log(fmt(c));

      const failed = checks.filter((c) => c.status === 'fail');
      const warned = checks.filter((c) => c.status === 'warn');
      console.log(
        `\n${checks.length - failed.length - warned.length} pass, ${warned.length} warn, ${failed.length} fail`,
      );
      if (failed.length > 0) process.exit(1);
    });
}
