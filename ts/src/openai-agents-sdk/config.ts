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

export type OpenBoxAgentsSDKDiagnosticStatus = 'pass' | 'fail' | 'skip';

export interface OpenBoxAgentsSDKDiagnosticCheck {
  name: string;
  status: OpenBoxAgentsSDKDiagnosticStatus;
  detail: string;
  remediation?: string;
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
  const values = openBoxAgentsConfigValues(config);
  let coreClient = config.core;
  let cacheKey: string | undefined;

  const getCoreClient = () => {
    if (config.core) return config.core;
    const apiKey = config.apiKey ?? values.get('OPENBOX_API_KEY');
    const coreUrl = config.coreUrl ?? values.get('OPENBOX_CORE_URL');
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

export function verifyOpenBoxAgentsSDKConfig(
  config: OpenBoxAgentsSDKConfig = {},
): OpenBoxAgentsSDKDiagnosticCheck[] {
  const values = openBoxAgentsConfigValues(config);
  const enabled = config.enabled ?? true;
  const checks: OpenBoxAgentsSDKDiagnosticCheck[] = [
    {
      name: 'runtime-enabled',
      status: enabled ? 'pass' : 'skip',
      detail: enabled
        ? 'OpenBox OpenAI Agents SDK runtime governance is enabled.'
        : 'OpenBox OpenAI Agents SDK runtime governance is disabled by config.',
    },
  ];

  if (config.core) {
    checks.push({
      name: 'core-client',
      status: 'pass',
      detail: 'A caller-provided OpenBox Core client will be used.',
    });
    checks.push({
      name: 'api-key',
      status: 'skip',
      detail: 'OPENBOX_API_KEY is not required when a Core client is provided.',
    });
    checks.push({
      name: 'core-url',
      status: 'skip',
      detail: 'OPENBOX_CORE_URL is not required when a Core client is provided.',
    });
  } else {
    checks.push(apiKeyCheck(config.apiKey ?? values.get('OPENBOX_API_KEY')));
    checks.push(coreUrlCheck(config.coreUrl ?? values.get('OPENBOX_CORE_URL')));
  }

  checks.push(agentIdentityCheck(config.agentIdentity));
  checks.push({
    name: 'runtime-defaults',
    status: 'pass',
    detail: `workflowType=${config.workflowType ?? DEFAULT_OPENAI_AGENTS_WORKFLOW_TYPE}; taskQueue=${config.taskQueue ?? DEFAULT_OPENAI_AGENTS_TASK_QUEUE}; approvalMode=${config.approvalMode ?? 'wait'}`,
  });
  return checks;
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

function openBoxAgentsConfigValues(config: OpenBoxAgentsSDKConfig): {
  get(key: string, fallback?: string): string | undefined;
} {
  const configDir = resolveProjectConfigDir(config.cwd);
  const fileConfig = loadJsonConfig(path.join(configDir, 'config.json'));
  const envConfig = loadDotenv(path.join(configDir, '.env'));
  return {
    get: (key: string, fallback?: string) =>
      process.env[key] ??
      (fileConfig[key] as string | undefined) ??
      (envConfig[key] as string | undefined) ??
      fallback,
  };
}

function apiKeyCheck(apiKey: string | undefined): OpenBoxAgentsSDKDiagnosticCheck {
  if (!apiKey) {
    return {
      name: 'api-key',
      status: 'fail',
      detail: 'OPENBOX_API_KEY is not configured.',
      remediation: 'Set OPENBOX_API_KEY to an obx_live_* or obx_test_* runtime key.',
    };
  }
  if (OPENBOX_BACKEND_API_KEY_PATTERN.test(apiKey)) {
    return {
      name: 'api-key',
      status: 'fail',
      detail: 'OPENBOX_API_KEY is an org/backend key (obx_key_*), not an agent runtime key.',
      remediation: 'Use an obx_live_* or obx_test_* runtime key for OpenAI Agents SDK runtime governance.',
    };
  }
  if (!OPENBOX_RUNTIME_KEY_PATTERN.test(apiKey)) {
    return {
      name: 'api-key',
      status: 'fail',
      detail: 'OPENBOX_API_KEY must start with obx_live_* or obx_test_*.',
      remediation: 'Create or configure an OpenBox runtime key for this agent.',
    };
  }
  return {
    name: 'api-key',
    status: 'pass',
    detail: 'OPENBOX_API_KEY has an agent runtime key prefix.',
  };
}

function coreUrlCheck(coreUrl: string | undefined): OpenBoxAgentsSDKDiagnosticCheck {
  return coreUrl
    ? {
        name: 'core-url',
        status: 'pass',
        detail: 'OPENBOX_CORE_URL is configured.',
      }
    : {
        name: 'core-url',
        status: 'fail',
        detail: 'OPENBOX_CORE_URL is not configured.',
        remediation: 'Set OPENBOX_CORE_URL to the OpenBox Core runtime endpoint.',
      };
}

function agentIdentityCheck(
  agentIdentity: AgentIdentityConfig | undefined,
): OpenBoxAgentsSDKDiagnosticCheck {
  if (agentIdentity) {
    return {
      name: 'signed-agent-identity',
      status: 'pass',
      detail: 'Signed agent identity is provided in config.',
    };
  }
  if (!process.env.OPENBOX_AGENT_DID && !process.env.OPENBOX_AGENT_PRIVATE_KEY) {
    return {
      name: 'signed-agent-identity',
      status: 'skip',
      detail: 'No signed agent identity is configured; unsigned runtime requests will be used.',
    };
  }
  try {
    resolveAgentIdentity();
    return {
      name: 'signed-agent-identity',
      status: 'pass',
      detail: 'Signed agent identity environment variables are complete.',
    };
  } catch (error) {
    return {
      name: 'signed-agent-identity',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
      remediation: 'Set both OPENBOX_AGENT_DID and OPENBOX_AGENT_PRIVATE_KEY, or remove both.',
    };
  }
}
