import { Command } from 'commander';
import { OpenBoxClient } from '../../client/index.js';
import {
  endpointsFromStackUrl,
  normalizeStackUrl,
  type StackEndpoints,
} from '../../env/index.js';
import { saveApiKey } from '../../file-tokens/index.js';
import { reportAndExit } from '../../validators/index.js';
import { setConfig, unsetConfig } from '../config-store.js';
import { isMachineMode } from '../non-interactive.js';
import { output, success, warn } from '../output.js';

interface DiscoveryResponse {
  apiUrl?: string;
  coreUrl?: string;
  authUrl?: string;
  platformUrl?: string;
  name?: string;
}

interface ResolvedStack extends StackEndpoints {
  discovered: boolean;
}

export function registerConnectCommand(program: Command) {
  program
    .command('connect')
    .description('Connect this machine to OpenBox API and core endpoints')
    .argument('[remote-url]', 'Optional base URL used only to derive endpoints, for example https://ipsum.lat')
    .option('--api-key <key>', 'Org API key for backend and extension access')
    .option('--api-url <url>', 'Backend API endpoint URL')
    .option('--core-url <url>', 'Core/runtime policy endpoint URL')
    .option('--no-validate', 'Save the connection without probing /auth/profile')
    .action(async (remoteUrlArg: string | undefined, opts: {
      apiKey?: string;
      apiUrl?: string;
      coreUrl?: string;
      validate?: boolean;
    }) => {
      try {
        const connection = await resolveConnectionProfile(remoteUrlArg, {
          apiUrl: opts.apiUrl,
          coreUrl: opts.coreUrl,
        });
        setConfig('OPENBOX_API_URL', connection.apiUrl);
        setConfig('OPENBOX_CORE_URL', connection.coreUrl);
        unsetConfig('OPENBOX_STACK_URL');
        unsetConfig('OPENBOX_STACK_NAME');

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
          warn('no API key saved; run openbox connect --api-url <url> --core-url <url> --api-key <key> when you have one');
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

async function resolveConnectionProfile(raw: string | undefined, opts: {
  apiUrl?: string;
  coreUrl?: string;
} = {}): Promise<ResolvedStack> {
  const remoteUrl = raw ? normalizeStackUrl(raw) : undefined;
  const fallback = remoteUrl ? endpointsFromStackUrl(remoteUrl) : undefined;
  const discovered = remoteUrl ? await discover(remoteUrl) : undefined;
  const apiUrl = opts.apiUrl ?? discovered?.apiUrl ?? fallback?.apiUrl;
  const coreUrl = opts.coreUrl ?? discovered?.coreUrl ?? fallback?.coreUrl;
  if (!apiUrl || !coreUrl) {
    throw new Error('connect requires --api-url and --core-url when no endpoint discovery URL is provided.');
  }
  const endpoints = discovered
    ? {
        apiUrl,
        coreUrl,
        authUrl: discovered.authUrl ?? fallback?.authUrl,
        platformUrl: discovered.platformUrl ?? fallback?.platformUrl ?? '',
      }
    : {
        apiUrl,
        coreUrl,
        authUrl: fallback?.authUrl,
        platformUrl: fallback?.platformUrl ?? '',
      };
  return {
    discovered: !!discovered,
    ...endpoints,
  };
}

async function discover(remoteUrl: string): Promise<DiscoveryResponse | undefined> {
  const url = `${remoteUrl}/.well-known/openbox.json`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as DiscoveryResponse;
    if (!data || typeof data !== 'object') return undefined;
    return data;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
