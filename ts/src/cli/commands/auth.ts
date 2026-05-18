// CLI auth surface: thin wrapper around the on-disk X-API-Key store.
// Org-level keys are minted in the dashboard FE (Organization → API Keys);
// this command set just persists / clears / inspects them. JWT login was
// removed from the CLI in v0.2.0; the SDK still accepts Bearer JWTs for
// non-CLI consumers (mobile, SSO).
import { Command } from 'commander';
import {
  saveApiKey,
  clearApiKey,
  loadApiKey,
  getClient,
} from '../config.js';
import { resolveEnv } from '../../env/index.js';
import { reportAndExit } from '../../validators/index.js';
import { EXIT, bailWith } from '../exit-codes.js';
import { isNonInteractive } from '../non-interactive.js';
import { output, error, info, success } from '../output.js';

export function registerAuthCommands(program: Command) {
  const auth = program.command('auth').description('Manage the local X-API-Key store for backend auth');

  auth
    .command('set-api-key')
    .description('Save an org-level X-API-Key for the active OpenBox connection')
    .option('-k, --key <key>', 'Pass the key directly instead of prompting')
    .action(async (opts: { key?: string }) => {
      try {
        const env = resolveEnv();
        let key = opts.key?.trim();
        if (!key) {
          if (isNonInteractive()) {
            error('auth set-api-key needs --key <value> in non-interactive mode.');
            bailWith(EXIT.USAGE);
          }
          const { createInterface } = await import('node:readline/promises');
          const rl = createInterface({ input: process.stdin, output: process.stderr });
          try {
            key = (await rl.question('Paste org API key for the active OpenBox connection (obx_key_...): ')).trim();
          } finally {
            rl.close();
          }
        }
        if (!key) {
          error('no key provided.');
          bailWith(EXIT.USAGE);
        }
        if (!/^obx_key_[0-9a-f]{48}$/.test(key)) {
          error(
            `key does not match the org-key format (obx_key_<48 hex>); got prefix ${key.slice(0, 12)}...`,
            { help: 'mint a key in the dashboard: Organization → API Keys → New key' },
          );
          bailWith(EXIT.AUTH);
        }
        saveApiKey(env, key);
        success('X-API-Key saved.');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  auth
    .command('clear-api-key')
    .description('Remove the saved X-API-Key for the active OpenBox connection')
    .action(() => {
      try {
        const env = resolveEnv();
        const cleared = clearApiKey(env);
        if (cleared) success('X-API-Key cleared.');
        else info('No X-API-Key was stored.');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  auth
    .command('status')
    .description('Print whether an X-API-Key is saved')
    .action(() => {
      try {
        const env = resolveEnv();
        const apiKey = loadApiKey(env);
        info(apiKey ? `api-key (${apiKey.slice(0, 12)}...)` : 'none');
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  auth
    .command('profile')
    .description('Fetch /auth/profile for the active OpenBox connection (orgId, sub, permissions)')
    .action(async () => {
      try {
        const profile = await getClient().getProfile();
        output(profile);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  auth
    .command('permissions')
    .description('Print the authenticated principal\'s permission set')
    .action(async () => {
      try {
        const profile = (await getClient().getProfile()) as { permissions?: string[] };
        output(profile.permissions ?? []);
      } catch (err: any) {
        reportAndExit(err);
      }
    });
}
