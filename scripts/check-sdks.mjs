#!/usr/bin/env node
// Generic target-native validation runner.
//
// The command list comes from TypeSpec via codegen/fixtures/sdk-targets.json,
// keeping root package scripts target-neutral as new SDK and app targets are
// added.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertRecord,
  assertString,
  assertStringArray,
  readJsonFile,
  readSdkTargetsFixture,
  repoRoot,
  runStep,
} from './lib/spec-steps.mjs';

function readFixture() {
  const raw = readSdkTargetsFixture(
    'Missing codegen/fixtures/sdk-targets.json. Run npm run generate:sdks before target validation.',
  );
  if (!Array.isArray(raw.targets) || raw.targets.length === 0) {
    throw new Error('sdk-targets fixture must contain a non-empty targets array');
  }
  return raw;
}

function readJson(relPath, label) {
  const file = resolve(repoRoot, relPath);
  if (!existsSync(file)) {
    throw new Error(`${label} does not exist: ${relPath}`);
  }
  return readJsonFile(file);
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
  assertRecord(command, `${target.id}.commands[${index}]`);
  assertString(command.command, `${target.id}.commands[${index}].command`);
  if (command.args !== undefined) assertStringArray(command.args, `${target.id}.${command.command}.args`);
  if (command.env !== undefined) {
    assertRecord(command.env, `${target.id}.${command.command}.env`);
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

function runTargetCommand(target, command) {
  const cwd = resolve(repoRoot, target.workingDirectory ?? '.');
  if (!existsSync(cwd)) {
    throw new Error(`${target.id} workingDirectory does not exist: ${target.workingDirectory ?? '.'}`);
  }

  const args = command.args ?? [];
  runStep({
    id: `${target.id}:${command.command}`,
    label: `[${target.id}] ${command.command} ${args.join(' ')}`.trimEnd(),
    command: command.command,
    args,
    cwd,
    env: command.env ?? {},
  });
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
