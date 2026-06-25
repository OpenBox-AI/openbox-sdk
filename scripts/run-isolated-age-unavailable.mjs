#!/usr/bin/env node
// Run the AGE/LlamaFirewall-unavailable goal-alignment scenario against temporary Core processes.

import { runIsolatedCoreVitestScenario } from './lib/isolated-core-runner.mjs';

const port = process.env.OPENBOX_E2E_ISOLATED_CORE_PORT ?? '8116';
const unavailableGoalAlignmentUrl =
  process.env.OPENBOX_E2E_UNAVAILABLE_GOAL_ALIGNMENT_URL ??
  process.env.OPENBOX_E2E_UNAVAILABLE_AGE_URL ??
  'http://127.0.0.1:9';
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
    LLAMAFIREWALL_HOST: unavailableGoalAlignmentUrl,
    AGE_URL: unavailableGoalAlignmentUrl,
    AGE_HTTP_TIMEOUT_SEC: process.env.AGE_HTTP_TIMEOUT_SEC ?? '1',
  },
  statusLines: [
    `LLAMAFIREWALL_HOST=${unavailableGoalAlignmentUrl}`,
    `AGE_URL=${unavailableGoalAlignmentUrl}`,
  ],
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
