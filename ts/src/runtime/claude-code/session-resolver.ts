// Resolves Claude Code's `session_id` (one per chat session) to the
// workflowId/runId pair the OpenBox runtime requires. Logic lives in
// `_shared/session-resolver`; this file just supplies the right field
// from the envelope.
import {
  resolveSessionByKey,
  markHaltedByKey,
  clearSessionByKey,
} from '../_shared/session-resolver.js';
import type { ClaudeCodeConfig } from './config.js';
import type { ClaudeCodeEnvelope } from '../../core-client/generated/runtime/claude-code.js';

export async function resolveSession(
  env: ClaudeCodeEnvelope,
  cfg: ClaudeCodeConfig,
): Promise<{ workflowId: string; runId: string }> {
  return resolveSessionByKey(env.session_id, cfg);
}

export function markHalted(sessionId: string, cfg: ClaudeCodeConfig): void {
  markHaltedByKey(sessionId, cfg);
}

export function clearSession(sessionId: string, cfg: ClaudeCodeConfig): void {
  clearSessionByKey(sessionId, cfg);
}
