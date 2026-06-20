#!/usr/bin/env node
// Run the TypeSpec-declared SDK generation pipeline.

import { existsSync } from 'node:fs';
import {
  assertRecord,
  normalizeCommandSteps,
  readJsonFile,
  repoRoot,
  runSteps,
  sdkTargetsFixturePath,
} from './lib/spec-steps.mjs';

function bootstrapSteps() {
  return [
    {
      id: 'build-codegen',
      label: 'Codegen package build',
      command: 'npm',
      args: ['run', 'build:codegen'],
      cwd: repoRoot,
      env: {},
    },
    {
      id: 'specs-compile',
      label: 'TypeSpec contract compile',
      command: 'npm',
      args: ['run', 'specs:compile'],
      cwd: repoRoot,
      env: {},
    },
  ];
}

function readSdkGenerationSteps() {
  if (!existsSync(sdkTargetsFixturePath)) {
    process.stderr.write(
      'Using bootstrap SDK generation pipeline; generated SDK targets fixture was not found.\n',
    );
    return bootstrapSteps();
  }

  const fixture = readJsonFile(sdkTargetsFixturePath);
  assertRecord(fixture, 'sdk-targets fixture');
  if (fixture.sdkGeneration === undefined) {
    process.stderr.write(
      'Using bootstrap SDK generation pipeline; generated SDK targets fixture has no sdkGeneration section.\n',
    );
    return bootstrapSteps();
  }
  assertRecord(fixture.sdkGeneration, 'sdkGeneration');
  return normalizeCommandSteps(fixture.sdkGeneration.steps, 'sdkGeneration.steps');
}

runSteps(readSdkGenerationSteps());
