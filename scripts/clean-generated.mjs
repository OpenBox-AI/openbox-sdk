#!/usr/bin/env node
// Remove generated artifacts listed in the TypeSpec-emitted SDK target manifest.

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const repoRoot = process.cwd();
const fixturePath = resolve(repoRoot, 'codegen/fixtures/sdk-targets.json');

function assertStringArray(value, field) {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`${field} must be a string array`);
  }
}

function readGeneratedArtifacts() {
  if (!existsSync(fixturePath)) {
    throw new Error(
      'Missing codegen/fixtures/sdk-targets.json. Run npm run generate:sdks before cleaning generated artifacts.',
    );
  }

  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const artifacts = fixture.generatedArtifacts;
  if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
    throw new Error('sdk-targets fixture is missing generatedArtifacts');
  }

  const generatedRoots = artifacts.generatedRoots ?? [];
  const generatedFiles = artifacts.generatedFiles ?? [];
  const nestedGeneratedFiles = artifacts.nestedGeneratedFiles ?? [];
  assertStringArray(generatedRoots, 'generatedArtifacts.generatedRoots');
  assertStringArray(generatedFiles, 'generatedArtifacts.generatedFiles');
  if (!Array.isArray(nestedGeneratedFiles)) {
    throw new Error('generatedArtifacts.nestedGeneratedFiles must be an array');
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
  return { generatedRoots, generatedFiles, nestedGeneratedFiles };
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) walkFiles(fullPath, out);
    else out.push(fullPath);
  }
  return out;
}

function isNestedGeneratedFile(file, suffixes) {
  return file.split(sep).includes('generated') && suffixes.some((suffix) => file.endsWith(suffix));
}

const artifacts = readGeneratedArtifacts();

for (const root of artifacts.generatedRoots) {
  rmSync(resolve(repoRoot, root), { recursive: true, force: true });
}

for (const file of artifacts.generatedFiles) {
  rmSync(resolve(repoRoot, file), { force: true });
}

for (const entry of artifacts.nestedGeneratedFiles) {
  for (const file of walkFiles(resolve(repoRoot, entry.root))) {
    if (isNestedGeneratedFile(file, entry.suffixes)) {
      rmSync(file, { force: true });
    }
  }
}
