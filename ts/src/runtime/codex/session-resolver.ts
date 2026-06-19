import {
  clearSessionByKey,
  markHaltedByKey,
  resolveSessionByKey,
} from '../../session/resolver.js';
import type { CodexEnvelope } from '../../core-client/generated/runtime/codex.js';
import type { CodexConfig } from './config.js';

export function codexSessionKey(env: CodexEnvelope): string {
  return env.session_id ?? env.conversation_id ?? env.turn_id ?? 'default';
}

export async function resolveSession(
  env: CodexEnvelope,
  cfg: CodexConfig,
): Promise<{ workflowId: string; runId: string }> {
  return resolveSessionByKey(codexSessionKey(env), cfg);
}

export function markHalted(env: CodexEnvelope, cfg: CodexConfig): void {
  markHaltedByKey(codexSessionKey(env), cfg);
}

export function clearSession(env: CodexEnvelope, cfg: CodexConfig): void {
  clearSessionByKey(codexSessionKey(env), cfg);
}
