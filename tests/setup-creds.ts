// Loaded by e2e + contract projects on top of tests/setup.ts. Reads
// the developer's `~/.openbox/tokens` (or a repo-local `.tokens` as a
// CI-friendly override) and populates OPENBOX_BACKEND_API_KEY for the
// active OPENBOX_ENV.
//
// Mobile is the only sanctioned JWT consumer; every other surface
// (CLI, MCP, IDE extension, hooks) consumes the org X-API-Key from
// `~/.openbox/tokens`. The SDK's own e2e tests must follow the same
// rule: no ACCESS_TOKEN/REFRESH_TOKEN, no login flow, just an X-API-Key.
//
// Unit tests deliberately do NOT load this file: file-tokens'
// loadApiKey short-circuits on OPENBOX_BACKEND_API_KEY before reading
// any file, so an ambient key would mask the on-disk store the unit
// tests are actually exercising. Keep credential loading scoped to
// projects that need a live backend.

import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { parseTokenStore, resolveEnv } from '../ts/src/env/index';

function loadCredsForActiveEnv(): void {
  const candidates = [
    resolve(homedir(), '.openbox', 'tokens'),
    resolve(__dirname, '..', '.tokens'),
  ];
  const tokensPath = candidates.find((p) => existsSync(p));
  if (!tokensPath) return;

  const store = parseTokenStore(readFileSync(tokensPath, 'utf-8'));
  const env = resolveEnv();
  const entry = store[env];
  if (!entry) return;
  if (entry.apiKey && !process.env.OPENBOX_BACKEND_API_KEY) {
    process.env.OPENBOX_BACKEND_API_KEY = entry.apiKey;
  }
}
loadCredsForActiveEnv();
