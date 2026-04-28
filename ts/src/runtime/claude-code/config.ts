import fs from 'node:fs';
import path from 'node:path';

const CONFIG_DIR = path.join(process.env.HOME || '', '.claude-hooks');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const ENV_FILE = path.join(CONFIG_DIR, '.env');

export interface ClaudeHooksConfig {
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
export function loadConfig(): ClaudeHooksConfig {
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

  return {
    openboxApiKey: get('OPENBOX_API_KEY'),
    openboxEndpoint: get('OPENBOX_ENDPOINT', 'https://core.openbox.ai'),
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

function loadConfigFile(): Record<string, string> {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        out[k.toUpperCase().replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()] = String(v);
        out[k] = String(v);
      }
      return out;
    }
  } catch { /* ignore */ }
  return {};
}

function loadEnvFile(): Record<string, string> {
  try {
    if (fs.existsSync(ENV_FILE)) {
      const lines = fs.readFileSync(ENV_FILE, 'utf-8').split('\n');
      const out: Record<string, string> = {};
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        out[key] = val;
      }
      return out;
    }
  } catch { /* ignore */ }
  return {};
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigFilePath(): string {
  return CONFIG_FILE;
}
