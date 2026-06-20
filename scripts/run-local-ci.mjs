#!/usr/bin/env node
// Run the TypeSpec-declared local CI pipeline.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const fixturePath = resolve(repoRoot, 'codegen/fixtures/sdk-targets.json');

function assertString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function assertStringArray(value, field) {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`${field} must be a string array`);
  }
}

function assertRecord(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be a record`);
  }
}

function readLocalCiSteps() {
  if (!existsSync(fixturePath)) {
    throw new Error('Missing codegen/fixtures/sdk-targets.json. Run npm run generate:sdks before local CI.');
  }

  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  assertRecord(fixture, 'sdk-targets fixture');
  const localCi = fixture.localCi;
  assertRecord(localCi, 'localCi');
  if (!Array.isArray(localCi.steps) || localCi.steps.length === 0) {
    throw new Error('localCi.steps must be a non-empty array');
  }

  return localCi.steps.map((step, index) => {
    assertRecord(step, `localCi.steps[${index}]`);
    for (const field of ['id', 'label', 'command', 'workingDirectory']) {
      assertString(step[field], `localCi.steps[${index}].${field}`);
    }
    if (step.args !== undefined) {
      assertStringArray(step.args, `localCi.steps[${index}].args`);
    }
    if (step.env !== undefined) {
      assertRecord(step.env, `localCi.steps[${index}].env`);
      for (const [name, value] of Object.entries(step.env)) {
        assertString(name, `localCi.steps[${index}].env key`);
        if (typeof value !== 'string') {
          throw new Error(`localCi.steps[${index}].env.${name} must be a string`);
        }
      }
    }
    return {
      id: step.id,
      label: step.label,
      command: step.command,
      args: step.args ?? [],
      cwd: resolve(repoRoot, step.workingDirectory),
      env: step.env ?? {},
    };
  });
}

function commandForPlatform(command) {
  if (process.platform !== 'win32') return command;
  if (command === 'npm' || command === 'npx') return `${command}.cmd`;
  return command;
}

function runStep(step) {
  process.stderr.write(`\n==> ${step.label}\n`);
  const result = spawnSync(commandForPlatform(step.command), step.args, {
    cwd: step.cwd,
    env: { ...process.env, ...step.env },
    stdio: 'inherit',
  });
  if (result.error?.code === 'ENOENT') {
    process.stderr.write(`${step.command} is required for ${step.label} but was not found on PATH\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

for (const step of readLocalCiSteps()) {
  runStep(step);
}
