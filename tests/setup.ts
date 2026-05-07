import { config } from 'dotenv';
import { resolve } from 'path';

const rootDir = resolve(__dirname, '..');

// Load .env
config({ path: resolve(rootDir, '.env') });

// URLs are NOT defaulted here. Hardcoding production literals would
// override OPENBOX_ENV-driven derivation — a developer running with
// OPENBOX_ENV=local would silently hit api.openbox.ai. URL resolution
// belongs to the env registry (ts/src/env/environments.ts → resolveUrls)
// and is wired into projects that actually need it via tests/setup-creds.ts.

// bypass the destructive-op confirmation gate for the test
// run. Tests that EXERCISE the gate (cli-noninteractive.test.ts) clear
// this in their own beforeEach. Without this, every command-test that
// invokes `delete`/`logout`/etc would have to thread `--yes` manually.
if (!process.env.OPENBOX_ASSUME_YES) {
  process.env.OPENBOX_ASSUME_YES = '1';
}

// Unit tests must run with NO ambient auth. file-tokens.loadApiKey()
// short-circuits on OPENBOX_BACKEND_API_KEY before reading any file,
// so leaving a real key in the env from the developer's shell would
// silently bleed into unit tests that exercise loadApiKey. e2e and
// contract projects opt in to credential loading via setup-creds.ts.
delete process.env.OPENBOX_BACKEND_API_KEY;
delete process.env.ACCESS_TOKEN;
delete process.env.REFRESH_TOKEN;
