#!/usr/bin/env node
// Run TypeSpec-declared local-stack proof lanes by lane id.

import {
  assertRecord,
  assertString,
  flattenCommandSteps,
  normalizeCommandSteps,
  readSdkTargetsFixture,
  rootE2eRunId,
  runSteps,
} from './lib/spec-steps.mjs';

const defaultSharedAgentName = `e2e-agent-${rootE2eRunId}`.slice(0, 120);

function readLaneManifest() {
  const fixture = readSdkTargetsFixture(
    'Missing codegen/fixtures/sdk-targets.json. Run npm run generate:sdks before running local-stack lanes.',
  );
  assertRecord(fixture.localStackProofLanes, 'localStackProofLanes');
  if (!Array.isArray(fixture.localStackProofLanes.lanes)) {
    throw new Error('localStackProofLanes.lanes must be an array');
  }
  assertRecord(fixture.testSuites, 'testSuites');
  const suites = normalizeCommandSteps(fixture.testSuites.suites, 'testSuites.suites');
  const suiteById = new Map(flattenCommandSteps(suites).map((suite) => [suite.id, suite]));
  const lanes = fixture.localStackProofLanes.lanes.map((lane, index) => {
    assertRecord(lane, `localStackProofLanes.lanes[${index}]`);
    for (const field of ['id', 'label', 'suiteId']) {
      assertString(lane[field], `localStackProofLanes.lanes[${index}].${field}`);
    }
    const suite = suiteById.get(lane.suiteId);
    if (!suite) {
      throw new Error(`local-stack proof lane ${lane.id} references unknown suite ${lane.suiteId}`);
    }
    return { ...lane, suite };
  });
  return lanes;
}

function laneStep(lane) {
  return attachLaneEnv(lane.suite, lane.id);
}

function attachLaneEnv(step, laneId) {
  if (step.type === 'group') {
    return {
      ...step,
      steps: step.steps.map((child) => attachLaneEnv(child, laneId)),
    };
  }
  return {
    ...step,
    env: {
      ...step.env,
      OPENBOX_LOCAL_STACK_PROOF_LANE: laneId,
      OPENBOX_E2E_SHARED_AGENT: step.env?.OPENBOX_E2E_SHARED_AGENT ?? '1',
      OPENBOX_E2E_SHARED_AGENT_NAME: step.env?.OPENBOX_E2E_SHARED_AGENT_NAME
        ?? process.env.OPENBOX_E2E_SHARED_AGENT_NAME
        ?? defaultSharedAgentName,
    },
  };
}

function usage(lanes) {
  const laneList = lanes
    .map((lane) => `  ${lane.id} - ${lane.label}`)
    .join('\n');
  return [
    'Usage: node scripts/run-local-stack-lane.mjs [--list] <lane-id> [lane-id...]',
    '',
    'Known lanes:',
    laneList,
    '',
  ].join('\n');
}

const lanes = readLaneManifest();
const args = process.argv.slice(2);
if (args.includes('--list')) {
  process.stdout.write(`${usage(lanes)}\n`);
  process.exit(0);
}
if (args.length === 0) {
  process.stderr.write(`${usage(lanes)}\n`);
  process.exit(1);
}

const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
const selected = args.map((id) => {
  const lane = laneById.get(id);
  if (!lane) {
    throw new Error(`Unknown local-stack proof lane "${id}". Use --list to inspect lanes.`);
  }
  return laneStep(lane);
});

await runSteps(selected.length > 1
  ? [{
      type: 'group',
      id: 'selected-local-stack-proof-lanes',
      label: 'Selected local-stack proof lanes',
      parallel: true,
      steps: selected,
    }]
  : selected);
