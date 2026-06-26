import fs from 'node:fs';
import path from 'node:path';
import {
  OpenBoxCoreClient,
  validateAgentIdentityConfig,
  type AgentIdentityConfig,
} from '../core-client/core-client.js';
import { loadDotenv, loadJsonConfig } from '../config/host-config.js';
import { resolveAgentIdentity } from '../env/agent-identity.js';
import {
  OPENBOX_BACKEND_API_KEY_PATTERN,
  OPENBOX_RUNTIME_KEY_PATTERN,
} from './constants.js';
import {
  OpenBoxCopilotKitError,
  type OpenBoxCopilotKitConfig,
} from './types.js';

export function resolveProjectConfigDir(startDir: string = process.cwd()): string {
  let cur = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(cur, '.openbox', 'copilotkit');
    if (
      fs.existsSync(path.join(candidate, 'config.json')) ||
      fs.existsSync(path.join(candidate, '.env'))
    ) {
      return candidate;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.join(startDir, '.openbox', 'copilotkit');
}

function openBoxCopilotKitConfigValues(config: OpenBoxCopilotKitConfig): {
  get(key: string, defaultValue?: string): string | undefined;
} {
  const configDir = resolveProjectConfigDir(config.cwd);
  const fileConfig = loadJsonConfig(path.join(configDir, 'config.json'));
  const envConfig = loadDotenv(path.join(configDir, '.env'));
  return {
    get: (key: string, defaultValue?: string) =>
      process.env[key] ??
      envConfig[key] ??
      fileConfig[key] ??
      defaultValue,
  };
}

export function getRuntimeApiKey(
  config: OpenBoxCopilotKitConfig,
): string | undefined {
  const values = openBoxCopilotKitConfigValues(config);
  return config.apiKey ?? values.get('OPENBOX_API_KEY');
}

export function getApprovalBackendApiKey(
  config: OpenBoxCopilotKitConfig,
): string | undefined {
  const values = openBoxCopilotKitConfigValues(config);
  return config.backendApiKey ?? values.get('OPENBOX_BACKEND_API_KEY');
}

export function createCoreClientResolver(config: OpenBoxCopilotKitConfig) {
  let coreClient: OpenBoxCoreClient | undefined = config.core;
  let coreClientCacheKey: string | undefined;

  return () => {
    if (config.core) return config.core;
    const values = openBoxCopilotKitConfigValues(config);
    const apiKey = getRuntimeApiKey(config);
    const coreUrl = config.coreUrl ?? values.get('OPENBOX_CORE_URL');
    if (!apiKey) {
      throw new OpenBoxCopilotKitError(
        'OpenBox is enabled but the runtime API key is not configured.',
      );
    }
    if (OPENBOX_BACKEND_API_KEY_PATTERN.test(apiKey)) {
      throw new OpenBoxCopilotKitError(
        'OpenBox CopilotKit runtime expected an agent runtime key in OPENBOX_API_KEY (obx_live_* or obx_test_*), but received an org/backend key (obx_key_*). Put org keys in OPENBOX_BACKEND_API_KEY.',
      );
    }
    if (!OPENBOX_RUNTIME_KEY_PATTERN.test(apiKey)) {
      throw new OpenBoxCopilotKitError(
        'OpenBox is enabled but the runtime API key must be an obx_live_* or obx_test_* key.',
      );
    }
    if (!coreUrl) {
      throw new OpenBoxCopilotKitError(
        'OpenBox is enabled but the Core URL is not configured.',
      );
    }
    const agentIdentity = getAgentIdentity(config);
    const cacheKey = `${coreUrl}:${apiKey}:${agentIdentity?.did ?? ''}:${config.coreTimeoutMs ?? ''}`;
    if (!coreClient || coreClientCacheKey !== cacheKey) {
      coreClient = new OpenBoxCoreClient({
        apiKey,
        apiUrl: coreUrl,
        agentIdentity,
        timeoutMs: config.coreTimeoutMs,
      });
      coreClientCacheKey = cacheKey;
    }
    return coreClient;
  };
}

export function getAgentIdentity(
  config: OpenBoxCopilotKitConfig,
): AgentIdentityConfig | undefined {
  if (config.agentIdentity) return validateAgentIdentityConfig(config.agentIdentity);
  try {
    const values = openBoxCopilotKitConfigValues(config);
    return resolveAgentIdentity({
      OPENBOX_AGENT_DID: values.get('OPENBOX_AGENT_DID'),
      OPENBOX_AGENT_PRIVATE_KEY: values.get('OPENBOX_AGENT_PRIVATE_KEY'),
    });
  } catch {
    throw new OpenBoxCopilotKitError(
      'OpenBox signed agent identity requires both OPENBOX_AGENT_DID and OPENBOX_AGENT_PRIVATE_KEY.',
    );
  }
}
