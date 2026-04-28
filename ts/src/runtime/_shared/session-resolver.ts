// Generic session-id → workflowId/runId resolver shared by every runtime
// adapter. The first hook in a session creates the IDs; subsequent
// hooks load them from disk. A halt verdict marks the persisted record
// so the next hook starts a fresh workflow envelope.
//
// Adapters wrap this with their own envelope-field accessor (e.g.
// `env.session_id` for claude-code, `env.conversation_id` for cursor).
import { randomUUID } from 'node:crypto';
import { SessionStore } from './session-store.js';

interface PersistedSession {
  workflowId: string;
  runId: string;
  /** Cleared when a halt verdict fires; the next hook starts a fresh workflow. */
  halted?: boolean;
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

export function markHaltedByKey(key: string, cfg: SharedSessionConfig): void {
  const store = getStore(cfg);
  const existing = store.load(key) as PersistedSession | null;
  if (existing) store.save(key, { ...existing, halted: true });
}

export function clearSessionByKey(key: string, cfg: SharedSessionConfig): void {
  getStore(cfg).delete(key);
}
