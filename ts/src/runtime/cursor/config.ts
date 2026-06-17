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
  governancePolicy: 'fail_open' | 'fail_closed';
  governanceTimeout: number;
  activityType: string;
  sessionDir: string;
  logFile: string | null;
  verbose: boolean;
  dryRun: boolean;
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
  skipActivityTypes: string[];
  testDriftResponse: string | null;
}

/** Load config: env vars > config.json > .env > defaults */
export function loadConfig(): CursorConfig {
  const fileConfig = loadConfigFile();
  const envConfig = loadEnvFile();
  const get = (key: string, fileFallback?: string) => {
    if (process.env[key] !== undefined) return process.env[key]!;
    if (fileConfig[key] !== undefined) return fileConfig[key];
    if (envConfig[key] !== undefined) return envConfig[key];
    return fileFallback ?? '';
  };

  const skipRaw = get('SKIP_ACTIVITY_TYPES');
  const skipList = skipRaw ? skipRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

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
    governancePolicy: (get('GOVERNANCE_POLICY', 'fail_closed') as 'fail_open' | 'fail_closed'),
    governanceTimeout: parseInt(get('GOVERNANCE_TIMEOUT', '15'), 10) || 15,
    activityType: get('ACTIVITY_TYPE', 'CursorIDE'),
    sessionDir: get('SESSION_DIR', path.join(CONFIG_DIR, 'sessions')),
    logFile: get('LOG_FILE', path.join(CONFIG_DIR, 'hook.log')) || null,
    verbose: get('VERBOSE') === 'true' || get('VERBOSE') === '1',
    dryRun: get('DRY_RUN') === 'true' || get('DRY_RUN') === '1',
    hitlEnabled: get('HITL_ENABLED', 'true') !== 'false',
    hitlPollInterval: parseInt(get('HITL_POLL_INTERVAL', '5'), 10) || 5,
    hitlMaxWait: parseInt(get('HITL_MAX_WAIT', '300'), 10) || 300,
    approvalMode: (get('APPROVAL_MODE', 'remote').toLowerCase() === 'inline' ? 'inline' : 'remote'),
    approvalSocketPath: get('OPENBOX_APPROVAL_SOCKET') || null,
    taskQueue: get('TASK_QUEUE', 'cursor-hooks'),
    sendStartEvent: get('SEND_START_EVENT', 'true') !== 'false',
    sendActivityStartEvent: get('SEND_ACTIVITY_START_EVENT', 'true') !== 'false',
    maxBodySize: get('MAX_BODY_SIZE') ? (parseInt(get('MAX_BODY_SIZE'), 10) || null) : null,
    skipActivityTypes: skipList,
    testDriftResponse: get('TEST_DRIFT_RESPONSE') || null,
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
