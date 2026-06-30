import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTokenStore, serializeTokenStore, type TokenStore } from '../env/index.js';
import { resolveOsPath } from '../env/os-paths.js';
import { writeSecretFile } from '../env/secret-file.js';

export function getTokenPath(): string {
  const projectTokens = resolve(process.cwd(), '.tokens');
  if (existsSync(projectTokens)) return projectTokens;
  return resolveOsPath('tokens');
}

export function readTokenStore(): TokenStore {
  const path = getTokenPath();
  if (!existsSync(path)) return {};
  return parseTokenStore(readFileSync(path, 'utf-8'));
}

export function loadApiKey(): string | undefined {
  return process.env.OPENBOX_BACKEND_API_KEY ?? process.env.OPENBOX_API_KEY ?? readTokenStore().apiKey;
}

export function saveApiKey(apiKey: string): void {
  const path = getTokenPath();
  const store = readTokenStore();
  const {
    permissions: _permissions,
    features: _features,
    ...storeWithoutPrincipalMetadata
  } = store;
  writeSecretFile(
    path,
    serializeTokenStore({
      ...storeWithoutPrincipalMetadata,
      apiKey,
      updatedAt: new Date().toISOString(),
    }),
  );
}

export function clearApiKey(): boolean {
  const path = getTokenPath();
  const store = readTokenStore();
  if (!store.apiKey) return false;
  const { apiKey: _apiKey, ...next } = store;
  writeSecretFile(path, serializeTokenStore(next));
  return true;
}

export function hasApiKey(): boolean {
  return loadApiKey() !== undefined;
}

export {
  recordAgentKey,
  recallAgentKey,
  agentKeysPath,
  type AgentKeyRecord,
} from './agent-keys.js';
