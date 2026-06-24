#!/usr/bin/env -S node --experimental-strip-types
// Drift check for generated SDK artifacts.
//
// This validates the working tree state, not the commit state: it
// snapshots generated files, reruns generation, and fails only if the
// rerun changes those generated files. That keeps local patches with
// intentional generated diffs verifiable before they are staged or
// committed.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

interface NestedGeneratedFiles {
  root: string;
  suffixes: string[];
}

interface GeneratedArtifactsManifest {
  generatedRoots: string[];
  generatedFiles: string[];
  driftCheckFiles: string[];
  nestedGeneratedFiles: NestedGeneratedFiles[];
}

function readGeneratedArtifactsManifest(): GeneratedArtifactsManifest {
  const fixturePath = resolve(process.cwd(), 'codegen/fixtures/sdk-targets.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    generatedArtifacts?: Partial<GeneratedArtifactsManifest>;
  };
  const artifacts = fixture.generatedArtifacts;
  if (!artifacts) {
    throw new Error('sdk-targets fixture is missing generatedArtifacts');
  }

  const generatedRoots = artifacts.generatedRoots ?? [];
  const generatedFiles = artifacts.generatedFiles ?? [];
  const driftCheckFiles = artifacts.driftCheckFiles ?? [];
  const nestedGeneratedFiles = artifacts.nestedGeneratedFiles ?? [];
  if (!generatedRoots.every((entry) => typeof entry === 'string')) {
    throw new Error('generatedArtifacts.generatedRoots must be a string array');
  }
  if (!generatedFiles.every((entry) => typeof entry === 'string')) {
    throw new Error('generatedArtifacts.generatedFiles must be a string array');
  }
  if (!driftCheckFiles.every((entry) => typeof entry === 'string')) {
    throw new Error('generatedArtifacts.driftCheckFiles must be a string array');
  }
  for (const entry of nestedGeneratedFiles) {
    if (
      !entry ||
      typeof entry.root !== 'string' ||
      !Array.isArray(entry.suffixes) ||
      !entry.suffixes.every((suffix) => typeof suffix === 'string')
    ) {
      throw new Error('generatedArtifacts.nestedGeneratedFiles must contain { root, suffixes } records');
    }
  }
  return { generatedRoots, generatedFiles, driftCheckFiles, nestedGeneratedFiles };
}

const GENERATED_ARTIFACTS = readGeneratedArtifactsManifest();

function run(command: string, args: string[], stdio: 'pipe' | 'inherit' = 'inherit'): string {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf-8',
    stdio,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return typeof result.stdout === 'string' ? result.stdout : '';
}

function trackedAndUntrackedFiles(): string[] {
  const trackedRoots = [
    ...GENERATED_ARTIFACTS.generatedRoots,
    ...GENERATED_ARTIFACTS.nestedGeneratedFiles.map((entry) => entry.root),
  ];
  const out = run(
    'git',
    [
      'ls-files',
      '-co',
      '--exclude-standard',
      '--',
      ...trackedRoots,
      ...GENERATED_ARTIFACTS.generatedFiles,
      ...GENERATED_ARTIFACTS.driftCheckFiles,
    ],
    'pipe',
  );
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => {
      if (GENERATED_ARTIFACTS.generatedFiles.includes(file)) return true;
      if (GENERATED_ARTIFACTS.driftCheckFiles.includes(file)) return true;
      if (GENERATED_ARTIFACTS.generatedRoots.some((root) => file.startsWith(`${root}/`))) {
        return true;
      }
      return GENERATED_ARTIFACTS.nestedGeneratedFiles.some((entry) =>
        file.startsWith(`${entry.root}/`) &&
        file.includes('/generated/') &&
        entry.suffixes.some((suffix) => file.endsWith(suffix)),
      );
    })
    .sort();
}

function fileHash(file: string): string {
  if (!existsSync(file)) return '<missing>';
  const stat = statSync(file);
  if (!stat.isFile()) return '<not-file>';
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function snapshot(files: string[]): Map<string, string> {
  return new Map(files.map((file) => [file, fileHash(file)]));
}

const beforeFiles = trackedAndUntrackedFiles();
const before = snapshot(beforeFiles);

run('npm', ['run', 'generate:sdks']);

const afterFiles = trackedAndUntrackedFiles();
const allFiles = [...new Set([...beforeFiles, ...afterFiles])].sort();
const after = snapshot(allFiles);
const changed = allFiles.filter((file) => before.get(file) !== after.get(file));

if (changed.length > 0) {
  console.error('Generated files drift detected. Re-run npm run generate:sdks and keep the generated result.');
  for (const file of changed) {
    console.error(`  - ${relative(process.cwd(), file)}`);
  }
  process.exit(1);
}

console.log('OK: generated files are current');
