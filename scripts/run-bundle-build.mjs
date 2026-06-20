#!/usr/bin/env node
// Run the TypeSpec-declared bundle build pipeline.

import {
  assertRecord,
  normalizeCommandSteps,
  readSdkTargetsFixture,
  runSteps,
} from './lib/spec-steps.mjs';

function readBundleBuildSteps() {
  const fixture = readSdkTargetsFixture(
    'Missing codegen/fixtures/sdk-targets.json. Run npm run generate:sdks before bundle build.',
  );
  const bundleBuild = fixture.bundleBuild;
  assertRecord(bundleBuild, 'bundleBuild');
  return normalizeCommandSteps(bundleBuild.steps, 'bundleBuild.steps');
}

runSteps(readBundleBuildSteps());
