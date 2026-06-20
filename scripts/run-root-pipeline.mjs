#!/usr/bin/env node
// Run TypeSpec-declared root package pipelines.

import { existsSync } from 'node:fs';
import {
  assertRecord,
  assertString,
  normalizeCommandSteps,
  readJsonFile,
  repoRoot,
  runSteps,
  sdkTargetsFixturePath,
} from './lib/spec-steps.mjs';

const fallbackPipelines = new Map([
  [
    'build',
    [
      {
        id: 'generate-sdks',
        label: 'Generate SDK artifacts',
        command: 'npm',
        args: ['run', 'generate:sdks'],
        cwd: repoRoot,
        env: {},
      },
      {
        id: 'bundle-build',
        label: 'Bundle package',
        command: 'npm',
        args: ['run', 'build:bundle'],
        cwd: repoRoot,
        env: {},
      },
    ],
  ],
  [
    'check-sdks',
    [
      {
        id: 'generate-sdks',
        label: 'Generate SDK artifacts',
        command: 'npm',
        args: ['run', 'generate:sdks'],
        cwd: repoRoot,
        env: {},
      },
      {
        id: 'validate-targets',
        label: 'Validate SDK targets',
        command: 'node',
        args: ['scripts/check-sdks.mjs'],
        cwd: repoRoot,
        env: {},
      },
    ],
  ],
]);

function fallbackSteps(pipelineId, reason) {
  const steps = fallbackPipelines.get(pipelineId);
  if (!steps) {
    throw new Error(`Unknown root pipeline "${pipelineId}"`);
  }
  process.stderr.write(`Using bootstrap ${pipelineId} pipeline; ${reason}.\n`);
  return steps;
}

function readPipelineSteps(pipelineId) {
  if (!existsSync(sdkTargetsFixturePath)) {
    return fallbackSteps(pipelineId, 'generated SDK targets fixture was not found');
  }

  const fixture = readJsonFile(sdkTargetsFixturePath);
  assertRecord(fixture, 'sdk-targets fixture');
  if (fixture.rootPipelines === undefined) {
    return fallbackSteps(pipelineId, 'generated SDK targets fixture has no rootPipelines section');
  }
  assertRecord(fixture.rootPipelines, 'rootPipelines');
  const pipelines = fixture.rootPipelines.pipelines;
  if (!Array.isArray(pipelines)) {
    throw new Error('rootPipelines.pipelines must be an array');
  }

  const pipeline = pipelines.find((entry) => entry?.id === pipelineId);
  assertRecord(pipeline, `rootPipelines pipeline ${pipelineId}`);
  assertString(pipeline.label, `rootPipelines pipeline ${pipelineId}.label`);
  return normalizeCommandSteps(pipeline.steps, `rootPipelines.${pipelineId}.steps`);
}

const selected = process.argv.slice(2);
if (selected.length !== 1) {
  throw new Error('Usage: node scripts/run-root-pipeline.mjs <pipeline-id>');
}

runSteps(readPipelineSteps(selected[0]));
