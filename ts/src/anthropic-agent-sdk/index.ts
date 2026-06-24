import {
  query as anthropicQuery,
  type Options,
  type Query,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { createOpenBoxAnthropicRuntimeContext } from './config.js';
import {
  createOpenBoxAnthropicAgentHooks,
  withOpenBoxAnthropicAgentOptions,
} from './hooks.js';
import { AnthropicAgentSessionManager } from './session-manager.js';
import type {
  OpenBoxAnthropicAgentQueryParams,
  OpenBoxAnthropicAgentSDK,
  OpenBoxAnthropicAgentSDKConfig,
} from './types.js';

const QUERY_METHODS = [
  'interrupt',
  'setPermissionMode',
  'setModel',
  'setMaxThinkingTokens',
  'applyFlagSettings',
  'initializationResult',
  'supportedCommands',
  'supportedModels',
  'supportedAgents',
  'mcpServerStatus',
  'getContextUsage',
  'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET',
  'readFile',
  'reloadPlugins',
  'reloadSkills',
  'accountInfo',
  'rewindFiles',
  'seedReadState',
  'reconnectMcpServer',
  'toggleMcpServer',
  'setMcpServers',
  'streamInput',
  'stopTask',
  'backgroundTasks',
] as const;

export {
  DEFAULT_ANTHROPIC_AGENT_TASK_QUEUE,
  DEFAULT_ANTHROPIC_AGENT_WORKFLOW_TYPE,
  OpenBoxAnthropicAgentSDKError,
  createOpenBoxAnthropicRuntimeContext,
  resolveProjectConfigDir,
  verifyOpenBoxAnthropicAgentSDKConfig,
} from './config.js';
export type {
  OpenBoxAnthropicAgentSDKDiagnosticCheck,
  OpenBoxAnthropicAgentSDKDiagnosticStatus,
} from './config.js';
export {
  OPENBOX_ANTHROPIC_AGENT_DEFAULT_HOOK_EVENTS,
  OPENBOX_ANTHROPIC_AGENT_OPT_IN_HOOK_EVENTS,
  createOpenBoxAnthropicAgentHooks,
  withOpenBoxAnthropicAgentOptions,
} from './hooks.js';
export type {
  OpenBoxAnthropicAgentHookEvent,
  OpenBoxAnthropicAgentMessageObserver,
  OpenBoxAnthropicAgentQueryParams,
  OpenBoxAnthropicAgentSDK,
  OpenBoxAnthropicAgentSDKConfig,
  OpenBoxAnthropicApprovalMode,
} from './types.js';

export function createOpenBoxAnthropicAgentSDK(
  config: OpenBoxAnthropicAgentSDKConfig = {},
): OpenBoxAnthropicAgentSDK {
  const context = createOpenBoxAnthropicRuntimeContext(config);
  const manager = new AnthropicAgentSessionManager(context);
  const queryImpl = config.query ?? anthropicQuery;

  return {
    hooks: createOpenBoxAnthropicAgentHooks(config, manager),
    withOptions: (options?: Options) =>
      withOpenBoxAnthropicAgentOptions(options, config, manager),
    query: (params: OpenBoxAnthropicAgentQueryParams) => {
      const source = queryImpl({
        ...params,
        options: withOpenBoxAnthropicAgentOptions(
          params.options,
          config,
          manager,
        ),
      });
      return observeQuery(source, manager);
    },
  };
}

function observeQuery(
  source: Query,
  manager: AnthropicAgentSessionManager,
): Query {
  const iterator = source[Symbol.asyncIterator]();
  const wrapped = {
    async next(...args: Parameters<Query['next']>) {
      try {
        const result = await iterator.next(...args);
        if (!result.done) await observeMessage(result.value, manager);
        return result;
      } catch (error) {
        await manager.failOpenSessions(error);
        throw error;
      }
    },
    async return(value?: void) {
      await manager.failOpenSessions('Anthropic Agent SDK query closed before completion');
      if (typeof iterator.return === 'function') {
        return iterator.return(value);
      }
      return { done: true as const, value };
    },
    async throw(error?: unknown) {
      await manager.failOpenSessions(error);
      if (typeof iterator.throw === 'function') {
        return iterator.throw(error);
      }
      throw error;
    },
    close() {
      void manager
        .failOpenSessions('Anthropic Agent SDK query closed before completion')
        .catch(() => undefined);
      source.close();
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  } as unknown as Query;

  for (const method of QUERY_METHODS) {
    const value = Reflect.get(source, method);
    if (typeof value === 'function') {
      (wrapped as unknown as Record<string, unknown>)[method] =
        value.bind(source);
    }
  }

  for (const key of Reflect.ownKeys(source)) {
    if (key in wrapped) continue;
    const value = (source as unknown as Record<PropertyKey, unknown>)[key];
    (wrapped as unknown as Record<PropertyKey, unknown>)[key] =
      typeof value === 'function' ? value.bind(source) : value;
  }

  return wrapped;
}

async function observeMessage(
  message: SDKMessage,
  manager: AnthropicAgentSessionManager,
): Promise<void> {
  if (message.type === 'assistant') {
    manager.rememberAssistant(message);
    return;
  }
  if (message.type === 'result') {
    await manager.observeResult(message);
  }
}
