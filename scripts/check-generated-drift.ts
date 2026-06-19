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
import { relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const GENERATED_ROOTS = ['specs/generated', 'python/openbox_sdk/generated'];

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
  const out = run(
    'git',
    ['ls-files', '-co', '--exclude-standard', '--', 'ts/src', 'specs/generated', 'python/openbox_sdk/generated'],
    'pipe',
  );
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => {
      if (GENERATED_ROOTS.some((root) => file.startsWith(`${root}/`))) return true;
      return file.startsWith('ts/src/') && file.includes('/generated/');
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

run('npm', ['run', 'specs:compile']);
run('npm', ['run', 'generate:types']);

const afterFiles = trackedAndUntrackedFiles();
const allFiles = [...new Set([...beforeFiles, ...afterFiles])].sort();
const after = snapshot(allFiles);
const changed = allFiles.filter((file) => before.get(file) !== after.get(file));

if (changed.length > 0) {
  console.error('Generated files drift detected. Re-run npm run specs:all and keep the generated result.');
  for (const file of changed) {
    console.error(`  - ${relative(process.cwd(), file)}`);
  }
  process.exit(1);
}

console.log('OK: generated files are current');
