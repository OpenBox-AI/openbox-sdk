import fs from 'node:fs';
import path from 'node:path';
import { loadJsonConfig, loadDotenv } from '../../config/host-config.js';
import type { AgentIdentityConfig } from '../../core-client/index.js';
import { resolveAgentIdentity } from '../../env/agent-identity.js';

/**
 * Resolve which `.claude-hooks/` directory the hook subprocess
 * should read from. The lookup walks the current working directory
 * upward and prefers the closest one to the project root; this is
 * how a project-scoped plugin install (written by
 * `openbox install claude-code --scope project --cwd <dir>`) gets
 * picked up automatically when Claude Code spawns the hook with
 * its working directory inside `<dir>`. If no project config is
 * found, the hook reads `<startDir>/.claude-hooks/` and therefore
 * fails from missing project config instead of consulting user-level
 * state.
 *
 * Exported so tests can drive the walk-up logic against synthetic
 * directory layouts without spawning the hook subprocess. The
 * production callsite below passes `process.cwd()`.
 */
export function resolveConfigDir(startDir: string = process.cwd()): string {
  let cur = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(cur, '.claude-hooks');
    if (fs.existsSync(path.join(candidate, 'config.json'))) {
      return candidate;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.join(startDir, '.claude-hooks');
}

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
   *  unset, the default), the hook polls the backend up to
   *  `hitlMaxWait` for an external approver's decision. */
  approvalMode: 'inline' | 'remote' | 'defer';
  taskQueue: string;
  sendStartEvent: boolean;
  sendActivityStartEvent: boolean;
  maxBodySize: number | null;
}

/** Load config: env vars > config.json > .env > defaults */
export function loadConfig(): ClaudeCodeConfig {
  const fileConfig = loadConfigFile();
  const envConfig = loadEnvFile();
  const get = (key: string, fileFallback?: string) => {
    if (process.env[key] !== undefined) return process.env[key]!;
    if (fileConfig[key] !== undefined) return fileConfig[key];
    if (envConfig[key] !== undefined) return envConfig[key];
    return fileFallback ?? '';
  };

  // OPENBOX_CORE_URL is the canonical runtime target. No environment
  // fallback is baked in; installs must provide explicit service URLs.
  const coreUrl =
    process.env.OPENBOX_CORE_URL ??
    fileConfig.OPENBOX_CORE_URL ??
    envConfig.OPENBOX_CORE_URL ??
    '';
  return {
    openboxApiKey: get('OPENBOX_API_KEY'),
    openboxEndpoint: coreUrl,
    agentIdentity: resolveAgentIdentity({
      OPENBOX_AGENT_DID: get('OPENBOX_AGENT_DID') || undefined,
      OPENBOX_AGENT_PRIVATE_KEY: get('OPENBOX_AGENT_PRIVATE_KEY') || undefined,
    }),
    governancePolicy: 'fail_closed',
    governanceTimeout: parseInt(get('GOVERNANCE_TIMEOUT', '15'), 10) || 15,
    sessionDir: get('SESSION_DIR', path.join(CONFIG_DIR, 'sessions')),
    logFile: get('LOG_FILE', path.join(CONFIG_DIR, 'hook.log')) || null,
    verbose: get('VERBOSE') === 'true' || get('VERBOSE') === '1',
    hitlEnabled: get('HITL_ENABLED', 'true') !== 'false',
    hitlPollInterval: parseInt(get('HITL_POLL_INTERVAL', '5'), 10) || 5,
    hitlMaxWait: parseInt(get('HITL_MAX_WAIT', '300'), 10) || 300,
    approvalMode: parseApprovalMode(get('APPROVAL_MODE', 'remote')),
    taskQueue: get('TASK_QUEUE', 'claude-code'),
    sendStartEvent: get('SEND_START_EVENT', 'true') !== 'false',
    sendActivityStartEvent: get('SEND_ACTIVITY_START_EVENT', 'true') !== 'false',
    maxBodySize: get('MAX_BODY_SIZE') ? (parseInt(get('MAX_BODY_SIZE'), 10) || null) : null,
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
