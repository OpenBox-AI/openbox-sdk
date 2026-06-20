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

function assertRecord(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
}

function readJson(relPath, label) {
  const file = resolve(repoRoot, relPath);
  if (!existsSync(file)) {
    throw new Error(`${label} does not exist: ${relPath}`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

function assertString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function assertSameStringArray(actual, expected, field) {
  assertStringArray(actual, `${field} package value`);
  assertStringArray(expected, `${field} TypeSpec value`);
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${field} does not match TypeSpec manifest. package=${actualJson} spec=${expectedJson}`);
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

function validateExtensionManifest(target) {
  if (target.extensionManifest === undefined) return;
  if (target.kind !== 'app') {
    throw new Error(`${target.id}.extensionManifest is only valid for app targets`);
  }

  const manifest = target.extensionManifest;
  assertRecord(manifest, `${target.id}.extensionManifest`);
  for (const field of ['packageName', 'publisher', 'displayName', 'main']) {
    assertString(manifest[field], `${target.id}.extensionManifest.${field}`);
  }
  for (const field of ['activationEvents', 'views', 'commands', 'configurationKeys']) {
    assertStringArray(manifest[field], `${target.id}.extensionManifest.${field}`);
  }

  const packageJson = readJson(
    `${target.workingDirectory ?? '.'}/package.json`,
    `${target.id} package manifest`,
  );
  assertRecord(packageJson, `${target.id} package manifest`);
  assertRecord(packageJson.contributes, `${target.id}.package.contributes`);
  assertRecord(packageJson.contributes.views, `${target.id}.package.contributes.views`);
  assertRecord(
    packageJson.contributes.configuration,
    `${target.id}.package.contributes.configuration`,
  );
  assertRecord(
    packageJson.contributes.configuration.properties,
    `${target.id}.package.contributes.configuration.properties`,
  );

  const contributedViews = Object.values(packageJson.contributes.views)
    .flat()
    .map((view) => view?.id);
  const contributedCommands = packageJson.contributes.commands?.map((command) => command?.command);
  const configurationKeys = Object.keys(packageJson.contributes.configuration.properties);

  if (packageJson.name !== manifest.packageName) {
    throw new Error(`${target.id}.package.name does not match TypeSpec manifest`);
  }
  if (packageJson.publisher !== manifest.publisher) {
    throw new Error(`${target.id}.package.publisher does not match TypeSpec manifest`);
  }
  if (packageJson.displayName !== manifest.displayName) {
    throw new Error(`${target.id}.package.displayName does not match TypeSpec manifest`);
  }
  if (packageJson.main !== manifest.main) {
    throw new Error(`${target.id}.package.main does not match TypeSpec manifest`);
  }
  assertSameStringArray(packageJson.activationEvents, manifest.activationEvents, `${target.id}.activationEvents`);
  assertSameStringArray(contributedViews, manifest.views, `${target.id}.views`);
  assertSameStringArray(contributedCommands, manifest.commands, `${target.id}.commands`);
  assertSameStringArray(configurationKeys, manifest.configurationKeys, `${target.id}.configurationKeys`);
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
  validateExtensionManifest(target);
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
