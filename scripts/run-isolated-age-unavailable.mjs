#!/usr/bin/env node
// Run the AGE-unavailable goal-drift scenario against temporary Core processes.

import { runIsolatedCoreVitestScenario } from './lib/isolated-core-runner.mjs';

const port = process.env.OPENBOX_E2E_ISOLATED_CORE_PORT ?? '8116';
const unavailableAgeUrl =
  process.env.OPENBOX_E2E_UNAVAILABLE_AGE_URL ?? 'http://127.0.0.1:9';
const taskQueue =
  process.env.OPENBOX_E2E_ISOLATED_AGE_TASK_QUEUE ??
  `openbox-age-unavailable-${Date.now()}`;
const workflowPrefix =
  process.env.OPENBOX_E2E_ISOLATED_AGE_WORKFLOW_PREFIX ??
  `age-unavailable-${Date.now()}`;

runIsolatedCoreVitestScenario({
  scenarioName: 'npm run test:e2e:age-unavailable',
  port,
  taskQueue,
  workflowPrefix,
  coreEnv: {
    AGE_URL: unavailableAgeUrl,
    AGE_HTTP_TIMEOUT_SEC: process.env.AGE_HTTP_TIMEOUT_SEC ?? '1',
  },
  statusLines: [`AGE_URL=${unavailableAgeUrl}`],
  vitestArgs: [
    'vitest',
    'run',
    '--project',
    'e2e',
    'tests/e2e/core-governance.test.ts',
    '-t',
    'AGE unavailable',
  ],
  vitestEnv: {
    OPENBOX_E2E_ISOLATED_AGE_UNAVAILABLE: '1',
  },
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
