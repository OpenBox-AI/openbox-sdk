#!/usr/bin/env node
// Sync root package scripts from the TypeSpec-emitted SDK target manifest.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const fixturePath = resolve(repoRoot, 'codegen/fixtures/sdk-targets.json');
const packagePath = resolve(repoRoot, 'package.json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const fixture = readJson(fixturePath);
const scripts = fixture.packageScripts?.scripts;
if (!Array.isArray(scripts)) {
  throw new Error('sdk-targets fixture is missing packageScripts.scripts');
}

const nextScripts = {};
for (const [index, script] of scripts.entries()) {
  if (!script || typeof script.name !== 'string' || typeof script.command !== 'string') {
    throw new Error(`packageScripts.scripts[${index}] must include name and command`);
  }
  nextScripts[script.name] = script.command;
}

const packageJson = readJson(packagePath);
packageJson.scripts = nextScripts;
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
