// WebdriverIO + wdio-vscode-service config for the OpenBox extension.
//
// Run: `npm run test:e2e-extension`
//
// LIVE-only end-to-end suite. The extension activates inside a real
// VS Code / Cursor workbench and talks through the real SDK to the
// real backend. UI/glue layer behavior (status bar paint, mockStore
// fixtures, view contributions, fail-mode folding, approval-row
// resolution) is covered by the unit-test suite under
// `apps/extension/src/*.test.ts`; this suite only exercises what
// can't be unit tested: the SDK ↔ backend wire and the editor host.
//
// Required env (refuses to run without it):
//   OPENBOX_E2E_LIVE=1
//   OPENBOX_E2E_AGENT_ID    — agent id from openbox-local's bootstrap
//   OPENBOX_E2E_RUNTIME_KEY — runtime key from the same bootstrap
//
// Optional knobs:
//   OPENBOX_E2E_VSCODE_VERSION — VS Code version (default: stable)
//   OPENBOX_E2E_VSCODE_BINARY  — path to a VS Code-fork binary
//                                 (e.g. Cursor) to use instead of the
//                                 downloaded one. The harness still
//                                 uses the bundled VS Code version's
//                                 chromedriver, so versions must
//                                 stay close.
//   OPENBOX_ENV                — env tag the launched workbench binds
//                                 to (default: 'local').
//   OPENBOX_E2E_HEADLESS=1     — pass `--no-sandbox`; rely on the
//                                 caller's Xvfb when running CI.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const EXTENSION_DIR = resolve(ROOT, 'apps/extension');

const vscodeVersion = process.env.OPENBOX_E2E_VSCODE_VERSION ?? 'stable';
const vscodeBinary = process.env.OPENBOX_E2E_VSCODE_BINARY;
const headless = process.env.OPENBOX_E2E_HEADLESS === '1';

if (
  process.env.OPENBOX_E2E_LIVE !== '1' ||
  !process.env.OPENBOX_E2E_AGENT_ID ||
  !process.env.OPENBOX_E2E_RUNTIME_KEY
) {
  console.error(
    'test:e2e-extension is LIVE-only. Set OPENBOX_E2E_LIVE=1 + ' +
      'OPENBOX_E2E_AGENT_ID + OPENBOX_E2E_RUNTIME_KEY (run ' +
      '`cd ~/workspace/openbox-local && npm run bootstrap` to get them). ' +
      'Mock-data UI coverage moved to apps/extension/src/*.test.ts.',
  );
  process.exit(1);
}

const userSettings: Record<string, unknown> = {
  'openbox.environment': process.env.OPENBOX_ENV ?? 'local',
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

  specs: ['./suites/live-*.e2e.ts'],
  // One spec file at a time. Each launches its own VS Code instance
  // (fresh state, fresh extension activation, no cross-suite leakage)
  // because wdio-vscode-service models a session as one workbench.
  // Sequential is by design: stable + isolated > fast.
  maxInstances: 1,
  // Retry the whole spec file once on flaky launch failures
  // (chromedriver racing the VS Code workbench during cold boot
  // occasionally counts a spec as failed before any test runs).
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
