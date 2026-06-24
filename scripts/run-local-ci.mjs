#!/usr/bin/env node
// Run the TypeSpec-declared local CI pipeline.

import {
  assertRecord,
  normalizeCommandSteps,
  readSdkTargetsFixture,
  runSteps,
} from './lib/spec-steps.mjs';

function readLocalCiSteps() {
  const fixture = readSdkTargetsFixture(
    'Missing codegen/fixtures/sdk-targets.json. Run npm run generate:sdks before local CI.',
  );
  const localCi = fixture.localCi;
  assertRecord(localCi, 'localCi');
  return normalizeCommandSteps(localCi.steps, 'localCi.steps');
}

await runSteps(readLocalCiSteps());
