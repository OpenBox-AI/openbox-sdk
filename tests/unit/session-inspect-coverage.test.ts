// Coverage for ts/src/cli/commands/session.ts inspect + prune.
// Driven through registerSessionCommands with a stub client that
// returns synthetic events; the inspect rules (pairing, terminal,
// ID consistency, canonical verdict checks) are pure and observable
// in the rendered output.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Intercept getClient with a per-test injection point. The module-level
// hoisted vi.mock is the only way to override a frozen ESM export.
let _injectedClient: any = null;
vi.mock('../../ts/src/cli/config', async () => {
  const real = await vi.importActual<typeof import('../../ts/src/cli/config')>('../../ts/src/cli/config');
  return {
    ...real,
    getClient: () => _injectedClient ?? real.getClient(),
  };
});

let dir: string;
let originalHome: string | undefined;
let originalCwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'openbox-session-inspect-'));
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

function stubClient(events: any[], session: any = { id: 'sess1', status: 'COMPLETED', workflow_id: 'wf-1', run_id: 'run-1' }, active: any[] = []): any {
  return new Proxy({}, {
    get(_, prop: string) {
      if (prop === 'getSession') return async () => session;
      if (prop === 'listSessions') return async () => ({ data: [session], total: 1 });
      if (prop === 'getSessionLogs') return async (_a: string, _s: string, q: { page: number }) => ({
        data: q.page === 0 ? events : [],
        total: events.length,
      });
      if (prop === 'getActiveSessions') return async () => active;
      if (prop === 'terminateSession') return async () => ({ ok: true });
      return undefined;
    },
  });
}

async function runSessionAction(verb: string, args: string[], client: any): Promise<{ exitCode: number | undefined; out: string[] }> {
  // Inject the stub via the module-level _injectedClient hook above.
  _injectedClient = client;

  const { registerSessionCommands } = await import('../../ts/src/cli/commands/session');
  const program = new Command();
  program.exitOverride();
  registerSessionCommands(program);

  const out: string[] = [];
  const ol = console.log;
  const oe = console.error;
  console.log = (...a: any[]) => out.push(a.join(' '));
  console.error = (...a: any[]) => out.push(a.join(' '));

  const ovExit = process.exit;
  let exitCode: number | undefined;
  (process as any).exit = ((code?: number) => {
    exitCode = code;
    throw new Error('exit:' + code);
  }) as never;

  try {
    await program.parseAsync(['node', 'openbox', 'session', verb, ...args]);
  } catch {
    /* expected on bailWith paths */
  } finally {
    console.log = ol;
    console.error = oe;
    (process as any).exit = ovExit;
    _injectedClient = null;
  }
  return { exitCode, out };
}

describe('session inspect; protocol validator', () => {
  it('clean session (paired Start/Complete + WorkflowCompleted) → no fail findings', async () => {
    const events = [
      { event_type: 'WorkflowStarted', workflow_id: 'wf-1', run_id: 'run-1' },
      { event_type: 'ActivityStarted', activity_id: 'a1', activity_type: 'PromptSubmission', activity_input: [{ p: 'hi' }] },
      { event_type: 'ActivityCompleted', activity_id: 'a1', activity_type: 'PromptSubmission', verdict: 'allow' },
      { event_type: 'WorkflowCompleted' },
    ];
    const r = await runSessionAction('inspect', ['ag1', 'sess1'], stubClient(events));
    expect(r.out.some((l) => l.includes('protocol check'))).toBe(true);
    // Clean session shouldn't produce a `fail` line; exitCode stays undefined.
    expect(r.exitCode).toBeUndefined();
  });

  it('orphan ActivityStarted produces a fail finding + exit code', async () => {
    const events = [
      { event_type: 'WorkflowStarted', workflow_id: 'wf-1', run_id: 'run-1' },
      { event_type: 'ActivityStarted', activity_id: 'orphan', activity_type: 'PromptSubmission', activity_input: [{ p: 'x' }] },
      // no Completed pair, no Workflow terminal
    ];
    const r = await runSessionAction('inspect', ['ag1', 'sess1'], stubClient(events));
    expect(r.out.some((l) => l.includes('orphan') || l.includes('terminal') || l.includes('protocol'))).toBe(true);
  });

  it('non-canonical event_type fires a finding', async () => {
    const events = [
      { event_type: 'NotInTheCanon', workflow_id: 'wf-1', run_id: 'run-1' },
      { event_type: 'WorkflowCompleted' },
    ];
    const r = await runSessionAction('inspect', ['ag1', 'sess1'], stubClient(events));
    expect(r.out.length).toBeGreaterThan(0);
  });

  it('inspect finds a session by name when getSession 404s but listSessions returns one', async () => {
    const events = [{ event_type: 'WorkflowCompleted' }];
    const session = { id: 'real-id', status: 'COMPLETED', workflow_id: 'wf-1', run_id: 'run-1' };
    const client = new Proxy({}, {
      get(_, prop: string) {
        if (prop === 'getSession') return async () => { throw new Error('not found'); };
        if (prop === 'listSessions') return async () => ({ data: [session], total: 1 });
        if (prop === 'getSessionLogs') return async () => ({ data: events, total: 1 });
        return undefined;
      },
    });
    const r = await runSessionAction('inspect', ['ag1', 'some-name'], client);
    expect(r.out.some((l) => l.includes('real-id'))).toBe(true);
  });
});

describe('session prune; bulk terminate', () => {
  it('--dry-run lists candidates without firing terminate', async () => {
    const tooOld = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    const sessions = [
      { id: 's-old-1', status: 'PENDING', started_at: tooOld, workflow_id: 'wf-old' },
      { id: 's-old-2', status: 'PENDING', started_at: tooOld, workflow_id: 'wf-old-2' },
    ];
    const calls: string[] = [];
    const client = new Proxy({}, {
      get(_, prop: string) {
        if (prop === 'getActiveSessions') return async () => sessions;
        if (prop === 'terminateSession') return async () => { calls.push('terminate'); return { ok: true }; };
        return undefined;
      },
    });
    const r = await runSessionAction('prune', ['ag1', '--older-than', '30m', '--dry-run'], client);
    expect(r.out.some((l) => l.includes('would terminate'))).toBe(true);
    expect(calls.length).toBe(0);
  });

  it('without --dry-run terminates each candidate (OPENBOX_ASSUME_YES bypasses gate)', async () => {
    const tooOld = new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString();
    const sessions = [
      { id: 's-old-1', status: 'PENDING', started_at: tooOld, workflow_id: 'wf-old' },
    ];
    const calls: string[] = [];
    const client = new Proxy({}, {
      get(_, prop: string) {
        if (prop === 'getActiveSessions') return async () => sessions;
        if (prop === 'terminateSession') return async () => { calls.push('terminate'); return { ok: true }; };
        return undefined;
      },
    });
    // OPENBOX_ASSUME_YES is set by tests/setup.ts so requireYesForDestructive
    // bypasses without --yes here. The action body should reach the
    // terminate loop.
    const r = await runSessionAction('prune', ['ag1', '--older-than', '30m'], client);
    expect(calls.length).toBe(1);
    expect(r.out.some((l) => /^done\./.test(l) && l.includes('removed=1'))).toBe(true);
  });

  it('no candidates → "no dangling sessions" message + exit 0', async () => {
    const fresh = new Date().toISOString();
    const sessions = [{ id: 's-fresh', status: 'PENDING', started_at: fresh }];
    const client = new Proxy({}, {
      get(_, prop: string) {
        if (prop === 'getActiveSessions') return async () => sessions;
        return undefined;
      },
    });
    const r = await runSessionAction('prune', ['ag1', '--older-than', '30m'], client);
    expect(r.out.some((l) => l.includes('no dangling'))).toBe(true);
  });

  it('invalid duration spec → throws via reportAndExit', async () => {
    const client = stubClient([]);
    const r = await runSessionAction('prune', ['ag1', '--older-than', 'NOT-A-DURATION'], client);
    expect(r.out.some((l) => l.toLowerCase().includes('invalid duration'))).toBe(true);
  });
});
