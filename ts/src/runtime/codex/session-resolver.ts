import {
  clearSessionByKey,
  isSessionStartedByKey,
  markHaltedByKey,
  markStartedByKey,
  peekGoalByKey,
  recordGoalByKey,
  resolveSessionByKey,
  type SessionGoalRecord,
} from '../../session/resolver.js';
import type { CodexEnvelope } from '../../core-client/generated/runtime/codex.js';
import type { CodexConfig } from './config.js';

export function stableCodexSessionKey(env: CodexEnvelope): string | undefined {
  const key = env.session_id ?? env.conversation_id ?? env.turn_id;
  return typeof key === 'string' && key.trim() ? key.trim() : undefined;
}

export function codexSessionKey(env: CodexEnvelope): string {
  const stableKey = stableCodexSessionKey(env);
  if (stableKey) return stableKey;

  const scopedKey = [
    env.hook_event_name,
    env.tool_use_id ?? env.call_id ?? env.tool_call_id ?? env.approval_id,
  ]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(':');
  return scopedKey || 'codex:unscoped';
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

export function isStarted(env: CodexEnvelope, cfg: CodexConfig): boolean {
  return isSessionStartedByKey(codexSessionKey(env), cfg);
}

export function markStarted(env: CodexEnvelope, cfg: CodexConfig): void {
  markStartedByKey(codexSessionKey(env), cfg);
}

export function recordGoal(
  env: CodexEnvelope,
  cfg: CodexConfig,
  goal: string | undefined,
  goalSource: SessionGoalRecord['goalSource'] = 'prompt',
): SessionGoalRecord | null {
  return recordGoalByKey(codexSessionKey(env), cfg, goal, goalSource);
}

export function peekGoal(env: CodexEnvelope, cfg: CodexConfig): SessionGoalRecord | null {
  return peekGoalByKey(codexSessionKey(env), cfg);
}

export function clearSession(env: CodexEnvelope, cfg: CodexConfig): void {
  clearSessionByKey(codexSessionKey(env), cfg);
}
