import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type {
  HookCallback,
  HookCallbackMatcher,
  HookInput,
  HookJSONOutput,
  Options,
} from '@anthropic-ai/claude-agent-sdk';
import { HOOK_EVENTS as ANTHROPIC_AGENT_HOOK_EVENTS } from '@anthropic-ai/claude-agent-sdk';
import type { WorkflowVerdict } from '../core-client/index.js';
import { stringFrom } from '../internal/strings.js';
import { sanitizePathSegment } from '../internal/paths.js';
import { errorMessage } from '../internal/errors.js';
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
  promptSpan,
  redactedOutputValue,
  redactedRecord,
  subagentActivityInput,
  toolActivityInput,
  toolActivityType,
  toolTelemetryFields,
  toolSpan,
} from './payloads.js';
import { AnthropicAgentSessionManager } from './session-manager.js';
import type {
  OpenBoxAnthropicAgentHookEvent,
  OpenBoxAnthropicAgentSDKConfig,
} from './types.js';

const OPT_IN_HOOK_EVENTS = [
  'WorktreeCreate',
] as const satisfies readonly OpenBoxAnthropicAgentHookEvent[];

export const OPENBOX_ANTHROPIC_AGENT_OPT_IN_HOOK_EVENTS = [
  ...OPT_IN_HOOK_EVENTS,
] as const satisfies readonly OpenBoxAnthropicAgentHookEvent[];

const OPT_IN_HOOK_EVENT_SET = new Set<OpenBoxAnthropicAgentHookEvent>(
  OPT_IN_HOOK_EVENTS,
);

export const OPENBOX_ANTHROPIC_AGENT_DEFAULT_HOOK_EVENTS =
  ANTHROPIC_AGENT_HOOK_EVENTS.filter(
    (event): event is OpenBoxAnthropicAgentHookEvent =>
      !OPT_IN_HOOK_EVENT_SET.has(event),
  );

const DECISION_CAPABLE = new Set<OpenBoxAnthropicAgentHookEvent>([
  'UserPromptSubmit',
  'UserPromptExpansion',
  'PreToolUse',
  'PermissionRequest',
  'PermissionDenied',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'TaskCreated',
  'TaskCompleted',
  'TeammateIdle',
  'ConfigChange',
  'WorktreeCreate',
  'PreCompact',
  'Elicitation',
  'ElicitationResult',
]);

interface HookDeps {
  context: OpenBoxAnthropicRuntimeContext;
  manager: AnthropicAgentSessionManager;
}

type ActivityEventKind = typeof EVENT.START | typeof EVENT.COMPLETE | typeof EVENT.SIGNAL;

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

  const events = context.includeOptInHooks
    ? [
        ...OPENBOX_ANTHROPIC_AGENT_DEFAULT_HOOK_EVENTS,
        ...OPENBOX_ANTHROPIC_AGENT_OPT_IN_HOOK_EVENTS,
      ]
    : OPENBOX_ANTHROPIC_AGENT_DEFAULT_HOOK_EVENTS;

  return events.reduce<
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
      if (!DECISION_CAPABLE.has(event)) return {};
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
    case 'Setup':
      return observeGenericEvent(env, deps, sessionId, EVENT.START, ANTHROPIC_AGENT_ACTIVITY_TYPES.SESSION, 'setup');
    case 'SessionStart':
      await deps.manager.ensureStarted(sessionId);
      await deps.manager.activity(sessionId, EVENT.START, ANTHROPIC_AGENT_ACTIVITY_TYPES.SESSION, {
        input: [compactPayload(env, 'session_start')],
      });
      return {};
    case 'InstructionsLoaded':
      return observeGenericEvent(env, deps, sessionId, EVENT.START, ANTHROPIC_AGENT_ACTIVITY_TYPES.MESSAGE, 'agent_observation');
    case 'UserPromptSubmit':
      return handleUserPromptSubmit(env, deps, sessionId);
    case 'UserPromptExpansion':
      return handleUserPromptExpansion(env, deps, sessionId);
    case 'Notification':
      return observeGenericEvent(env, deps, sessionId, EVENT.SIGNAL, ANTHROPIC_AGENT_ACTIVITY_TYPES.MESSAGE, 'agent_notification');
    case 'PreToolUse':
      return handlePreToolUse(env, deps, sessionId);
    case 'PermissionRequest':
      return handlePermissionRequest(env, deps, sessionId);
    case 'PermissionDenied':
      return handlePermissionDenied(env, deps, sessionId);
    case 'PostToolUse':
      return handlePostToolUse(env, deps, sessionId);
    case 'PostToolUseFailure':
      return handlePostToolUseFailure(env, deps, sessionId);
    case 'PostToolBatch':
      return handlePostToolBatch(env, deps, sessionId);
    case 'Stop':
      return handleStop(env, deps, sessionId);
    case 'StopFailure':
      return handleStopFailure(env, deps, sessionId);
    case 'SubagentStart':
      return handleSubagentStart(env, deps, sessionId);
    case 'SubagentStop':
      return handleSubagentStop(env, deps, sessionId);
    case 'TaskCreated':
      return handleTaskEvent(env, deps, sessionId, EVENT.START, 'task_created');
    case 'TaskCompleted':
      return handleTaskEvent(env, deps, sessionId, EVENT.COMPLETE, 'task_completed');
    case 'TeammateIdle':
      return handleTaskEvent(env, deps, sessionId, EVENT.COMPLETE, 'teammate_idle');
    case 'ConfigChange':
      return handleConfigChange(env, deps, sessionId);
    case 'CwdChanged':
      return observeGenericEvent(env, deps, sessionId, EVENT.SIGNAL, ANTHROPIC_AGENT_ACTIVITY_TYPES.WORKSPACE_CHANGE, 'cwd_changed');
    case 'FileChanged':
      return observeGenericEvent(env, deps, sessionId, EVENT.SIGNAL, ANTHROPIC_AGENT_ACTIVITY_TYPES.WORKSPACE_CHANGE, 'file_changed');
    case 'WorktreeCreate':
      return handleWorktreeCreate(env, deps, sessionId);
    case 'WorktreeRemove':
      return observeGenericEvent(env, deps, sessionId, EVENT.COMPLETE, ANTHROPIC_AGENT_ACTIVITY_TYPES.WORKSPACE_CHANGE, 'worktree_remove');
    case 'PreCompact':
      return handlePreCompact(env, deps, sessionId);
    case 'PostCompact':
      return observeGenericEvent(env, deps, sessionId, EVENT.COMPLETE, ANTHROPIC_AGENT_ACTIVITY_TYPES.SESSION, 'post_compact');
    case 'SessionEnd':
      return handleSessionEnd(env, deps, sessionId);
    case 'Elicitation':
      return handleElicitation(env, deps, sessionId, EVENT.START, 'mcp_elicitation');
    case 'ElicitationResult':
      return handleElicitation(env, deps, sessionId, EVENT.COMPLETE, 'mcp_elicitation_result');
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
  await deps.manager.activity(sessionId, EVENT.SIGNAL, ANTHROPIC_AGENT_ACTIVITY_TYPES.GOAL_SIGNAL, {
    input: [compactPayload({ prompt, session_id: sessionId }, 'agent_goal')],
    signalName: ANTHROPIC_AGENT_ACTIVITY_TYPES.GOAL_SIGNAL,
    signalArgs: prompt,
    sessionId,
    prompt,
  });

  const verdict = await deps.manager.activity(sessionId, EVENT.START, ANTHROPIC_AGENT_ACTIVITY_TYPES.PROMPT, {
    input: [compactPayload(env, 'llm_prompt')],
    prompt,
    sessionId,
    spans: promptSpan({ prompt }),
  });
  return renderDecisionBlock('UserPromptSubmit', verdict);
}

async function handleUserPromptExpansion(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
): Promise<HookJSONOutput> {
  const prompt = stringFrom(env.prompt);
  if (!prompt) return {};
  const verdict = await deps.manager.activity(sessionId, EVENT.START, ANTHROPIC_AGENT_ACTIVITY_TYPES.PROMPT, {
    input: [compactPayload(env, 'llm_prompt_expansion')],
    prompt,
    sessionId,
    spans: promptSpan({ prompt }),
  });
  return renderDecisionBlock('UserPromptExpansion', verdict);
}

async function observeGenericEvent(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
  eventType: ActivityEventKind,
  activityType: string,
  eventCategory: string,
): Promise<HookJSONOutput> {
  try {
    await deps.manager.observeActivity(sessionId, eventType, activityType, {
      input: [compactPayload(env, eventCategory)],
    });
  } catch {
    // Observe-only hooks must not disturb the host.
  }
  return {};
}

async function handleWorktreeCreate(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
): Promise<HookJSONOutput> {
  const requestedName = stringFrom(env.name) ?? stringFrom(env.worktree_name) ?? 'worktree';
  const safeName = sanitizePathSegment(requestedName);
  const root = path.resolve(
    deps.context.worktreeRoot ??
      path.join(process.cwd(), '.openbox', 'worktrees'),
  );
  const worktreePath = path.join(root, `${safeName}-${Date.now().toString(36)}`);

  mkdirSync(worktreePath, { recursive: true });
  await observeGenericEvent(
    { ...env, worktree_path: worktreePath },
    deps,
    sessionId,
    EVENT.START,
    ANTHROPIC_AGENT_ACTIVITY_TYPES.WORKSPACE_CHANGE,
    'worktree_create',
  );

  return {
    hookSpecificOutput: {
      hookEventName: 'WorktreeCreate',
      worktreePath,
    },
  } as HookJSONOutput;
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
    ...toolTelemetryFields(toolName, toolInput),
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
    ...toolTelemetryFields(toolName, toolInput),
    spans: toolSpan(toolName, toolInput),
  });
  return renderPermissionRequest(verdict);
}

async function handlePermissionDenied(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
): Promise<HookJSONOutput> {
  const toolName = stringFrom(env.tool_name) ?? 'unknown';
  const toolInput = objectRecord(env.tool_input);
  const verdict = await deps.manager.activity(sessionId, EVENT.START, toolActivityType(toolName, toolInput), {
    input: toolActivityInput(
      toolName,
      toolInput,
      compactPayload({ ...env, tool_name: toolName, tool_input: toolInput }, 'permission_denied'),
    ),
    ...toolTelemetryFields(toolName, toolInput),
    spans: toolSpan(toolName, toolInput, env.reason),
  });
  return renderPermissionDenied(verdict);
}

async function handleTaskEvent(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
  eventType: typeof EVENT.START | typeof EVENT.COMPLETE,
  eventCategory: string,
): Promise<HookJSONOutput> {
  const verdict = await deps.manager.activity(sessionId, eventType, ANTHROPIC_AGENT_ACTIVITY_TYPES.TASK, {
    input: subagentActivityInput(env, compactPayload(env, eventCategory)),
  });
  return renderContinueBlock(verdict);
}

async function handleConfigChange(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
): Promise<HookJSONOutput> {
  const verdict = await deps.manager.activity(sessionId, EVENT.START, ANTHROPIC_AGENT_ACTIVITY_TYPES.CONFIG_CHANGE, {
    input: [compactPayload(env, 'config_change')],
  });
  return renderDecisionBlock('ConfigChange', verdict);
}

async function handleSessionEnd(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
): Promise<HookJSONOutput> {
  if (!deps.manager.has(sessionId)) return {};
  try {
    await deps.manager.observeActivity(sessionId, EVENT.COMPLETE, ANTHROPIC_AGENT_ACTIVITY_TYPES.SESSION, {
      input: [compactPayload(env, 'session_end')],
    });
  } catch {
    // best-effort shutdown telemetry
  }
  try {
    await deps.manager.complete(sessionId);
  } catch {
    // best-effort terminal telemetry
  }
  return {};
}

async function handleElicitation(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
  eventType: typeof EVENT.START | typeof EVENT.COMPLETE,
  eventCategory: string,
): Promise<HookJSONOutput> {
  const verdict = await deps.manager.activity(sessionId, eventType, ANTHROPIC_AGENT_ACTIVITY_TYPES.MCP_ELICITATION, {
    input: [compactPayload(env, eventCategory)],
  });
  return renderElicitationResponse(
    stringFrom(env.hook_event_name) === 'ElicitationResult' ? 'ElicitationResult' : 'Elicitation',
    verdict,
    env,
  );
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
    ...toolTelemetryFields(toolName, toolInput),
    spans: toolSpan(toolName, toolInput, toolOutput, 'completed'),
    hookSpanParentEventType: EVENT.START,
  };
  const verdict =
    (await deps.manager.completeToolActivity(
      sessionId,
      toolUseIdFrom(env),
      activityType,
      payload,
    )) ??
    (await deps.manager.activity(sessionId, EVENT.COMPLETE, activityType, {
      ...payload,
      ensureHookSpanParent: true,
    }));
  return renderDecisionBlock('PostToolUse', verdict, toolOutput);
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
    ...toolTelemetryFields(toolName, toolInput),
    spans: toolSpan(toolName, toolInput, env.error, 'completed'),
    hookSpanParentEventType: EVENT.START,
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
      {
        ...payload,
        ensureHookSpanParent: true,
      },
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
  return renderDecisionBlock('PostToolBatch', verdict, env.tool_calls);
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
    hasToolCalls: latest?.hasToolCalls ?? false,
    sessionId,
    event: 'Stop',
  };
  const verdict = await deps.manager.activity(sessionId, EVENT.COMPLETE, ANTHROPIC_AGENT_ACTIVITY_TYPES.SESSION, {
    input: [compactPayload(env, 'session_stop')],
    output: content ? { content } : undefined,
    ...assistantOutputTelemetry(assistant),
    spans: assistantOutputSpan(assistant),
    hookSpanParentEventType: EVENT.START,
    ensureHookSpanParent: true,
  });
  if (verdict.arm === 'allow' || verdict.arm === 'constrain') {
    await deps.manager.complete(sessionId);
  }
  return renderContinueBlock(verdict);
}

async function handleStopFailure(
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
    hasToolCalls: latest?.hasToolCalls ?? false,
    sessionId,
    event: 'StopFailure',
  };
  try {
    await deps.manager.activity(sessionId, EVENT.COMPLETE, ANTHROPIC_AGENT_ACTIVITY_TYPES.SESSION, {
      input: [compactPayload(env, 'session_stop_failure')],
      output: stopFailureOutput(env, content),
      ...assistantOutputTelemetry(assistant),
      spans: assistantOutputSpan(assistant),
      hookSpanParentEventType: EVENT.START,
      ensureHookSpanParent: true,
    });
  } catch {
    // best-effort failure telemetry; StopFailure cannot safely block the host.
  }
  try {
    await deps.manager.fail(sessionId, stopFailureReason(env));
  } catch {
    // best-effort terminal telemetry; the hook response remains observe-only.
  }
  return {};
}

async function handleSubagentStart(
  env: Record<string, unknown>,
  deps: HookDeps,
  sessionId: string,
): Promise<HookJSONOutput> {
  const verdict = await deps.manager.activity(sessionId, EVENT.START, ANTHROPIC_AGENT_ACTIVITY_TYPES.SUBAGENT, {
    input: subagentActivityInput(env, compactPayload(env, 'subagent_start')),
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
    input: subagentActivityInput(env, compactPayload(env, 'subagent_stop')),
    output: env.last_assistant_message,
    ...assistantOutputTelemetry(assistant),
    spans: assistantOutputSpan(assistant),
    hookSpanParentEventType: EVENT.START,
    ensureHookSpanParent: true,
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
    hookSpanParentEventType: EVENT.START,
    ensureHookSpanParent: true,
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
      if (hasInputRedaction(verdict) && !redacted) {
        return {
          hookSpecificOutput: {
            hookEventName: event,
            permissionDecision: 'deny',
            permissionDecisionReason: missingInputReplacementBlockReason(reason),
          },
        };
      }
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
      if (hasInputRedaction(verdict) && !redacted) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: {
              behavior: 'deny',
              message: missingInputReplacementBlockReason(brandedReason(verdict)),
            },
          },
        };
      }
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
  event:
    | 'UserPromptSubmit'
    | 'UserPromptExpansion'
    | 'PostToolUse'
    | 'PostToolBatch'
    | 'ConfigChange',
  verdict: WorkflowVerdict | undefined,
  originalToolOutput?: unknown,
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
  if (
    arm === 'constrain' &&
    isPromptDecisionEvent(event) &&
    hasPromptRedaction(verdict)
  ) {
    return {
      decision: 'block',
      reason:
        reason ||
        '[OpenBox] redacted this prompt, but this host cannot replace submitted prompts. Rewrite the prompt with the redacted content and submit again.',
    };
  }
  if (arm === 'constrain') {
    const redacted = redactedOutputValue(verdict, originalToolOutput);
    if (!reason && redacted === undefined) return {};
    const hookSpecificOutput: Record<string, unknown> = {
      hookEventName: event,
    };
    if (reason) hookSpecificOutput.additionalContext = reason;
    if (redacted !== undefined) hookSpecificOutput.updatedToolOutput = redacted;
    return { hookSpecificOutput } as HookJSONOutput;
  }
  return {};
}

function isPromptDecisionEvent(event: string): boolean {
  return event === 'UserPromptSubmit' || event === 'UserPromptExpansion';
}

function hasPromptRedaction(verdict: WorkflowVerdict | undefined): boolean {
  return hasInputRedaction(verdict);
}

function hasInputRedaction(verdict: WorkflowVerdict | undefined): boolean {
  const guardrails = verdict?.guardrailsResult;
  const hasRedactedField = guardrails?.fieldResults?.some(
    (field) => field.status === 'redacted' || field.status === 'transformed',
  );
  return Boolean(
    guardrails &&
      (guardrails.inputType === 'activity_input' ||
        guardrails.inputType === 'signal_args') &&
      (hasRedactedField ||
        guardrails.redactedInput !== undefined &&
        guardrails.redactedInput !== null),
  );
}

function missingInputReplacementBlockReason(reason: string): string {
  const detail = reason.replace(/^\[OpenBox\] /, '').replace(/[.]+$/, '');
  return detail
    ? `[OpenBox] ${detail}. OpenBox did not provide replacement input, so the original action was blocked.`
    : '[OpenBox] redacted this action input but did not provide replacement input, so OpenBox blocked the original action.';
}

function renderPermissionDenied(verdict: WorkflowVerdict | undefined): HookJSONOutput {
  const arm = verdict?.arm ?? 'allow';
  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionDenied',
      retry: arm === 'allow' || arm === 'constrain',
    },
  };
}

function renderElicitationResponse(
  event: 'Elicitation' | 'ElicitationResult',
  verdict: WorkflowVerdict | undefined,
  env: Record<string, unknown>,
): HookJSONOutput {
  const arm = verdict?.arm ?? 'allow';
  if (arm === 'allow') return {};
  if (arm === 'constrain') {
    const redacted = redactedRecord(verdict);
    if (hasInputRedaction(verdict) && !redacted) {
      return {
        hookSpecificOutput: {
          hookEventName: event,
          action: 'decline',
          content: {},
        },
      };
    }
    return {
      hookSpecificOutput: {
        hookEventName: event,
        action: 'accept',
        content: redacted ?? objectRecord(env.response) ?? objectRecord(env.content),
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: event,
      action: arm === 'halt' ? 'cancel' : 'decline',
      content: {},
    },
  };
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
    errorMessage(error)
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
    case 'PermissionDenied':
      return {
        hookSpecificOutput: {
          hookEventName: event,
          retry: false,
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
    case 'TaskCreated':
    case 'TaskCompleted':
    case 'TeammateIdle':
    case 'PreCompact':
      return { continue: false, stopReason: reason };
    case 'Elicitation':
    case 'ElicitationResult':
      return {
        hookSpecificOutput: {
          hookEventName: event,
          action: 'decline',
          content: {},
        },
      };
    default:
      return { decision: 'block', reason };
  }
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stopFailureOutput(
  env: Record<string, unknown>,
  content: string | undefined,
): Record<string, unknown> {
  return compactPayload(
    {
      error: env.error,
      error_details: env.error_details,
      ...(content ? { content } : {}),
    },
    'session_stop_failure_output',
  );
}

function stopFailureReason(env: Record<string, unknown>): Error {
  const details = stringFrom(env.error_details);
  const errorText =
    stringFrom(env.error) ??
    stringFrom(objectRecord(env.error).message) ??
    'Anthropic Agent SDK StopFailure';
  return new Error(details ? `${errorText}: ${details}` : errorText);
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
