#!/usr/bin/env node
// Build TypeSpec libraries and emitters from the TypeSpec-declared codegen pipeline.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

function normalizeSteps(rawSteps, field) {
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

function readPackageJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function expandWorkspacePattern(pattern) {
  if (!pattern.startsWith('codegen/')) return [];
  if (!pattern.endsWith('/*')) {
    return existsSync(resolve(repoRoot, pattern)) ? [pattern] : [];
  }

  const parent = pattern.slice(0, -2);
  const parentPath = resolve(repoRoot, parent);
  if (!existsSync(parentPath)) return [];
  return readdirSync(parentPath)
    .map((entry) => join(parent, entry))
    .filter((entry) => {
      const fullPath = resolve(repoRoot, entry);
      return statSync(fullPath).isDirectory() && existsSync(resolve(fullPath, 'package.json'));
    });
}

function topologicalCodegenPackages(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const remaining = new Map(byName);
  const sorted = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((pkg) => pkg.internalDependencies.every((name) => !remaining.has(name)))
      .sort((left, right) => left.directory.localeCompare(right.directory));
    if (ready.length === 0) {
      throw new Error(
        `Unable to derive codegen build order; cyclic dependencies among ${[...remaining.keys()].join(', ')}`,
      );
    }
    for (const pkg of ready) {
      remaining.delete(pkg.name);
      sorted.push(pkg);
    }
  }

  return sorted;
}

function deriveBootstrapSteps() {
  const rootPackage = readPackageJson(resolve(repoRoot, 'package.json'));
  const workspaces = Array.isArray(rootPackage.workspaces)
    ? rootPackage.workspaces
    : rootPackage.workspaces?.packages;
  assertStringArray(workspaces, 'package.json workspaces');

  const workspaceDirs = [...new Set(workspaces.flatMap(expandWorkspacePattern))].sort();
  const packages = workspaceDirs
    .map((directory) => {
      const packageJson = readPackageJson(resolve(repoRoot, directory, 'package.json'));
      const dependencies = {
        ...(packageJson.dependencies ?? {}),
        ...(packageJson.devDependencies ?? {}),
      };
      return {
        directory,
        name: packageJson.name,
        hasBuild: typeof packageJson.scripts?.build === 'string',
        internalDependencies: Object.keys(dependencies).filter((name) =>
          workspaceDirs.some((entry) => {
            const entryPackage = readPackageJson(resolve(repoRoot, entry, 'package.json'));
            return entryPackage.name === name;
          }),
        ),
      };
    })
    .filter((pkg) => pkg.hasBuild);

  if (packages.length === 0) {
    throw new Error('Unable to derive codegen build steps from package.json workspaces');
  }

  process.stderr.write(
    'Using package-metadata bootstrap for codegen build; regenerate SDK targets to restore the TypeSpec-emitted pipeline.\n',
  );
  return topologicalCodegenPackages(packages).map((pkg) => ({
    id: pkg.name,
    label: `${pkg.name} package`,
    command: 'npm',
    args: ['run', 'build', '-w', pkg.name],
    cwd: repoRoot,
    env: {},
  }));
}

function readCodegenBuildSteps() {
  if (!existsSync(fixturePath)) {
    return deriveBootstrapSteps();
  }

  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  assertRecord(fixture, 'sdk-targets fixture');
  if (fixture.codegenBuild === undefined) {
    return deriveBootstrapSteps();
  }
  assertRecord(fixture.codegenBuild, 'codegenBuild');
  return normalizeSteps(fixture.codegenBuild.steps, 'codegenBuild.steps');
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

for (const step of readCodegenBuildSteps()) {
  runStep(step);
}
