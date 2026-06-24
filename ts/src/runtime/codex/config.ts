import fs from 'node:fs';
import path from 'node:path';
import { loadDotenv, loadJsonConfig } from '../../config/host-config.js';
import type { AgentIdentityConfig } from '../../core-client/index.js';
import { resolveAgentIdentity } from '../../env/agent-identity.js';
import { codexRuntimeConfigDir } from './install.js';

function hasRuntimeConfig(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'config.json')) ||
    fs.existsSync(path.join(dir, '.env'));
}

export function resolveConfigDir(startDir: string = process.cwd()): string {
  let cur = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = codexRuntimeConfigDir(cur);
    if (hasRuntimeConfig(candidate)) {
      return candidate;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return codexRuntimeConfigDir(startDir);
}

const CONFIG_DIR = resolveConfigDir();
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const ENV_FILE = path.join(CONFIG_DIR, '.env');

export interface CodexConfig {
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
  approvalMode: 'inline' | 'remote' | 'defer';
  taskQueue: string;
  sendStartEvent: boolean;
  sendActivityStartEvent: boolean;
  maxBodySize: number | null;
  /** Strict AGE compliance: every governed action must resolve a session goal. */
  requireGoalContext: boolean;
  /** Background/scheduled workflow objective used when no prompt event exists. */
  defaultGoal?: string;
}

export function loadConfig(): CodexConfig {
  const fileConfig = loadConfigFile();
  const envConfig = loadEnvFile();
  const getRuntime = (key: string, defaultValue?: string) => {
    if (process.env[key] !== undefined) return process.env[key]!;
    if (envConfig[key] !== undefined) return envConfig[key];
    if (fileConfig[key] !== undefined) return fileConfig[key];
    return defaultValue ?? '';
  };
  const getSetting = (key: string, defaultValue?: string) => {
    if (fileConfig[key] !== undefined) return fileConfig[key];
    if (envConfig[key] !== undefined) return envConfig[key];
    return defaultValue ?? '';
  };

  const coreUrl =
    process.env.OPENBOX_CORE_URL ??
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
    taskQueue: getSetting('taskQueue', 'codex'),
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

function parseApprovalMode(value: string): CodexConfig['approvalMode'] {
  const mode = value.toLowerCase();
  if (mode === 'inline' || mode === 'defer') return mode;
  return 'remote';
}

function asBoolean(value: string): boolean {
  return value === 'true' || value === '1';
}
