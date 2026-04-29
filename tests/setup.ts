import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { parseTokenStore, resolveEnv } from '../ts/src/env/index';

const rootDir = resolve(__dirname, '..');

// Load .env
config({ path: resolve(rootDir, '.env') });

// Load tokens for the active env. The CLI's token store uses a
// per-env-namespaced format (`<env>.ACCESS_TOKEN=...`) plus legacy
// un-namespaced rows (treated as production). We use the SDK's own
// parseTokenStore so the test resolution matches what the CLI sees,
// instead of duplicating the parse - and so a future format change
// is a one-line update on the producer side, not a bug-hunt here.
//
// Tokens are looked up by `resolveEnv()` which honors OPENBOX_ENV,
// matching `up.sh` (sets OPENBOX_ENV=local) and CI overrides.
function loadTokensForActiveEnv(): void {
  const tokensPath = resolve(rootDir, '.tokens');
  if (!existsSync(tokensPath)) return;
  const store = parseTokenStore(readFileSync(tokensPath, 'utf-8'));
  const env = resolveEnv();
  const entry = store[env];
  if (!entry) return;
  // The e2e helpers (tests/helpers/api-client.ts) read these specific
  // env-var names. Setting them here means individual tests don't need
  // to know about token-store layout.
  if (entry.accessToken && !process.env.ACCESS_TOKEN) {
    process.env.ACCESS_TOKEN = entry.accessToken;
  }
  if (entry.refreshToken && !process.env.REFRESH_TOKEN) {
    process.env.REFRESH_TOKEN = entry.refreshToken;
  }
}
loadTokensForActiveEnv();

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
