import fs from 'node:fs';
import path from 'node:path';
import { loadJsonConfig, loadDotenv } from '../../config/host-config.js';
import type { AgentIdentityConfig } from '../../core-client/index.js';
import { resolveAgentIdentity } from '../../env/agent-identity.js';
import { asBoolean } from '../../internal/coerce.js';
import {
  claudeCodeRuntimeConfigDir,
  claudeCodeSettingsLocalFile,
  readClaudeCodeSettingsLocalEnv,
} from './plugin.js';

/**
 * Resolve the project root for a project-scoped Claude Code plugin install.
 * Official Claude runtime env is read from `.claude/settings.local.json`;
 * OpenBox-only hook state/settings live under `.openbox/claude-code`.
 *
 * Exported so tests can drive the walk-up logic against synthetic
 * directory layouts without spawning the hook subprocess. The
 * production callsite below passes `process.cwd()`.
 */
export function resolveProjectRoot(startDir: string = process.cwd()): string {
  let cur = startDir;
  for (let i = 0; i < 8; i++) {
    if (
      fs.existsSync(claudeCodeSettingsLocalFile(cur)) ||
      fs.existsSync(path.join(claudeCodeRuntimeConfigDir(cur), 'config.json'))
    ) {
      return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return startDir;
}

export function resolveConfigDir(startDir: string = process.cwd()): string {
  const projectRoot = resolveProjectRoot(startDir);
  return claudeCodeRuntimeConfigDir(projectRoot);
}

const PROJECT_ROOT = resolveProjectRoot();
const CONFIG_DIR = resolveConfigDir();
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const ENV_FILE = path.join(CONFIG_DIR, '.env');

export interface ClaudeCodeConfig {
  openboxApiKey: string;
  openboxEndpoint: string;
  agentIdentity?: AgentIdentityConfig;
  governancePolicy: 'fail_closed';
  governanceTimeout: number;
  sessionDir: string;
  logFile: string | null;
  verbose: boolean;
  hitlEnabled: boolean;
  hitlPollInterval: number;
  hitlMaxWait: number;
  /** When 'inline', the hook returns `permissionDecision:'ask'` on
   *  require_approval so Claude Code's native permission dialog pops
   *  in the TUI; the local user is the approver. When 'defer', supported
   *  Claude Code permission decisions are deferred in non-interactive
   *  sessions. When 'remote' (or
   *  unset, the default), the hook polls until Core returns a terminal
   *  decision or the server-owned approval expiration is reached. */
  approvalMode: 'inline' | 'remote' | 'defer';
  taskQueue: string;
  sendStartEvent: boolean;
  sendActivityStartEvent: boolean;
  maxBodySize: number | null;
  /** Strict AGE compliance: every governed action must resolve a session goal. */
  requireGoalContext: boolean;
  /** Background/scheduled workflow objective used when no prompt event exists. */
  defaultGoal?: string;
  /**
   * Root for opt-in managed WorktreeCreate directories. Relative values
   * resolve against the hook envelope cwd.
   */
  worktreeRoot?: string;
}

/** Load config: env vars > config.json > .env > defaults */
export function loadConfig(): ClaudeCodeConfig {
  const fileConfig = loadConfigFile();
  const envConfig = loadEnvFile();
  const claudeLocalEnv = readClaudeCodeSettingsLocalEnv(PROJECT_ROOT);
  const getRuntime = (key: string, defaultValue?: string) => {
    if (process.env[key] !== undefined) return process.env[key]!;
    if (claudeLocalEnv[key] !== undefined) return claudeLocalEnv[key];
    if (envConfig[key] !== undefined) return envConfig[key];
    if (fileConfig[key] !== undefined) return fileConfig[key];
    return defaultValue ?? '';
  };
  const getSetting = (key: string, defaultValue?: string) => {
    if (fileConfig[key] !== undefined) return fileConfig[key];
    if (envConfig[key] !== undefined) return envConfig[key];
    return defaultValue ?? '';
  };

  // OPENBOX_CORE_URL is the canonical runtime target. Installs must
  // provide explicit service URLs.
  const coreUrl =
    process.env.OPENBOX_CORE_URL ??
    claudeLocalEnv.OPENBOX_CORE_URL ??
    envConfig.OPENBOX_CORE_URL ??
    fileConfig.OPENBOX_CORE_URL ??
    '';
  return {
    openboxApiKey: getRuntime('OPENBOX_API_KEY'),
    openboxEndpoint: coreUrl,
    agentIdentity: resolveAgentIdentity({
      OPENBOX_AGENT_DID: getRuntime('OPENBOX_AGENT_DID') || undefined,
      OPENBOX_AGENT_PRIVATE_KEY: getRuntime('OPENBOX_AGENT_PRIVATE_KEY') || undefined,
    }),
    governancePolicy: 'fail_closed',
    governanceTimeout: parseInt(getSetting('governanceTimeout', '15'), 10) || 15,
    sessionDir: getSetting('sessionDir', path.join(CONFIG_DIR, 'sessions')),
    logFile: getSetting('logFile', path.join(CONFIG_DIR, 'hook.log')) || null,
    verbose: asBoolean(getSetting('verbose', 'false')),
    hitlEnabled: getSetting('hitlEnabled', 'true') !== 'false',
    hitlPollInterval: parseInt(getSetting('hitlPollInterval', '5'), 10) || 5,
    hitlMaxWait: parseInt(getSetting('hitlMaxWait', '300'), 10) || 300,
    approvalMode: parseApprovalMode(getSetting('approvalMode', 'remote')),
    taskQueue: getSetting('taskQueue', 'claude-code'),
    sendStartEvent: getSetting('sendStartEvent', 'true') !== 'false',
    sendActivityStartEvent: getSetting('sendActivityStartEvent', 'true') !== 'false',
    maxBodySize: getSetting('maxBodySize')
      ? (parseInt(getSetting('maxBodySize'), 10) || null)
      : null,
    requireGoalContext: asBoolean(
      getRuntime('OPENBOX_REQUIRE_GOAL_CONTEXT') ||
      getRuntime('OPENBOX_GOAL_ALIGNMENT_REQUIRED') ||
      getRuntime('ENABLE_ALIGNMENT_CHECK') ||
      getSetting('requireGoalContext', 'false'),
    ),
    defaultGoal: getRuntime('OPENBOX_SESSION_GOAL') ||
      getRuntime('OPENBOX_WORKFLOW_GOAL') ||
      getSetting('defaultGoal') ||
      undefined,
    worktreeRoot: getSetting('worktreeRoot') || undefined,
  };
}

const loadConfigFile = (): Record<string, string> => loadJsonConfig(CONFIG_FILE);
const loadEnvFile = (): Record<string, string> => loadDotenv(ENV_FILE);

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigFilePath(): string {
  return CONFIG_FILE;
}

function parseApprovalMode(value: string): ClaudeCodeConfig['approvalMode'] {
  const mode = value.toLowerCase();
  if (mode === 'inline' || mode === 'defer') return mode;
  return 'remote';
}
