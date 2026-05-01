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
} from '../config.js';
import { resolveEnv } from '../../env/index.js';
import type { EnvName } from '../../env/index.js';
import { reportAndExit } from '../../validators/index.js';
import { EXIT, bailWith } from '../exit-codes.js';
import { isNonInteractive } from '../non-interactive.js';

export function registerAuthCommands(program: Command) {
  const auth = program.command('auth').description('Manage the local X-API-Key store for backend auth');

  auth
    .command('set-api-key')
    .description('Save an org-level X-API-Key for the active env (mint via dashboard FE)')
    .option('-k, --key <key>', 'Pass the key directly instead of prompting')
    .action(async (opts: { key?: string }) => {
      try {
        const env = resolveEnv();
        let key = opts.key?.trim();
        if (!key) {
          if (isNonInteractive()) {
            console.error('auth set-api-key needs --key <value> in non-interactive mode.');
            bailWith(EXIT.USAGE);
          }
          const { createInterface } = await import('node:readline/promises');
          const rl = createInterface({ input: process.stdin, output: process.stderr });
          try {
            key = (await rl.question(`Paste org API key for ${env} (obx_key_...): `)).trim();
          } finally {
            rl.close();
          }
        }
        if (!key) {
          console.error('No key provided.');
          bailWith(EXIT.USAGE);
        }
        if (!/^obx_key_[0-9a-f]{48}$/.test(key)) {
          console.error(
            `Key does not match the org-key format (obx_key_<48 hex>). Got prefix: ${key.slice(0, 12)}...`,
          );
          console.error(`Mint a key in the dashboard: Organization → API Keys → New key.`);
          bailWith(EXIT.AUTH);
        }
        saveApiKey(env, key);
        console.error(`X-API-Key saved for environment: ${env}`);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  auth
    .command('clear-api-key')
    .description('Remove the saved X-API-Key for the current env')
    .action(() => {
      try {
        const env = resolveEnv();
        const cleared = clearApiKey(env);
        console.error(
          cleared
            ? `X-API-Key cleared for environment: ${env}`
            : `No X-API-Key was stored for environment: ${env}`,
        );
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  auth
    .command('status')
    .description('Print whether an X-API-Key is saved per env')
    .action(() => {
      try {
        const envs: EnvName[] = ['production', 'staging', 'local'];
        for (const env of envs) {
          const apiKey = loadApiKey(env);
          const detail = apiKey ? `api-key (${apiKey.slice(0, 12)}...)` : 'none';
          console.log(`  ${env.padEnd(10)} ${detail}`);
        }
      } catch (err: any) {
        reportAndExit(err);
      }
    });
}
