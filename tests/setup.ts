import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { parseTokenStore, resolveEnv } from '../ts/src/env/index';

const rootDir = resolve(__dirname, '..');

// Load .env
config({ path: resolve(rootDir, '.env') });

// Load credentials for the active env. The CLI's token store uses a
// per-env-namespaced format (`<env>.ACCESS_TOKEN=...` / `<env>.API_KEY=...`)
// plus legacy un-namespaced rows (treated as production). We use the SDK's
// own parseTokenStore so the test resolution matches what the CLI sees.
//
// Credentials are looked up by `resolveEnv()` which honors OPENBOX_ENV,
// matching `up.sh` (sets OPENBOX_ENV=local) and CI overrides.
function loadCredsForActiveEnv(): void {
  const tokensPath = resolve(rootDir, '.tokens');
  if (!existsSync(tokensPath)) return;
  const store = parseTokenStore(readFileSync(tokensPath, 'utf-8'));
  const env = resolveEnv();
  const entry = store[env];
  if (!entry) return;
  // X-API-Key path (CLI's only auth mode post-v0.2.0).
  if (entry.apiKey && !process.env.OPENBOX_BACKEND_API_KEY) {
    process.env.OPENBOX_BACKEND_API_KEY = entry.apiKey;
  }
  // Legacy JWT fields kept for older e2e helpers (tests/helpers/api-client.ts)
  // that still construct a Bearer-auth client. Harmless when absent.
  if (entry.accessToken && !process.env.ACCESS_TOKEN) {
    process.env.ACCESS_TOKEN = entry.accessToken;
  }
  if (entry.refreshToken && !process.env.REFRESH_TOKEN) {
    process.env.REFRESH_TOKEN = entry.refreshToken;
  }
}
loadCredsForActiveEnv();

// Set defaults
if (!process.env.OPENBOX_API_URL) {
  process.env.OPENBOX_API_URL = 'https://api.openbox.ai';
}
if (!process.env.OPENBOX_CORE_URL) {
  process.env.OPENBOX_CORE_URL = 'https://core.openbox.ai';
}

// bypass the destructive-op confirmation gate for the test
// run. Tests that EXERCISE the gate (cli-noninteractive.test.ts) clear
// this in their own beforeEach. Without this, every command-test that
// invokes `delete`/`logout`/etc would have to thread `--yes` manually.
if (!process.env.OPENBOX_ASSUME_YES) {
  process.env.OPENBOX_ASSUME_YES = '1';
}
