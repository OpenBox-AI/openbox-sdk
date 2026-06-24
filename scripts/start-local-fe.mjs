#!/usr/bin/env node
// Start the local OpenBox frontend with local-stack-safe defaults.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultRecaptchaSiteKey = [
  '6LeIxAcTAAAAA',
  'JcZVRqyHh71UMIEGNQ_MXjiZKhI',
].join('');

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  const feDir = resolveFrontendDir();
  const host = process.env.OPENBOX_FE_HOST ?? 'localhost';
  const port = normalizePort(process.env.OPENBOX_FE_PORT ?? '3233');
  const browserHost = process.env.OPENBOX_FE_BROWSER_HOST ?? browserHostFor(host);
  const apiUrl = normalizeLoopbackUrl(
    process.env.VITE_API_URL ?? process.env.OPENBOX_API_URL ?? 'http://localhost:3000',
    browserHost,
  );
  const wsUrl = normalizeLoopbackUrl(
    process.env.VITE_WS_URL ?? process.env.OPENBOX_WS_URL ?? apiUrl,
    browserHost,
  );
  const recaptchaSiteKey = process.env.VITE_RECAPTCHA_SITE_KEY ?? defaultRecaptchaSiteKey;

  process.stderr.write(
    `Starting openbox-fe on http://${browserHost}:${port} with API ${apiUrl}\n`,
  );

  const child = spawn(
    'pnpm',
    [
      'exec',
      'vite',
      '--host',
      host,
      '--port',
      port,
      '--strictPort',
      ...process.argv.slice(2),
    ],
    {
      cwd: feDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_API_URL: apiUrl,
        VITE_WS_URL: wsUrl,
        VITE_RECAPTCHA_SITE_KEY: recaptchaSiteKey,
      },
    },
  );

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  child.on('error', (error) => {
    if (error?.code === 'ENOENT') {
      process.stderr.write('pnpm is required to start openbox-fe but was not found on PATH\n');
      process.exit(1);
    }
    throw error;
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

function resolveFrontendDir() {
  const explicitDir = process.env.OPENBOX_FE_DIR;
  if (explicitDir) {
    if (isFrontendDir(explicitDir)) return explicitDir;
    throw new Error('OPENBOX_FE_DIR does not point to an openbox-fe checkout');
  }

  const candidates = [
    resolve(repoRoot, '..', 'openbox-fe'),
    resolve(repoRoot, '..', 'openbox-repos', 'openbox-fe'),
  ];

  const match = candidates.find((candidate) => isFrontendDir(candidate));
  if (match) return match;

  throw new Error('Set OPENBOX_FE_DIR to a local openbox-fe checkout before running local:fe');
}

function isFrontendDir(dir) {
  const packagePath = resolve(dir, 'package.json');
  if (!existsSync(packagePath)) return false;
  try {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    return (
      packageJson.name === 'openbox-fe' &&
      typeof packageJson.scripts?.dev === 'string' &&
      packageJson.scripts.dev.includes('vite')
    );
  } catch {
    return false;
  }
}

function normalizePort(rawPort) {
  if (!/^\d+$/.test(rawPort)) {
    throw new Error('OPENBOX_FE_PORT must be a number');
  }
  const port = Number(rawPort);
  if (port < 1 || port > 65535) {
    throw new Error('OPENBOX_FE_PORT must be between 1 and 65535');
  }
  return String(port);
}

function browserHostFor(host) {
  if (host === '0.0.0.0' || host === '::' || host === '[::]') {
    return 'localhost';
  }
  return stripIpv6Brackets(host);
}

function normalizeLoopbackUrl(rawUrl, browserHost) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid local frontend URL: ${rawUrl}`);
  }

  if (isLoopbackHost(parsed.hostname) && isLoopbackHost(browserHost)) {
    parsed.hostname = stripIpv6Brackets(browserHost);
  }
  return parsed.toString().replace(/\/$/, '');
}

function isLoopbackHost(host) {
  const normalized = stripIpv6Brackets(host).toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function stripIpv6Brackets(host) {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function printHelp() {
  process.stdout.write(`Usage: npm run local:fe

Starts openbox-fe for the local OpenBox stack.

Environment:
  OPENBOX_FE_DIR             frontend checkout; auto-detected when possible
  OPENBOX_FE_HOST            Vite host, default localhost
  OPENBOX_FE_PORT            Vite port, default 3233
  OPENBOX_FE_BROWSER_HOST    browser host for printed URL and loopback API normalization
  VITE_API_URL               backend API URL, default http://localhost:3000
  VITE_WS_URL                websocket URL, default VITE_API_URL
  VITE_RECAPTCHA_SITE_KEY    reCAPTCHA site key, default Google public test key
`);
}
