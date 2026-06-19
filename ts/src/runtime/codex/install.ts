import fs from 'node:fs';
import path from 'node:path';
import { HOOK_SPEC } from '../../core-client/generated/runtime/codex.js';
import {
  installAdapter,
  resolveInstallPaths,
  uninstallAdapter,
  type InstallOptions,
} from '../../install/from-spec.js';
import { loadDotenv, loadJsonConfig } from '../../config/host-config.js';
import { listConfig, configStorePath } from '../../config/index.js';
import { resolveAgentIdentity, resolveConnection, validateApiKeyFormat } from '../../env/index.js';
import { OpenBoxCoreClient } from '../../core-client/index.js';

export type CodexInstallCheckStatus = 'pass' | 'fail' | 'skip';

export interface CodexInstallCheck {
  name: string;
  status: CodexInstallCheckStatus;
  path?: string;
  detail?: string;
}

export interface VerifyCodexInstallOptions {
  cwd?: string;
  includeRuntime?: boolean;
  validateRuntime?: boolean;
}

function isPlaceholderKey(value: string | undefined): boolean {
  if (!value) return false;
  return /YOUR_API_KEY|REPLACE_ME|placeholder/i.test(value);
}

export function installCodex(opts: InstallOptions = {}): void {
  installAdapter(HOOK_SPEC, opts);
}

export function uninstallCodex(opts: InstallOptions = {}): void {
  uninstallAdapter(HOOK_SPEC, opts);
}

function loadHookEntries(file: string): unknown[] {
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
    const hooks = json.hooks;
    if (!hooks || typeof hooks !== 'object') return [];
    return Object.values(hooks as Record<string, unknown>).flatMap((value) =>
      Array.isArray(value) ? value : [value],
    );
  } catch {
    return [];
  }
}

function hookEntryContainsOpenBox(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hookEntryContainsOpenBox);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (typeof record.command === 'string' && record.command.includes('openbox codex hook')) {
    return true;
  }
  return hookEntryContainsOpenBox(record.hooks);
}

function buildRuntimeEnv(cwd = process.cwd()) {
  const configDir = path.join(cwd, '.codex-hooks');
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
  const apiKey = get('OPENBOX_API_KEY') ?? '';
  const agentIdentity = resolveAgentIdentity({
    OPENBOX_AGENT_DID: get('OPENBOX_AGENT_DID'),
    OPENBOX_AGENT_PRIVATE_KEY: get('OPENBOX_AGENT_PRIVATE_KEY'),
  });
  return {
    configFile,
    envFile,
    cliConfigFile: configStorePath(),
    coreUrl: connection.coreUrl,
    apiKey,
    agentIdentity,
  };
}

async function checkRuntimeReadiness(
  cwd: string | undefined,
  validateRuntime: boolean,
): Promise<CodexInstallCheck> {
  const runtime = buildRuntimeEnv(cwd);
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

export function verifyCodexInstall(
  opts?: VerifyCodexInstallOptions & { includeRuntime?: false; validateRuntime?: false },
): CodexInstallCheck[];
export function verifyCodexInstall(
  opts: VerifyCodexInstallOptions & ({ includeRuntime: true } | { validateRuntime: true }),
): Promise<CodexInstallCheck[]>;
export function verifyCodexInstall(
  opts: VerifyCodexInstallOptions = {},
): CodexInstallCheck[] | Promise<CodexInstallCheck[]> {
  const paths = resolveInstallPaths(HOOK_SPEC, { cwd: opts.cwd });
  const hooksFileExists = fs.existsSync(paths.hooksFile);
  const configFile = path.join(paths.configDir, 'config.json');
  const entries = hooksFileExists ? loadHookEntries(paths.hooksFile) : [];
  const checks: CodexInstallCheck[] = [
    {
      name: 'hooks-file',
      status: hooksFileExists ? 'pass' : 'fail',
      path: paths.hooksFile,
      detail: hooksFileExists ? 'project .codex/hooks.json exists' : 'missing project .codex/hooks.json',
    },
    {
      name: 'openbox-hook',
      status: entries.some(hookEntryContainsOpenBox) ? 'pass' : 'fail',
      path: paths.hooksFile,
      detail: 'project hook command is openbox codex hook',
    },
    {
      name: 'runtime-config',
      status: fs.existsSync(configFile) ? 'pass' : 'fail',
      path: configFile,
      detail: fs.existsSync(configFile) ? 'project .codex-hooks/config.json exists' : 'missing project runtime config',
    },
    {
      name: 'hook-trust',
      status: 'skip',
      path: paths.hooksFile,
      detail: 'Codex hook trust is user-controlled; OpenBox never mutates global hook trust state',
    },
  ];

  if (opts.includeRuntime || opts.validateRuntime) {
    return checkRuntimeReadiness(opts.cwd, Boolean(opts.validateRuntime)).then((runtime) => [...checks, runtime]);
  }
  return checks;
}
