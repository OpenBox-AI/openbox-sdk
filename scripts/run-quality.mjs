#!/usr/bin/env node
// Run TypeSpec-declared quality commands.

import {
  assertRecord,
  normalizeCommandSteps,
  readSdkTargetsFixture,
  runSteps,
} from './lib/spec-steps.mjs';

function readQualityCommands() {
  const fixture = readSdkTargetsFixture(
    'Missing codegen/fixtures/sdk-targets.json. Run npm run generate:sdks before quality commands.',
  );
  const qualityCommands = fixture.qualityCommands;
  assertRecord(qualityCommands, 'qualityCommands');
  return normalizeCommandSteps(qualityCommands.commands, 'qualityCommands.commands');
}

const selected = process.argv.slice(2);
if (selected.length !== 1) {
  throw new Error('Usage: node scripts/run-quality.mjs <command-id>');
}

const commands = readQualityCommands();
const command = commands.find((entry) => entry.id === selected[0]);
if (!command) {
  throw new Error(
    `Unknown quality command "${selected[0]}". Known commands: ${commands.map((entry) => entry.id).join(', ')}`,
  );
}

runSteps([command]);
