import { config } from 'dotenv';
import { resolve } from 'path';

const rootDir = resolve(__dirname, '..');

// Load .env
config({ path: resolve(rootDir, '.env') });

// URL-first clients intentionally have no production defaults. Unit tests get
// explicit loopback defaults so constructors can be exercised without touching
// live services. E2E/contract setup restores explicit caller overrides.
if (process.env.OPENBOX_API_URL) {
  process.env.OPENBOX_API_URL_OVERRIDE = process.env.OPENBOX_API_URL;
}
if (process.env.OPENBOX_CORE_URL) {
  process.env.OPENBOX_CORE_URL_OVERRIDE = process.env.OPENBOX_CORE_URL;
}
process.env.OPENBOX_API_URL = 'http://localhost:18080';
process.env.OPENBOX_CORE_URL = 'http://localhost:18081';

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
if (process.env.OPENBOX_BACKEND_API_KEY) {
  process.env.OPENBOX_BACKEND_API_KEY_OVERRIDE = process.env.OPENBOX_BACKEND_API_KEY;
}
if (process.env.OPENBOX_API_KEY) {
  process.env.OPENBOX_API_KEY_OVERRIDE = process.env.OPENBOX_API_KEY;
}
delete process.env.OPENBOX_BACKEND_API_KEY;
delete process.env.OPENBOX_API_KEY;
delete process.env.ACCESS_TOKEN;
delete process.env.REFRESH_TOKEN;

// Default test mode is TTY-mode: `isMachineMode()` flips on whenever
// stdout isn't a TTY, and vitest captures stdout into a non-TTY
// stream. Without this, every helper that's silenced in machine mode
// would no-op in tests and assertions on prose output would fail.
// Tests that EXERCISE machine mode (cli-machine-contract.test.ts)
// override locally via setArgvForTesting / their own isTTY flag.
Object.defineProperty(process.stdout, 'isTTY', {
  value: true,
  configurable: true,
  writable: true,
});
