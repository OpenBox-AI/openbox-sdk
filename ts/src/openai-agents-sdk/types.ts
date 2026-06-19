import type {
  AgentIdentityConfig,
  OpenBoxCoreClient,
} from '../core-client/index.js';

export type AgentsToolFactory = (config: Record<string, unknown>) => unknown;
export type AgentsRunFunction = (
  agent: unknown,
  input: unknown,
  options?: Record<string, unknown>,
) => Promise<unknown>;

export type OpenBoxAgentsApprovalMode = 'wait' | 'error';

export interface OpenBoxAgentsSDKConfig {
  enabled?: boolean;
  cwd?: string;
  core?: OpenBoxCoreClient;
  coreUrl?: string;
  apiKey?: string;
  agentIdentity?: AgentIdentityConfig;
  coreTimeoutMs?: number;
  workflowType?: string;
  taskQueue?: string;
  approvalMode?: OpenBoxAgentsApprovalMode;
  workflowId?: string;
  runId?: string;
}

export interface OpenBoxAgentsToolOptions extends OpenBoxAgentsSDKConfig {
  toolFactory?: AgentsToolFactory;
  sessionId?: string;
  toolType?: string;
}

export interface OpenBoxAgentsRunOptions extends OpenBoxAgentsSDKConfig {
  runFunction?: AgentsRunFunction;
  sessionId?: string;
  input?: unknown;
}

export interface OpenBoxAgentsToolConfig {
  name: string;
  description?: string;
  parameters?: unknown;
  execute: (input: unknown, context?: unknown) => unknown | Promise<unknown>;
  [key: string]: unknown;
}
