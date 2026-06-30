import {
  createCodexAdapter,
  type CodexAdapterHandlers,
  type CodexEnvelope,
} from '../../core-client/generated/runtime/codex.js';
import {
  OpenBoxCoreClient,
  verdictHasIncompleteGovernanceChecks,
  type CodexSession,
  type WorkflowVerdict,
} from '../../core-client/index.js';
import { createLogger } from '../../logging/logger.js';
import { makeHookLog } from '../../logging/hook-log.js';
import { getConfigDir, loadConfig, type CodexConfig } from './config.js';
import { reasonFromError } from '../../internal/errors.js';
import {
  isStarted,
  markStarted,
  peekGoal,
  recordGoal,
  resolveSession,
  stableCodexSessionKey,
} from './session-resolver.js';
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
type HookHandler = (env: CodexEnvelope, session: CodexSession) => HandlerResult;

function logged<E, S, R>(
  event: string,
  verdictKind: 'permission' | 'observe',
  fn: (env: E, s: S) => Promise<R>,
): (env: E, s: S) => Promise<R> {
  return async (env, s) => {
    const start = Date.now();
    try {
      const out = await fn(env, s);
      const decision = verdictDecision(out);
      const reason = verdictReason(out);
      hookLog.record({
        ts: new Date().toISOString(),
        event,
        verdict_kind: verdictKind,
        took_ms: Date.now() - start,
        ...envelopeLogMetadata(env),
        ...(decision ? { decision } : {}),
        ...(reason ? { reason } : {}),
        ...verdictLogMetadata(out),
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

function verdictDecision(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const decision = record.arm ?? record.verdict ?? record.action ?? record.decision;
  return typeof decision === 'string' && decision.trim() ? decision.trim() : undefined;
}

function verdictReason(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const reason = (value as Record<string, unknown>).reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : undefined;
}

function verdictLogMetadata(value: unknown): Record<string, string | boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.governanceEventId === 'string' && record.governanceEventId.trim()
      ? { governance_event_id: record.governanceEventId.trim() }
      : {}),
    ...(verdictHasIncompleteGovernanceChecks(value) ? { governance_checks_incomplete: true } : {}),
  };
}

function envelopeLogMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.session_id === 'string' && record.session_id.trim()
      ? { session_id: record.session_id.trim() }
      : {}),
    ...(typeof record.conversation_id === 'string' && record.conversation_id.trim()
      ? { conversation_id: record.conversation_id.trim() }
      : {}),
    ...(typeof record.turn_id === 'string' && record.turn_id.trim()
      ? { turn_id: record.turn_id.trim() }
      : {}),
    ...(typeof record.tool_name === 'string' && record.tool_name.trim()
      ? { tool_name: record.tool_name.trim() }
      : {}),
  };
}

function failClosedVerdict(reason: string): WorkflowVerdict {
  return {
    arm: 'block',
    reason,
    riskScore: 1,
  };
}

function isDecisionCapable(eventName: string | undefined): boolean {
  return DECISION_CAPABLE_EVENTS.has(String(eventName ?? ''));
}

function requiresGoalContext(env: CodexEnvelope): boolean {
  return isDecisionCapable(env.hook_event_name) &&
    !['UserPromptSubmit', 'Stop'].includes(String(env.hook_event_name ?? ''));
}

function ensureGoalContext(env: CodexEnvelope, cfg: CodexConfig): void {
  if (!cfg.requireGoalContext || !requiresGoalContext(env)) return;
  if (peekGoal(env, cfg)) return;
  const configuredGoal = cfg.defaultGoal?.trim();
  if (configuredGoal) {
    recordGoal(env, cfg, configuredGoal, 'workflow_config');
    return;
  }
  throw new Error(
    'OpenBox goal context is required for AGE alignment, but this Codex session has no prompt/query/workflow goal.',
  );
}

async function ensureWorkflowStartedForDecision(
  env: CodexEnvelope,
  session: CodexSession,
  cfg: CodexConfig,
): Promise<void> {
  if (!isDecisionCapable(env.hook_event_name)) return;
  if (isStarted(env, cfg)) return;

  // Hook subprocesses can start at the first tool gate. Emit the workflow
  // open event only when the project-local session store has not already
  // recorded one for this workflow/run pair.
  await session.workflowStarted();
  markStarted(env, cfg);
}

function guarded(
  cfg: CodexConfig,
  event: string,
  verdictKind: 'permission' | 'observe',
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
        verdictHasIncompleteGovernanceChecks(verdict) &&
        verdict.arm !== 'block' &&
        verdict.arm !== 'halt'
      ) {
        return failClosedVerdict('OpenBox required governance checks did not complete while processing Codex hook');
      }
      return verdict;
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
  if (env && isDecisionCapable(env.hook_event_name) && !stableCodexSessionKey(env)) {
    writeFailClosedIfPossible(env, 'missing Codex session identifier');
    if (cfg.verbose) {
      console.error('[openbox codex] no session_id, conversation_id, or turn_id set; decision-capable hooks fail closed');
    }
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
    inlineApproval: cfg.approvalMode === 'inline' || cfg.approvalMode === 'defer',
    deferApproval: cfg.approvalMode === 'defer',
    readStdin: async () => raw,
    handlers,
  }).run();
}
