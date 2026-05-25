// True e2e: spawn the server as a child process, hit it with real
// HTTP. The server module side-effects (it boots on import), so we
// run it as a Node subprocess with a custom port and tear it down
// when the test ends.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, '../src/server.ts');
const PORT = 28787;
const BASE = `http://127.0.0.1:${PORT}`;
const TSX = path.resolve(__dirname, '../../../node_modules/.bin/tsx');

let proc: ChildProcess | undefined;

async function waitForListening(timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch {
      /* not yet listening */
    }
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('server did not start in time');
}

beforeAll(async () => {
  // Use tsx (already a devDependency) to run the TS source directly.
  // Resolve from the worktree root's node_modules/.bin for portability.
  proc = spawn(TSX, [SERVER_ENTRY], {
    env: {
      ...process.env,
      OPENBOX_BRIDGE_PORT: String(PORT),
      OPENBOX_BRIDGE_HOST: '127.0.0.1',
      OPENBOX_BRIDGE_UNSAFE_LOCAL_DEV: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', () => undefined);
  proc.stderr?.on('data', () => undefined);
  await waitForListening();
}, 15_000);

afterAll(() => {
  proc?.kill('SIGTERM');
});

describe('cloud-bridge http (e2e)', () => {
  it('GET /healthz returns 200 ok', async () => {
    const r = await fetch(`${BASE}/healthz`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('ok');
  });

  it('POST /webhook with valid payload returns the stub verdict', async () => {
    const r = await fetch(`${BASE}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-openbox-agent': 'agt_e2e' },
      body: JSON.stringify({ action: 'cursor_cloud_agent_complete', source_run_id: 'run-e2e' }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; verdict: string; reason: string };
    expect(body.ok).toBe(true);
    expect(body.verdict).toBe('pass');
    expect(body.reason).toContain('agt_e2e');
    expect(body.reason).toContain('run-e2e');
  });

  it('POST /webhook without agent_id returns 400', async () => {
    const r = await fetch(`${BASE}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'foo' }),
    });
    expect(r.status).toBe(400);
  });

  it('unknown route returns 404', async () => {
    const r = await fetch(`${BASE}/nope`);
    expect(r.status).toBe(404);
  });

  it('refuses unsafe local-dev mode on a non-loopback host', async () => {
    const child = spawn(TSX, [SERVER_ENTRY], {
      env: {
        ...process.env,
        OPENBOX_BRIDGE_PORT: '28788',
        OPENBOX_BRIDGE_HOST: '0.0.0.0',
        OPENBOX_BRIDGE_UNSAFE_LOCAL_DEV: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stderr: Buffer[] = [];
    child.stderr?.on('data', (chunk) => stderr.push(chunk as Buffer));
    const code = await new Promise<number | null>((resolve) => {
      child.once('exit', resolve);
    });

    expect(code).not.toBe(0);
    expect(Buffer.concat(stderr).toString('utf-8')).toContain(
      'OPENBOX_BRIDGE_UNSAFE_LOCAL_DEV is only allowed on loopback hosts',
    );
  });
});
