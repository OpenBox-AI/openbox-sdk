#!/usr/bin/env node
// Build TypeSpec libraries and emitters from the TypeSpec-declared codegen pipeline.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  assertRecord,
  assertStringArray,
  normalizeCommandSteps,
  readJsonFile,
  repoRoot,
  runSteps,
  sdkTargetsFixturePath,
} from './lib/spec-steps.mjs';

function readPackageJson(path) {
  return readJsonFile(path);
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
  const workspacePackages = workspaceDirs.map((directory) => ({
    directory,
    packageJson: readPackageJson(resolve(repoRoot, directory, 'package.json')),
  }));
  const packageNames = new Set(workspacePackages.map((pkg) => pkg.packageJson.name));
  const packages = workspacePackages
    .map(({ directory, packageJson }) => {
      const dependencies = {
        ...(packageJson.dependencies ?? {}),
        ...(packageJson.devDependencies ?? {}),
      };
      return {
        directory,
        name: packageJson.name,
        hasBuild: typeof packageJson.scripts?.build === 'string',
        internalDependencies: Object.keys(dependencies).filter((name) => packageNames.has(name)),
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
  if (!existsSync(sdkTargetsFixturePath)) {
    return deriveBootstrapSteps();
  }

  const fixture = readJsonFile(sdkTargetsFixturePath);
  assertRecord(fixture, 'sdk-targets fixture');
  if (fixture.codegenBuild === undefined) {
    return deriveBootstrapSteps();
  }
  assertRecord(fixture.codegenBuild, 'codegenBuild');
  return normalizeCommandSteps(fixture.codegenBuild.steps, 'codegenBuild.steps');
}

runSteps(readCodegenBuildSteps());
