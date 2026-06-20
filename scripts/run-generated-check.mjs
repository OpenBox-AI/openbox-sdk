#!/usr/bin/env node
// Run TypeSpec-declared generated-artifact checks.

import {
  assertRecord,
  normalizeCommandSteps,
  readSdkTargetsFixture,
  runSteps,
} from './lib/spec-steps.mjs';

function readGeneratedChecks() {
  const fixture = readSdkTargetsFixture(
    'Missing codegen/fixtures/sdk-targets.json. Run npm run generate:sdks before generated checks.',
  );
  const generatedChecks = fixture.generatedChecks;
  assertRecord(generatedChecks, 'generatedChecks');
  return normalizeCommandSteps(generatedChecks.commands, 'generatedChecks.commands');
}

const selected = process.argv.slice(2);
if (selected.length !== 1) {
  throw new Error('Usage: node scripts/run-generated-check.mjs <check-id>');
}

const checks = readGeneratedChecks();
const check = checks.find((entry) => entry.id === selected[0]);
if (!check) {
  throw new Error(
    `Unknown generated check "${selected[0]}". Known checks: ${checks.map((entry) => entry.id).join(', ')}`,
  );
}

runSteps([check]);
