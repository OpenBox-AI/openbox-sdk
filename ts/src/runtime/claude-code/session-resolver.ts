// Resolves Claude Code's `session_id` (one per chat session) to the
// workflowId/runId pair the OpenBox runtime requires. The first hook in
// a session creates the IDs; subsequent hooks load them from disk.
//
// File layout: ~/.claude-hooks/sessions/<sanitized-session-id>.json
import { randomUUID } from 'node:crypto';
import { SessionStore } from './session-store.js';
import type { ClaudeHooksConfig } from './config.js';
import type { ClaudeHookEnvelope } from '../claude-hooks.js';

interface PersistedSession {
  workflowId: string;
  runId: string;
  /** Cleared when a halt verdict fires; the next hook starts a fresh workflow. */
  halted?: boolean;
}

let storeInstance: SessionStore | null = null;
function getStore(cfg: ClaudeHooksConfig): SessionStore {
  if (!storeInstance) storeInstance = new SessionStore(cfg.sessionDir);
  return storeInstance;
}

export async function resolveSession(
  env: ClaudeHookEnvelope,
  cfg: ClaudeHooksConfig,
): Promise<{ workflowId: string; runId: string }> {
  const store = getStore(cfg);
  const existing = store.load(env.session_id) as PersistedSession | null;

  if (existing && !existing.halted) {
    return { workflowId: existing.workflowId, runId: existing.runId };
  }

  // First hook in this session, OR previous workflow halted - fresh IDs.
  const workflowId = randomUUID();
  const runId = randomUUID();
  store.save(env.session_id, { workflowId, runId } satisfies PersistedSession);
  return { workflowId, runId };
}

/**
 * Mark this session's workflow as halted so the next hook starts a fresh
 * workflow envelope. Called from handlers when they observe verdict.arm
 * === 'halt'.
 */
export function markHalted(sessionId: string, cfg: ClaudeHooksConfig): void {
  const store = getStore(cfg);
  const existing = store.load(sessionId) as PersistedSession | null;
  if (existing) {
    store.save(sessionId, { ...existing, halted: true });
  }
}

/** Tear down the session store entry on session-end so disk doesn't grow. */
export function clearSession(sessionId: string, cfg: ClaudeHooksConfig): void {
  getStore(cfg).delete(sessionId);
}
