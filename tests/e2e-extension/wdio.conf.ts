// WebdriverIO + wdio-vscode-service config for the OpenBox extension.
//
// Run: `npm run test:e2e-extension`
// Needs a graphical session (downloads + launches VS Code).
//
// Knobs:
//   OPENBOX_E2E_VSCODE_VERSION — VS Code version (default: stable)
//   OPENBOX_E2E_HEADLESS=1     — pass `--no-sandbox`; rely on the
//                                caller's Xvfb when running CI.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
// extensionPath points at the extension's package.json directory;
// the service hands the dir to VS Code's --extensionDevelopmentPath
// (so the dist bundle inside is loaded directly).
const EXTENSION_DIR = resolve(ROOT, 'apps/extension');

const vscodeVersion = process.env.OPENBOX_E2E_VSCODE_VERSION ?? 'stable';
const headless = process.env.OPENBOX_E2E_HEADLESS === '1';

export const config = {
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
        extensionPath: EXTENSION_DIR,
        userSettings: {
          'openbox.environment': 'staging',
          'openbox.mockAuth': true,
        },
        workspacePath: resolve(HERE, 'fixtures-workspace'),
        ...(headless ? { vscodeArgs: ['--no-sandbox'] } : {}),
      },
    },
  ],

  services: ['vscode'],
  outputDir: resolve(ROOT, 'tests/e2e-extension/.wdio-cache/logs'),
  logLevel: 'info',
} as const;
