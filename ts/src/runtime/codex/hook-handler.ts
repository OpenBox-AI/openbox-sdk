import {
  createCodexAdapter,
  type CodexAdapterHandlers,
  type CodexEnvelope,
} from '../../core-client/generated/runtime/codex.js';
import {
  OpenBoxCoreClient,
  type WorkflowVerdict,
} from '../../core-client/index.js';
import { createLogger } from '../../logging/logger.js';
import { makeHookLog } from '../../logging/hook-log.js';
import { getConfigDir, loadConfig, type CodexConfig } from './config.js';
import { resolveSession } from './session-resolver.js';
import { handleUserPromptSubmit } from './mappers/prompt.js';
import {
  handlePermissionRequest,
  handlePostToolUse,
  handlePreToolUse,
} from './mappers/tool.js';
import { handleStop } from './mappers/session.js';

const hookLog = makeHookLog('codex');
const MAX_STDIN_BYTES = 10 * 1024 * 1024;
const DECISION_CAPABLE_EVENTS = new Set([
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop',
]);

type HandlerResult = Promise<WorkflowVerdict | undefined | void>;
type HookHandler = (env: CodexEnvelope, session: any) => HandlerResult;

function logged<E, S, R>(
  event: string,
  verdictKind: 'permission' | 'observe',
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

function reasonFromError(prefix: string, err?: unknown): string {
  const detail = err instanceof Error ? err.message : String(err ?? '');
  return detail ? `${prefix}: ${detail}` : prefix;
}

function isDecisionCapable(eventName: string | undefined): boolean {
  return DECISION_CAPABLE_EVENTS.has(String(eventName ?? ''));
}

function guarded(
  cfg: CodexConfig,
  event: string,
  verdictKind: 'permission' | 'observe',
  fn: HookHandler,
): HookHandler {
  return logged(event, verdictKind, async (env, session) => {
    try {
      return await fn(env, session);
    } catch (err) {
      const reason = reasonFromError('OpenBox governance failed while processing Codex hook', err);
      if (cfg.verbose) console.error(`[openbox codex] ${reason}`);
      if (isDecisionCapable(env.hook_event_name)) return failClosedVerdict(reason);
      return undefined;
    }
  });
}

function renderFailClosedHookOutput(env: CodexEnvelope, reason: string): unknown {
  const eventName = env.hook_event_name ?? 'Codex';
  const message = `[OpenBox] ${reason}`;
  if (eventName === 'PreToolUse') {
    return {
      hookSpecificOutput: {
        hookEventName: eventName,
        permissionDecision: 'deny',
        permissionDecisionReason: message,
      },
    };
  }
  if (eventName === 'PermissionRequest') {
    return {
      hookSpecificOutput: {
        hookEventName: eventName,
        decision: {
          behavior: 'deny',
          message,
        },
      },
    };
  }
  return {
    decision: 'block',
    reason: message,
  };
}

function writeFailClosedIfPossible(env: CodexEnvelope | undefined, reason: string): void {
  if (!env || !isDecisionCapable(env.hook_event_name)) return;
  process.stdout.write(JSON.stringify(renderFailClosedHookOutput(env, reason)));
}

function parseEnvelope(raw: string): CodexEnvelope | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as CodexEnvelope;
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

export async function runCodexHook(): Promise<void> {
  const cfg = loadConfig();
  if (!process.env.OPENBOX_HOME) {
    process.env.OPENBOX_HOME = getConfigDir();
  }
  createLogger('codex').initLogger(cfg);

  let raw = '';
  let env: CodexEnvelope | undefined;
  try {
    raw = await readHookStdin();
    env = parseEnvelope(raw);
  } catch (err) {
    if (cfg.verbose) console.error(`[openbox codex] ${reasonFromError('failed to read hook stdin', err)}`);
    process.exit(0);
  }

  if (!cfg.openboxApiKey) {
    writeFailClosedIfPossible(env, 'missing OPENBOX_API_KEY');
    if (cfg.verbose) console.error('[openbox codex] no OPENBOX_API_KEY set; decision-capable hooks fail closed');
    process.exit(0);
  }
  if (!cfg.openboxEndpoint) {
    writeFailClosedIfPossible(env, 'missing OPENBOX_CORE_URL');
    if (cfg.verbose) console.error('[openbox codex] no OPENBOX_CORE_URL set; decision-capable hooks fail closed');
    process.exit(0);
  }

  const core = new OpenBoxCoreClient({
    apiKey: cfg.openboxApiKey,
    apiUrl: cfg.openboxEndpoint,
    agentIdentity: cfg.agentIdentity,
    timeoutMs: cfg.governanceTimeout * 1000,
  });
  const approvalMaxWaitMs = Math.min(
    Math.max(1, cfg.hitlMaxWait) * 1000,
    3600_000,
  );

  const handlers: CodexAdapterHandlers = {
    userPromptSubmit: guarded(cfg, 'UserPromptSubmit', 'permission',
      async (env, s) => handleUserPromptSubmit(env, s, cfg)),
    preToolUse: guarded(cfg, 'PreToolUse', 'permission',
      async (env, s) => handlePreToolUse(env, s, cfg)),
    permissionRequest: guarded(cfg, 'PermissionRequest', 'permission',
      async (env, s) => handlePermissionRequest(env, s, cfg)),
    postToolUse: guarded(cfg, 'PostToolUse', 'observe',
      async (env, s) => handlePostToolUse(env, s, cfg)),
    stop: guarded(cfg, 'Stop', 'permission',
      async (env, s) => handleStop(env, s, cfg)),
  };

  await createCodexAdapter({
    core,
    resolveSession: (env) => resolveSession(env, cfg),
    approvalMaxWaitMs,
    inlineApproval: cfg.approvalMode === 'inline',
    deferApproval: cfg.approvalMode === 'defer',
    readStdin: async () => raw,
    handlers,
  }).run();
}
