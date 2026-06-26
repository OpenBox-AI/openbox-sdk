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
import { configStorePath } from '../../config/index.js';
import { normalizeServiceUrl } from '../../env/connection.js';
import { resolveAgentIdentity, validateApiKeyFormat } from '../../env/index.js';
import { recallAgentKey } from '../../file-tokens/agent-keys.js';
import {
  OpenBoxCoreClient,
  validateAgentIdentityConfig,
  type AgentIdentityConfig,
} from '../../core-client/index.js';

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

export type CodexApprovalMode = 'inline' | 'remote' | 'defer';

export interface ConfigureCodexRuntimeOptions {
  /** Project root for the Codex runtime config. Defaults to process.cwd(). */
  cwd?: string;
  /** Agent runtime key written as OPENBOX_API_KEY. */
  apiKey?: string;
  /** Resolve the runtime key from the project-local agent-key cache. */
  agentId?: string;
  /** Core/runtime policy endpoint written as OPENBOX_CORE_URL. */
  coreUrl?: string;
  /** Signed agent identity written as OPENBOX_AGENT_DID/OPENBOX_AGENT_PRIVATE_KEY. */
  agentIdentity?: AgentIdentityConfig;
  approvalMode?: CodexApprovalMode;
  governanceTimeout?: number;
  hitlMaxWait?: number;
  hitlPollInterval?: number;
  hitlEnabled?: boolean;
  verbose?: boolean;
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
  const fileConfig = loadJsonConfig(configFile);
  const envConfig = loadDotenv(envFile);
  const get = (key: string): string | undefined =>
    process.env[key] ?? fileConfig[key] ?? envConfig[key];

  const rawCoreUrl = get('OPENBOX_CORE_URL');
  let coreUrl = '';
  let coreUrlError: string | undefined;
  if (rawCoreUrl) {
    try {
      coreUrl = normalizeServiceUrl('OPENBOX_CORE_URL', rawCoreUrl);
    } catch (err) {
      coreUrlError = err instanceof Error ? err.message : String(err);
    }
  }
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
    coreUrlError,
    apiKey,
    agentIdentity,
  };
}

function defaultRuntimeConfig(): Record<string, unknown> {
  return {
    hitlEnabled: true,
    hitlMaxWait: 300,
    verbose: false,
  };
}

export function codexRuntimeConfigFile(cwd = process.cwd()): string {
  return path.join(cwd, '.codex-hooks', 'config.json');
}

function requirePositiveInteger(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function normalizeApprovalMode(value: CodexApprovalMode | undefined): CodexApprovalMode | undefined {
  if (value === undefined) return undefined;
  if (value === 'inline' || value === 'remote' || value === 'defer') return value;
  throw new Error(`approvalMode must be one of: inline, remote, defer`);
}

function resolveRuntimeKey(options: ConfigureCodexRuntimeOptions): string | undefined {
  if (options.apiKey) return options.apiKey;
  if (!options.agentId) return undefined;
  const record = recallAgentKey(options.agentId);
  if (!record?.runtimeKey) {
    throw new Error(`No cached runtime key for agent ${options.agentId}`);
  }
  return record.runtimeKey;
}

export function configureCodexRuntime(options: ConfigureCodexRuntimeOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const configFile = codexRuntimeConfigFile(cwd);
  const existing = fs.existsSync(configFile) ? loadJsonConfig(configFile) : {};
  const next: Record<string, unknown> = {
    ...defaultRuntimeConfig(),
    ...existing,
  };

  const apiKey = resolveRuntimeKey(options);
  if (apiKey !== undefined) {
    const format = validateApiKeyFormat(apiKey);
    if (format !== true) throw new Error(format);
    next.OPENBOX_API_KEY = apiKey;
  }

  if (options.coreUrl !== undefined) {
    next.OPENBOX_CORE_URL = normalizeServiceUrl('OPENBOX_CORE_URL', options.coreUrl);
  }

  if (options.agentIdentity !== undefined) {
    const agentIdentity = validateAgentIdentityConfig(options.agentIdentity);
    next.OPENBOX_AGENT_DID = agentIdentity.did;
    next.OPENBOX_AGENT_PRIVATE_KEY = agentIdentity.privateKey;
  }

  const approvalMode = normalizeApprovalMode(options.approvalMode);
  if (approvalMode !== undefined) next.approvalMode = approvalMode;

  const governanceTimeout = requirePositiveInteger(options.governanceTimeout, 'governanceTimeout');
  if (governanceTimeout !== undefined) next.governanceTimeout = String(governanceTimeout);

  const hitlMaxWait = requirePositiveInteger(options.hitlMaxWait, 'hitlMaxWait');
  if (hitlMaxWait !== undefined) next.hitlMaxWait = hitlMaxWait;

  const hitlPollInterval = requirePositiveInteger(options.hitlPollInterval, 'hitlPollInterval');
  if (hitlPollInterval !== undefined) next.hitlPollInterval = hitlPollInterval;

  if (options.hitlEnabled !== undefined) next.hitlEnabled = options.hitlEnabled;
  if (options.verbose !== undefined) next.verbose = options.verbose;

  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(next, null, 2) + '\n', {
    mode: 0o600,
    encoding: 'utf-8',
  });
  return configFile;
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
  if (runtime.coreUrlError) {
    return { name: 'runtime', status: 'fail', path: runtime.configFile, detail: `${details.join('; ')}; invalid OPENBOX_CORE_URL: ${runtime.coreUrlError}` };
  }
  if (!runtime.coreUrl) {
    return { name: 'runtime', status: 'fail', path: runtime.configFile, detail: `${details.join('; ')}; missing OPENBOX_CORE_URL` };
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
