#!/usr/bin/env node
// Run the guardrail-service-unavailable scenario against a temporary backend.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { commandForPlatform, repoRoot } from './lib/spec-steps.mjs';

const port = process.env.OPENBOX_E2E_ISOLATED_BACKEND_PORT ?? '3109';
const backendUrl = `http://127.0.0.1:${port}`;
const unavailableGuardrailUrl =
  process.env.OPENBOX_E2E_UNAVAILABLE_GUARDRAIL_URL ?? 'http://127.0.0.1:9';
const backendBootTimeoutMs = Number(
  process.env.OPENBOX_E2E_ISOLATED_BACKEND_BOOT_TIMEOUT_MS ?? 60_000,
);
const backendShutdownTimeoutMs = Number(
  process.env.OPENBOX_E2E_ISOLATED_BACKEND_SHUTDOWN_TIMEOUT_MS ?? 8_000,
);
const verboseBackendLogs = process.env.OPENBOX_E2E_ISOLATED_BACKEND_LOGS === '1';
const backendLogTail = [];

function backendRepoCandidates() {
  if (process.env.OPENBOX_BACKEND_REPO) {
    return [resolve(repoRoot, process.env.OPENBOX_BACKEND_REPO)];
  }

  return [
    resolve(repoRoot, '../openbox-backend'),
    resolve(repoRoot, '../openbox-repos/openbox-backend'),
  ];
}

function isOpenboxBackendRepo(candidate) {
  const packageJsonPath = resolve(candidate, 'package.json');
  if (!existsSync(packageJsonPath)) return false;

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return packageJson.name === 'openbox-backend';
  } catch {
    return false;
  }
}

function findBackendRepo() {
  const candidates = backendRepoCandidates();
  const match = candidates.find(isOpenboxBackendRepo);
  if (match) return match;

  throw new Error(
    [
      'OPENBOX_BACKEND_REPO must point at openbox-backend.',
      `Checked: ${candidates.join(', ')}`,
      'Set OPENBOX_BACKEND_REPO=/path/to/openbox-backend and rerun npm run test:e2e:guardrail-unavailable.',
    ].join('\n'),
  );
}

const backendRepo = findBackendRepo();

function pushBackendLog(stream, chunk) {
  const lines = String(chunk)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => `[isolated-backend:${stream}] ${line}`);
  backendLogTail.push(...lines);
  while (backendLogTail.length > 80) backendLogTail.shift();
  if (verboseBackendLogs) {
    for (const line of lines) process.stderr.write(`${line}\n`);
  }
}

function formatBackendLogTail() {
  return backendLogTail.length > 0
    ? `\nBackend log tail:\n${backendLogTail.join('\n')}`
    : '';
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function spawnIsolatedBackend() {
  const env = {
    ...process.env,
    PORT: port,
    OPENBOX_E2E_KEYCLOAK_STUB: 'true',
    OPENBOX_E2E_DISABLE_ANALYTICS: 'true',
    OPENBOX_E2E_DISABLE_THROTTLE: 'true',
    OPENBOX_DISABLE_THROTTLE: 'true',
    GUARDRAIL_API_URL: unavailableGuardrailUrl,
    KMS_PROVIDER: process.env.KMS_PROVIDER ?? 'local',
    OPENBOX_LOCAL_KMS_SECRET:
      process.env.OPENBOX_LOCAL_KMS_SECRET ?? 'openbox-local-sdk-secret',
    S3_BUCKET_NAME: process.env.S3_BUCKET_NAME ?? 'openbox-local',
    AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL ?? 'http://127.0.0.1:5001',
    AWS_ENDPOINT_URL_S3: process.env.AWS_ENDPOINT_URL_S3 ?? 'http://127.0.0.1:5001',
    AWS_ENDPOINT_URL_KMS: process.env.AWS_ENDPOINT_URL_KMS ?? 'http://127.0.0.1:5001',
    AWS_ENDPOINT_URL_STS: process.env.AWS_ENDPOINT_URL_STS ?? 'http://127.0.0.1:5001',
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? 'local',
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? 'local-secret',
  };

  const child = spawn(commandForPlatform('npm'), ['run', 'start:prod'], {
    cwd: backendRepo,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => pushBackendLog('stdout', chunk));
  child.stderr.on('data', (chunk) => pushBackendLog('stderr', chunk));

  return child;
}

async function waitForBackendHealthy(child) {
  const deadline = Date.now() + backendBootTimeoutMs;
  let exited = false;
  let exitCode = null;
  let exitSignal = null;
  child.once('exit', (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
  });

  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(
        `isolated backend exited before health check passed: code=${exitCode} signal=${exitSignal}${formatBackendLogTail()}`,
      );
    }

    try {
      const response = await fetch(`${backendUrl}/health`);
      if (response.ok) return;
    } catch {
      // Backend is still booting.
    }
    await sleep(500);
  }

  throw new Error(
    `isolated backend did not become healthy at ${backendUrl}/health within ${backendBootTimeoutMs}ms${formatBackendLogTail()}`,
  );
}

function runCommand(command, args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(commandForPlatform(command), args, {
      ...options,
      stdio: 'inherit',
    });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (signal) resolveRun(1);
      else resolveRun(code ?? 1);
    });
  });
}

async function stopBackend(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const exited = new Promise((resolveExit) => {
    child.once('exit', () => resolveExit(true));
  });

  child.kill('SIGTERM');
  const stopped = await Promise.race([
    exited,
    sleep(backendShutdownTimeoutMs).then(() => false),
  ]);

  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

async function main() {
  process.stderr.write(
    `Starting isolated backend at ${backendUrl} with GUARDRAIL_API_URL=${unavailableGuardrailUrl}\n`,
  );
  const backend = spawnIsolatedBackend();

  try {
    await waitForBackendHealthy(backend);
    const status = await runCommand(
      'npx',
      [
        'vitest',
        'run',
        '--project',
        'e2e',
        'tests/e2e/guardrails.test.ts',
        '-t',
        'guardrail service is unavailable',
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          OPENBOX_API_URL: backendUrl,
          OPENBOX_CORE_URL: process.env.OPENBOX_CORE_URL ?? 'http://127.0.0.1:8086',
          OPENBOX_E2E_ISOLATED_GUARDRAIL_UNAVAILABLE: '1',
        },
      },
    );

    if (status !== 0) process.exitCode = status;
  } finally {
    await stopBackend(backend);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
