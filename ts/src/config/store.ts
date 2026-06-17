import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { resolveOsPath } from '../env/os-paths.js';

type Store = Record<string, string>;

export type Scope = 'project';
const CONFIG_KEY = /^[A-Z][A-Z0-9_]*$/;

function getPath(): string {
  return resolveOsPath('config');
}

function read(): Store {
  const path = getPath();
  if (!existsSync(path)) return {};
  const out: Store = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (CONFIG_KEY.test(key)) out[key] = value;
  }
  return out;
}

function write(store: Store): void {
  const lines = ['# OpenBox CLI config; managed by `openbox config set/get/unset/list`.'];
  for (const key of Object.keys(store).sort()) lines.push(`${key}=${store[key]}`);
  const path = getPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${lines.join('\n')}\n`, { mode: 0o600 });
}

export function effectiveScope(_requested: Scope, _key: string): Scope {
  return 'project';
}

export function setConfig(key: string, value: string): { scope: Scope; purged: number } {
  if (!key) throw new Error('config key cannot be empty');
  if (!CONFIG_KEY.test(key)) throw new Error(`invalid config key: ${key}`);
  write({ ...read(), [key]: value });
  return { scope: 'project', purged: 0 };
}

export function getConfig(key: string): string | undefined {
  return read()[key];
}

export function unsetConfig(key: string): { scope: Scope; removed: boolean } {
  const store = read();
  if (!(key in store)) return { scope: 'project', removed: false };
  const { [key]: _removed, ...next } = store;
  write(next);
  return { scope: 'project', removed: true };
}

export function listConfig(): Record<string, string> {
  return read();
}

export function configStorePath(): string {
  return getPath();
}

export function applyConfigToProcessEnv(): void {
  for (const [key, value] of Object.entries(listConfig())) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
