import {
  OpenBoxCoreClient,
  validateAgentIdentityConfig,
  type AgentIdentityConfig,
} from '../core-client/core-client.js';
import { resolveAgentIdentity } from '../env/agent-identity.js';
import {
  OPENBOX_BACKEND_API_KEY_PATTERN,
  OPENBOX_RUNTIME_KEY_PATTERN,
} from './constants.js';
import {
  OpenBoxCopilotKitError,
  type OpenBoxCopilotKitConfig,
} from './types.js';

export function getRuntimeApiKey(
  config: OpenBoxCopilotKitConfig,
): string | undefined {
  return config.apiKey ?? process.env.OPENBOX_API_KEY;
}

export function getApprovalBackendApiKey(
  config: OpenBoxCopilotKitConfig,
): string | undefined {
  return config.backendApiKey ?? process.env.OPENBOX_BACKEND_API_KEY;
}

export function createCoreClientResolver(config: OpenBoxCopilotKitConfig) {
  let coreClient: OpenBoxCoreClient | undefined = config.core;
  let coreClientCacheKey: string | undefined;

  return () => {
    if (config.core) return config.core;
    const apiKey = getRuntimeApiKey(config);
    const coreUrl = config.coreUrl ?? process.env.OPENBOX_CORE_URL;
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
    return resolveAgentIdentity();
  } catch {
    throw new OpenBoxCopilotKitError(
      'OpenBox signed agent identity requires both OPENBOX_AGENT_DID and OPENBOX_AGENT_PRIVATE_KEY.',
    );
  }
}
