#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const steps = [
  ['npm', ['audit'], { label: 'root npm audit' }],
  ['npm', ['--prefix', 'example/n8n/custom-node', 'audit'], { label: 'n8n npm audit' }],
  ['cargo', ['audit'], { label: 'cargo audit' }],
  ['infisical', ['scan', 'git-changes', '--redact', '--no-color'], { label: 'infisical redacted secret scan for local changes' }],
];

function run(command, args, { label }) {
  process.stderr.write(`\n==> ${label}\n`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  if (result.error?.code === 'ENOENT') {
    process.stderr.write(`${command} is required for ${label} but was not found on PATH\n`);
    process.exitCode = 1;
    return;
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    process.stderr.write(`${label} failed with exit ${result.status ?? 'unknown'}\n`);
    process.exitCode = 1;
  }
}

for (const [command, args, opts] of steps) {
  run(command, args, opts);
}
