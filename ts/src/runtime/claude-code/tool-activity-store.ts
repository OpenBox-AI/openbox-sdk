import { createHash } from 'node:crypto';
import path from 'node:path';
import { SessionStore } from '../../session/store.js';
import type { ClaudeCodeEnvelope } from '../../core-client/generated/runtime/claude-code.js';
import type { ClaudeCodeConfig } from './config.js';

interface PendingToolActivity {
  activityId: string;
  activityType: string;
  startTime: number;
}

const stores = new WeakMap<ClaudeCodeConfig, SessionStore>();

function storeFor(cfg: ClaudeCodeConfig): SessionStore {
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

export function toolActivityKey(env: ClaudeCodeEnvelope): string {
  if (env.tool_use_id) {
    return `${env.session_id}:${env.tool_use_id}`;
  }
  const digest = createHash('sha256')
    .update(env.session_id)
    .update('\0')
    .update(env.tool_name ?? '')
    .update('\0')
    .update(stableStringify(env.tool_input ?? null))
    .digest('hex')
    .slice(0, 32);
  return `${env.session_id}:${digest}`;
}

export function rememberToolActivity(
  env: ClaudeCodeEnvelope,
  cfg: ClaudeCodeConfig,
  activity: PendingToolActivity,
): void {
  storeFor(cfg).save(toolActivityKey(env), { ...activity });
}

export function takeToolActivity(
  env: ClaudeCodeEnvelope,
  cfg: ClaudeCodeConfig,
): PendingToolActivity | null {
  const key = toolActivityKey(env);
  const store = storeFor(cfg);
  const record = store.load(key) as Partial<PendingToolActivity> | null;
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
