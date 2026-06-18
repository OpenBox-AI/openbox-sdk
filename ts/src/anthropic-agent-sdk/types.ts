import type {
  HookCallbackMatcher,
  HookEvent,
  Options,
  Query,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentIdentityConfig,
  OpenBoxCoreClient,
} from '../core-client/index.js';

export type OpenBoxAnthropicAgentHookEvent = Extract<
  HookEvent,
  | 'Setup'
  | 'SessionStart'
  | 'InstructionsLoaded'
  | 'UserPromptSubmit'
  | 'UserPromptExpansion'
  | 'Notification'
  | 'PreToolUse'
  | 'PermissionRequest'
  | 'PermissionDenied'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PostToolBatch'
  | 'Stop'
  | 'StopFailure'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'TaskCreated'
  | 'TaskCompleted'
  | 'TeammateIdle'
  | 'ConfigChange'
  | 'CwdChanged'
  | 'FileChanged'
  | 'WorktreeRemove'
  | 'PreCompact'
  | 'PostCompact'
  | 'SessionEnd'
  | 'Elicitation'
  | 'ElicitationResult'
  | 'MessageDisplay'
>;

export type OpenBoxAnthropicApprovalMode = 'ask' | 'defer';

export interface OpenBoxAnthropicAgentSDKConfig {
  enabled?: boolean;
  core?: OpenBoxCoreClient;
  /** Core runtime URL. Defaults to OPENBOX_CORE_URL. */
  coreUrl?: string;
  /** Runtime agent key. Defaults to OPENBOX_API_KEY. */
  apiKey?: string;
  /** Optional signed agent identity. Defaults to env-based identity. */
  agentIdentity?: AgentIdentityConfig;
  coreTimeoutMs?: number;
  workflowType?: string;
  taskQueue?: string;
  approvalMode?: OpenBoxAnthropicApprovalMode;
  /** @deprecated Compatibility no-op. Decision-capable hooks always fail closed. */
  failClosed?: boolean;
  hookTimeoutSeconds?: number;
  clientName?: string;
  query?: (params: OpenBoxAnthropicAgentQueryParams) => Query;
}

export interface OpenBoxAnthropicAgentQueryParams {
  prompt: string | AsyncIterable<SDKUserMessageLike>;
  options?: Options;
}

export type SDKUserMessageLike = Parameters<
  typeof import('@anthropic-ai/claude-agent-sdk').query
>[0]['prompt'] extends string | AsyncIterable<infer Message>
  ? Message
  : never;

export interface OpenBoxAnthropicAgentSDK {
  hooks: Partial<Record<OpenBoxAnthropicAgentHookEvent, HookCallbackMatcher[]>>;
  withOptions(options?: Options): Options;
  query(params: OpenBoxAnthropicAgentQueryParams): Query;
}

export type OpenBoxAnthropicAgentMessageObserver = (
  message: SDKMessage,
) => Promise<void>;
