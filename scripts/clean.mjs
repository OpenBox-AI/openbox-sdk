#!/usr/bin/env node
// Remove build/package artifacts declared in the TypeSpec-emitted SDK target manifest.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const repoRoot = process.cwd();
const fixturePath = resolve(repoRoot, 'codegen/fixtures/sdk-targets.json');

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

function readCleanArtifacts() {
  if (!existsSync(fixturePath)) {
    throw new Error('Missing codegen/fixtures/sdk-targets.json. Run npm run generate:sdks before cleaning.');
  }

  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const cleanArtifacts = fixture.cleanArtifacts;
  assertRecord(cleanArtifacts, 'cleanArtifacts');
  assertStringArray(cleanArtifacts.paths, 'cleanArtifacts.paths');

  if (!Array.isArray(cleanArtifacts.nestedNames)) {
    throw new Error('cleanArtifacts.nestedNames must be an array');
  }
  for (const [index, entry] of cleanArtifacts.nestedNames.entries()) {
    assertRecord(entry, `cleanArtifacts.nestedNames[${index}]`);
    if (typeof entry.root !== 'string' || entry.root.length === 0) {
      throw new Error(`cleanArtifacts.nestedNames[${index}].root must be a non-empty string`);
    }
    assertStringArray(entry.names, `cleanArtifacts.nestedNames[${index}].names`);
  }

  if (!Array.isArray(cleanArtifacts.filePatterns)) {
    throw new Error('cleanArtifacts.filePatterns must be an array');
  }
  for (const [index, entry] of cleanArtifacts.filePatterns.entries()) {
    assertRecord(entry, `cleanArtifacts.filePatterns[${index}]`);
    for (const field of ['root', 'prefix', 'suffix']) {
      if (typeof entry[field] !== 'string' || entry[field].length === 0) {
        throw new Error(`cleanArtifacts.filePatterns[${index}].${field} must be a non-empty string`);
      }
    }
  }

  return cleanArtifacts;
}

function walkEntries(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    out.push(fullPath);
    if (statSync(fullPath).isDirectory()) walkEntries(fullPath, out);
  }
  return out;
}

function remove(relPath) {
  rmSync(resolve(repoRoot, relPath), { recursive: true, force: true });
}

function removeNestedNames(entry) {
  const root = resolve(repoRoot, entry.root);
  const names = new Set(entry.names);
  for (const fullPath of walkEntries(root)) {
    if (names.has(basename(fullPath))) {
      rmSync(fullPath, { recursive: true, force: true });
    }
  }
}

function removeFilePattern(pattern) {
  const root = resolve(repoRoot, pattern.root);
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith(pattern.prefix) || !entry.endsWith(pattern.suffix)) continue;
    const fullPath = join(root, entry);
    if (statSync(fullPath).isFile()) {
      rmSync(fullPath, { force: true });
    }
  }
}

const cleanArtifacts = readCleanArtifacts();

for (const path of cleanArtifacts.paths) remove(path);
for (const entry of cleanArtifacts.nestedNames) removeNestedNames(entry);
for (const pattern of cleanArtifacts.filePatterns) removeFilePattern(pattern);

const generated = spawnSync(process.execPath, ['scripts/clean-generated.mjs'], {
  cwd: repoRoot,
  stdio: 'inherit',
});
if (generated.status !== 0) process.exit(generated.status ?? 1);
