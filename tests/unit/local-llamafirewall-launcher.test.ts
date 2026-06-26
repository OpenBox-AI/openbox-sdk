import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type HealthPayload = {
  status: string;
  provider: string;
  model: string;
  api_base_url: string;
};

async function withHealthServer<T>(
  payload: HealthPayload,
  fn: (port: number) => Promise<T> | T,
): Promise<T> {
  const server = createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(port);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function withModelsServer<T>(
  model: string,
  fn: (baseUrl: string) => Promise<T> | T,
  options: {
    structuredContent?: unknown;
    structuredStatus?: number;
    toolCallArguments?: unknown;
  } = {},
): Promise<T> {
  const defaultStructuredContent = {
    observation: 'aligned action',
    thought: 'the trace follows the user goal',
    conclusion: false,
  };
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: model }] }));
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      res.writeHead(options.structuredStatus ?? 200, { 'Content-Type': 'application/json' });
      if (options.toolCallArguments) {
        res.end(JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      arguments: typeof options.toolCallArguments === 'string'
                        ? options.toolCallArguments
                        : JSON.stringify(options.toolCallArguments),
                    },
                  },
                ],
              },
            },
          ],
        }));
        return;
      }
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              content: typeof options.structuredContent === 'string'
                ? options.structuredContent
                : JSON.stringify(options.structuredContent ?? defaultStructuredContent),
            },
          },
        ],
      }));
      return;
    }

    {
      res.writeHead(404).end();
      return;
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}/v1`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function runLauncher(port: number, env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, ['scripts/start-llamafirewall.mjs'], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      ...env,
      LLAMAFIREWALL_PORT: String(port),
    },
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const status = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`start-llamafirewall timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 10_000);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  return { status, stderr, stdout };
}

async function runE2eRunner(port: number, env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, ['scripts/run-local-llamafirewall-e2e.mjs'], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      ...env,
      LLAMAFIREWALL_PORT: String(port),
    },
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const status = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`run-local-llamafirewall-e2e timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 10_000);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  return { status, stderr, stdout };
}

function combinedOutput(result: { stdout: string; stderr: string }) {
  return `${result.stdout}\n${result.stderr}`;
}

describe('local LlamaFirewall e2e runner', () => {
  it('reuses existing adapter health as the model/base source when env is not pinned', async () => {
    await withHealthServer(
      {
        status: 'ok',
        provider: 'local-llamafirewall',
        model: 'local-test-model',
        api_base_url: 'http://127.0.0.1:9999/v1',
      },
      async (port) => {
        const tmp = mkdtempSync(join(tmpdir(), 'openbox-llamafirewall-runner-'));
        const fakeNpx = join(tmp, 'npx');
        const envOut = join(tmp, 'env.json');
        writeFileSync(
          fakeNpx,
          `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
writeFileSync(process.env.OPENBOX_FAKE_NPX_ENV_OUT, JSON.stringify({
  args: process.argv.slice(2),
  model: process.env.OPENBOX_E2E_LLAMAFIREWALL_MODEL,
  url: process.env.OPENBOX_E2E_LLAMAFIREWALL_URL
}, null, 2));
`,
        );
        chmodSync(fakeNpx, 0o755);

        const result = await runE2eRunner(port, {
          PATH: `${tmp}:${process.env.PATH ?? ''}`,
          OPENBOX_FAKE_NPX_ENV_OUT: envOut,
        });

        expect(result.status).toBe(0);
        expect(combinedOutput(result)).not.toContain('local-test-model');
        expect(combinedOutput(result)).not.toContain('127.0.0.1:9999');

        const invoked = JSON.parse(readFileSync(envOut, 'utf8')) as {
          args: string[];
          model: string;
          url: string;
        };
        expect(invoked.args).toEqual([
          'vitest',
          'run',
          '--project',
          'e2e',
          'tests/e2e/llamafirewall.test.ts',
        ]);
        expect(invoked.model).toBe('local-test-model');
        expect(invoked.url).toBe(`http://127.0.0.1:${port}`);
      },
    );
  });

  it('fails closed when env pins a different model than the running adapter', async () => {
    await withHealthServer(
      {
        status: 'ok',
        provider: 'local-llamafirewall',
        model: 'existing-model',
        api_base_url: 'http://127.0.0.1:9999/v1',
      },
      async (port) => {
        const result = await runE2eRunner(port, {
          OPENAI_COMPAT_MODEL: 'requested-model',
          OPENAI_COMPAT_BASE_URL: 'http://127.0.0.1:9999/v1',
          OPENAI_COMPAT_API_KEY: 'obx-secret-value-that-must-not-print',
        });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(
          `local LlamaFirewall adapter is already running on 127.0.0.1:${port} with different settings`,
        );
        expect(combinedOutput(result)).not.toContain('existing-model');
        expect(combinedOutput(result)).not.toContain('requested-model');
        expect(combinedOutput(result)).not.toContain('obx-secret-value-that-must-not-print');
      },
    );
  });
});

describe('local LlamaFirewall launcher', () => {
  it('reuses an already running adapter without requiring endpoint secrets', async () => {
    await withHealthServer(
      {
        status: 'ok',
        provider: 'local-llamafirewall',
        model: 'local-test-model',
        api_base_url: 'http://127.0.0.1:9999/v1',
      },
      async (port) => {
        const result = await runLauncher(port);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe(
          `Local LlamaFirewall adapter is already running on 127.0.0.1:${port}\n`,
        );
        expect(combinedOutput(result)).not.toContain('local-test-model');
        expect(combinedOutput(result)).not.toContain('127.0.0.1:9999');
      },
    );
  });

  it('keeps requested endpoint settings and API keys out of reuse output', async () => {
    await withHealthServer(
      {
        status: 'ok',
        provider: 'local-llamafirewall',
        model: 'local-test-model',
        api_base_url: 'http://127.0.0.1:9999/v1',
      },
      async (port) => {
        const result = await runLauncher(port, {
          OPENAI_COMPAT_MODEL: 'local-test-model',
          OPENAI_COMPAT_BASE_URL: 'http://127.0.0.1:9999/v1',
          OPENAI_COMPAT_API_KEY: 'obx-secret-value-that-must-not-print',
        });

        expect(result.status).toBe(0);
        expect(result.stderr).toBe(
          `Local LlamaFirewall adapter is already running on 127.0.0.1:${port}\n`,
        );
        expect(combinedOutput(result)).not.toContain('local-test-model');
        expect(combinedOutput(result)).not.toContain('127.0.0.1:9999');
        expect(combinedOutput(result)).not.toContain('obx-secret-value-that-must-not-print');
      },
    );
  });

  it('fails closed when a different adapter configuration is already bound', async () => {
    await withHealthServer(
      {
        status: 'ok',
        provider: 'local-llamafirewall',
        model: 'existing-model',
        api_base_url: 'http://127.0.0.1:9999/v1',
      },
      async (port) => {
        const result = await runLauncher(port, {
          OPENAI_COMPAT_MODEL: 'requested-model',
          OPENAI_COMPAT_BASE_URL: 'http://127.0.0.1:9999/v1',
          OPENAI_COMPAT_API_KEY: 'obx-secret-value-that-must-not-print',
        });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(
          `Local LlamaFirewall adapter is already running on 127.0.0.1:${port} with different settings`,
        );
        expect(combinedOutput(result)).not.toContain('existing-model');
        expect(combinedOutput(result)).not.toContain('requested-model');
        expect(combinedOutput(result)).not.toContain('obx-secret-value-that-must-not-print');
      },
    );
  });

  it('requires generic OpenAI-compatible endpoint env before starting a new adapter', async () => {
    const result = await runLauncher(9);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Set OPENAI_COMPAT_MODEL before starting LlamaFirewall');
  });

  it('starts the official-package adapter without enabling a direct evaluator', async () => {
    await withModelsServer('local-test-model', async (baseUrl) => {
      const tmp = mkdtempSync(join(tmpdir(), 'openbox-llamafirewall-launcher-'));
      const fakeUv = join(tmp, 'uv');
      const envOut = join(tmp, 'env.json');
      writeFileSync(
        fakeUv,
        `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
writeFileSync(process.env.OPENBOX_FAKE_UV_ENV_OUT, JSON.stringify({
  args: process.argv.slice(2),
  direct: process.env.LLAMAFIREWALL_OPENAI_COMPAT_DIRECT ?? null,
  model: process.env.LLAMAFIREWALL_MODEL,
  apiBaseUrl: process.env.LLAMAFIREWALL_API_BASE_URL,
  apiKeyEnvVar: process.env.LLAMAFIREWALL_API_KEY_ENV_VAR,
  structuredOutputMode: process.env.LLAMAFIREWALL_STRUCTURED_OUTPUT_MODE,
  apiKeyPresent: Boolean(process.env.OPENAI_COMPAT_API_KEY),
  port: process.env.LLAMAFIREWALL_PORT
}, null, 2));
`,
      );
      chmodSync(fakeUv, 0o755);

      const result = await runLauncher(9, {
        PATH: `${tmp}:${process.env.PATH ?? ''}`,
        OPENAI_COMPAT_MODEL: 'local-test-model',
        OPENAI_COMPAT_BASE_URL: baseUrl,
        OPENAI_COMPAT_API_KEY: 'secret-that-must-not-print',
        OPENBOX_FAKE_UV_ENV_OUT: envOut,
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('Starting local LlamaFirewall adapter on 127.0.0.1:9\n');
      expect(combinedOutput(result)).not.toContain('secret-that-must-not-print');

      const spawnedEnv = JSON.parse(readFileSync(envOut, 'utf8')) as {
        args: string[];
        direct: string | null;
        model: string;
        apiBaseUrl: string;
        apiKeyEnvVar: string;
        structuredOutputMode: string;
        apiKeyPresent: boolean;
        port: string;
      };
      expect(spawnedEnv.args).toEqual([
        'run',
        '--no-project',
        '--with',
        'llamafirewall==1.0.3',
        '--with',
        'fastapi',
        '--with',
        'uvicorn',
        'scripts/local-llamafirewall-server.py',
      ]);
      expect(spawnedEnv.direct).toBeNull();
      expect(spawnedEnv.model).toBe('local-test-model');
      expect(spawnedEnv.apiBaseUrl).toBe(baseUrl);
      expect(spawnedEnv.apiKeyEnvVar).toBe('OPENAI_COMPAT_API_KEY');
      expect(spawnedEnv.structuredOutputMode).toBe('response_format');
      expect(spawnedEnv.apiKeyPresent).toBe(true);
      expect(spawnedEnv.port).toBe('9');
    });
  });

  it('uses forced tool calls when response_format is listed but not honored', async () => {
    await withModelsServer('local-test-model', async (baseUrl) => {
      const tmp = mkdtempSync(join(tmpdir(), 'openbox-llamafirewall-launcher-'));
      const fakeUv = join(tmp, 'uv');
      const envOut = join(tmp, 'env.json');
      writeFileSync(
        fakeUv,
        `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
writeFileSync(process.env.OPENBOX_FAKE_UV_ENV_OUT, JSON.stringify({
  structuredOutputMode: process.env.LLAMAFIREWALL_STRUCTURED_OUTPUT_MODE,
  model: process.env.LLAMAFIREWALL_MODEL,
  apiBaseUrl: process.env.LLAMAFIREWALL_API_BASE_URL,
  apiKeyPresent: Boolean(process.env.OPENAI_COMPAT_API_KEY),
}, null, 2));
`,
      );
      chmodSync(fakeUv, 0o755);

      const result = await runLauncher(9, {
        PATH: `${tmp}:${process.env.PATH ?? ''}`,
        OPENAI_COMPAT_MODEL: 'local-test-model',
        OPENAI_COMPAT_BASE_URL: baseUrl,
        OPENAI_COMPAT_API_KEY: 'secret-that-must-not-print',
        OPENBOX_FAKE_UV_ENV_OUT: envOut,
      });

      expect(result.status).toBe(0);
      const spawnedEnv = JSON.parse(readFileSync(envOut, 'utf8')) as {
        structuredOutputMode: string;
        model: string;
        apiBaseUrl: string;
        apiKeyPresent: boolean;
      };
      expect(spawnedEnv.structuredOutputMode).toBe('tool_call');
      expect(spawnedEnv.model).toBe('local-test-model');
      expect(spawnedEnv.apiBaseUrl).toBe(baseUrl);
      expect(spawnedEnv.apiKeyPresent).toBe(true);
      expect(combinedOutput(result)).not.toContain('secret-that-must-not-print');
    }, {
      structuredContent: 'plain markdown',
      toolCallArguments: {
        observation: 'aligned',
        thought: 'request and trace match',
        conclusion: false,
      },
    });
  });

  it('fails before start when the endpoint cannot satisfy OpenAI structured output', async () => {
    await withModelsServer('local-test-model', async (baseUrl) => {
      const result = await runLauncher(9, {
        OPENAI_COMPAT_MODEL: 'local-test-model',
        OPENAI_COMPAT_BASE_URL: baseUrl,
        OPENAI_COMPAT_API_KEY: 'secret-that-must-not-print',
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'OPENAI_COMPAT_MODEL does not support OpenAI structured JSON schema or forced tool-call responses required by LlamaFirewall',
      );
      expect(combinedOutput(result)).not.toContain('secret-that-must-not-print');
      expect(combinedOutput(result)).not.toContain('local-test-model');
      expect(combinedOutput(result)).not.toContain(baseUrl);
    }, { structuredContent: 'plain markdown' });
  });
});
