import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { OpenBoxCoreClient } from '../../core-client/index.js';
import { getClient, getTokenPath, loadApiKey } from '../config.js';
import { resolveEnv, resolveUrls } from '../../env/index.js';
import { EXIT, bailWith } from '../exit-codes.js';

type Check = {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  detail: string;
};

function fmt(c: Check): string {
  const mark = c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : c.status === 'warn' ? '!' : '-';
  return `  ${mark} ${c.name.padEnd(32)} ${c.detail}`;
}

export function registerDoctorCommand(program: Command) {
  program
    .command('doctor')
    .description('Diagnose CLI install: api-key store, backend/core reachability')
    .action(async () => {
      const env = resolveEnv();
      const urls = resolveUrls(env);
      const checks: Check[] = [];

      const tokenPath = getTokenPath();
      checks.push({
        name: 'token file',
        status: existsSync(tokenPath) ? 'pass' : 'skip',
        detail: existsSync(tokenPath) ? tokenPath : `(none; first run sets up via auth set-api-key)`,
      });

      const apiKey = loadApiKey(env);
      const haveKey = !!apiKey;
      checks.push({
        name: `${env} api-key`,
        status: haveKey ? 'pass' : 'fail',
        detail: haveKey
          ? `${apiKey!.slice(0, 12)}…`
          : `missing; run: openbox --env ${env} auth set-api-key`,
      });

      checks.push({
        name: `backend URL`,
        status: 'skip',
        detail: urls.apiUrl,
      });
      if (haveKey) {
        try {
          await getClient(env).health();
          checks.push({ name: 'backend /health', status: 'pass', detail: '200 OK' });
        } catch (err: any) {
          const msg = err.message || String(err);
          // Distinguish network failure (URL unreachable) from auth /
          // API failure so the user can act on the right thing.
          const isNetwork = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(msg);
          const detail = isNetwork
            ? `${msg}; backend URL unreachable from this machine - check OPENBOX_API_URL or your network`
            : `${msg}; run: openbox --env ${env} auth set-api-key (key may be invalid)`;
          checks.push({ name: 'backend /health', status: 'fail', detail });
        }
      }

      // Core reachable. `/health` is a public endpoint; always probe it.
      // Only the API key validation step needs a key.
      checks.push({ name: 'core URL', status: 'skip', detail: urls.coreUrl });
      const coreApiKey = process.env.OPENBOX_API_KEY;
      try {
        const core = new OpenBoxCoreClient({ apiUrl: urls.coreUrl, apiKey: coreApiKey ?? '', env });
        await core.health();
        checks.push({ name: 'core /health', status: 'pass', detail: '200 OK' });
      } catch (err: any) {
        const msg = err.message || String(err);
        const isNetwork = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(msg);
        const detail = isNetwork
          ? `${msg}; core URL unreachable from this machine - check OPENBOX_CORE_URL or your network`
          : msg;
        checks.push({ name: 'core /health', status: 'fail', detail });
      }
      if (!coreApiKey) {
        checks.push({
          name: 'core API key',
          status: 'skip',
          detail: 'set OPENBOX_API_KEY to validate core credentials',
        });
      } else {
        try {
          const core = new OpenBoxCoreClient({ apiUrl: urls.coreUrl, apiKey: coreApiKey, env });
          await core.validateApiKey();
          checks.push({ name: 'core API key', status: 'pass', detail: 'valid' });
        } catch (err: any) {
          checks.push({ name: 'core API key', status: 'fail', detail: err.message || String(err) });
        }
      }

      // Legacy tokens (flat format without env prefix; triggers migration).
      try {
        const raw = readFileSync(tokenPath, 'utf-8');
        if (/^ACCESS_TOKEN=/m.test(raw) && !/^production\.ACCESS_TOKEN=/m.test(raw)) {
          checks.push({
            name: 'token format',
            status: 'warn',
            detail: 'legacy flat format detected; will migrate to production.* on next auth command',
          });
        } else {
          checks.push({ name: 'token format', status: 'pass', detail: 'env-namespaced' });
        }
      } catch {
        // already flagged above.
      }

      console.log(`openbox doctor; env=${env}`);
      for (const c of checks) console.log(fmt(c));

      const failed = checks.filter((c) => c.status === 'fail');
      const warned = checks.filter((c) => c.status === 'warn');
      console.log(
        `\n${checks.length - failed.length - warned.length} pass, ${warned.length} warn, ${failed.length} fail`,
      );
      if (failed.length > 0) bailWith(EXIT.GENERIC);
    });
}
