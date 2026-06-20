#!/usr/bin/env node
// Run TypeSpec-declared root test suites.

import {
  assertRecord,
  assertStringArray,
  normalizeCommandSteps,
  readSdkTargetsFixture,
  runSteps,
} from './lib/spec-steps.mjs';

function readTestSuites() {
  const fixture = readSdkTargetsFixture(
    'Missing codegen/fixtures/sdk-targets.json. Run npm run generate:sdks before running tests.',
  );
  const testSuites = fixture.testSuites;
  assertRecord(testSuites, 'testSuites');
  assertStringArray(testSuites.defaultSuites, 'testSuites.defaultSuites');
  const suites = normalizeCommandSteps(testSuites.suites, 'testSuites.suites');
  const byId = new Map(suites.map((suite) => [suite.id, suite]));
  return { defaultSuites: testSuites.defaultSuites, byId };
}

function selectedSuiteIds(defaultSuites) {
  const selected = process.argv.slice(2);
  if (selected.length === 0) return defaultSuites;
  if (selected.length === 1) return selected;
  throw new Error('Usage: node scripts/run-tests.mjs [suite-id]');
}

const { defaultSuites, byId } = readTestSuites();
const steps = selectedSuiteIds(defaultSuites).map((suiteId) => {
  const suite = byId.get(suiteId);
  if (!suite) {
    throw new Error(`Unknown test suite "${suiteId}". Known suites: ${[...byId.keys()].join(', ')}`);
  }
  return suite;
});

runSteps(steps);
