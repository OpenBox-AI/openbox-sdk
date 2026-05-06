// WebdriverIO + wdio-vscode-service config for the OpenBox extension.
//
// Drives a real VS Code (or Cursor, see OPENBOX_E2E_VSCODE_BINARY)
// with the freshly-built extension installed, then runs the suites
// against the live workbench.
//
// Run: `npm run test:e2e-extension`
// Required: a graphical session (the test downloads VS Code which
//   needs to launch a window). Headless servers should use Xvfb.
//
// Knobs:
//   OPENBOX_E2E_VSCODE_BINARY  — point at Cursor.app/Contents/MacOS/Cursor
//                                or any VS Code-compatible binary;
//                                defaults to the version downloaded
//                                by wdio-vscode-service.
//   OPENBOX_E2E_VSCODE_VERSION — VS Code version to download (defaults
//                                to "stable"). Ignored when binary is
//                                set.
//   OPENBOX_E2E_HEADLESS=1     — pass `--no-sandbox` and rely on the
//                                caller's Xvfb / similar.

import { resolve } from 'node:path';
import type { Options } from '@wdio/types';

const ROOT = resolve(__dirname, '../..');
const VSIX = resolve(ROOT, 'apps/extension/openbox-0.1.0.vsix');

const vscodeBinary = process.env.OPENBOX_E2E_VSCODE_BINARY;
const vscodeVersion = process.env.OPENBOX_E2E_VSCODE_VERSION ?? 'stable';
const headless = process.env.OPENBOX_E2E_HEADLESS === '1';

export const config: Options.Testrunner = {
  runner: 'local',
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60_000,
  },

  specs: ['./suites/**/*.e2e.ts'],
  maxInstances: 1,

  capabilities: [
    {
      browserName: 'vscode',
      browserVersion: vscodeVersion,
      'wdio:vscodeOptions': {
        // Path to a VSCE-installed extension package. Re-built by
        // `apps/extension && npm run package` before the e2e run.
        extensionPath: VSIX,
        // Per-run user data dir keeps settings/extensions isolated
        // from the developer's personal VS Code / Cursor profile.
        userSettings: {
          'openbox.environment': 'staging',
          'openbox.mockAuth': true,
        },
        workspacePath: resolve(__dirname, 'fixtures-workspace'),
        ...(vscodeBinary ? { vscode: { binaryPath: vscodeBinary } } : {}),
        ...(headless ? { vscodeArgs: ['--no-sandbox'] } : {}),
      } as Record<string, unknown>,
    },
  ],

  services: ['vscode'],

  // Skip wdio's auto-install of webdriver binaries; the vscode service
  // handles its own driver lifecycle.
  automationProtocol: 'webdriver',

  outputDir: resolve(ROOT, 'tests/e2e-extension/.wdio-cache/logs'),
  logLevel: 'info',

  before: async () => {
    // Allow suites to import vitest-style `expect` if they want;
    // wdio's globals (`browser`, `$`, `$$`) are set by the runner.
  },
};
