import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function runLauncher(env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, ['scripts/start-local-fe.mjs'], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      ...env,
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
      reject(new Error(`start-local-fe timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 10_000);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  return { status, stderr, stdout };
}

function createFrontendCheckout() {
  const dir = mkdtempSync(join(tmpdir(), 'openbox-fe-launcher-'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'openbox-fe',
      scripts: {
        dev: 'vite --port 3233',
      },
    }),
  );
  return dir;
}

function createFakePnpm() {
  const dir = mkdtempSync(join(tmpdir(), 'openbox-fe-pnpm-'));
  const outputPath = join(dir, 'pnpm-env.json');
  const fakePnpm = join(dir, 'pnpm');
  writeFileSync(
    fakePnpm,
    `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
writeFileSync(process.env.OPENBOX_FAKE_PNPM_OUT, JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  env: {
    VITE_API_URL: process.env.VITE_API_URL,
    VITE_WS_URL: process.env.VITE_WS_URL,
    VITE_RECAPTCHA_SITE_KEY: process.env.VITE_RECAPTCHA_SITE_KEY,
  },
}, null, 2));
`,
  );
  chmodSync(fakePnpm, 0o755);
  return { dir, outputPath };
}

describe('local FE launcher', () => {
  it('starts Vite with local stack defaults and normalized loopback API host', async () => {
    const feDir = createFrontendCheckout();
    const fakePnpm = createFakePnpm();

    const result = await runLauncher({
      PATH: `${fakePnpm.dir}:${process.env.PATH}`,
      OPENBOX_FE_DIR: feDir,
      OPENBOX_API_URL: 'http://127.0.0.1:3000',
      OPENBOX_FAKE_PNPM_OUT: fakePnpm.outputPath,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Starting openbox-fe on http://localhost:3233');

    const captured = JSON.parse(readFileSync(fakePnpm.outputPath, 'utf8')) as {
      args: string[];
      cwd: string;
      env: Record<string, string>;
    };
    expect(realpathSync(captured.cwd)).toBe(realpathSync(feDir));
    expect(captured.args).toEqual([
      'exec',
      'vite',
      '--host',
      'localhost',
      '--port',
      '3233',
      '--strictPort',
    ]);
    expect(captured.env.VITE_API_URL).toBe('http://localhost:3000');
    expect(captured.env.VITE_WS_URL).toBe('http://localhost:3000');
    expect(captured.env.VITE_RECAPTCHA_SITE_KEY).toBe(
      '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI',
    );
  });

  it('honors explicit frontend host, port, API, websocket, and reCAPTCHA env', async () => {
    const feDir = createFrontendCheckout();
    const fakePnpm = createFakePnpm();

    const result = await runLauncher({
      PATH: `${fakePnpm.dir}:${process.env.PATH}`,
      OPENBOX_FE_DIR: feDir,
      OPENBOX_FE_HOST: '0.0.0.0',
      OPENBOX_FE_PORT: '3333',
      VITE_API_URL: 'http://localhost:4000',
      VITE_WS_URL: 'http://localhost:4001',
      VITE_RECAPTCHA_SITE_KEY: 'test-site-key',
      OPENBOX_FAKE_PNPM_OUT: fakePnpm.outputPath,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Starting openbox-fe on http://localhost:3333');

    const captured = JSON.parse(readFileSync(fakePnpm.outputPath, 'utf8')) as {
      args: string[];
      env: Record<string, string>;
    };
    expect(captured.args).toEqual([
      'exec',
      'vite',
      '--host',
      '0.0.0.0',
      '--port',
      '3333',
      '--strictPort',
    ]);
    expect(captured.env).toMatchObject({
      VITE_API_URL: 'http://localhost:4000',
      VITE_WS_URL: 'http://localhost:4001',
      VITE_RECAPTCHA_SITE_KEY: 'test-site-key',
    });
  });

  it('fails without a valid frontend checkout', async () => {
    const result = await runLauncher({
      OPENBOX_FE_DIR: join(tmpdir(), 'missing-openbox-fe'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('OPENBOX_FE_DIR does not point to an openbox-fe checkout');
  });
});
