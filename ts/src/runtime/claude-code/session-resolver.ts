// Resolves Claude Code's `session_id` (one per chat session) to the
// workflowId/runId pair the OpenBox runtime requires. Logic lives in
// `session/resolver`; this file just supplies the right field
// from the envelope.
import {
  resolveSessionByKey,
  peekSessionByKey,
  markHaltedByKey,
  clearSessionByKey,
} from '../../session/resolver.js';
import type { ClaudeCodeConfig } from './config.js';
import type { ClaudeCodeEnvelope } from '../../core-client/generated/runtime/claude-code.js';

// True iff the most recent resolveSession() had to create a fresh
// record (no prior on-disk session, or the prior was halted). One-shot
// invocations like `claude update` fire SessionEnd without any prior
// hook; the parent process is exiting and the harness cancels our HTTP
// calls mid-flight ("Hook cancelled"). When SessionEnd sees a phantom
// session, it skips HTTP entirely — there's nothing to observe.
let resolveCreatedFreshSession = false;

export async function resolveSession(
  env: ClaudeCodeEnvelope,
  cfg: ClaudeCodeConfig,
): Promise<{ workflowId: string; runId: string }> {
  const prior = peekSessionByKey(env.session_id, cfg);
  resolveCreatedFreshSession = !prior || prior.halted;
  return resolveSessionByKey(env.session_id, cfg);
}

export function lastResolveCreatedFreshSession(): boolean {
  return resolveCreatedFreshSession;
}

export function markHalted(sessionId: string, cfg: ClaudeCodeConfig): void {
  markHaltedByKey(sessionId, cfg);
}

export function clearSession(sessionId: string, cfg: ClaudeCodeConfig): void {
  clearSessionByKey(sessionId, cfg);
}
