// Loaded by e2e + contract projects on top of tests/setup.ts. Reads
// the developer's `.tokens` (or `~/.openbox/tokens` via the symlink)
// to populate OPENBOX_BACKEND_API_KEY / ACCESS_TOKEN / REFRESH_TOKEN
// for the active OPENBOX_ENV, so test invocations against a real
// backend pick up the developer's existing auth without re-prompting.
//
// Unit tests deliberately do NOT load this file: file-tokens'
// loadApiKey short-circuits on OPENBOX_BACKEND_API_KEY before reading
// any file, so an ambient key would mask the on-disk store the unit
// tests are actually exercising. Keep credential loading scoped to
// projects that need a live backend.

import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { parseTokenStore, resolveEnv } from '../ts/src/env/index';

const rootDir = resolve(__dirname, '..');

function loadCredsForActiveEnv(): void {
  const tokensPath = resolve(rootDir, '.tokens');
  if (!existsSync(tokensPath)) return;
  const store = parseTokenStore(readFileSync(tokensPath, 'utf-8'));
  const env = resolveEnv();
  const entry = store[env];
  if (!entry) return;
  if (entry.apiKey && !process.env.OPENBOX_BACKEND_API_KEY) {
    process.env.OPENBOX_BACKEND_API_KEY = entry.apiKey;
  }
  if (entry.accessToken && !process.env.ACCESS_TOKEN) {
    process.env.ACCESS_TOKEN = entry.accessToken;
  }
  if (entry.refreshToken && !process.env.REFRESH_TOKEN) {
    process.env.REFRESH_TOKEN = entry.refreshToken;
  }
}
loadCredsForActiveEnv();
