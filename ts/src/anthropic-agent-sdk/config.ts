import { OpenBoxCoreClient } from '../core-client/index.js';
import type { AgentIdentityConfig } from '../core-client/index.js';
import { resolveAgentIdentity } from '../env/agent-identity.js';
import type {
  OpenBoxAnthropicAgentSDKConfig,
  OpenBoxAnthropicApprovalMode,
} from './types.js';

const OPENBOX_RUNTIME_KEY_PATTERN = /^obx_(live|test)_/;
const OPENBOX_BACKEND_API_KEY_PATTERN = /^obx_key_/;

export const DEFAULT_ANTHROPIC_AGENT_WORKFLOW_TYPE =
  'AnthropicAgentSDKSession';
export const DEFAULT_ANTHROPIC_AGENT_TASK_QUEUE = 'anthropic-agent-sdk';

export class OpenBoxAnthropicAgentSDKError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenBoxAnthropicAgentSDKError';
  }
}

export interface OpenBoxAnthropicRuntimeContext {
  enabled: boolean;
  workflowType: string;
  taskQueue: string;
  approvalMode: OpenBoxAnthropicApprovalMode;
  hookTimeoutSeconds?: number;
  getCoreClient(): OpenBoxCoreClient;
}

export function createOpenBoxAnthropicRuntimeContext(
  config: OpenBoxAnthropicAgentSDKConfig = {},
): OpenBoxAnthropicRuntimeContext {
  let coreClient = config.core;
  let cacheKey: string | undefined;

  const getCoreClient = () => {
    if (config.core) return config.core;
    const apiKey = config.apiKey ?? process.env.OPENBOX_API_KEY;
    const coreUrl = config.coreUrl ?? process.env.OPENBOX_CORE_URL;
    if (!apiKey) {
      throw new OpenBoxAnthropicAgentSDKError(
        'OpenBox Anthropic Agent SDK integration is enabled but OPENBOX_API_KEY is not configured.',
      );
    }
    if (OPENBOX_BACKEND_API_KEY_PATTERN.test(apiKey)) {
      throw new OpenBoxAnthropicAgentSDKError(
        'OpenBox Anthropic Agent SDK integration expected an agent runtime key in OPENBOX_API_KEY (obx_live_* or obx_test_*), but received an org/backend key (obx_key_*).',
      );
    }
    if (!OPENBOX_RUNTIME_KEY_PATTERN.test(apiKey)) {
      throw new OpenBoxAnthropicAgentSDKError(
        'OpenBox Anthropic Agent SDK integration requires an obx_live_* or obx_test_* runtime key.',
      );
    }
    if (!coreUrl) {
      throw new OpenBoxAnthropicAgentSDKError(
        'OpenBox Anthropic Agent SDK integration is enabled but OPENBOX_CORE_URL is not configured.',
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
    workflowType:
      config.workflowType ?? DEFAULT_ANTHROPIC_AGENT_WORKFLOW_TYPE,
    taskQueue: config.taskQueue ?? DEFAULT_ANTHROPIC_AGENT_TASK_QUEUE,
    approvalMode: config.approvalMode ?? 'ask',
    hookTimeoutSeconds: config.hookTimeoutSeconds,
    getCoreClient,
  };
}

function getAgentIdentity(
  config: OpenBoxAnthropicAgentSDKConfig,
): AgentIdentityConfig | undefined {
  if (config.agentIdentity) return config.agentIdentity;
  try {
    return resolveAgentIdentity();
  } catch {
    throw new OpenBoxAnthropicAgentSDKError(
      'OpenBox signed agent identity requires both OPENBOX_AGENT_DID and OPENBOX_AGENT_PRIVATE_KEY.',
    );
  }
}
