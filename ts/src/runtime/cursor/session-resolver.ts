// Resolves Cursor's `conversation_id` → workflowId/runId. Logic lives
// in `session/resolver`; this file just supplies the right
// field from the envelope.
import {
  resolveSessionByKey,
  isSessionStartedByKey,
  markHaltedByKey,
  markStartedByKey,
  clearSessionByKey,
} from '../../session/resolver.js';
import type { CursorConfig } from './config.js';
import type { CursorEnvelope } from '../../core-client/generated/runtime/cursor.js';

export async function resolveSession(
  env: CursorEnvelope,
  cfg: CursorConfig,
): Promise<{ workflowId: string; runId: string }> {
  return resolveSessionByKey(env.conversation_id, cfg);
}

export function markHalted(conversationId: string, cfg: CursorConfig): void {
  markHaltedByKey(conversationId, cfg);
}

export function isStarted(conversationId: string, cfg: CursorConfig): boolean {
  return isSessionStartedByKey(conversationId, cfg);
}

export function markStarted(conversationId: string, cfg: CursorConfig): void {
  markStartedByKey(conversationId, cfg);
}

export function clearSession(conversationId: string, cfg: CursorConfig): void {
  clearSessionByKey(conversationId, cfg);
}
