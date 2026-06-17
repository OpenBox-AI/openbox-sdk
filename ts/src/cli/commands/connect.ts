import { Command } from 'commander';
import { OpenBoxClient } from '../../client/index.js';
import { saveApiKey } from '../../file-tokens/index.js';
import { reportAndExit } from '../../validators/index.js';
import { setConfig } from '../../config/index.js';
import { isMachineMode } from '../non-interactive.js';
import { output, success, warn } from '../output.js';

interface ResolvedConnection {
  apiUrl: string;
  coreUrl: string;
  discovered: boolean;
}

export function registerConnectCommand(program: Command) {
  program
    .command('connect')
    .description('Connect this project to explicit OpenBox API and core endpoints')
    .option('--api-key <key>', 'Org API key for backend and extension access')
    .option('--api-url <url>', 'Backend API endpoint URL')
    .option('--core-url <url>', 'Core/runtime policy endpoint URL')
    .option('--no-validate', 'Save the connection without probing /auth/profile')
    .action(async (opts: {
      apiKey?: string;
      apiUrl?: string;
      coreUrl?: string;
      validate?: boolean;
    }) => {
      try {
        const connection = resolveConnectionProfile({
          apiUrl: opts.apiUrl,
          coreUrl: opts.coreUrl,
        });
        setConfig('OPENBOX_API_URL', connection.apiUrl);
        setConfig('OPENBOX_CORE_URL', connection.coreUrl);

        let profile: unknown;
        if (opts.apiKey) {
          const key = opts.apiKey.trim();
          saveApiKey(key);
          if (opts.validate !== false) {
            profile = await new OpenBoxClient({
              apiUrl: connection.apiUrl,
              apiKey: key,
              clientName: 'cli/connect',
              timeoutMs: 10_000,
            }).getProfile();
          }
        } else if (!isMachineMode()) {
          warn('no API key saved; rerun openbox connect --api-url <url> --core-url <url> --api-key <key> in this project when you have one');
        }

        const result = {
          apiUrl: connection.apiUrl,
          coreUrl: connection.coreUrl,
          discovered: connection.discovered,
          apiKey: opts.apiKey ? 'saved' : 'missing',
          profile,
        };
        if (isMachineMode()) output(result);
        else {
          success('connected to OpenBox endpoints');
          output(result);
        }
      } catch (err: any) {
        reportAndExit(err);
      }
    });
}

function resolveConnectionProfile(opts: {
  apiUrl?: string;
  coreUrl?: string;
}): ResolvedConnection {
  if (!opts.apiUrl || !opts.coreUrl) {
    throw new Error('connect requires explicit --api-url and --core-url.');
  }
  return {
    apiUrl: normalizeServiceUrl('OPENBOX_API_URL', opts.apiUrl),
    coreUrl: normalizeServiceUrl('OPENBOX_CORE_URL', opts.coreUrl),
    discovered: false,
  };
}

function normalizeServiceUrl(name: 'OPENBOX_API_URL' | 'OPENBOX_CORE_URL', raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`${name} cannot be empty.`);
  const url = new URL(trimmed);
  if (url.protocol !== 'https:' && !isLoopbackHost(url.hostname)) {
    throw new Error(`${name} must use https:// unless it points at localhost.`);
  }
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}
