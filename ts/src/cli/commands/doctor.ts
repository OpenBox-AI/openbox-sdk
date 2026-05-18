import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { OpenBoxCoreClient } from '../../core-client/index.js';
import { getClient, getTokenPath, loadApiKey } from '../config.js';
import { resolveConnection, resolveEnv } from '../../env/index.js';
import { EXIT, bailWith } from '../exit-codes.js';
import { row, summary, output } from '../output.js';
import { isMachineMode } from '../non-interactive.js';

type Check = {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  detail: string;
};

export function registerDoctorCommand(program: Command) {
  program
    .command('doctor')
    .description('Diagnose CLI install: api-key store, backend/core reachability')
    .action(async () => {
      const env = resolveEnv();
      const connection = resolveConnection({ envName: env });
      const urls = { apiUrl: connection.apiUrl, coreUrl: connection.coreUrl };
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
        name: 'api-key',
        status: haveKey ? 'pass' : 'fail',
        detail: haveKey
          ? `${apiKey!.slice(0, 12)}…`
          : 'missing; run: openbox auth set-api-key',
      });

      checks.push({
        name: 'backend URL',
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
            : `${msg}; run: openbox auth set-api-key (key may be invalid)`;
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

      // Token-format sanity. The codec writes flat lines for the
      // primary env and namespaced lines for any user who opted into
      // an override. Both shapes parse, so the doctor only flags a
      // file we can't read at all.
      try {
        readFileSync(tokenPath, 'utf-8');
        checks.push({ name: 'token file', status: 'pass', detail: 'readable' });
      } catch {
        // already flagged above by the existsSync probe.
      }

      const failed = checks.filter((c) => c.status === 'fail');
      const warned = checks.filter((c) => c.status === 'warn');
      const counts = {
        pass: checks.length - failed.length - warned.length,
        warn: warned.length,
        fail: failed.length,
      };

      if (isMachineMode()) {
        output({ checks, summary: counts });
        if (failed.length > 0) bailWith(EXIT.GENERIC);
        return;
      }

      // Map `skip` to plain; doctor's "skip" is not a failure, just
      // info ("we didn't probe this"). The row() colorizer falls back
      // to plain rendering for unknown statuses.
      for (const c of checks) {
        const status = c.status === 'skip' ? 'unchanged' : c.status;
        row(c.name, status, c.detail);
      }

      summary(counts);
      if (failed.length > 0) bailWith(EXIT.GENERIC);
    });
}
