// WebdriverIO + wdio-vscode-service config for the OpenBox extension.
//
// Run: `npm run test:e2e-extension`
// Needs a graphical session (downloads + launches VS Code).
//
// Two modes (selected by env):
//
//   default — mockAuth: true; no backend needed; covers panel + UI
//             smoke. Suites: panel, save-gate, mock-decide.
//
//   live   — set OPENBOX_E2E_LIVE=1 + OPENBOX_E2E_AGENT_ID +
//             OPENBOX_E2E_RUNTIME_KEY (produced by your bootstrap
//             tool of choice) to flip the launched VS Code into
//             real-agent mode. Suites: live-gate. The extension's
//             gates fire real check_governance against the
//             configured backend; planted behavior rules turn that
//             into deterministic verdicts.
//
// Knobs:
//   OPENBOX_E2E_VSCODE_VERSION — VS Code version (default: stable)
//   OPENBOX_E2E_HEADLESS=1     — pass `--no-sandbox`; rely on the
//                                caller's Xvfb when running CI.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const EXTENSION_DIR = resolve(ROOT, 'apps/extension');

const vscodeVersion = process.env.OPENBOX_E2E_VSCODE_VERSION ?? 'stable';
const headless = process.env.OPENBOX_E2E_HEADLESS === '1';

const LIVE =
  process.env.OPENBOX_E2E_LIVE === '1' &&
  !!process.env.OPENBOX_E2E_AGENT_ID &&
  !!process.env.OPENBOX_E2E_RUNTIME_KEY;

const userSettings: Record<string, unknown> = LIVE
  ? {
      'openbox.environment': process.env.OPENBOX_ENV ?? 'local',
      'openbox.mockAuth': false,
      'openbox.agentId': process.env.OPENBOX_E2E_AGENT_ID!,
      'openbox.preWriteGate.active': true,
      'openbox.tabObserver.enabled': true,
      'openbox.tabObserver.active': true,
      'openbox.fileOpGate.enabled': true,
      'openbox.failClosed': false,
    }
  : {
      'openbox.environment': 'staging',
      'openbox.mockAuth': true,
    };

const specs = LIVE ? ['./suites/live-*.e2e.ts'] : ['./suites/!(live-)*.e2e.ts'];

export const config = {
  runner: 'local',
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 90_000,
  },

  specs,
  maxInstances: 1,

  capabilities: [
    {
      browserName: 'vscode',
      browserVersion: vscodeVersion,
      'wdio:vscodeOptions': {
        extensionPath: EXTENSION_DIR,
        userSettings,
        workspacePath: resolve(HERE, 'fixtures-workspace'),
        ...(headless ? { vscodeArgs: ['--no-sandbox'] } : {}),
      },
    },
  ],

  services: ['vscode'],
  outputDir: resolve(ROOT, 'tests/e2e-extension/.wdio-cache/logs'),
  logLevel: 'info',
} as const;
