// Resolves Cursor's `conversation_id` → workflowId/runId. Persistent
// per-session storage so hook events across the same conversation share
// one OpenBox workflow envelope.
import { randomUUID } from 'node:crypto';
import { SessionStore } from './session-store.js';
import type { CursorConfig } from './config.js';
import type { CursorEnvelope } from '../../core-client/generated/runtime/cursor.js';

interface PersistedSession {
  workflowId: string;
  runId: string;
  halted?: boolean;
}

let storeInstance: SessionStore | null = null;
function getStore(cfg: CursorConfig): SessionStore {
  if (!storeInstance) storeInstance = new SessionStore(cfg.sessionDir);
  return storeInstance;
}

export async function resolveSession(
  env: CursorEnvelope,
  cfg: CursorConfig,
): Promise<{ workflowId: string; runId: string }> {
  const store = getStore(cfg);
  const existing = store.load(env.conversation_id) as PersistedSession | null;
  if (existing && !existing.halted) {
    return { workflowId: existing.workflowId, runId: existing.runId };
  }
  const workflowId = randomUUID();
  const runId = randomUUID();
  store.save(env.conversation_id, { workflowId, runId } satisfies PersistedSession);
  return { workflowId, runId };
}

export function markHalted(conversationId: string, cfg: CursorConfig): void {
  const store = getStore(cfg);
  const existing = store.load(conversationId) as PersistedSession | null;
  if (existing) store.save(conversationId, { ...existing, halted: true });
}

export function clearSession(conversationId: string, cfg: CursorConfig): void {
  getStore(cfg).delete(conversationId);
}
