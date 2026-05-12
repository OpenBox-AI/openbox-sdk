// Hook handler; invoked by `openbox cursor hook` from Cursor's
// hooks.json config. Reads stdin, dispatches via the spec-driven
// cursor adapter, returns the appropriate stdout per hook event
// (cursor-permission for before*, cursor-observe for after*), exits 0
// fail-open.
import { createCursorAdapter } from '../../core-client/generated/runtime/cursor.js';
import { OpenBoxCoreClient } from '../../core-client/index.js';
import { loadConfig } from './config.js';
import { applyEnvSource } from '../../cli/env-source.js';
import { createLogger } from '../../logging/logger.js';
import { resolveSession } from './session-resolver.js';
import { makeHookLog } from '../../logging/hook-log.js';

const hookLog = makeHookLog('cursor');
import { connectApprovalSocket } from '../../approvals/socket-client.js';
import { handleBeforeSubmitPrompt } from './mappers/prompt.js';
import { handleBeforeShellExecution } from './mappers/shell.js';
import { handleBeforeMCPExecution } from './mappers/mcp.js';
import { handleBeforeReadFile, handleBeforeTabFileRead } from './mappers/file-read.js';
import { handlePreToolUse } from './mappers/pre-tool-use.js';
import { handleAfterMCPExecution } from './mappers/mcp-response.js';
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

export async function runCursorHook(): Promise<void> {
  // Single-source env resolution. Layers ~/.openbox/config into
  // process.env BEFORE loadConfig reads it, so a user who switched
  // env via the extension (or `openbox config set --global`) sees
  // their hook fire against the matching env automatically. Without
  // this, the hook would use whatever was snapshotted into
  // ~/.cursor-hooks/config.json at install time — so an env switch
  // wouldn't propagate to already-installed hooks.
  applyEnvSource();

  const cfg = loadConfig();
  createLogger('cursor').initLogger(cfg);

  if (!cfg.openboxApiKey) {
    if (cfg.verbose) console.error('[openbox cursor] no OPENBOX_API_KEY set, passing through');
    process.exit(0);
  }

  const dryRun = cfg.dryRun;

  const core = new OpenBoxCoreClient({
    apiKey: cfg.openboxApiKey,
    apiUrl: cfg.openboxEndpoint,
    timeoutMs: cfg.governanceTimeout * 1000,
  });

  // Cursor's hook subprocess timeout is `t.timeout ?? Kkc` (per-event
  // config in ~/.cursor/hooks.json, default Kkc = 60 seconds, max
  // ~3600s = 1hr per the validator's warning threshold). Whatever the
  // user has configured for the event becomes the ceiling on how long
  // we're willing to poll.
  //
  // cfg.hitlMaxWait is the user-tunable knob (in ~/.cursor-hooks/config.json
  // HITL_MAX_WAIT, default 300s). We respect it up to 1 hour. The
  // hooks.json `timeout` field MUST be set to at least the same value
  // or Cursor will kill us before pollApproval finishes.
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
    socketHandle = await connectApprovalSocket();
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
      // signal — server's 'close' handler does the cleanup.
      try {
        socketHandle?.close();
      } catch {
        /* ignore */
      }
    },
    handlers: {
      beforeSubmitPrompt: logged('beforeSubmitPrompt', 'permission',
        async (env, s) => dryRun ? undefined : handleBeforeSubmitPrompt(env, s, cfg)),
      beforeShellExecution: logged('beforeShellExecution', 'permission',
        async (env, s) => dryRun ? undefined : handleBeforeShellExecution(env, s, cfg)),
      beforeMCPExecution: logged('beforeMCPExecution', 'permission',
        async (env, s) => dryRun ? undefined : handleBeforeMCPExecution(env, s, cfg)),
      beforeReadFile: logged('beforeReadFile', 'permission',
        async (env, s) => dryRun ? undefined : handleBeforeReadFile(env, s, cfg)),
      preToolUse: logged('preToolUse', 'permission',
        async (env, s) => dryRun ? undefined : handlePreToolUse(env, s, cfg)),
      afterMCPExecution: logged('afterMCPExecution', 'observe',
        async (env, s) => dryRun ? undefined : handleAfterMCPExecution(env, s, cfg)),
      afterAgentResponse: logged('afterAgentResponse', 'observe',
        async (env, s) => dryRun ? undefined : handleAfterAgentResponse(env, s, cfg)),
      afterAgentThought: logged('afterAgentThought', 'observe',
        async (env, s) => dryRun ? undefined : handleAfterAgentThought(env, s, cfg)),
      afterShellExecution: logged('afterShellExecution', 'observe',
        async (env, s) => dryRun ? undefined : handleAfterShellExecution(env, s, cfg)),
      afterFileEdit: logged('afterFileEdit', 'observe',
        async (env, s) => dryRun ? undefined : handleAfterFileEdit(env, s, cfg)),
      sessionStart: logged('sessionStart', 'none',
        async (env, s) => dryRun ? undefined : handleSessionStart(env, s, cfg)),
      stop: logged('stop', 'none',
        async (env, s) => dryRun ? undefined : handleStop(env, s, cfg)),
      // postToolUse / postToolUseFailure carry no payload per the
      // spec (@noPayload). We log them so the OutputChannel tail
      // shows the full lifecycle, but there's nothing to map.
      postToolUse: logged('postToolUse', 'observe', async () => undefined),
      postToolUseFailure: logged('postToolUseFailure', 'observe', async () => undefined),
      // Tab-driven + lifecycle + subagent coverage.
      beforeTabFileRead: logged('beforeTabFileRead', 'permission',
        async (env, s) => dryRun ? undefined : handleBeforeTabFileRead(env, s, cfg)),
      afterTabFileEdit: logged('afterTabFileEdit', 'observe',
        async (env, s) => dryRun ? undefined : handleAfterTabFileEdit(env, s, cfg)),
      sessionEnd: logged('sessionEnd', 'none',
        async (env, s) => dryRun ? undefined : handleSessionEnd(env, s, cfg)),
      preCompact: logged('preCompact', 'observe',
        async (env, s) => dryRun ? undefined : handlePreCompact(env, s, cfg)),
      subagentStart: logged('subagentStart', 'permission',
        async (env, s) => dryRun ? undefined : handleSubagentStart(env, s, cfg)),
      subagentStop: logged('subagentStop', 'observe',
        async (env, s) => dryRun ? undefined : handleSubagentStop(env, s, cfg)),
    },
  }).run();
}
