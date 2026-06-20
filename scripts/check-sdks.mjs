#!/usr/bin/env node
// Generic target-native validation runner.
//
// The command list comes from TypeSpec via codegen/fixtures/sdk-targets.json,
// keeping root package scripts target-neutral as new SDK and app targets are
// added.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const fixturePath = resolve(repoRoot, 'codegen/fixtures/sdk-targets.json');

function readFixture() {
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('sdk-targets fixture must be a JSON object');
  }
  if (!Array.isArray(raw.targets) || raw.targets.length === 0) {
    throw new Error('sdk-targets fixture must contain a non-empty targets array');
  }
  return raw;
}

function assertStringArray(value, field) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${field} must be a string array`);
  }
}

function validateCommand(target, command, index) {
  if (typeof command.command !== 'string' || command.command.length === 0) {
    throw new Error(`${target.id}.commands[${index}].command must be a non-empty string`);
  }
  if (command.args !== undefined) assertStringArray(command.args, `${target.id}.${command.command}.args`);
  if (command.env !== undefined) {
    if (!command.env || typeof command.env !== 'object' || Array.isArray(command.env)) {
      throw new Error(`${target.id}.${command.command}.env must be an object`);
    }
    for (const [name, value] of Object.entries(command.env)) {
      if (typeof value !== 'string') {
        throw new Error(`${target.id}.${command.command}.env.${name} must be a string`);
      }
    }
  }
}

function validateTarget(target) {
  if (typeof target.id !== 'string' || target.id.length === 0) {
    throw new Error('target id must be a non-empty string');
  }
  if (target.kind !== undefined && !['sdk', 'app'].includes(target.kind)) {
    throw new Error(`${target.id}.kind must be "sdk" or "app"`);
  }
  if (!Array.isArray(target.commands) || target.commands.length === 0) {
    throw new Error(`${target.id}.commands must be a non-empty array`);
  }
  for (const [index, command] of target.commands.entries()) {
    validateCommand(target, command, index);
  }
}

function commandForPlatform(command) {
  if (process.platform !== 'win32') return command;
  if (command === 'npm' || command === 'npx') return `${command}.cmd`;
  return command;
}

function runTargetCommand(target, command) {
  const cwd = resolve(repoRoot, target.workingDirectory ?? '.');
  if (!existsSync(cwd)) {
    throw new Error(`${target.id} workingDirectory does not exist: ${target.workingDirectory ?? '.'}`);
  }

  const args = command.args ?? [];
  console.log(`\n[${target.id}] ${command.command} ${args.join(' ')}`.trimEnd());
  const result = spawnSync(commandForPlatform(command.command), args, {
    cwd,
    env: { ...process.env, ...(command.env ?? {}) },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

try {
  const fixture = readFixture();
  for (const target of fixture.targets) {
    validateTarget(target);
    console.log(`\n==> ${target.label ?? target.id}`);
    for (const command of target.commands) {
      runTargetCommand(target, command);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
