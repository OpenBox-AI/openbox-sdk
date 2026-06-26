// Generic session-id to workflowId / runId resolver shared by every
// runtime adapter. The first hook in a session creates the IDs;
// subsequent hooks load them from disk. A halt verdict marks the
// persisted record so the next hook starts a fresh workflow envelope.
//
// Adapters wrap this with their own envelope-field accessor:
// `env.session_id` for claude-code, `env.conversation_id` for cursor.
import { randomUUID } from 'node:crypto';
import { SessionStore } from './store.js';

interface PersistedSession {
  workflowId: string;
  runId: string;
  /** Cleared when a halt verdict fires; the next hook starts a fresh workflow. */
  halted?: boolean;
  /** True after an adapter has emitted WorkflowStarted for this workflow/run pair. */
  started?: boolean;
  /** Prompt/query/workflow objective that seeds AGE goal alignment for the session. */
  goal?: string;
  goalSource?: 'prompt' | 'query' | 'run' | 'workflow_config' | 'mcp_argument';
  goalSetAt?: string;
}

/** Minimal config contract every adapter shares. */
export interface SharedSessionConfig {
  sessionDir: string;
}

const stores = new WeakMap<SharedSessionConfig, SessionStore>();
function getStore(cfg: SharedSessionConfig): SessionStore {
  let s = stores.get(cfg);
  if (!s) {
    s = new SessionStore(cfg.sessionDir);
    stores.set(cfg, s);
  }
  return s;
}

export function resolveSessionByKey(
  key: string,
  cfg: SharedSessionConfig,
): { workflowId: string; runId: string } {
  const store = getStore(cfg);
  const existing = store.load(key) as PersistedSession | null;
  if (existing && !existing.halted) {
    return { workflowId: existing.workflowId, runId: existing.runId };
  }
  const workflowId = randomUUID();
  const runId = randomUUID();
  store.save(key, { workflowId, runId } satisfies PersistedSession);
  return { workflowId, runId };
}

export function peekSessionByKey(
  key: string,
  cfg: SharedSessionConfig,
): { workflowId: string; runId: string; halted: boolean } | null {
  const existing = getStore(cfg).load(key) as PersistedSession | null;
  if (!existing) return null;
  return {
    workflowId: existing.workflowId,
    runId: existing.runId,
    halted: existing.halted ?? false,
  };
}

export function markHaltedByKey(key: string, cfg: SharedSessionConfig): void {
  const store = getStore(cfg);
  const existing = store.load(key) as PersistedSession | null;
  if (existing) store.save(key, { ...existing, halted: true });
}

export function isSessionStartedByKey(key: string, cfg: SharedSessionConfig): boolean {
  const existing = getStore(cfg).load(key) as PersistedSession | null;
  return Boolean(existing && !existing.halted && existing.started === true);
}

export function markStartedByKey(key: string, cfg: SharedSessionConfig): void {
  const store = getStore(cfg);
  const existing = store.load(key) as PersistedSession | null;
  if (existing && !existing.halted) store.save(key, { ...existing, started: true });
}

export interface SessionGoalRecord {
  goal: string;
  goalSource: NonNullable<PersistedSession['goalSource']>;
  goalSetAt?: string;
  workflowId: string;
  runId: string;
}

export function recordGoalByKey(
  key: string,
  cfg: SharedSessionConfig,
  goal: string | undefined,
  goalSource: SessionGoalRecord['goalSource'],
): SessionGoalRecord | null {
  const normalized = goal?.trim();
  if (!normalized) return null;
  const store = getStore(cfg);
  const existing = store.load(key) as PersistedSession | null;
  const base = existing && !existing.halted
    ? existing
    : { ...resolveSessionByKey(key, cfg), started: false };
  const next = {
    ...base,
    goal: normalized,
    goalSource,
    goalSetAt: new Date().toISOString(),
  } satisfies PersistedSession;
  store.save(key, next);
  return {
    goal: next.goal,
    goalSource: next.goalSource,
    goalSetAt: next.goalSetAt,
    workflowId: next.workflowId,
    runId: next.runId,
  };
}

export function peekGoalByKey(
  key: string,
  cfg: SharedSessionConfig,
): SessionGoalRecord | null {
  const existing = getStore(cfg).load(key) as PersistedSession | null;
  const goal = existing && !existing.halted ? existing.goal?.trim() : undefined;
  if (!existing || !goal || !existing.goalSource) return null;
  return {
    goal,
    goalSource: existing.goalSource,
    goalSetAt: existing.goalSetAt,
    workflowId: existing.workflowId,
    runId: existing.runId,
  };
}

export function clearSessionByKey(key: string, cfg: SharedSessionConfig): void {
  getStore(cfg).delete(key);
}
