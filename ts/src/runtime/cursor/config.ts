import fs from 'node:fs';
import path from 'node:path';
import { loadJsonConfig, loadDotenv } from '../../config/host-config.js';
import type { AgentIdentityConfig } from '../../core-client/index.js';
import { resolveAgentIdentity } from '../../env/agent-identity.js';

/**
 * Resolve which `.cursor-hooks/` directory the hook subprocess
 * should read from. The lookup walks the current working directory
 * upward and prefers the closest one, which lets advanced users keep
 * project-local runtime config. If no project config is found, the
 * hook reads `<startDir>/.cursor-hooks/` and therefore fails from
 * missing project config instead of consulting user-level state.
 * Cursor installation itself is plugin-only.
 *
 * Exported for tests; production callsite below passes
 * `process.cwd()`.
 */
export function resolveConfigDir(startDir: string = process.cwd()): string {
  let cur = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(cur, '.cursor-hooks');
    if (fs.existsSync(path.join(candidate, 'config.json'))) {
      return candidate;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.join(startDir, '.cursor-hooks');
}

const CONFIG_DIR = resolveConfigDir();
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const ENV_FILE = path.join(CONFIG_DIR, '.env');

export interface CursorConfig {
  openboxApiKey: string;
  openboxEndpoint: string;
  agentIdentity?: AgentIdentityConfig;
  governancePolicy: 'fail_closed';
  governanceTimeout: number;
  activityType: string;
  sessionDir: string;
  logFile: string | null;
  verbose: boolean;
  hitlEnabled: boolean;
  hitlPollInterval: number;
  hitlMaxWait: number;
  /** When 'inline', the hook returns permission:'ask' on
   *  require_approval so Cursor's native permission dialog pops; the
   *  local user is the approver. 'remote' (default) keeps the
   *  existing poll-and-wait behavior. */
  approvalMode: 'inline' | 'remote';
  approvalSocketPath: string | null;
  taskQueue: string;
  sendStartEvent: boolean;
  sendActivityStartEvent: boolean;
  maxBodySize: number | null;
}

/** Load config: env vars > config.json > .env > defaults */
export function loadConfig(): CursorConfig {
  const fileConfig = loadConfigFile();
  const envConfig = loadEnvFile();
  const getRuntime = (key: string, fileFallback?: string) => {
    if (process.env[key] !== undefined) return process.env[key]!;
    if (fileConfig[key] !== undefined) return fileConfig[key];
    if (envConfig[key] !== undefined) return envConfig[key];
    return fileFallback ?? '';
  };
  const getSetting = (key: string, fileFallback?: string) => {
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
    openboxApiKey: getRuntime('OPENBOX_API_KEY'),
    openboxEndpoint: coreUrl,
    agentIdentity: resolveAgentIdentity({
      OPENBOX_AGENT_DID: getRuntime('OPENBOX_AGENT_DID') || undefined,
      OPENBOX_AGENT_PRIVATE_KEY: getRuntime('OPENBOX_AGENT_PRIVATE_KEY') || undefined,
    }),
    governancePolicy: 'fail_closed',
    governanceTimeout: parseInt(getSetting('governanceTimeout', '15'), 10) || 15,
    activityType: getSetting('activityType', 'CursorIDE'),
    sessionDir: getSetting('sessionDir', path.join(CONFIG_DIR, 'sessions')),
    logFile: getSetting('logFile', path.join(CONFIG_DIR, 'hook.log')) || null,
    verbose: asBoolean(getSetting('verbose', 'false')),
    hitlEnabled: getSetting('hitlEnabled', 'true') !== 'false',
    hitlPollInterval: parseInt(getSetting('hitlPollInterval', '5'), 10) || 5,
    hitlMaxWait: parseInt(getSetting('hitlMaxWait', '300'), 10) || 300,
    approvalMode: (getSetting('approvalMode', 'remote').toLowerCase() === 'inline' ? 'inline' : 'remote'),
    approvalSocketPath: getRuntime('OPENBOX_APPROVAL_SOCKET') || null,
    taskQueue: getSetting('taskQueue', 'cursor-hooks'),
    sendStartEvent: getSetting('sendStartEvent', 'true') !== 'false',
    sendActivityStartEvent: getSetting('sendActivityStartEvent', 'true') !== 'false',
    maxBodySize: getSetting('maxBodySize')
      ? (parseInt(getSetting('maxBodySize'), 10) || null)
      : null,
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

function asBoolean(value: string): boolean {
  return value === 'true' || value === '1';
}
