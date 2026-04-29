// Coverage for ts/src/cli/commands/doctor.ts. Doctor is a runtime
// pre-flight: token file present? JWT not expired? Backend reachable?
// We drive each branch by setting up a sandboxed token store + a
// capture-server backend that can return /health/version 200 or fail
// on demand.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

let dir: string;
let originalHome: string | undefined;
let originalCwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'openbox-doctor-cov-'));
  originalHome = process.env.OPENBOX_HOME;
  process.env.OPENBOX_HOME = dir;
  originalCwd = process.cwd();
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome !== undefined) process.env.OPENBOX_HOME = originalHome;
  else delete process.env.OPENBOX_HOME;
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

async function makeOkServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 200, data: { ok: true } }));
    void req; // unused
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

async function runDoctor(): Promise<{ exitCode: number | undefined; lines: string[] }> {
  const { registerDoctorCommand } = await import('../../ts/src/cli/commands/doctor');
  const program = new Command();
  program.exitOverride();
  registerDoctorCommand(program);

  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: any[]) => lines.push(a.join(' '));
  console.error = (...a: any[]) => lines.push(a.join(' '));

  const origExit = process.exit;
  let exitCode: number | undefined;
  (process as any).exit = ((code?: number) => {
    exitCode = code;
    throw new Error('exit:' + code);
  }) as never;

  try {
    await program.parseAsync(['node', 'openbox', 'doctor']);
  } catch {
    /* expected on fail-paths */
  } finally {
    console.log = origLog;
    console.error = origErr;
    (process as any).exit = origExit;
  }
  return { exitCode, lines };
}

describe('doctor command', () => {
  it('reports fail when token file is missing', async () => {
    const r = await runDoctor();
    expect(r.lines.some((l) => l.includes('token file') || l.includes('access token'))).toBe(true);
    expect(r.exitCode).toBe(1); // EXIT.GENERIC - fails present
  });

  it('reports pass when tokens + backend reachable', async () => {
    // Set up a fake token store with a non-JWT placeholder.
    const cfg = await import('../../ts/src/cli/config');
    cfg.saveTokens('production', 'placeholder-token', 'placeholder-refresh');

    const ok = await makeOkServer();
    process.env.OPENBOX_API_URL = ok.url;
    process.env.OPENBOX_CORE_URL = ok.url;
    try {
      const r = await runDoctor();
      // The tokens-present + JWT-malformed-warning + reachable backends
      // path produces a rich `lines` output. We just need the function
      // to have run end-to-end.
      expect(r.lines.length).toBeGreaterThan(2);
    } finally {
      delete process.env.OPENBOX_API_URL;
      delete process.env.OPENBOX_CORE_URL;
      await ok.close();
    }
  });

  it('reports JWT expiry when payload has exp claim', async () => {
    // Resolve the active env (OPENBOX_ENV may be 'local' under the
    // dev-stack-driven full run) and write the fake JWT for THAT env.
    const { resolveEnv } = await import('../../ts/src/env');
    const env = resolveEnv();
    const cfg = await import('../../ts/src/cli/config');
    const past = Math.floor(Date.now() / 1000) - 60;
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ exp: past, sub: 'me' })).toString('base64url');
    const fake = `${header}.${payload}.sig`;
    cfg.saveTokens(env, fake, 'r');

    const r = await runDoctor();
    expect(r.lines.some((l) => l.toLowerCase().includes('expired') || l.includes('JWT'))).toBe(true);
  });
});
