// WebdriverIO + wdio-vscode-service config for the OpenBox extension.
//
// Run: `npm run test:e2e-extension`
//
// LIVE end-to-end suite; the extension activates inside a real
// VS Code / Cursor workbench and talks through the real SDK to the
// real backend. UI/glue layer logic (status bar paint shapes,
// MockStore fixtures, view contributions, fail-mode folding,
// approval-row resolution) is covered by unit tests under
// `apps/extension/src/*.test.ts`. This suite covers what those can't:
// extension activation, view registration, real polling round-trips,
// real governance.check verdicts, real save → revert flows.
//
// Zero env vars required for a default localhost run. URLs and
// credentials auto-load the same way the SDK e2e suite does:
//
//   OPENBOX_API_URL          ← override OR http://localhost:3000
//   OPENBOX_CORE_URL         ← override OR http://localhost:8086
//   OPENBOX_E2E_AGENT_ID     ← override OR e2e-agent from ~/.openbox/agent-keys
//   OPENBOX_E2E_RUNTIME_KEY  ← override OR e2e-agent runtime key from same
//
// Knobs:
//   OPENBOX_E2E_VSCODE_VERSION; VS Code version (default: stable)
//   OPENBOX_E2E_VSCODE_BINARY ; path to a VS Code-fork binary
//                                 (e.g. Cursor) to use instead of the
//                                 downloaded one. Versions must stay
//                                 close; chromedriver is bundled to
//                                 the VS Code version we downloaded.
//   OPENBOX_E2E_HEADLESS=1    ; pass `--no-sandbox` for Linux + Xvfb
//                                 environments. macOS shows the
//                                 workbench window; the in-test
//                                 before-hook minimizes it after launch.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const EXTENSION_DIR = resolve(ROOT, 'apps/extension');

// ─── credential auto-load ────────────────────────────────────────────
//
// Pull the e2e-agent's runtime key from ~/.openbox/agent-keys (the
// canonical store openbox-local's bootstrap writes to). Same pattern
// as tests/setup-creds.ts; lets `npm run test:e2e-extension` Just Work
// after `cd ~/workspace/openbox-local && npm run bootstrap`.

const E2E_AGENT_NAME = 'e2e-agent';

if (!process.env.OPENBOX_E2E_AGENT_ID || !process.env.OPENBOX_E2E_RUNTIME_KEY) {
  const keysFile = resolve(homedir(), '.openbox', 'agent-keys');
  if (existsSync(keysFile)) {
    try {
      const cache = JSON.parse(readFileSync(keysFile, 'utf-8')) as Record<
        string,
        { agentId: string; agentName: string; runtimeKey: string }
      >;
      const entry = Object.values(cache).find((r) => r.agentName === E2E_AGENT_NAME);
      if (entry) {
        if (!process.env.OPENBOX_E2E_AGENT_ID) process.env.OPENBOX_E2E_AGENT_ID = entry.agentId;
        if (!process.env.OPENBOX_E2E_RUNTIME_KEY) process.env.OPENBOX_E2E_RUNTIME_KEY = entry.runtimeKey;
      }
    } catch {
      /* best-effort; the explicit-error path below catches missing creds */
    }
  }
}

if (!process.env.OPENBOX_E2E_AGENT_ID || !process.env.OPENBOX_E2E_RUNTIME_KEY) {
  console.error(
    'No e2e agent credentials. Run `cd ~/workspace/openbox-local && npm run bootstrap` ' +
      'to provision the canonical e2e-agent (writes to ~/.openbox/agent-keys), or set ' +
      'OPENBOX_E2E_AGENT_ID + OPENBOX_E2E_RUNTIME_KEY explicitly for a different agent.',
  );
  process.exit(1);
}

const vscodeVersion = process.env.OPENBOX_E2E_VSCODE_VERSION ?? 'stable';
const vscodeBinary = process.env.OPENBOX_E2E_VSCODE_BINARY;
const headless = process.env.OPENBOX_E2E_HEADLESS === '1';

const userSettings: Record<string, unknown> = {
  'openbox.environment': 'local',
  'openbox.mockAuth': false,
  'openbox.agentId': process.env.OPENBOX_E2E_AGENT_ID!,
  'openbox.preWriteGate.active': true,
  'openbox.tabObserver.enabled': true,
  'openbox.tabObserver.active': true,
  'openbox.fileOpGate.enabled': true,
  'openbox.failClosed': false,
};

export const config = {
  runner: 'local',
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 90_000,
  },

  // One consolidated spec file = one workbench launch = one window
  // flash on macOS. Splitting across N files multiplies the launch
  // count by N. The single spec file groups concerns via describe()
  // blocks for navigability.
  specs: ['./suites/live-e2e.e2e.ts'],
  maxInstances: 1,
  // Retry the spec file once on flaky launch failures (chromedriver
  // racing the workbench during cold boot occasionally counts a spec
  // as failed before any test runs).
  specFileRetries: 1,
  specFileRetriesDelay: 2,

  capabilities: [
    {
      browserName: 'vscode',
      browserVersion: vscodeVersion,
      'wdio:vscodeOptions': {
        extensionPath: EXTENSION_DIR,
        userSettings,
        workspacePath: resolve(HERE, 'fixtures-workspace'),
        ...(vscodeBinary ? { binary: vscodeBinary } : {}),
        ...(headless ? { vscodeArgs: ['--no-sandbox'] } : {}),
      },
    },
  ],

  services: ['vscode'],
  outputDir: resolve(ROOT, 'tests/e2e-extension/.wdio-cache/logs'),
  logLevel: 'info',
} as const;
