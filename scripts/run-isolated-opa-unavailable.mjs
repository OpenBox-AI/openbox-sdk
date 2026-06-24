#!/usr/bin/env node
// Run the opa-unavailable-fail-closed scenario against temporary Core processes.

import { runIsolatedCoreVitestScenario } from './lib/isolated-core-runner.mjs';

const port = process.env.OPENBOX_E2E_ISOLATED_OPA_CORE_PORT ?? '8117';
const unavailableOpaUrl =
  process.env.OPENBOX_E2E_UNAVAILABLE_OPA_URL ?? 'http://127.0.0.1:9';
const taskQueue =
  process.env.OPENBOX_E2E_ISOLATED_OPA_TASK_QUEUE ??
  `openbox-opa-unavailable-${Date.now()}`;
const workflowPrefix =
  process.env.OPENBOX_E2E_ISOLATED_OPA_WORKFLOW_PREFIX ??
  `opa-unavailable-${Date.now()}`;

runIsolatedCoreVitestScenario({
  scenarioName: 'npm run test:e2e:opa-unavailable',
  port,
  taskQueue,
  workflowPrefix,
  coreEnv: {
    OPA_URL: unavailableOpaUrl,
  },
  statusLines: [`OPA_URL=${unavailableOpaUrl}`],
  vitestArgs: [
    'vitest',
    'run',
    '--project',
    'e2e',
    'tests/e2e/core-governance.test.ts',
    '-t',
    'OPA is unavailable',
  ],
  vitestEnv: {
    OPENBOX_E2E_ISOLATED_OPA_UNAVAILABLE: '1',
  },
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
