import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const repoRoot = process.cwd();
export const sdkTargetsFixturePath = resolve(repoRoot, 'codegen/fixtures/sdk-targets.json');

export function assertString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

export function assertStringArray(value, field) {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`${field} must be a string array`);
  }
}

export function assertRecord(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be a record`);
  }
}

export function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function readSdkTargetsFixture(missingMessage) {
  if (!existsSync(sdkTargetsFixturePath)) {
    throw new Error(
      missingMessage ??
        'Missing codegen/fixtures/sdk-targets.json. Run npm run generate:sdks before running this command.',
    );
  }
  const fixture = readJsonFile(sdkTargetsFixturePath);
  assertRecord(fixture, 'sdk-targets fixture');
  return fixture;
}

export function normalizeCommandSteps(rawSteps, field) {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw new Error(`${field} must be a non-empty array`);
  }

  return rawSteps.map((step, index) => {
    assertRecord(step, `${field}[${index}]`);
    for (const stepField of ['id', 'label', 'command', 'workingDirectory']) {
      assertString(step[stepField], `${field}[${index}].${stepField}`);
    }
    if (step.args !== undefined) {
      assertStringArray(step.args, `${field}[${index}].args`);
    }
    if (step.env !== undefined) {
      assertRecord(step.env, `${field}[${index}].env`);
      for (const [name, value] of Object.entries(step.env)) {
        assertString(name, `${field}[${index}].env key`);
        if (typeof value !== 'string') {
          throw new Error(`${field}[${index}].env.${name} must be a string`);
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

export function commandForPlatform(command) {
  if (process.platform !== 'win32') return command;
  if (command === 'npm' || command === 'npx') return `${command}.cmd`;
  return command;
}

export function runStep(step) {
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

export function runSteps(steps) {
  for (const step of steps) {
    runStep(step);
  }
}
