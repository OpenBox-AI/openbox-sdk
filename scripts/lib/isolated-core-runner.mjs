import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { commandForPlatform, repoRoot } from './spec-steps.mjs';

function coreRepoCandidates() {
  if (process.env.OPENBOX_CORE_REPO) {
    return [resolve(repoRoot, process.env.OPENBOX_CORE_REPO)];
  }

  return [
    resolve(repoRoot, '../openbox-core'),
    resolve(repoRoot, '../openbox-repos/openbox-core'),
  ];
}

function isOpenboxCoreRepo(candidate) {
  const goModPath = resolve(candidate, 'go.mod');
  if (!existsSync(goModPath)) return false;
  return /^module openbox-core$/m.test(readFileSync(goModPath, 'utf8'));
}

function findCoreRepo(scenarioName) {
  const candidates = coreRepoCandidates();
  const match = candidates.find(isOpenboxCoreRepo);
  if (match) return match;

  throw new Error(
    [
      'OPENBOX_CORE_REPO must point at openbox-core.',
      `Checked: ${candidates.join(', ')}`,
      `Set OPENBOX_CORE_REPO=/path/to/openbox-core and rerun ${scenarioName}.`,
    ].join('\n'),
  );
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
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

async function stopProcess(child, shutdownTimeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const exited = new Promise((resolveExit) => {
    child.once('exit', () => resolveExit(true));
  });

  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  } else {
    child.kill('SIGTERM');
  }
  const stopped = await Promise.race([
    exited,
    sleep(shutdownTimeoutMs).then(() => false),
  ]);

  if (!stopped && child.exitCode === null && child.signalCode === null) {
    if (process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    } else {
      child.kill('SIGKILL');
    }
    await exited;
  }
}

export async function runIsolatedCoreVitestScenario({
  scenarioName,
  port,
  taskQueue,
  workflowPrefix,
  coreEnv,
  statusLines,
  vitestArgs,
  vitestEnv,
}) {
  const coreRepo = findCoreRepo(scenarioName);
  const coreUrl = `http://127.0.0.1:${port}`;
  const bootTimeoutMs = Number(
    process.env.OPENBOX_E2E_ISOLATED_CORE_BOOT_TIMEOUT_MS ?? 60_000,
  );
  const shutdownTimeoutMs = Number(
    process.env.OPENBOX_E2E_ISOLATED_CORE_SHUTDOWN_TIMEOUT_MS ?? 8_000,
  );
  const verboseCoreLogs = process.env.OPENBOX_E2E_ISOLATED_CORE_LOGS === '1';
  const coreLogTail = [];

  function pushCoreLog(processName, stream, chunk) {
    const lines = String(chunk)
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => `[${processName}:${stream}] ${line}`);
    coreLogTail.push(...lines);
    while (coreLogTail.length > 100) coreLogTail.shift();
    if (verboseCoreLogs) {
      for (const line of lines) process.stderr.write(`${line}\n`);
    }
  }

  function formatCoreLogTail() {
    return coreLogTail.length > 0
      ? `\nCore log tail:\n${coreLogTail.join('\n')}`
      : '';
  }

  function isolatedCoreEnv() {
    return {
      ...process.env,
      ...coreEnv,
      KMS_PROVIDER: process.env.KMS_PROVIDER ?? 'local',
      OPENBOX_LOCAL_KMS_SECRET:
        process.env.OPENBOX_LOCAL_KMS_SECRET ?? 'openbox-local-sdk-secret',
      GOVERNANCE_TASK_QUEUE: taskQueue,
      WORKFLOW_ID_PREFIX: workflowPrefix,
    };
  }

  function spawnCoreProcess(name, args) {
    const child = spawn(commandForPlatform('go'), args, {
      cwd: coreRepo,
      env: isolatedCoreEnv(),
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => pushCoreLog(name, 'stdout', chunk));
    child.stderr.on('data', (chunk) => pushCoreLog(name, 'stderr', chunk));

    return child;
  }

  async function waitForCoreHealthy(server, worker) {
    const deadline = Date.now() + bootTimeoutMs;
    const exits = new Map();
    for (const [name, child] of [
      ['server', server],
      ['worker', worker],
    ]) {
      child.once('exit', (code, signal) => {
        exits.set(name, { code, signal });
      });
    }

    while (Date.now() < deadline) {
      if (exits.size > 0) {
        throw new Error(
          `isolated Core exited before health check passed: ${JSON.stringify([...exits])}${formatCoreLogTail()}`,
        );
      }

      try {
        const response = await fetch(`${coreUrl}/`);
        if (response.ok && (await response.text()) === 'hello world') return;
      } catch {
        // Core is still booting.
      }
      await sleep(500);
    }

    throw new Error(
      `isolated Core did not become healthy at ${coreUrl}/ within ${bootTimeoutMs}ms${formatCoreLogTail()}`,
    );
  }

  process.stderr.write(
    [
      `Starting isolated Core at ${coreUrl}`,
      `GOVERNANCE_TASK_QUEUE=${taskQueue}`,
      ...statusLines,
      '',
    ].join('\n'),
  );
  const server = spawnCoreProcess('isolated-core-server', [
    'run',
    'cmd/core/main.go',
    'server',
    '--addr',
    `127.0.0.1:${port}`,
  ]);
  const worker = spawnCoreProcess('isolated-core-worker', [
    'run',
    'cmd/core/main.go',
    'governance-worker',
    '--task-queue',
    taskQueue,
  ]);

  try {
    await waitForCoreHealthy(server, worker);
    const status = await runCommand('npx', vitestArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        OPENBOX_CORE_URL: coreUrl,
        ...vitestEnv,
      },
    });

    if (status !== 0) {
      process.stderr.write(formatCoreLogTail());
      process.exitCode = status;
    }
  } finally {
    await Promise.all([
      stopProcess(worker, shutdownTimeoutMs),
      stopProcess(server, shutdownTimeoutMs),
    ]);
  }
}
