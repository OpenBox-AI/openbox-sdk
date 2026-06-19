import fs from 'node:fs';
import path from 'node:path';
import { OpenBoxCoreClient } from '../core-client/index.js';
import type { AgentIdentityConfig } from '../core-client/index.js';
import { loadDotenv, loadJsonConfig } from '../config/host-config.js';
import { resolveAgentIdentity } from '../env/agent-identity.js';
import type { OpenBoxAgentsSDKConfig } from './types.js';

const OPENBOX_RUNTIME_KEY_PATTERN = /^obx_(live|test)_/;
const OPENBOX_BACKEND_API_KEY_PATTERN = /^obx_key_/;

export const DEFAULT_OPENAI_AGENTS_WORKFLOW_TYPE = 'OpenAIAgentsSDKRun';
export const DEFAULT_OPENAI_AGENTS_TASK_QUEUE = 'openai-agents-sdk';

export class OpenBoxAgentsSDKError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenBoxAgentsSDKError';
  }
}

export interface OpenBoxAgentsRuntimeContext {
  enabled: boolean;
  workflowType: string;
  taskQueue: string;
  approvalMode: 'wait' | 'error';
  getCoreClient(): OpenBoxCoreClient;
}

export function resolveProjectConfigDir(startDir: string = process.cwd()): string {
  let cur = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(cur, '.openbox', 'openai-agents-sdk');
    if (fs.existsSync(path.join(candidate, 'config.json'))) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.join(startDir, '.openbox', 'openai-agents-sdk');
}

export function createOpenBoxAgentsRuntimeContext(
  config: OpenBoxAgentsSDKConfig = {},
): OpenBoxAgentsRuntimeContext {
  const configDir = resolveProjectConfigDir(config.cwd);
  const fileConfig = loadJsonConfig(path.join(configDir, 'config.json'));
  const envConfig = loadDotenv(path.join(configDir, '.env'));
  let coreClient = config.core;
  let cacheKey: string | undefined;
  const getConfigValue = (key: string, fallback?: string) =>
    process.env[key] ??
    (fileConfig[key] as string | undefined) ??
    (envConfig[key] as string | undefined) ??
    fallback;

  const getCoreClient = () => {
    if (config.core) return config.core;
    const apiKey = config.apiKey ?? getConfigValue('OPENBOX_API_KEY');
    const coreUrl = config.coreUrl ?? getConfigValue('OPENBOX_CORE_URL');
    if (!apiKey) {
      throw new OpenBoxAgentsSDKError(
        'OpenBox OpenAI Agents SDK integration is enabled but OPENBOX_API_KEY is not configured.',
      );
    }
    if (OPENBOX_BACKEND_API_KEY_PATTERN.test(apiKey)) {
      throw new OpenBoxAgentsSDKError(
        'OpenBox OpenAI Agents SDK integration expected an agent runtime key in OPENBOX_API_KEY (obx_live_* or obx_test_*), but received an org/backend key (obx_key_*).',
      );
    }
    if (!OPENBOX_RUNTIME_KEY_PATTERN.test(apiKey)) {
      throw new OpenBoxAgentsSDKError(
        'OpenBox OpenAI Agents SDK integration requires an obx_live_* or obx_test_* runtime key.',
      );
    }
    if (!coreUrl) {
      throw new OpenBoxAgentsSDKError(
        'OpenBox OpenAI Agents SDK integration is enabled but OPENBOX_CORE_URL is not configured.',
      );
    }
    const agentIdentity = getAgentIdentity(config);
    const nextCacheKey = `${coreUrl}:${apiKey}:${agentIdentity?.did ?? ''}:${config.coreTimeoutMs ?? ''}`;
    if (!coreClient || cacheKey !== nextCacheKey) {
      coreClient = new OpenBoxCoreClient({
        apiKey,
        apiUrl: coreUrl,
        agentIdentity,
        timeoutMs: config.coreTimeoutMs,
      });
      cacheKey = nextCacheKey;
    }
    return coreClient;
  };

  return {
    enabled: config.enabled ?? true,
    workflowType: config.workflowType ?? DEFAULT_OPENAI_AGENTS_WORKFLOW_TYPE,
    taskQueue: config.taskQueue ?? DEFAULT_OPENAI_AGENTS_TASK_QUEUE,
    approvalMode: config.approvalMode ?? 'wait',
    getCoreClient,
  };
}

function getAgentIdentity(
  config: OpenBoxAgentsSDKConfig,
): AgentIdentityConfig | undefined {
  if (config.agentIdentity) return config.agentIdentity;
  try {
    return resolveAgentIdentity();
  } catch {
    throw new OpenBoxAgentsSDKError(
      'OpenBox signed agent identity requires both OPENBOX_AGENT_DID and OPENBOX_AGENT_PRIVATE_KEY.',
    );
  }
}
