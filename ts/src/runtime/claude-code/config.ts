import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CORE_URL } from '../../env/index.js';
import { loadJsonConfig, loadDotenv } from '../../config/host-config.js';

// `os.homedir()` honors USERPROFILE on Windows where HOME is unset.
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.claude-hooks');

/**
 * Resolve which `.claude-hooks/` directory the hook subprocess
 * should read from. The lookup walks the current working directory
 * upward and prefers the closest one to the project root; this is
 * how a project-scoped install (written by
 * `openbox claude-code install --scope project --cwd <dir>`) gets
 * picked up automatically when Claude Code spawns the hook with
 * its working directory inside `<dir>`. Falls back to the global
 * `~/.claude-hooks/` so any pre-existing user install keeps
 * working unchanged.
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
  return GLOBAL_CONFIG_DIR;
}

const CONFIG_DIR = resolveConfigDir();
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const ENV_FILE = path.join(CONFIG_DIR, '.env');

export interface ClaudeCodeConfig {
  openboxApiKey: string;
  openboxEndpoint: string;
  governancePolicy: 'fail_open' | 'fail_closed';
  governanceTimeout: number;
  sessionDir: string;
  logFile: string | null;
  verbose: boolean;
  dryRun: boolean;
  hitlEnabled: boolean;
  hitlPollInterval: number;
  hitlMaxWait: number;
  taskQueue: string;
  sendStartEvent: boolean;
  sendActivityStartEvent: boolean;
  maxBodySize: number | null;
  skipTools: string[];
  skipActivityTypes: string[];
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

  const skipToolsRaw = get('SKIP_TOOLS', 'Glob,Grep');
  const skipTools = skipToolsRaw ? skipToolsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

  const skipActivityRaw = get('SKIP_ACTIVITY_TYPES');
  const skipActivityTypes = skipActivityRaw ? skipActivityRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

  // Prefer canonical OPENBOX_CORE_URL (set by applyEnvSource() from
  // ~/.openbox/config). Legacy OPENBOX_ENDPOINT honored as fallback
  // for installs whose config.json predates unification.
  const coreUrl =
    process.env.OPENBOX_CORE_URL ??
    fileConfig.OPENBOX_CORE_URL ??
    envConfig.OPENBOX_CORE_URL ??
    get('OPENBOX_ENDPOINT', DEFAULT_CORE_URL);
  return {
    openboxApiKey: get('OPENBOX_API_KEY'),
    openboxEndpoint: coreUrl,
    governancePolicy: (get('GOVERNANCE_POLICY', 'fail_open') as 'fail_open' | 'fail_closed'),
    governanceTimeout: parseInt(get('GOVERNANCE_TIMEOUT', '15'), 10) || 15,
    sessionDir: get('SESSION_DIR', path.join(CONFIG_DIR, 'sessions')),
    logFile: get('LOG_FILE', path.join(CONFIG_DIR, 'hook.log')) || null,
    verbose: get('VERBOSE') === 'true' || get('VERBOSE') === '1',
    dryRun: get('DRY_RUN') === 'true' || get('DRY_RUN') === '1',
    hitlEnabled: get('HITL_ENABLED', 'true') !== 'false',
    hitlPollInterval: parseInt(get('HITL_POLL_INTERVAL', '5'), 10) || 5,
    hitlMaxWait: parseInt(get('HITL_MAX_WAIT', '300'), 10) || 300,
    taskQueue: get('TASK_QUEUE', 'claude-code'),
    sendStartEvent: get('SEND_START_EVENT', 'true') !== 'false',
    sendActivityStartEvent: get('SEND_ACTIVITY_START_EVENT', 'true') !== 'false',
    maxBodySize: get('MAX_BODY_SIZE') ? (parseInt(get('MAX_BODY_SIZE'), 10) || null) : null,
    skipTools,
    skipActivityTypes,
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
