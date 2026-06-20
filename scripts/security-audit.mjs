#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

const repoRoot = process.cwd();
const fixturePath = resolve(repoRoot, 'codegen/fixtures/sdk-targets.json');

function assertString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

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

function readSecurityAuditConfig() {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  assertRecord(fixture, 'sdk-targets fixture');
  const securityAudit = fixture.securityAudit;
  assertRecord(securityAudit, 'securityAudit');
  if (!Array.isArray(securityAudit.commands) || securityAudit.commands.length === 0) {
    throw new Error('securityAudit.commands must be a non-empty array');
  }
  if (!Array.isArray(securityAudit.secretScanExcludes)) {
    throw new Error('securityAudit.secretScanExcludes must be an array');
  }

  const commands = securityAudit.commands.map((command, index) => {
    assertRecord(command, `securityAudit.commands[${index}]`);
    for (const field of ['id', 'label', 'command', 'workingDirectory']) {
      assertString(command[field], `securityAudit.commands[${index}].${field}`);
    }
    if (command.args !== undefined) {
      assertStringArray(command.args, `securityAudit.commands[${index}].args`);
    }
    if (command.env !== undefined) {
      assertRecord(command.env, `securityAudit.commands[${index}].env`);
      for (const [name, value] of Object.entries(command.env)) {
        assertString(name, `securityAudit.commands[${index}].env key`);
        if (typeof value !== 'string') {
          throw new Error(`securityAudit.commands[${index}].env.${name} must be a string`);
        }
      }
    }
    return {
      id: command.id,
      label: command.label,
      command: command.command,
      args: command.args ?? [],
      cwd: resolve(repoRoot, command.workingDirectory),
      env: command.env ?? {},
    };
  });

  const secretScanExcludes = new Map();
  for (const [index, exclude] of securityAudit.secretScanExcludes.entries()) {
    assertRecord(exclude, `securityAudit.secretScanExcludes[${index}]`);
    assertString(exclude.path, `securityAudit.secretScanExcludes[${index}].path`);
    assertString(exclude.reason, `securityAudit.secretScanExcludes[${index}].reason`);
    secretScanExcludes.set(exclude.path, exclude.reason);
  }

  return { commands, secretScanExcludes };
}

const { commands: auditCommands, secretScanExcludes } = readSecurityAuditConfig();

function commandForPlatform(command) {
  if (process.platform !== 'win32') return command;
  if (command === 'npm' || command === 'npx') return `${command}.cmd`;
  return command;
}

function run(command, args, { label, cwd = repoRoot, env = {} }) {
  process.stderr.write(`\n==> ${label}\n`);
  const result = spawnSync(commandForPlatform(command), args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
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

for (const auditCommand of auditCommands) {
  run(auditCommand.command, auditCommand.args, auditCommand);
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
