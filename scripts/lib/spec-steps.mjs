import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const repoRoot = process.cwd();
export const sdkTargetsFixturePath = resolve(repoRoot, 'codegen/fixtures/sdk-targets.json');
const rootE2eRunId = normalizeRunIdPart(process.env.OPENBOX_E2E_RUN_ID)
  ?? `run-${Date.now().toString(36)}-${process.pid}-${randomUUID().slice(0, 8)}`;

function normalizeRunIdPart(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized.slice(0, 120) : undefined;
}

function commandRunIdSuffix(step) {
  const fromPath = Array.isArray(step.runIdPath) ? step.runIdPath : [step.id];
  return fromPath.map((part) => normalizeRunIdPart(part) ?? 'step').join('.');
}

export function envForStep(step) {
  return {
    ...process.env,
    ...step.env,
    OPENBOX_E2E_RUN_ID: `${rootE2eRunId}.${commandRunIdSuffix(step)}`,
  };
}

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

export function normalizeCommandSteps(rawSteps, field, runIdPath = []) {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw new Error(`${field} must be a non-empty array`);
  }

  return rawSteps.map((step, index) => {
    assertRecord(step, `${field}[${index}]`);
    if (step.steps !== undefined) {
      for (const stepField of ['id', 'label']) {
        assertString(step[stepField], `${field}[${index}].${stepField}`);
      }
      if (step.parallel !== true) {
        throw new Error(`${field}[${index}].parallel must be true for grouped steps`);
      }
      return {
        type: 'group',
        id: step.id,
        label: step.label,
        parallel: true,
        steps: normalizeCommandSteps(step.steps, `${field}[${index}].steps`, [...runIdPath, step.id]),
      };
    }
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
      type: 'command',
      id: step.id,
      label: step.label,
      command: step.command,
      args: step.args ?? [],
      cwd: resolve(repoRoot, step.workingDirectory),
      env: step.env ?? {},
      runIdPath: [...runIdPath, step.id],
    };
  });
}

export function flattenCommandSteps(steps) {
  const out = [];
  for (const step of steps) {
    out.push(step);
    if (step.type === 'group') out.push(...flattenCommandSteps(step.steps));
  }
  return out;
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
    env: envForStep(step),
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

function writePrefixed(stream, prefix, target) {
  let pending = '';
  stream.on('data', (chunk) => {
    pending += String(chunk);
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      target.write(`${prefix}${line}\n`);
    }
  });
  stream.on('end', () => {
    if (pending.length > 0) target.write(`${prefix}${pending}\n`);
  });
}

function runParallelCommandStep(step, activeChildren) {
  return new Promise((resolveRun) => {
    process.stderr.write(`\n==> ${step.label}\n`);
    const child = spawn(commandForPlatform(step.command), step.args, {
      cwd: step.cwd,
      env: envForStep(step),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeChildren.add(child);
    const prefix = `[${step.id}] `;

    child.once('error', (error) => {
      activeChildren.delete(child);
      if (error?.code === 'ENOENT') {
        process.stderr.write(`${step.command} is required for ${step.label} but was not found on PATH\n`);
      } else {
        process.stderr.write(`${step.label} failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
      }
      resolveRun(1);
    });
    writePrefixed(child.stdout, prefix, process.stdout);
    writePrefixed(child.stderr, prefix, process.stderr);
    child.once('exit', (code, signal) => {
      activeChildren.delete(child);
      if (signal) resolveRun(1);
      else resolveRun(code ?? 1);
    });
  });
}

async function runParallelGroup(group) {
  process.stderr.write(`\n==> ${group.label}\n`);
  const activeChildren = new Set();
  const stopChildren = () => {
    for (const child of activeChildren) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    }
  };
  process.once('SIGINT', stopChildren);
  process.once('SIGTERM', stopChildren);
  try {
    const statuses = await Promise.all(
      group.steps.map((step) => {
        if (step.type === 'group') return runPipelineStep(step);
        return runParallelCommandStep(step, activeChildren);
      }),
    );
    const failed = statuses.find((status) => status !== 0);
    if (failed !== undefined) process.exit(failed);
  } finally {
    process.removeListener('SIGINT', stopChildren);
    process.removeListener('SIGTERM', stopChildren);
  }
}

async function runPipelineStep(step) {
  if (step.type === 'group') {
    await runParallelGroup(step);
    return 0;
  }
  runStep(step);
  return 0;
}

export async function runSteps(steps) {
  for (const step of steps) {
    await runPipelineStep(step);
  }
}
