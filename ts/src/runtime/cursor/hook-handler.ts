// Hook handler; invoked by `openbox cursor hook` from Cursor's
// hooks.json config. Reads stdin, dispatches via the spec-driven
// cursor adapter, returns the appropriate stdout per hook event
// (cursor-permission for before*, cursor-observe for after*), exits 0.
import {
  createCursorAdapter,
  type CursorEnvelope,
} from '../../core-client/generated/runtime/cursor.js';
import {
  OpenBoxCoreClient,
  type WorkflowVerdict,
} from '../../core-client/index.js';
import { getConfigDir, loadConfig } from './config.js';
import { createLogger } from '../../logging/logger.js';
import {
  markStarted,
  peekGoal,
  recordGoal,
  resolveSession,
} from './session-resolver.js';
import { makeHookLog } from '../../logging/hook-log.js';

const hookLog = makeHookLog('cursor');
import { connectApprovalSocket } from '../../approvals/socket-client.js';
import { handleBeforeSubmitPrompt } from './mappers/prompt.js';
import { handleBeforeShellExecution } from './mappers/shell.js';
import { handleBeforeMCPExecution } from './mappers/mcp.js';
import { handleBeforeReadFile, handleBeforeTabFileRead } from './mappers/file-read.js';
import { handlePreToolUse } from './mappers/pre-tool-use.js';
import { handleAfterMCPExecution } from './mappers/mcp-response.js';
import {
  handlePostToolUse,
  handlePostToolUseFailure,
} from './mappers/tool-completion.js';
import { handleSubagentStart } from './mappers/subagent.js';
import {
  handleAfterAgentResponse,
  handleAfterAgentThought,
  handleAfterShellExecution,
  handleAfterFileEdit,
  handleAfterTabFileEdit,
  handlePreCompact,
  handleSessionStart,
  handleSessionEnd,
  handleStop,
  handleSubagentStop,
} from './mappers/observe.js';

const MAX_STDIN_BYTES = 10 * 1024 * 1024;

/** Wrap a per-event handler with a JSONL log line for the
 *  OutputChannel tail. Records timing, dispatch outcome (verdict
 *  shape from the spec), and any thrown error. Logging never
 *  breaks the handler: thrown errors are recorded then re-raised.
 *  Generics preserve the original handler's return type so the
 *  spec-emitted adapter's `verdict | undefined` contract isn't
 *  widened to `unknown`. */
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

type HandlerResult = Promise<WorkflowVerdict | undefined | void>;
type HookHandler = (env: CursorEnvelope, session: any) => HandlerResult;

const CURSOR_CONTINUE_EVENTS = new Set(['beforeSubmitPrompt']);
const CURSOR_PERMISSION_EVENTS = new Set([
  'beforeReadFile',
  'beforeShellExecution',
  'beforeMCPExecution',
  'preToolUse',
  'beforeTabFileRead',
  'subagentStart',
]);

function failClosedVerdict(reason: string): WorkflowVerdict {
  return {
    arm: 'block',
    reason,
    riskScore: 1,
  };
}

function isDecisionCapable(eventName: string | undefined): boolean {
  return CURSOR_CONTINUE_EVENTS.has(String(eventName ?? '')) ||
    CURSOR_PERMISSION_EVENTS.has(String(eventName ?? ''));
}

function requiresGoalContext(env: CursorEnvelope): boolean {
  return isDecisionCapable(env.hook_event_name) &&
    String(env.hook_event_name ?? '') !== 'beforeSubmitPrompt';
}

function ensureGoalContext(env: CursorEnvelope, cfg: ReturnType<typeof loadConfig>): void {
  if (!cfg.requireGoalContext || !requiresGoalContext(env)) return;
  if (peekGoal(env.conversation_id, cfg)) return;
  const configuredGoal = cfg.defaultGoal?.trim();
  if (configuredGoal) {
    recordGoal(env.conversation_id, cfg, configuredGoal, 'workflow_config');
    return;
  }
  throw new Error(
    'OpenBox goal context is required for AGE alignment, but this Cursor session has no prompt/query/workflow goal.',
  );
}

function reasonFromError(prefix: string, err?: unknown): string {
  const detail = err instanceof Error ? err.message : String(err ?? '');
  return detail ? `${prefix}: ${detail}` : prefix;
}

function verdictUsesFallback(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const metadata = record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
    ? record.metadata as Record<string, unknown>
    : {};
  const ageResult = record.ageResult && typeof record.ageResult === 'object' && !Array.isArray(record.ageResult)
    ? record.ageResult as Record<string, unknown>
    : {};
  return record.fallbackUsed === true
    || metadata.age_fallback_used === true
    || ageResult.fallback_used === true;
}

async function ensureWorkflowStartedForDecision(
  env: CursorEnvelope,
  session: any,
  cfg: ReturnType<typeof loadConfig>,
): Promise<void> {
  if (!isDecisionCapable(env.hook_event_name)) return;

  await session.workflowStarted();
  markStarted(env.conversation_id, cfg);
}

function guarded(
  cfg: ReturnType<typeof loadConfig>,
  event: string,
  verdictKind: 'permission' | 'observe' | 'none',
  fn: HookHandler,
): HookHandler {
  return logged(event, verdictKind, async (env, session) => {
    try {
      await ensureWorkflowStartedForDecision(env, session, cfg);
      ensureGoalContext(env, cfg);
      const verdict = await fn(env, session);
      if (
        verdict &&
        isDecisionCapable(env.hook_event_name) &&
        verdictUsesFallback(verdict) &&
        verdict.arm !== 'block' &&
        verdict.arm !== 'halt'
      ) {
        return failClosedVerdict('OpenBox governance fallback used while processing Cursor hook');
      }
      return verdict;
    } catch (err) {
      const reason = reasonFromError('OpenBox governance failed while processing Cursor hook', err);
      if (cfg.verbose) console.error(`[openbox cursor] ${reason}`);
      if (isDecisionCapable(env.hook_event_name)) return failClosedVerdict(reason);
      return undefined;
    }
  });
}

function renderFailClosedHookOutput(env: CursorEnvelope, reason: string): unknown {
  const eventName = String(env.hook_event_name ?? '');
  const message = `[OpenBox] ${reason}`;
  if (CURSOR_CONTINUE_EVENTS.has(eventName)) {
    return {
      continue: false,
      user_message: message,
    };
  }
  if (CURSOR_PERMISSION_EVENTS.has(eventName)) {
    return {
      permission: 'deny',
      user_message: message,
      agent_message: `${message}. Stop and ask the user to fix OpenBox project runtime configuration before retrying.`,
    };
  }
  return undefined;
}

function writeFailClosedIfPossible(env: CursorEnvelope | undefined, reason: string): void {
  if (!env || !isDecisionCapable(env.hook_event_name)) return;
  const output = renderFailClosedHookOutput(env, reason);
  if (output !== undefined) process.stdout.write(JSON.stringify(output));
}

function parseEnvelope(raw: string): CursorEnvelope | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as CursorEnvelope;
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

export async function runCursorHook(): Promise<void> {
  const cfg = loadConfig();
  if (!process.env.OPENBOX_HOME) {
    process.env.OPENBOX_HOME = getConfigDir();
  }
  createLogger('cursor').initLogger(cfg);

  let raw = '';
  let env: CursorEnvelope | undefined;
  try {
    raw = await readHookStdin();
    env = parseEnvelope(raw);
  } catch (err) {
    if (cfg.verbose) console.error(`[openbox cursor] ${reasonFromError('failed to read hook stdin', err)}`);
    process.exit(0);
  }

  if (!cfg.openboxApiKey) {
    writeFailClosedIfPossible(env, 'missing OPENBOX_API_KEY');
    if (cfg.verbose) console.error('[openbox cursor] no OPENBOX_API_KEY set; decision-capable hooks fail closed');
    process.exit(0);
  }
  if (!cfg.openboxEndpoint) {
    writeFailClosedIfPossible(env, 'missing OPENBOX_CORE_URL');
    if (cfg.verbose) console.error('[openbox cursor] no OPENBOX_CORE_URL set; decision-capable hooks fail closed');
    process.exit(0);
  }

  const core = new OpenBoxCoreClient({
    apiKey: cfg.openboxApiKey,
    apiUrl: cfg.openboxEndpoint,
    agentIdentity: cfg.agentIdentity,
    timeoutMs: cfg.governanceTimeout * 1000,
  });

  // Legacy adapter option for SDK compatibility. Core polling is
  // bounded by the server-supplied approval expiration. Cursor still
  // uses this value below to bound the local extension socket wait so
  // a hook subprocess is not held open solely by the editor-side IPC.
  const approvalMaxWaitMs = Math.min(
    Math.max(1, cfg.hitlMaxWait) * 1000,
    3600_000,
  );

  // Lazy agent_id resolution: the API key validates 1:1 to an agent.
  // We pay one round-trip the first time we surface a pending approval
  // so the socket payload identifies the agent for the extension's
  // decideApproval call. Cached because each hook subprocess handles
  // exactly one event (one require_approval at most).
  let cachedAgentId: string | undefined;
  const resolveAgentId = async (): Promise<string | undefined> => {
    if (cachedAgentId !== undefined) return cachedAgentId;
    try {
      const v = (await core.validateApiKey()) as { agent_id?: string } | undefined;
      cachedAgentId = v?.agent_id;
    } catch {
      cachedAgentId = '';
    }
    return cachedAgentId || undefined;
  };

  // One persistent socket connection per hook subprocess. Opened lazily
  // on the first require_approval (cheap if the extension isn't running:
  // 200ms timeout, returns null, hook falls back to pollApproval-only).
  let socketHandle: Awaited<ReturnType<typeof connectApprovalSocket>> | null | undefined;
  const ensureSocket = async () => {
    if (socketHandle !== undefined) return socketHandle;
    socketHandle = await connectApprovalSocket(cfg.approvalSocketPath ?? undefined);
    return socketHandle;
  };

  // Events whose verdict shape doesn't gate (after* + sessionStart /
  // stop + post*). Telemetry-only; surfacing a "approve" toast for an
  // action that already ran is misleading and creates phantom rows.
  const OBSERVE_ONLY = new Set([
    'afterAgentResponse',
    'afterAgentThought',
    'afterShellExecution',
    'afterFileEdit',
    'afterMCPExecution',
    'afterTabFileEdit',
    'postToolUse',
    'postToolUseFailure',
    'preCompact',
    'sessionStart',
    'sessionEnd',
    'stop',
    'subagentStop',
  ]);

  await createCursorAdapter({
    core,
    resolveSession: (env) => resolveSession(env, cfg),
    approvalMaxWaitMs,
    readStdin: async () => raw,
    // When approvalMode is inline, the SDK skips its internal poll loop
    // and the adapter renders permission:'ask' so Cursor's native
    // permission dialog pops in the IDE on every require_approval.
    // External approval clients such as the dashboard, mobile app,
    // or editor extension can still resolve the backend row, but the
    // hook does not wait.
    inlineApproval: cfg.approvalMode === 'inline',
    onPendingApproval: async (info, env) => {
      if (OBSERVE_ONLY.has(String(env.hook_event_name ?? ''))) return;

      const conn = await ensureSocket();
      if (!conn) return; // extension not running; pollApproval handles it
      const agentId = await resolveAgentId();
      const toolSummary = env.tool_name
        ? `${env.tool_name}(${typeof env.tool_input === 'string' ? env.tool_input : JSON.stringify(env.tool_input ?? {})})`
        : undefined;
      const summary = env.command ?? env.file_path ?? toolSummary ?? env.prompt ?? '';
      conn.notifyPending({
        governance_event_id: info.governanceEventId ?? info.approvalId,
        agent_id: agentId ?? '',
        hook_event_name: String(env.hook_event_name ?? ''),
        source: 'cursor',
        summary: summary.slice(0, 200),
        reason: info.reason ?? '',
        expires_at: info.expiresAt ?? new Date(Date.now() + 30 * 60_000).toISOString(),
      });
    },
    // Out-of-band decision channel. Returning a decision here makes
    // the SDK's pollApproval loop wake immediately and run one
    // confirmatory backend poll, instead of waiting for its next
    // exponential-backoff tick (default 500ms-5s). Approving in the
    // extension toast resolves the hook subprocess in O(1 poll RTT)
    // instead of O(poll-cycle).
    awaitExternalDecision: async (info, env) => {
      if (OBSERVE_ONLY.has(String(env.hook_event_name ?? ''))) return undefined;
      const conn = await ensureSocket();
      if (!conn) return undefined;
      const geid = info.governanceEventId ?? info.approvalId;
      const r = await conn.awaitDecision(geid, approvalMaxWaitMs);
      return r.kind === 'decision' ? r.decision : undefined;
    },
    onApprovalResolved: () => {
      // Tell the extension the hook is done (so it can drop the
      // resolver from the store entry). Closing the socket is the
      // signal; server's 'close' handler does the cleanup.
      try {
        socketHandle?.close();
      } catch {
        /* ignore */
      }
    },
    handlers: {
      beforeSubmitPrompt: guarded(cfg, 'beforeSubmitPrompt', 'permission',
        async (env, s) => handleBeforeSubmitPrompt(env, s, cfg)),
      beforeShellExecution: guarded(cfg, 'beforeShellExecution', 'permission',
        async (env, s) => handleBeforeShellExecution(env, s, cfg)),
      beforeMCPExecution: guarded(cfg, 'beforeMCPExecution', 'permission',
        async (env, s) => handleBeforeMCPExecution(env, s, cfg)),
      beforeReadFile: guarded(cfg, 'beforeReadFile', 'permission',
        async (env, s) => handleBeforeReadFile(env, s, cfg)),
      preToolUse: guarded(cfg, 'preToolUse', 'permission',
        async (env, s) => handlePreToolUse(env, s, cfg)),
      afterMCPExecution: guarded(cfg, 'afterMCPExecution', 'observe',
        async (env, s) => handleAfterMCPExecution(env, s, cfg)),
      afterAgentResponse: guarded(cfg, 'afterAgentResponse', 'observe',
        async (env, s) => handleAfterAgentResponse(env, s, cfg)),
      afterAgentThought: guarded(cfg, 'afterAgentThought', 'observe',
        async (env, s) => handleAfterAgentThought(env, s, cfg)),
      afterShellExecution: guarded(cfg, 'afterShellExecution', 'observe',
        async (env, s) => handleAfterShellExecution(env, s, cfg)),
      afterFileEdit: guarded(cfg, 'afterFileEdit', 'observe',
        async (env, s) => handleAfterFileEdit(env, s, cfg)),
      sessionStart: guarded(cfg, 'sessionStart', 'none',
        async (env, s) => handleSessionStart(env, s, cfg)),
      stop: guarded(cfg, 'stop', 'none',
        async (env, s) => handleStop(env, s, cfg)),
      postToolUse: guarded(cfg, 'postToolUse', 'observe',
        async (env, s) => handlePostToolUse(env, s, cfg)),
      postToolUseFailure: guarded(cfg, 'postToolUseFailure', 'observe',
        async (env, s) => handlePostToolUseFailure(env, s, cfg)),
      // Tab-driven + lifecycle + subagent coverage.
      beforeTabFileRead: guarded(cfg, 'beforeTabFileRead', 'permission',
        async (env, s) => handleBeforeTabFileRead(env, s, cfg)),
      afterTabFileEdit: guarded(cfg, 'afterTabFileEdit', 'observe',
        async (env, s) => handleAfterTabFileEdit(env, s, cfg)),
      sessionEnd: guarded(cfg, 'sessionEnd', 'none',
        async (env, s) => handleSessionEnd(env, s, cfg)),
      preCompact: guarded(cfg, 'preCompact', 'observe',
        async (env, s) => handlePreCompact(env, s, cfg)),
      subagentStart: guarded(cfg, 'subagentStart', 'permission',
        async (env, s) => handleSubagentStart(env, s, cfg)),
      subagentStop: guarded(cfg, 'subagentStop', 'observe',
        async (env, s) => handleSubagentStop(env, s, cfg)),
    },
  }).run();
}
