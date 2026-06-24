import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadDotenv, loadJsonConfig } from '../../config/host-config.js';
import { OpenBoxCoreClient } from '../../core-client/index.js';
import { normalizeServiceUrl } from '../../env/connection.js';
import { resolveAgentIdentity, validateApiKeyFormat } from '../../env/index.js';
import {
  claudeCodePluginTargetDir,
  claudeCodeRuntimeConfigDir,
  claudeCodeSettingsLocalFile,
  readClaudeCodeSettingsLocalEnv,
  verifyClaudeCodePlugin,
} from './plugin.js';

export type ClaudeCodeInstallCheckStatus = 'pass' | 'fail' | 'skip';

export interface ClaudeCodeInstallCheck {
  name: string;
  status: ClaudeCodeInstallCheckStatus;
  path?: string;
  detail?: string;
}

export interface VerifyClaudeCodeInstallOptions {
  /** Project root for project-scoped install. Defaults to process.cwd(). */
  cwd?: string;
  /** Project-local plugin target. Defaults to <cwd>/.claude/skills/openbox. */
  pluginTarget?: string;
  /** Alias for pluginTarget, used by MCP payloads. */
  target?: string;
  /** Include hook runtime readiness checks. */
  includeRuntime?: boolean;
  /** Validate the runtime key against Core. Implies includeRuntime. */
  validateRuntime?: boolean;
  /** Validate a plugin that intentionally includes opt-in hooks. */
  includeOptInHooks?: boolean;
}

function isPlaceholderKey(value: string | undefined): boolean {
  if (!value) return false;
  return /YOUR_API_KEY|REPLACE_ME|placeholder/i.test(value);
}

function parseApprovalMode(value: string | undefined): 'inline' | 'remote' | 'defer' {
  const mode = (value ?? 'remote').toLowerCase();
  if (mode === 'inline' || mode === 'defer') return mode;
  return 'remote';
}

function buildProjectRuntimeEnv(cwd = process.cwd()) {
  const configDir = claudeCodeRuntimeConfigDir(cwd);
  const configFile = path.join(configDir, 'config.json');
  const envFile = path.join(configDir, '.env');
  const settingsLocalFile = claudeCodeSettingsLocalFile(cwd);
  const fileConfig = loadJsonConfig(configFile);
  const envConfig = loadDotenv(envFile);
  const settingsLocalEnv = readClaudeCodeSettingsLocalEnv(cwd);
  const getRuntime = (key: string): string | undefined =>
    process.env[key] ??
    settingsLocalEnv[key] ??
    envConfig[key] ??
    fileConfig[key];
  const getSetting = (key: string): string | undefined =>
    fileConfig[key] ?? envConfig[key];

  const agentIdentity = resolveAgentIdentity({
    OPENBOX_AGENT_DID: getRuntime('OPENBOX_AGENT_DID'),
    OPENBOX_AGENT_PRIVATE_KEY: getRuntime('OPENBOX_AGENT_PRIVATE_KEY'),
  });

  const rawCoreUrl = getRuntime('OPENBOX_CORE_URL');
  let coreUrl = '';
  let coreUrlError: string | undefined;
  if (rawCoreUrl) {
    try {
      coreUrl = normalizeServiceUrl('OPENBOX_CORE_URL', rawCoreUrl);
    } catch (err) {
      coreUrlError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    configDir,
    configFile,
    envFile,
    settingsLocalFile,
    projectConfigPresent: existsSync(configFile),
    projectEnvPresent: existsSync(envFile),
    settingsLocalPresent: existsSync(settingsLocalFile),
    coreUrl,
    coreUrlError,
    apiKey: getRuntime('OPENBOX_API_KEY') ?? '',
    governancePolicy: 'fail_closed' as const,
    approvalMode: parseApprovalMode(getSetting('approvalMode')),
    agentIdentity,
  };
}

export function claudeCodeRuntimeDiagnostics(cwd = process.cwd()): Record<string, unknown> {
  const runtime = buildProjectRuntimeEnv(cwd);
  return {
    configDir: runtime.configDir,
    configFile: runtime.configFile,
    envFile: runtime.envFile,
    settingsLocalFile: runtime.settingsLocalFile,
    projectScoped: true,
    runtimeEnv: {
      projectConfigPresent: runtime.projectConfigPresent,
      projectEnvPresent: runtime.projectEnvPresent,
      settingsLocalPresent: runtime.settingsLocalPresent,
      runtimeApiKeyPresent: Boolean(runtime.apiKey),
      runtimeApiKeyPlaceholder: isPlaceholderKey(runtime.apiKey),
      coreUrlPresent: Boolean(runtime.coreUrl),
      agentIdentityPresent: Boolean(runtime.agentIdentity),
    },
    failMode: runtime.governancePolicy,
    approvalMode: runtime.approvalMode,
    unsupportedOrOptInSurfaces: {
      worktreeCreate: 'opt_in_managed_worktree_creator',
      sessionEnd: 'opt_in_shutdown_telemetry',
      monitors: 'opt_in_unsandboxed_not_project_scope',
      lsp: 'out_of_scope_no_openbox_language_server',
      managedSettings: 'enterprise_diagnose_only',
      channels: 'diagnose_only_research_preview',
    },
  };
}

async function checkRuntimeReadiness(
  cwd: string | undefined,
  validateRuntime: boolean,
): Promise<ClaudeCodeInstallCheck> {
  const runtime = buildProjectRuntimeEnv(cwd);
  const details = [
    `config=${runtime.configFile}`,
    `env=${runtime.settingsLocalFile}`,
    `core=${runtime.coreUrl || '(missing)'}`,
    `failMode=${runtime.governancePolicy}`,
    `approvalMode=${runtime.approvalMode}`,
  ];

  if (runtime.coreUrlError) {
    return {
      name: 'runtime',
      status: 'fail',
      path: runtime.configFile,
      detail: `${details.join('; ')}; invalid OPENBOX_CORE_URL: ${runtime.coreUrlError}`,
    };
  }
  if (!runtime.coreUrl) {
    return {
      name: 'runtime',
      status: 'fail',
      path: runtime.configFile,
      detail: `${details.join('; ')}; missing OPENBOX_CORE_URL`,
    };
  }
  if (!runtime.apiKey) {
    return {
      name: 'runtime',
      status: 'fail',
      path: runtime.configFile,
      detail: `${details.join('; ')}; missing OPENBOX_API_KEY`,
    };
  }
  if (isPlaceholderKey(runtime.apiKey)) {
    return {
      name: 'runtime',
      status: 'fail',
      path: runtime.configFile,
      detail: `${details.join('; ')}; placeholder OPENBOX_API_KEY`,
    };
  }
  const format = validateApiKeyFormat(runtime.apiKey);
  if (format !== true) {
    return {
      name: 'runtime',
      status: 'fail',
      path: runtime.configFile,
      detail: `${details.join('; ')}; invalid OPENBOX_API_KEY format: ${format}`,
    };
  }
  if (!validateRuntime) {
    return {
      name: 'runtime',
      status: 'pass',
      path: runtime.configFile,
      detail: `${details.join('; ')}; key=format-ok`,
    };
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
    return {
      name: 'runtime',
      status: 'pass',
      path: runtime.configFile,
      detail: `${details.join('; ')}; key=validated${agent}`,
    };
  } catch (err: any) {
    return {
      name: 'runtime',
      status: 'fail',
      path: runtime.configFile,
      detail: `${details.join('; ')}; core validation failed: ${String(err?.message ?? err)}`,
    };
  }
}

export function summarizeClaudeCodeChecks(
  checks: ClaudeCodeInstallCheck[],
): Record<ClaudeCodeInstallCheckStatus, number> {
  return checks.reduce(
    (acc, check) => {
      acc[check.status] += 1;
      return acc;
    },
    { pass: 0, skip: 0, fail: 0 } as Record<ClaudeCodeInstallCheckStatus, number>,
  );
}

export function verifyClaudeCodeInstall(
  opts?: VerifyClaudeCodeInstallOptions & { includeRuntime?: false; validateRuntime?: false },
): ClaudeCodeInstallCheck[];
export function verifyClaudeCodeInstall(
  opts: VerifyClaudeCodeInstallOptions & ({ includeRuntime: true } | { validateRuntime: true }),
): Promise<ClaudeCodeInstallCheck[]>;
export function verifyClaudeCodeInstall(
  opts: VerifyClaudeCodeInstallOptions = {},
): ClaudeCodeInstallCheck[] | Promise<ClaudeCodeInstallCheck[]> {
  const target = opts.pluginTarget ?? opts.target ?? claudeCodePluginTargetDir(opts.cwd);
  const checks: ClaudeCodeInstallCheck[] = verifyClaudeCodePlugin({
    cwd: opts.cwd,
    target,
    includeOptInHooks: opts.includeOptInHooks,
  }).map((check) => ({
    name: check.name,
    status: check.status,
    path: check.path,
    detail: check.detail,
  }));

  if (opts.includeRuntime || opts.validateRuntime) {
    return checkRuntimeReadiness(opts.cwd, Boolean(opts.validateRuntime)).then((runtime) => [
      ...checks,
      runtime,
    ]);
  }
  return checks;
}
