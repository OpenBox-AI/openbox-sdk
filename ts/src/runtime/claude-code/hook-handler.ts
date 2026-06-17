// Hook handler; invoked by the Claude Code plugin runner, which calls
// `openbox claude-code hook` through a project-local SDK CLI. Reads
// stdin, dispatches via the spec-driven
// claude-code adapter, returns appropriate stdout per hook event,
// exits 0. Decision-capable hooks honor GOVERNANCE_POLICY:
// fail_open writes Claude's default allow shape on runtime failure;
// fail_closed writes the corresponding block/deny shape.
import {
  createClaudeCodeAdapter,
  type ClaudeCodeAdapterHandlers,
  type ClaudeCodeEnvelope,
} from '../../core-client/generated/runtime/claude-code.js';
import type {
  ClaudeCodeSession,
  WorkflowVerdict,
} from '../../core-client/index.js';
import { OpenBoxCoreClient } from '../../core-client/index.js';
import { getConfigDir, loadConfig } from './config.js';
import { createLogger } from '../../logging/logger.js';
import { resolveSession } from './session-resolver.js';
import { makeHookLog } from '../../logging/hook-log.js';
import { handlePreToolUse } from './mappers/pre-tool-use.js';
import {
  handlePostToolBatch,
  handlePostToolUse,
  handlePostToolUseFailure,
} from './mappers/post-tool-use.js';
import {
  handleUserPromptExpansion,
  handleUserPromptSubmit,
} from './mappers/user-prompt.js';
import {
  handlePermissionDenied,
  handlePermissionRequest,
} from './mappers/permission-request.js';
import {
  handlePostCompact,
  handlePreCompact,
  handleSetup,
  handleSessionStart,
  handleSessionEnd,
  handleStop,
  handleStopFailure,
} from './mappers/session.js';
import {
  handleSubagentStart,
  handleSubagentStop,
  handleTaskCompleted,
  handleTaskCreated,
  handleTeammateIdle,
} from './mappers/subagent.js';
import {
  handleGenericClaudeEvent,
  observeGenericClaudeEvent,
} from './mappers/generic.js';
import { ACTIVITY_TYPES, EVENT } from './activity-types.js';
import { CLAUDE_CODE_HOOK_MATRIX } from './governance-matrix.js';
import type { ClaudeCodeConfig } from './config.js';

const hookLog = makeHookLog('claude-code');
const MAX_STDIN_BYTES = 10 * 1024 * 1024;

type HandlerResult = Promise<WorkflowVerdict | undefined | void>;
type HookHandler = (env: ClaudeCodeEnvelope, session: ClaudeCodeSession) => HandlerResult;

/** Wrap a per-event handler with a JSONL log line for the OutputChannel
 *  tail. Mirrors the cursor adapter so the extension can show both
 *  hosts' hook activity through the same code path. */
function logged<E, S, R>(
  event: string,
  verdictKind: 'permission' | 'observe' | 'none',
  fn: (env: E, s: S) => Promise<R>,
): (env: E, s: S) => Promise<R> {
  return async (env, s) => {
    const start = Date.now();
    try {
      const out = await fn(env, s);
      hookLog.record({
        ts: new Date().toISOString(),
        event,
        verdict_kind: verdictKind,
        took_ms: Date.now() - start,
      });
      return out;
    } catch (err: any) {
      hookLog.record({
        ts: new Date().toISOString(),
        event,
        verdict_kind: verdictKind,
        took_ms: Date.now() - start,
        error: String(err?.message ?? err),
      });
      throw err;
    }
  };
}

function failClosedVerdict(reason: string): WorkflowVerdict {
  return {
    arm: 'block',
    reason,
    riskScore: 1,
  };
}

function decisionSurface(eventName: string | undefined): string {
  return CLAUDE_CODE_HOOK_MATRIX.find((entry) => entry.event === eventName)?.decisionSurface ?? 'none';
}

function isDecisionCapable(eventName: string | undefined): boolean {
  const surface = decisionSurface(eventName);
  return surface !== 'none' && surface !== 'worktree-path';
}

function reasonFromError(prefix: string, err?: unknown): string {
  const detail = err instanceof Error ? err.message : String(err ?? '');
  return detail ? `${prefix}: ${detail}` : prefix;
}

function guarded(
  cfg: ClaudeCodeConfig,
  event: string,
  verdictKind: 'permission' | 'observe' | 'none',
  fn: HookHandler,
): HookHandler {
  return logged(event, verdictKind, async (env, session) => {
    try {
      return await fn(env, session);
    } catch (err) {
      const decisionCapable = isDecisionCapable(env.hook_event_name);
      const reason = reasonFromError('OpenBox governance failed while processing Claude Code hook', err);
      if (cfg.verbose) console.error(`[openbox claude-code] ${reason}`);
      if (decisionCapable && cfg.governancePolicy === 'fail_closed') {
        return failClosedVerdict(reason);
      }
      return undefined;
    }
  });
}

function renderFailClosedHookOutput(env: ClaudeCodeEnvelope, reason: string): unknown {
  const eventName = env.hook_event_name ?? 'ClaudeCode';
  switch (decisionSurface(eventName)) {
    case 'permission-decision':
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          permissionDecision: 'deny',
          permissionDecisionReason: `[OpenBox] ${reason}`,
        },
      };
    case 'permission-request':
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          decision: {
            behavior: 'deny',
            message: `[OpenBox] ${reason}`,
          },
        },
      };
    case 'permission-denied-retry':
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          retry: false,
        },
      };
    case 'elicitation-response':
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          action: 'decline',
          content: {},
        },
      };
    case 'continue-block':
      return {
        continue: false,
        stopReason: `[OpenBox] ${reason}`,
      };
    case 'additional-context':
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          additionalContext: `[OpenBox] ${reason}`,
        },
      };
    case 'decision-block':
      return {
        decision: 'block',
        reason: `[OpenBox] ${reason}`,
      };
    default:
      return undefined;
  }
}

function writeFailClosedIfPossible(env: ClaudeCodeEnvelope | undefined, reason: string): void {
  if (!env || !isDecisionCapable(env.hook_event_name)) return;
  const output = renderFailClosedHookOutput(env, reason);
  if (output !== undefined) process.stdout.write(JSON.stringify(output));
}

function parseEnvelope(raw: string): ClaudeCodeEnvelope | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as ClaudeCodeEnvelope;
  } catch {
    return undefined;
  }
}

async function readHookStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_STDIN_BYTES) {
      throw new Error(
        `hook stdin exceeded ${MAX_STDIN_BYTES.toLocaleString()} bytes; refusing to buffer further`,
      );
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export async function runClaudeHook(): Promise<void> {
  const cfg = loadConfig();
  // Claude Code governance is project-scoped. Keep hook-owned
  // auxiliary state such as JSONL logs under the resolved
  // `.claude-hooks/` tree unless the caller intentionally overrides
  // OPENBOX_HOME for tests or an alternate project-local location.
  if (!process.env.OPENBOX_HOME) {
    process.env.OPENBOX_HOME = getConfigDir();
  }
  createLogger('claude-code').initLogger(cfg);

  let raw = '';
  let env: ClaudeCodeEnvelope | undefined;
  try {
    raw = await readHookStdin();
    env = parseEnvelope(raw);
  } catch (err) {
    if (cfg.verbose) console.error(`[openbox claude-code] ${reasonFromError('failed to read hook stdin', err)}`);
    process.exit(0);
  }

  // Pass-through if not configured. The adapter would still be willing to
  // run but with no API key or Core URL the client can't call /evaluate.
  // Under fail_closed, emit the event-appropriate deny/block shape for
  // decision-capable hooks.
  if (!cfg.openboxApiKey) {
    if (cfg.governancePolicy === 'fail_closed') {
      writeFailClosedIfPossible(env, 'missing OPENBOX_API_KEY');
    }
    if (cfg.verbose) console.error('[openbox claude-code] no OPENBOX_API_KEY set, passing through');
    process.exit(0);
  }
  if (!cfg.openboxEndpoint) {
    if (cfg.governancePolicy === 'fail_closed') {
      writeFailClosedIfPossible(env, 'missing OPENBOX_CORE_URL');
    }
    if (cfg.verbose) console.error('[openbox claude-code] no OPENBOX_CORE_URL set, passing through');
    process.exit(0);
  }

  // Dry-run: handlers immediately return undefined (= allow / no decision).
  // The adapter still writes the right stdout shape per @verdictShape.
  const dryRun = cfg.dryRun;

  const core = new OpenBoxCoreClient({
    apiKey: cfg.openboxApiKey,
    apiUrl: cfg.openboxEndpoint,
    agentIdentity: cfg.agentIdentity,
    timeoutMs: cfg.governanceTimeout * 1000,
  });

  // Respect the user's HITL_MAX_WAIT knob (claude-hooks/config.json or
  // env). Without this wiring the SDK falls back to its 60s default,
  // which is much shorter than the 300s claude-code installs default to;
  // the hook would soft-deny long before the user could decide an
  // approval via the dashboard or mobile.
  const approvalMaxWaitMs = Math.min(
    Math.max(1, cfg.hitlMaxWait) * 1000,
    3600_000,
  );

  const handlers: ClaudeCodeAdapterHandlers = {
    setup: guarded(cfg, 'setup', 'observe',
      async (env, s) => dryRun ? undefined : handleSetup(env, s, cfg)),
    sessionStart: guarded(cfg, 'sessionStart', 'none',
      async (env, s) => dryRun ? undefined : handleSessionStart(env, s, cfg)),
    instructionsLoaded: guarded(cfg, 'instructionsLoaded', 'observe',
      async (env, s) => dryRun ? undefined : observeGenericClaudeEvent(env, s, cfg, {
        activityType: ACTIVITY_TYPES.MESSAGE,
        eventKind: EVENT.START,
        eventCategory: 'agent_observation',
      })),
    userPromptSubmit: guarded(cfg, 'userPromptSubmit', 'permission',
      async (env, s) => dryRun ? undefined : handleUserPromptSubmit(env, s, cfg)),
    userPromptExpansion: guarded(cfg, 'userPromptExpansion', 'permission',
      async (env, s) => dryRun ? undefined : handleUserPromptExpansion(env, s, cfg)),
    messageDisplay: guarded(cfg, 'messageDisplay', 'observe',
      async (env, s) => dryRun ? undefined : observeGenericClaudeEvent(env, s, cfg, {
        activityType: ACTIVITY_TYPES.MESSAGE,
        eventKind: EVENT.COMPLETE,
        eventCategory: 'llm_output',
      })),
    preToolUse: guarded(cfg, 'preToolUse', 'permission',
      async (env, s) => dryRun ? undefined : handlePreToolUse(env, s, cfg)),
    permissionRequest: guarded(cfg, 'permissionRequest', 'permission',
      async (env, s) => dryRun ? undefined : handlePermissionRequest(env, s, cfg)),
    permissionDenied: guarded(cfg, 'permissionDenied', 'permission',
      async (env, s) => dryRun ? undefined : handlePermissionDenied(env, s, cfg)),
    postToolUse: guarded(cfg, 'postToolUse', 'permission',
      async (env, s) => dryRun ? undefined : handlePostToolUse(env, s, cfg)),
    postToolUseFailure: guarded(cfg, 'postToolUseFailure', 'permission',
      async (env, s) => dryRun ? undefined : handlePostToolUseFailure(env, s, cfg)),
    postToolBatch: guarded(cfg, 'postToolBatch', 'permission',
      async (env, s) => dryRun ? undefined : handlePostToolBatch(env, s, cfg)),
    subagentStart: guarded(cfg, 'subagentStart', 'observe',
      async (env, s) => dryRun ? undefined : handleSubagentStart(env, s, cfg)),
    subagentStop: guarded(cfg, 'subagentStop', 'permission',
      async (env, s) => dryRun ? undefined : handleSubagentStop(env, s, cfg)),
    taskCreated: guarded(cfg, 'taskCreated', 'permission',
      async (env, s) => dryRun ? undefined : handleTaskCreated(env, s, cfg)),
    taskCompleted: guarded(cfg, 'taskCompleted', 'permission',
      async (env, s) => dryRun ? undefined : handleTaskCompleted(env, s, cfg)),
    stop: guarded(cfg, 'stop', 'permission',
      async (env, s) => dryRun ? undefined : handleStop(env, s, cfg)),
    stopFailure: guarded(cfg, 'stopFailure', 'observe',
      async (env, s) => dryRun ? undefined : handleStopFailure(env, s, cfg)),
    teammateIdle: guarded(cfg, 'teammateIdle', 'permission',
      async (env, s) => dryRun ? undefined : handleTeammateIdle(env, s, cfg)),
    notification: guarded(cfg, 'notification', 'observe',
      async (env, s) => dryRun ? undefined : observeGenericClaudeEvent(env, s, cfg, {
        activityType: ACTIVITY_TYPES.MESSAGE,
        eventKind: EVENT.SIGNAL,
        eventCategory: 'agent_notification',
      })),
    configChange: guarded(cfg, 'configChange', 'permission',
      async (env, s) => dryRun ? undefined : handleGenericClaudeEvent(env, s, cfg, {
        activityType: ACTIVITY_TYPES.CONFIG_CHANGE,
        eventKind: EVENT.START,
        eventCategory: 'config_change',
        decisionCapable: true,
      })),
    cwdChanged: guarded(cfg, 'cwdChanged', 'observe',
      async (env, s) => dryRun ? undefined : observeGenericClaudeEvent(env, s, cfg, {
        activityType: ACTIVITY_TYPES.WORKSPACE_CHANGE,
        eventKind: EVENT.SIGNAL,
        eventCategory: 'cwd_changed',
      })),
    fileChanged: guarded(cfg, 'fileChanged', 'observe',
      async (env, s) => dryRun ? undefined : observeGenericClaudeEvent(env, s, cfg, {
        activityType: ACTIVITY_TYPES.WORKSPACE_CHANGE,
        eventKind: EVENT.SIGNAL,
        eventCategory: 'file_changed',
      })),
    worktreeRemove: guarded(cfg, 'worktreeRemove', 'observe',
      async (env, s) => dryRun ? undefined : observeGenericClaudeEvent(env, s, cfg, {
        activityType: ACTIVITY_TYPES.WORKSPACE_CHANGE,
        eventKind: EVENT.COMPLETE,
        eventCategory: 'worktree_remove',
      })),
    preCompact: guarded(cfg, 'preCompact', 'permission',
      async (env, s) => dryRun ? undefined : handlePreCompact(env, s, cfg)),
    postCompact: guarded(cfg, 'postCompact', 'observe',
      async (env, s) => dryRun ? undefined : handlePostCompact(env, s, cfg)),
    sessionEnd: guarded(cfg, 'sessionEnd', 'none',
      async (env, s) => dryRun ? undefined : handleSessionEnd(env, s, cfg)),
    elicitation: guarded(cfg, 'elicitation', 'permission',
      async (env, s) => dryRun ? undefined : handleGenericClaudeEvent(env, s, cfg, {
        activityType: ACTIVITY_TYPES.MCP_ELICITATION,
        eventKind: EVENT.START,
        eventCategory: 'mcp_elicitation',
        decisionCapable: true,
      })),
    elicitationResult: guarded(cfg, 'elicitationResult', 'permission',
      async (env, s) => dryRun ? undefined : handleGenericClaudeEvent(env, s, cfg, {
        activityType: ACTIVITY_TYPES.MCP_ELICITATION,
        eventKind: EVENT.COMPLETE,
        eventCategory: 'mcp_elicitation_result',
        decisionCapable: true,
      })),
  };

  await createClaudeCodeAdapter({
    core,
    resolveSession: (env) => resolveSession(env, cfg),
    approvalMaxWaitMs,
    readStdin: async () => raw,
    // When APPROVAL_MODE=inline, the SDK skips its internal poll loop
    // and the adapter renders permissionDecision:'ask' so Claude
    // Code's native permission dialog pops in the TUI on every
    // require_approval. External approval clients such as the
    // dashboard, mobile app, or editor extension can still resolve
    // the backend row, but the hook does not wait for them.
    inlineApproval: cfg.approvalMode === 'inline' || cfg.approvalMode === 'defer',
    deferApproval: cfg.approvalMode === 'defer',
    handlers,
  }).run();
}
