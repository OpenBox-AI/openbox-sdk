#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

const steps = [
  ['npm', ['audit'], { label: 'root npm audit' }],
  ['npm', ['--prefix', 'example/n8n/custom-node', 'audit'], { label: 'n8n npm audit' }],
];

const secretScanExcludes = new Set([
  // Parser/spec fixtures intentionally contain non-secret obx_* examples.
  'codegen/fixtures/cli-auth.json',
  'codegen/fixtures/env-resolution.json',
  'specs/typespec/cli/main.tsp',
  'specs/typespec/env/main.tsp',
  'tests/e2e/core-client.test.ts',
  'tests/unit/core-client.test.ts',
  'tests/unit/cursor-mcp-install-coverage.test.ts',
  'tests/unit/runtime-cursor-mappers.test.ts',
]);

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

runLocalChangeScan();
runTrackedSourceScan();

function gitFiles(args) {
  const listed = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (listed.status !== 0) {
    if (listed.stderr) process.stderr.write(listed.stderr);
    process.exitCode = 1;
    return [];
  }
  return listed.stdout.split('\0').filter(Boolean);
}

function copyFilesToTemp(files, prefix) {
  const tmp = mkdtempSync(join(tmpdir(), prefix));
  for (const file of files) {
    if (secretScanExcludes.has(file)) continue;
    if (!existsSync(file)) continue;
    const target = join(tmp, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(file, target);
  }
  return tmp;
}

function runLocalChangeScan() {
  const changed = gitFiles(['diff', '--name-only', '--diff-filter=ACMRTUXB', '-z', 'HEAD', '--']);
  const untracked = gitFiles(['ls-files', '-o', '--exclude-standard', '-z']);
  const files = [...new Set([...changed, ...untracked])];
  const tmp = copyFilesToTemp(files, 'openbox-sdk-secret-scan-local-');
  try {
    run('infisical', ['scan', '--source', tmp, '--no-git', '--redact', '--no-color'], {
      label: 'infisical redacted secret scan for local changes',
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function runTrackedSourceScan() {
  const tmp = copyFilesToTemp(gitFiles(['ls-files', '-z']), 'openbox-sdk-secret-scan-');
  try {
    run('infisical', ['scan', '--source', tmp, '--no-git', '--redact', '--no-color'], {
      label: 'infisical tracked-source scan',
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
