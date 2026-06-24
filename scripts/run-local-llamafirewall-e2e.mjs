#!/usr/bin/env node
// Start or reuse the local LlamaFirewall adapter and run its e2e proof.

import { spawn } from 'node:child_process';
import { commandForPlatform, repoRoot } from './lib/spec-steps.mjs';

const port = process.env.LLAMAFIREWALL_PORT ?? '8184';
const adapterUrl = `http://127.0.0.1:${port}`;
const defaultModel = 'qwen2.5-coder:7b';
const defaultApiBaseUrl = 'http://127.0.0.1:11434/v1';
const requestedModel =
  process.env.OPENBOX_E2E_LLAMAFIREWALL_MODEL ??
  process.env.OPENAI_COMPAT_MODEL ??
  process.env.LLAMAFIREWALL_MODEL;
const requestedApiBaseUrl =
  process.env.OPENAI_COMPAT_BASE_URL ??
  process.env.LLAMAFIREWALL_API_BASE_URL;
const bootTimeoutMs = Number(process.env.OPENBOX_E2E_LLAMAFIREWALL_BOOT_TIMEOUT_MS ?? 60_000);
const shutdownTimeoutMs = Number(process.env.OPENBOX_E2E_LLAMAFIREWALL_SHUTDOWN_TIMEOUT_MS ?? 8_000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function adapterHealth() {
  const response = await fetch(`${adapterUrl}/health`).catch(() => null);
  if (!response?.ok) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function resolveSettingsForStart() {
  const apiBaseUrl = requestedApiBaseUrl ?? defaultApiBaseUrl;
  return {
    model: requestedModel ?? defaultModel,
    apiBaseUrl,
    apiKey:
      process.env.OPENAI_COMPAT_API_KEY ??
      process.env.LLAMAFIREWALL_API_KEY ??
      (apiBaseUrl === defaultApiBaseUrl ? 'ollama' : undefined),
  };
}

function resolveSettingsFromExisting(health) {
  if (health.provider !== 'local-llamafirewall') {
    throw new Error(
      `local LlamaFirewall adapter is already running on 127.0.0.1:${port} with different settings`,
    );
  }
  if (requestedModel && health.model !== requestedModel) {
    throw new Error(
      `local LlamaFirewall adapter is already running on 127.0.0.1:${port} with different settings`,
    );
  }
  if (requestedApiBaseUrl && health.api_base_url !== requestedApiBaseUrl) {
    throw new Error(
      `local LlamaFirewall adapter is already running on 127.0.0.1:${port} with different settings`,
    );
  }
  if (!health.model) {
    throw new Error(`local LlamaFirewall adapter on 127.0.0.1:${port} did not report a model`);
  }
  return {
    model: health.model,
    apiBaseUrl: health.api_base_url ?? requestedApiBaseUrl ?? defaultApiBaseUrl,
    apiKey: undefined,
  };
}

function spawnAdapter(settings) {
  const { apiBaseUrl, apiKey, model } = settings;
  if (!apiKey) {
    throw new Error('Set OPENAI_COMPAT_API_KEY before running local LlamaFirewall e2e');
  }

  const child = spawn(commandForPlatform('node'), ['scripts/start-llamafirewall.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENAI_COMPAT_API_KEY: apiKey,
      OPENAI_COMPAT_BASE_URL: apiBaseUrl,
      OPENAI_COMPAT_MODEL: model,
      LLAMAFIREWALL_PORT: port,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.pipe(process.stdout);
  child.stderr.on('data', (chunk) => {
    const text = String(chunk);
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      if (line.includes('OPENAI_COMPAT_API_KEY')) continue;
      process.stderr.write(`${line}\n`);
    }
  });

  return child;
}

async function waitForHealthy(child, settings) {
  const deadline = Date.now() + bootTimeoutMs;
  let exit;
  child.once('exit', (code, signal) => {
    exit = { code, signal };
  });

  while (Date.now() < deadline) {
    if (exit) {
      throw new Error(
        `local LlamaFirewall adapter exited before health check passed: code=${exit.code} signal=${exit.signal}`,
      );
    }

    const health = await adapterHealth();
    if (
      health?.status === 'ok' &&
      health?.provider === 'local-llamafirewall' &&
      health?.model === settings.model &&
      health?.api_base_url === settings.apiBaseUrl
    ) {
      return;
    }
    await sleep(500);
  }

  throw new Error(`local LlamaFirewall adapter did not become healthy on 127.0.0.1:${port}`);
}

function runVitest(settings) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      commandForPlatform('npx'),
      ['vitest', 'run', '--project', 'e2e', 'tests/e2e/llamafirewall.test.ts'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          OPENBOX_E2E_LLAMAFIREWALL_URL: adapterUrl,
          OPENBOX_E2E_LLAMAFIREWALL_MODEL: settings.model,
        },
        stdio: 'inherit',
      },
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) resolve(1);
      else resolve(code ?? 1);
    });
  });
}

async function stopAdapter(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  const exited = new Promise((resolve) => {
    child.once('exit', () => resolve(true));
  });

  child.kill('SIGTERM');
  const stopped = await Promise.race([
    exited,
    sleep(shutdownTimeoutMs).then(() => false),
  ]);

  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

async function main() {
  let adapter;
  let settings;
  const existing = await adapterHealth();
  if (existing?.status === 'ok') {
    settings = resolveSettingsFromExisting(existing);
  } else {
    settings = resolveSettingsForStart();
    process.stderr.write(`Starting local LlamaFirewall adapter on 127.0.0.1:${port}\n`);
    adapter = spawnAdapter(settings);
    await waitForHealthy(adapter, settings);
  }

  const status = await runVitest(settings);
  if (status !== 0) process.exitCode = status;
  await stopAdapter(adapter);
}

main().catch(async (error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
