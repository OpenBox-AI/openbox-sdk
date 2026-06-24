#!/usr/bin/env node
// Run TypeSpec-declared low-level spec commands.

import { existsSync } from 'node:fs';
import {
  assertRecord,
  normalizeCommandSteps,
  readJsonFile,
  repoRoot,
  runSteps,
  sdkTargetsFixturePath,
} from './lib/spec-steps.mjs';

const bootstrapCommands = new Map([
  [
    'compile',
    {
      id: 'compile',
      label: 'TypeSpec contract compile',
      command: 'npx',
      args: ['tsp', 'compile', 'specs/typespec'],
      cwd: repoRoot,
      env: {},
    },
  ],
  [
    'watch',
    {
      id: 'watch',
      label: 'TypeSpec contract watch',
      command: 'npx',
      args: ['tsp', 'compile', 'specs/typespec', '--watch'],
      cwd: repoRoot,
      env: {},
    },
  ],
]);

function bootstrapCommand(commandId, reason) {
  const command = bootstrapCommands.get(commandId);
  if (!command) {
    throw new Error(`Unknown spec command "${commandId}"`);
  }
  process.stderr.write(`Using bootstrap ${commandId} spec command; ${reason}.\n`);
  return command;
}

function readSpecCommand(commandId) {
  if (!existsSync(sdkTargetsFixturePath)) {
    return bootstrapCommand(commandId, 'generated SDK targets fixture was not found');
  }

  const fixture = readJsonFile(sdkTargetsFixturePath);
  assertRecord(fixture, 'sdk-targets fixture');
  if (fixture.specCommands === undefined) {
    return bootstrapCommand(commandId, 'generated SDK targets fixture has no specCommands section');
  }
  assertRecord(fixture.specCommands, 'specCommands');
  const commands = normalizeCommandSteps(fixture.specCommands.commands, 'specCommands.commands');
  const command = commands.find((entry) => entry.id === commandId);
  if (!command) {
    throw new Error(
      `Unknown spec command "${commandId}". Known commands: ${commands.map((entry) => entry.id).join(', ')}`,
    );
  }
  return command;
}

const selected = process.argv.slice(2);
if (selected.length !== 1) {
  throw new Error('Usage: node scripts/run-spec-command.mjs <command-id>');
}

await runSteps([readSpecCommand(selected[0])]);
