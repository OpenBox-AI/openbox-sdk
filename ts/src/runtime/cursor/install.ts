// Verifier for the OpenBox Cursor integration. Cursor installation is
// plugin-only: the plugin owns hooks, MCP, commands, rules, agents,
// and skills; the extension owns the approval UI.

import fs from 'node:fs';
import path from 'node:path';
import { loadDotenv, loadJsonConfig } from '../../config/host-config.js';
import { listConfig, configStorePath } from '../../config/index.js';
import { resolveAgentIdentity, resolveConnection, validateApiKeyFormat } from '../../env/index.js';
import { OpenBoxCoreClient } from '../../core-client/index.js';
import { verifyCursorPlugin } from './plugin.js';

export type CursorInstallCheckStatus = 'pass' | 'fail' | 'skip';

export interface CursorInstallCheck {
  name: string;
  status: CursorInstallCheckStatus;
  path?: string;
  detail?: string;
}

export interface VerifyCursorInstallOptions {
  /** Project root for project-scoped install. Defaults to process.cwd(). */
  cwd?: string;
  /** Cursor project-local plugin target. Defaults to <cwd>/.cursor/plugins/local/openbox. */
  pluginTarget?: string;
  /** Include hook runtime readiness checks. Install flows keep this
   *  false so they can lay down files before a runtime key exists. */
  includeRuntime?: boolean;
  /** Validate the runtime key against core. Implies includeRuntime. */
  validateRuntime?: boolean;
}

function isPlaceholderKey(value: string | undefined): boolean {
  if (!value) return false;
  return /YOUR_API_KEY|REPLACE_ME|placeholder/i.test(value);
}

function buildHookRuntimeEnv(cwd = process.cwd()) {
  const configDir = path.join(cwd, '.cursor-hooks');
  const configFile = path.join(configDir, 'config.json');
  const envFile = path.join(configDir, '.env');
  const values: Record<string, string> = {};
  const fill = (src: Record<string, string>) => {
    for (const [key, value] of Object.entries(src)) {
      if (process.env[key] !== undefined) values[key] = process.env[key]!;
      else if (values[key] === undefined) values[key] = value;
    }
  };

  fill(listConfig());

  const fileConfig = loadJsonConfig(configFile);
  const envConfig = loadDotenv(envFile);
  const get = (key: string): string | undefined =>
    process.env[key] ?? values[key] ?? fileConfig[key] ?? envConfig[key];

  const connection = resolveConnection({
    apiUrl: get('OPENBOX_API_URL'),
    coreUrl: get('OPENBOX_CORE_URL'),
    platformUrl: get('OPENBOX_PLATFORM_URL'),
  });
  const coreUrl = connection.coreUrl;
  const apiKey = get('OPENBOX_API_KEY') ?? '';
  const agentIdentity = resolveAgentIdentity({
    OPENBOX_AGENT_DID: get('OPENBOX_AGENT_DID'),
    OPENBOX_AGENT_PRIVATE_KEY: get('OPENBOX_AGENT_PRIVATE_KEY'),
  });
  return {
    configFile,
    envFile,
    cliConfigFile: configStorePath(),
    coreUrl,
    apiKey,
    agentIdentity,
  };
}

async function checkRuntimeReadiness(cwd: string | undefined, validateRuntime: boolean): Promise<CursorInstallCheck> {
  const runtime = buildHookRuntimeEnv(cwd);
  const details = [
    `config=${runtime.configFile}`,
    `cliConfig=${runtime.cliConfigFile}`,
    `core=${runtime.coreUrl}`,
  ];
  if (!runtime.apiKey) {
    return { name: 'runtime', status: 'fail', path: runtime.configFile, detail: `${details.join('; ')}; missing OPENBOX_API_KEY` };
  }
  if (isPlaceholderKey(runtime.apiKey)) {
    return { name: 'runtime', status: 'fail', path: runtime.configFile, detail: `${details.join('; ')}; placeholder OPENBOX_API_KEY` };
  }
  const format = validateApiKeyFormat(runtime.apiKey);
  if (format !== true) {
    return { name: 'runtime', status: 'fail', path: runtime.configFile, detail: `${details.join('; ')}; invalid OPENBOX_API_KEY format: ${format}` };
  }
  if (!validateRuntime) {
    return { name: 'runtime', status: 'pass', path: runtime.configFile, detail: `${details.join('; ')}; key=format-ok` };
  }
  try {
    const core = new OpenBoxCoreClient({
      apiKey: runtime.apiKey,
      apiUrl: runtime.coreUrl,
      agentIdentity: runtime.agentIdentity,
      timeoutMs: 5_000,
    });
    const validation = (await core.validateApiKey()) as { agent_id?: string } | undefined;
    const agent = validation?.agent_id ? `; agent=${validation.agent_id}` : '';
    return { name: 'runtime', status: 'pass', path: runtime.configFile, detail: `${details.join('; ')}; key=validated${agent}` };
  } catch (err: any) {
    return {
      name: 'runtime',
      status: 'fail',
      path: runtime.configFile,
      detail: `${details.join('; ')}; core validation failed: ${String(err?.message ?? err)}`,
    };
  }
}

export function verifyCursorInstall(
  opts?: VerifyCursorInstallOptions & { includeRuntime?: false; validateRuntime?: false },
): CursorInstallCheck[];
export function verifyCursorInstall(
  opts: VerifyCursorInstallOptions & ({ includeRuntime: true } | { validateRuntime: true }),
): Promise<CursorInstallCheck[]>;
export function verifyCursorInstall(
  opts: VerifyCursorInstallOptions = {},
): CursorInstallCheck[] | Promise<CursorInstallCheck[]> {
  const checks: CursorInstallCheck[] = [
    ...verifyCursorPlugin({ cwd: opts.cwd, target: opts.pluginTarget }),
  ];

  if (opts.includeRuntime || opts.validateRuntime) {
    return checkRuntimeReadiness(opts.cwd, Boolean(opts.validateRuntime)).then((runtime) => [...checks, runtime]);
  }
  return checks;
}
