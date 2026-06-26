import { createHash } from 'node:crypto';
import path from 'node:path';
import { SessionStore } from '../../session/store.js';
import type { CodexEnvelope } from '../../core-client/generated/runtime/codex.js';
import type { CodexConfig } from './config.js';
import { codexSessionKey } from './session-resolver.js';

interface PendingActivity {
  activityId: string;
  activityType: string;
  startTime: number;
}

const stores = new WeakMap<CodexConfig, SessionStore>();

function storeFor(cfg: CodexConfig): SessionStore {
  let store = stores.get(cfg);
  if (!store) {
    store = new SessionStore(path.join(cfg.sessionDir, 'tool-activities'));
    stores.set(cfg, store);
  }
  return store;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(',')}}`;
}

function toolActivityKey(env: CodexEnvelope): string {
  const explicit = env.tool_use_id ?? env.tool_call_id ?? env.call_id;
  const sessionKey = codexSessionKey(env);
  if (explicit) return `${sessionKey}:${explicit}`;
  const digest = createHash('sha256')
    .update(sessionKey)
    .update('\0')
    .update(env.tool_name ?? '')
    .update('\0')
    .update(stableStringify(env.tool_input ?? null))
    .digest('hex')
    .slice(0, 32);
  return `${sessionKey}:${digest}`;
}

export function rememberToolActivity(
  env: CodexEnvelope,
  cfg: CodexConfig,
  activity: PendingActivity,
): void {
  storeFor(cfg).save(toolActivityKey(env), { ...activity });
}

export function takeToolActivity(
  env: CodexEnvelope,
  cfg: CodexConfig,
): PendingActivity | null {
  const store = storeFor(cfg);
  const key = toolActivityKey(env);
  const record = store.load(key) as Partial<PendingActivity> | null;
  store.delete(key);
  if (
    !record ||
    typeof record.activityId !== 'string' ||
    typeof record.activityType !== 'string' ||
    typeof record.startTime !== 'number'
  ) {
    return null;
  }
  return {
    activityId: record.activityId,
    activityType: record.activityType,
    startTime: record.startTime,
  };
}
