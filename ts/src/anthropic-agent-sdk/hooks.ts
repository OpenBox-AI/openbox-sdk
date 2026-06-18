import type {
  HookCallback,
  HookCallbackMatcher,
  HookInput,
  HookJSONOutput,
  Options,
} from '@anthropic-ai/claude-agent-sdk';
import type { WorkflowVerdict } from '../core-client/index.js';
import { EVENT } from '../governance/events.js';
import {
  createOpenBoxAnthropicRuntimeContext,
  type OpenBoxAnthropicRuntimeContext,
} from './config.js';
import {
  ANTHROPIC_AGENT_ACTIVITY_TYPES,
  assistantOutputTelemetry,
  assistantOutputSpan,
  brandedReason,
  compactPayload,
  objectRecord,
  redactedRecord,
  redactedValue,
  toolActivityInput,
  toolActivityType,
  toolSpan,
} from './payloads.js';
import { AnthropicAgentSessionManager } from './session-manager.js';
import type {
  OpenBoxAnthropicAgentHookEvent,
  OpenBoxAnthropicAgentSDKConfig,
} from './types.js';

const HOOK_EVENTS: OpenBoxAnthropicAgentHookEvent[] = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'MessageDisplay',
];

const DECISION_CAPABLE = new Set<OpenBoxAnthropicAgentHookEvent>([
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
]);

interface HookDeps {
  context: OpenBoxAnthropicRuntimeContext;
  manager: AnthropicAgentSessionManager;
}

export function createOpenBoxAnthropicAgentHooks(
  config: OpenBoxAnthropicAgentSDKConfig = {},
  manager?: AnthropicAgentSessionManager,
): Partial<Record<OpenBoxAnthropicAgentHookEvent, HookCallbackMatcher[]>> {
  const context = createOpenBoxAnthropicRuntimeContext(config);
  if (!context.enabled) return {};
  const deps = {
    context,
    manager: manager ?? new AnthropicAgentSessionManager(context),
  };

  return HOOK_EVENTS.reduce<
    Partial<Record<OpenBoxAnthropicAgentHookEvent, HookCallbackMatcher[]>>
  >((hooks, event) => {
    hooks[event] = [
      {
        hooks: [guarded(event, deps)],
        ...(context.hookTimeoutSeconds
          ? { timeout: context.hookTimeoutSeconds }
          : {}),
      },
    ];
    return hooks;
  }, {});
}

export function withOpenBoxAnthropicAgentOptions(
  options: Options = {},
  config: OpenBoxAnthropicAgentSDKConfig = {},
  manager?: AnthropicAgentSessionManager,
): Options {
  const openBoxHooks = createOpenBoxAnthropicAgentHooks(config, manager);
  if (Object.keys(openBoxHooks).length === 0) return { ...options };
  return {
    ...options,
    hooks: mergeHooks(openBoxHooks, options.hooks),
  };
}

function mergeHooks(
  openBoxHooks: Partial<Record<OpenBoxAnthropicAgentHookEvent, HookCallbackMatcher[]>>,
  userHooks: Options['hooks'] = {},
): Options['hooks'] {
  const merged: Options['hooks'] = { ...userHooks };
  for (const [event, matchers] of Object.entries(openBoxHooks) as Array<
    [OpenBoxAnthropicAgentHookEvent, HookCallbackMatcher[]]
  >) {
    merged[event] = [...matchers, ...(userHooks[event] ?? [])];
  }
  return merged;
}

function guarded(event: OpenBoxAnthropicAgentHookEvent, deps: HookDeps): HookCallback {
  return async (input, toolUseID, _options) => {
    try {
      return await handleHook(event, withToolUseId(input, toolUseID), deps);
    } catch (error) {
      if (!deps.context.failClosed || !DECISION_CAPABLE.has(event)) return {};
      return renderFailClosed(event, error);
    }
  };
}

async function handleHook(
  event: OpenBoxAnthropicAgentHookEvent,
  input: HookInput,
  deps: HookDeps,
): Promise<HookJSONOutput> {
  const env = input as HookInput & Record<string, unknown>;
  const sessionId = stringFrom(env.session_id) ?? 'default';
  switch (event) {
    case 'SessionStart':
      await deps.manager.ensureStarted(sessionId);
      await deps.manager.activity(sessionId, EVENT.START, ANTHROPIC_AGENT_ACTIVITY_TYPES.SESSION, {
        input: [compactPayload(env, 'session_start')],
      });
      return {};
    case 'UserPromptSubmit':
      return handleUserPromptSubmit(env, deps, sessionId);
    case 'PreToolUse':
      return handlePreToolUse(env, deps, sessionId);
    case 'PermissionRequest':
      return handlePermissionRequest(env, deps, sessionId);
    case 'PostToolUse':
      return handlePostToolUse(env, deps, sessionId);
    case 'PostToolUseFailure':
      return handlePostToolUseFailure(env, deps, sessionId);
    case 'PostToolBatch':
      return handlePostToolBatch(env, deps, sessionId);
    case 'Stop':
      return handleStop(env, deps, sessionId);
    case 'SubagentStart':
      return handleSubagentStart(env, deps, sessionId);
    case 'SubagentStop':
      return handleSubagentStop(env, deps, sessionId);
    case 'PreCompact':
      return handlePreCompact(env, deps, sessionId);
    case 'MessageDisplay':
      return handleMessageDisplay(env, deps, sessionId);
  }
}

async function handleUserPromptSubmit(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
): Promise<HookJSONOutput> {
  const prompt = stringFrom(env.prompt);
  if (!prompt) return {};
  void deps.manager.activity(sessionId, EVENT.SIGNAL, ANTHROPIC_AGENT_ACTIVITY_TYPES.GOAL_SIGNAL, {
    input: [compactPayload({ prompt, session_id: sessionId }, 'agent_goal')],
    signalName: ANTHROPIC_AGENT_ACTIVITY_TYPES.GOAL_SIGNAL,
    signalArgs: prompt,
  }).catch(() => undefined);

  const verdict = await deps.manager.activity(sessionId, EVENT.START, ANTHROPIC_AGENT_ACTIVITY_TYPES.PROMPT, {
    input: [compactPayload(env, 'llm_prompt')],
    prompt,
    sessionId,
  });
  return renderDecisionBlock('UserPromptSubmit', verdict);
}

async function handlePreToolUse(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
): Promise<HookJSONOutput> {
  const toolName = stringFrom(env.tool_name) ?? 'unknown';
  const toolInput = objectRecord(env.tool_input);
  const activityType = toolActivityType(toolName, toolInput);
  const opened = await deps.manager.openActivity(sessionId, activityType, {
    input: toolActivityInput(
      toolName,
      toolInput,
      compactPayload({ ...env, tool_name: toolName, tool_input: toolInput }, 'tool_input'),
    ),
    spans: toolSpan(toolName, toolInput),
  });
  deps.manager.rememberToolActivity(
    sessionId,
    toolUseIdFrom(env),
    opened,
    activityType,
  );
  return renderPermissionDecision('PreToolUse', opened.verdict, deps.context);
}

async function handlePermissionRequest(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
): Promise<HookJSONOutput> {
  const toolName = stringFrom(env.tool_name) ?? 'unknown';
  const toolInput = objectRecord(env.tool_input);
  const verdict = await deps.manager.activity(sessionId, EVENT.START, ANTHROPIC_AGENT_ACTIVITY_TYPES.PERMISSION, {
    input: toolActivityInput(
      toolName,
      toolInput,
      compactPayload({ ...env, tool_name: toolName, tool_input: toolInput }, 'permission_request'),
    ),
    spans: toolSpan(toolName, toolInput),
  });
  return renderPermissionRequest(verdict);
}

async function handlePostToolUse(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
): Promise<HookJSONOutput> {
  const toolName = stringFrom(env.tool_name) ?? 'unknown';
  const toolInput = objectRecord(env.tool_input);
  const toolOutput = env.tool_response ?? env.tool_output;
  const activityType = toolActivityType(toolName, toolInput);
  const payload = {
    input: toolActivityInput(
      toolName,
      toolInput,
      compactPayload({ tool_name: toolName, tool_input: toolInput }, 'tool_input'),
    ),
    output: toolOutput,
    durationMs: numberFrom(env.duration_ms),
    spans: toolSpan(toolName, toolInput, toolOutput),
  };
  const verdict =
    (await deps.manager.completeToolActivity(
      sessionId,
      toolUseIdFrom(env),
      activityType,
      payload,
    )) ??
    (await deps.manager.activity(sessionId, EVENT.COMPLETE, activityType, payload));
  return renderDecisionBlock('PostToolUse', verdict, true);
}

async function handlePostToolUseFailure(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
): Promise<HookJSONOutput> {
  const toolName = stringFrom(env.tool_name) ?? 'unknown';
  const toolInput = objectRecord(env.tool_input);
  const payload = {
    input: toolActivityInput(
      toolName,
      toolInput,
      compactPayload({ tool_name: toolName, tool_input: toolInput }, 'tool_input'),
    ),
    output: compactPayload(env, 'tool_failure'),
    durationMs: numberFrom(env.duration_ms),
    spans: toolSpan(toolName, toolInput, env.error),
  };
  const verdict =
    (await deps.manager.completeToolActivity(
      sessionId,
      toolUseIdFrom(env),
      ANTHROPIC_AGENT_ACTIVITY_TYPES.TOOL_FAILURE,
      payload,
    )) ??
    (await deps.manager.activity(
      sessionId,
      EVENT.COMPLETE,
      ANTHROPIC_AGENT_ACTIVITY_TYPES.TOOL_FAILURE,
      payload,
    ));
  return renderAdditionalContext('PostToolUseFailure', verdict);
}

async function handlePostToolBatch(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
): Promise<HookJSONOutput> {
  const verdict = await deps.manager.activity(sessionId, EVENT.COMPLETE, ANTHROPIC_AGENT_ACTIVITY_TYPES.TOOL_BATCH, {
    input: [compactPayload(env, 'tool_batch')],
    output: env.tool_calls,
  });
  return renderDecisionBlock('PostToolBatch', verdict, true);
}

async function handleStop(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
): Promise<HookJSONOutput> {
  const latest = deps.manager.latestAssistant(sessionId);
  const content = stringFrom(env.last_assistant_message) ?? latest?.content;
  const assistant = {
    content,
    model: latest?.model,
    usage: latest?.usage,
    sessionId,
    event: 'Stop',
  };
  const verdict = await deps.manager.activity(sessionId, EVENT.COMPLETE, ANTHROPIC_AGENT_ACTIVITY_TYPES.SESSION, {
    input: [compactPayload(env, 'session_stop')],
    output: content ? { content } : undefined,
    ...assistantOutputTelemetry(assistant),
    spans: assistantOutputSpan(assistant),
  });
  if (verdict.arm === 'allow' || verdict.arm === 'constrain') {
    await deps.manager.complete(sessionId);
  }
  return renderContinueBlock(verdict);
}

async function handleSubagentStart(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
): Promise<HookJSONOutput> {
  const verdict = await deps.manager.activity(sessionId, EVENT.START, ANTHROPIC_AGENT_ACTIVITY_TYPES.SUBAGENT, {
    input: [compactPayload(env, 'subagent_start')],
  });
  return renderContinueBlock(verdict);
}

async function handleSubagentStop(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
): Promise<HookJSONOutput> {
  const content = stringFrom(env.last_assistant_message);
  const assistant = { content, sessionId, event: 'SubagentStop' };
  const verdict = await deps.manager.activity(sessionId, EVENT.COMPLETE, ANTHROPIC_AGENT_ACTIVITY_TYPES.SUBAGENT, {
    input: [compactPayload(env, 'subagent_stop')],
    output: env.last_assistant_message,
    ...assistantOutputTelemetry(assistant),
    spans: assistantOutputSpan(assistant),
  });
  return renderContinueBlock(verdict);
}

async function handlePreCompact(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
): Promise<HookJSONOutput> {
  const verdict = await deps.manager.activity(sessionId, EVENT.START, ANTHROPIC_AGENT_ACTIVITY_TYPES.COMPACT, {
    input: [compactPayload(env, 'pre_compact')],
  });
  return renderContinueBlock(verdict);
}

async function handleMessageDisplay(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
): Promise<HookJSONOutput> {
  if (env.final !== true) return {};
  const content = stringFrom(env.delta);
  const assistant = { content, sessionId, event: 'MessageDisplay' };
  await deps.manager.observeActivity(sessionId, EVENT.COMPLETE, ANTHROPIC_AGENT_ACTIVITY_TYPES.MESSAGE, {
    input: [compactPayload(env, 'message_display')],
    output: content,
    ...assistantOutputTelemetry(assistant),
    spans: assistantOutputSpan(assistant),
  });
  return {};
}

function renderPermissionDecision(
  event: 'PreToolUse',
  verdict: WorkflowVerdict | undefined,
  context: OpenBoxAnthropicRuntimeContext,
): HookJSONOutput {
  const arm = verdict?.arm ?? 'allow';
  const reason = brandedReason(verdict);
  if (arm === 'allow' || arm === 'constrain') {
    const hookSpecificOutput: Record<string, unknown> = {
      hookEventName: event,
      permissionDecision: 'allow',
    };
    if (arm === 'constrain') {
      const redacted = redactedRecord(verdict);
      if (redacted) hookSpecificOutput.updatedInput = redacted;
      if (reason) hookSpecificOutput.additionalContext = reason;
    }
    return { hookSpecificOutput } as HookJSONOutput;
  }
  if (arm === 'require_approval') {
    return {
      hookSpecificOutput: {
        hookEventName: event,
        permissionDecision: context.approvalMode === 'defer' ? 'defer' : 'ask',
        permissionDecisionReason: reason || '[OpenBox] approval required',
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: event,
      permissionDecision: 'deny',
      permissionDecisionReason: reason || '[OpenBox] blocked by policy',
    },
  };
}

function renderPermissionRequest(verdict: WorkflowVerdict | undefined): HookJSONOutput {
  const arm = verdict?.arm ?? 'allow';
  if (arm === 'allow' || arm === 'constrain') {
    const decision: {
      behavior: 'allow';
      updatedInput?: Record<string, unknown>;
    } = { behavior: 'allow' };
    if (arm === 'constrain') {
      const redacted = redactedRecord(verdict);
      if (redacted) decision.updatedInput = redacted;
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision,
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: {
        behavior: 'deny',
        message: brandedReason(verdict) || '[OpenBox] blocked by policy',
      },
    },
  };
}

function renderDecisionBlock(
  event: 'UserPromptSubmit' | 'PostToolUse' | 'PostToolBatch',
  verdict: WorkflowVerdict | undefined,
  includeUpdatedToolOutput = false,
): HookJSONOutput {
  const arm = verdict?.arm ?? 'allow';
  const reason = brandedReason(verdict);
  if (arm === 'block' || arm === 'halt') {
    return { decision: 'block', reason: reason || '[OpenBox] blocked by policy' };
  }
  if (arm === 'require_approval') {
    return {
      decision: 'block',
      reason:
        '[OpenBox] approval pending' +
        (reason ? `: ${reason.replace(/^\[OpenBox\] /, '')}` : '') +
        '. Approve in OpenBox, then ask the agent to retry.',
    };
  }
  if (arm === 'constrain' && reason) {
    const hookSpecificOutput: Record<string, unknown> = {
      hookEventName: event,
      additionalContext: reason,
    };
    if (includeUpdatedToolOutput) {
      const redacted = redactedValue(verdict);
      if (redacted !== undefined) hookSpecificOutput.updatedToolOutput = redacted;
    }
    return { hookSpecificOutput } as HookJSONOutput;
  }
  return {};
}

function renderAdditionalContext(
  event: 'PostToolUseFailure',
  verdict: WorkflowVerdict | undefined,
): HookJSONOutput {
  if (!verdict || verdict.arm === 'allow') return {};
  return {
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: brandedReason(verdict) || '[OpenBox] blocked by policy',
    },
  };
}

function renderContinueBlock(verdict: WorkflowVerdict | undefined): HookJSONOutput {
  const arm = verdict?.arm ?? 'allow';
  if (arm === 'allow' || arm === 'constrain') return {};
  return {
    continue: false,
    stopReason: brandedReason(verdict) || '[OpenBox] blocked by policy',
  };
}

function renderFailClosed(event: OpenBoxAnthropicAgentHookEvent, error: unknown): HookJSONOutput {
  const reason = `[OpenBox] OpenBox governance failed while processing Anthropic Agent SDK ${event}: ${
    error instanceof Error ? error.message : String(error)
  }`;
  switch (event) {
    case 'PreToolUse':
      return {
        hookSpecificOutput: {
          hookEventName: event,
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      };
    case 'PermissionRequest':
      return {
        hookSpecificOutput: {
          hookEventName: event,
          decision: { behavior: 'deny', message: reason },
        },
      };
    case 'PostToolUseFailure':
      return {
        hookSpecificOutput: {
          hookEventName: event,
          additionalContext: reason,
        },
      };
    case 'Stop':
    case 'SubagentStart':
    case 'SubagentStop':
    case 'PreCompact':
      return { continue: false, stopReason: reason };
    default:
      return { decision: 'block', reason };
  }
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toolUseIdFrom(env: Record<string, unknown>): string | undefined {
  return stringFrom(env.tool_use_id) ?? stringFrom(env.toolUseID);
}

function withToolUseId(input: HookInput, toolUseID: string | undefined): HookInput {
  if (!toolUseID || input === null || typeof input !== 'object') return input;
  const record = input as Record<string, unknown>;
  if (record.tool_use_id !== undefined || record.toolUseID !== undefined) {
    return input;
  }
  return { ...record, tool_use_id: toolUseID } as HookInput;
}
