import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../../core-client/index.js';
import type { ClaudeCodeEnvelope } from '../../../core-client/generated/runtime/claude-code.js';
import type { ClaudeCodeConfig } from '../config.js';
import { markHalted } from '../session-resolver.js';
import { ACTIVITY_TYPES, EVENT } from '../activity-types.js';
import { stampSource } from '../../../approvals/source.js';
import {
  buildClaudeAssistantOutputSpan,
  claudeAssistantTelemetryFields,
} from './assistant-output.js';
import { readLatestAssistantUsage } from '../transcript-usage.js';

type GenericEventKind = typeof EVENT.START | typeof EVENT.COMPLETE | typeof EVENT.SIGNAL;
type GenericActivityPayload = Parameters<ClaudeCodeSession['activity']>[2];
type ObserveCapableClaudeSession = ClaudeCodeSession & {
  observeActivity?: ClaudeCodeSession['activity'];
};

const IMPORTANT_FIELDS = [
  'hook_event_name',
  'session_id',
  'cwd',
  'trigger',
  'source',
  'file_path',
  'event',
  'old_cwd',
  'new_cwd',
  'name',
  'command_name',
  'command_args',
  'expanded_prompt',
  'prompt',
  'message',
  'display_content',
  'displayContent',
  'tool_name',
  'tool_input',
  'tool_output',
  'tool_response',
  'tool_calls',
  'error',
  'reason',
  'action',
  'content',
  'mcp_server_name',
  'mode',
  'url',
  'elicitation_id',
  'requested_schema',
  'response',
  'task_id',
  'task_subject',
  'task_description',
  'teammate_name',
  'team_name',
  'last_assistant_message',
  'background_tasks',
  'session_crons',
  'custom_instructions',
  'compact_summary',
] as const;

export interface GenericEventOptions {
  activityType: string;
  eventKind?: GenericEventKind;
  eventCategory: string;
  decisionCapable?: boolean;
}

function compactPayload(env: ClaudeCodeEnvelope, eventCategory: string): Record<string, unknown> {
  const source = env as unknown as Record<string, unknown>;
  const payload: Record<string, unknown> = {
    event_category: eventCategory,
  };
  for (const field of IMPORTANT_FIELDS) {
    const value = source[field];
    if (value !== undefined) payload[field] = value;
  }
  return payload;
}

export async function handleGenericClaudeEvent(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
  options: GenericEventOptions,
): Promise<WorkflowVerdict | undefined> {
  const verdict = await session.activity(options.eventKind ?? EVENT.START, options.activityType, {
    input: [stampSource(compactPayload(env, options.eventCategory), 'claude-code')],
  });
  if (verdict.arm === 'halt') markHalted(env.session_id, cfg);
  return options.decisionCapable ? verdict : undefined;
}

export async function observeGenericClaudeEvent(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
  options: GenericEventOptions,
): Promise<undefined> {
  void cfg;
  try {
    await observeActivity(session, options.eventKind ?? EVENT.START, options.activityType, {
      input: [stampSource(compactPayload(env, options.eventCategory), 'claude-code')],
    });
  } catch {
    // Observe-only hooks must not disturb Claude Code.
  }
  return undefined;
}

export async function handleMessageDisplay(
  env: ClaudeCodeEnvelope,
  session: ClaudeCodeSession,
  cfg: ClaudeCodeConfig,
  options: GenericEventOptions,
): Promise<undefined> {
  const usage = env.final === true ? readLatestAssistantUsage(env) : undefined;
  const text =
    env.delta ??
    env.display_content ??
    env.displayContent ??
    env.message ??
    '';
  try {
    await observeActivity(session, options.eventKind ?? EVENT.COMPLETE, options.activityType, {
      input: [stampSource(compactPayload(env, options.eventCategory), 'claude-code')],
      output: stampSource({ text, event_category: options.eventCategory }, 'claude-code'),
      ...(env.final === true
        ? claudeAssistantTelemetryFields(env, {
            fallbackText: text,
            preferTranscriptContent: true,
          })
        : {}),
      spans: env.final === true
        ? buildClaudeAssistantOutputSpan(env, {
            event: 'MessageDisplay',
            fallbackText: text,
            preferTranscriptContent: true,
          })
        : undefined,
      hookSpanParentEventType: env.final === true ? 'ActivityStarted' : undefined,
      ensureHookSpanParent: env.final === true,
    });
  } catch {
    // MessageDisplay is observe-only; never disturb Claude Code output.
  }
  if (usage && env.final === true) {
    try {
      const usagePayload = stampSource({
        event_category: 'llm_usage',
        model: usage.model,
        usage: usage.usage,
      }, 'claude-code');
      await session.activity(EVENT.SIGNAL, ACTIVITY_TYPES.USAGE_SIGNAL, {
        input: [usagePayload],
        signalName: ACTIVITY_TYPES.USAGE_SIGNAL,
        signalArgs: [usagePayload],
      });
    } catch {
      // best-effort usage side channel
    }
  }
  return undefined;
}

async function observeActivity(
  session: ClaudeCodeSession,
  eventType: GenericEventKind,
  activityType: string,
  payload: GenericActivityPayload,
): Promise<WorkflowVerdict> {
  const observeSession = session as ObserveCapableClaudeSession;
  if (observeSession.observeActivity) {
    return observeSession.observeActivity(eventType, activityType, payload);
  }
  return session.activity(eventType, activityType, payload);
}
