import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadDotenv, loadJsonConfig } from '../../config/host-config.js';
import { OpenBoxCoreClient } from '../../core-client/index.js';
import { resolveAgentIdentity, validateApiKeyFormat } from '../../env/index.js';
import {
  claudeCodePluginTargetDir,
  claudeCodeRuntimeConfigDir,
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

function truthy(value: string | undefined): boolean {
  return value === 'true' || value === '1';
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

function parseFailMode(value: string | undefined): 'fail_open' | 'fail_closed' {
  return value === 'fail_closed' ? 'fail_closed' : 'fail_open';
}

function buildProjectRuntimeEnv(cwd = process.cwd()) {
  const configDir = claudeCodeRuntimeConfigDir(cwd);
  const configFile = path.join(configDir, 'config.json');
  const envFile = path.join(configDir, '.env');
  const fileConfig = loadJsonConfig(configFile);
  const envConfig = loadDotenv(envFile);
  const get = (key: string): string | undefined =>
    process.env[key] ?? fileConfig[key] ?? envConfig[key];

  const agentIdentity = resolveAgentIdentity({
    OPENBOX_AGENT_DID: get('OPENBOX_AGENT_DID'),
    OPENBOX_AGENT_PRIVATE_KEY: get('OPENBOX_AGENT_PRIVATE_KEY'),
  });

  return {
    configDir,
    configFile,
    envFile,
    projectConfigPresent: existsSync(configFile),
    projectEnvPresent: existsSync(envFile),
    coreUrl: get('OPENBOX_CORE_URL') ?? '',
    apiKey: get('OPENBOX_API_KEY') ?? '',
    governancePolicy: parseFailMode(get('GOVERNANCE_POLICY')),
    approvalMode: parseApprovalMode(get('APPROVAL_MODE')),
    dryRun: truthy(get('DRY_RUN')),
    agentIdentity,
  };
}

export function claudeCodeRuntimeDiagnostics(cwd = process.cwd()): Record<string, unknown> {
  const runtime = buildProjectRuntimeEnv(cwd);
  return {
    configDir: runtime.configDir,
    configFile: runtime.configFile,
    envFile: runtime.envFile,
    projectScoped: true,
    runtimeEnv: {
      projectConfigPresent: runtime.projectConfigPresent,
      projectEnvPresent: runtime.projectEnvPresent,
      runtimeApiKeyPresent: Boolean(runtime.apiKey),
      runtimeApiKeyPlaceholder: isPlaceholderKey(runtime.apiKey),
      coreUrlPresent: Boolean(runtime.coreUrl),
      agentIdentityPresent: Boolean(runtime.agentIdentity),
    },
    failMode: runtime.governancePolicy,
    approvalMode: runtime.approvalMode,
    dryRun: runtime.dryRun,
    unsupportedOrOptInSurfaces: {
      worktreeCreate: 'explicit_out_of_scope_replaces_default_git_behavior',
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
    `core=${runtime.coreUrl || '(missing)'}`,
    `failMode=${runtime.governancePolicy}`,
    `approvalMode=${runtime.approvalMode}`,
    `dryRun=${runtime.dryRun}`,
  ];

  if (runtime.dryRun) {
    return {
      name: 'runtime',
      status: 'fail',
      path: runtime.configFile,
      detail: `${details.join('; ')}; DRY_RUN=true`,
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
