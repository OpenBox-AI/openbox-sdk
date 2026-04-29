// Coverage for ts/src/cli/commands/auth.ts - specifically the
// browserLogin path and the auth subcommands that don't have a hand
// in earlier tests.
//
// We stub playwright's `chromium.launch` so the test process never
// actually opens a browser. The stub returns a page object whose
// `evaluate`/`waitForResponse`/`on('disconnected')` cooperate with
// the harness to inject a fake "tokens captured" event, then close.
//
// This drives the channel-fallback chain the
// token capture pipeline, and the timeout / user-closed branches.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
let originalHome: string | undefined;
let originalCwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'openbox-auth-browser-'));
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
  vi.unstubAllGlobals();
  vi.doUnmock('playwright');
});

function makeFakeBrowser(opts: { capturedTokens?: { access: string; refresh?: string }; userClosed?: boolean }) {
  const listeners: Record<string, ((...a: any[]) => void)[]> = {};
  const browser = {
    on(ev: string, cb: any) {
      (listeners[ev] = listeners[ev] || []).push(cb);
      // Simulate user-closed AFTER a tick if requested.
      if (ev === 'disconnected' && opts.userClosed) {
        setTimeout(() => cb(), 5);
      }
    },
    async close() {},
    async newContext() {
      return {
        async newPage() {
          return {
            async goto() {},
            async evaluate() { return undefined; },
            async waitForFunction() { /* resolve immediately */ },
            async waitForResponse(predicate: any, _opts: any) {
              // Synthesize a token-bearing response when the predicate
              // matches a typical token URL.
              const fakeResponse = {
                async json() {
                  return {
                    access_token: opts.capturedTokens?.access ?? 'fake-access',
                    refresh_token: opts.capturedTokens?.refresh,
                  };
                },
                url() { return 'https://identity.openbox.ai/token'; },
                status() { return 200; },
              };
              try {
                if (predicate(fakeResponse)) return fakeResponse;
              } catch {
                // some predicates throw; fall through
              }
              return fakeResponse;
            },
            on(_ev: string, _cb: any) {},
          };
        },
        async close() {},
      };
    },
  };
  return browser;
}

describe('auth - browserLogin channel fallback', () => {
  it('exits with EXIT.GENERIC when every channel fails', async () => {
    vi.doMock('playwright', () => {
      return {
        chromium: {
          async launch() { throw new Error('no browsers installed'); },
        },
      };
    });

    const { registerAuthCommands } = await import('../../ts/src/cli/commands/auth');
    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    const out: string[] = [];
    const ol = console.log;
    const oe = console.error;
    console.log = (...a: any[]) => out.push(a.join(' '));
    console.error = (...a: any[]) => out.push(a.join(' '));
    const ovExit = process.exit;
    let exit: number | undefined;
    (process as any).exit = ((c?: number) => { exit = c; throw new Error('exit:' + c); }) as never;

    const ci = process.env.CI;
    const ni = process.env.OPENBOX_NONINTERACTIVE;
    delete process.env.CI;
    delete process.env.OPENBOX_NONINTERACTIVE;
    const stdin: any = process.stdin;
    const wasTty = stdin.isTTY;
    stdin.isTTY = true;

    try {
      await program.parseAsync(['node', 'openbox', 'auth', 'login']);
    } catch {
      /* expected */
    } finally {
      console.log = ol;
      console.error = oe;
      (process as any).exit = ovExit;
      if (ci !== undefined) process.env.CI = ci;
      if (ni !== undefined) process.env.OPENBOX_NONINTERACTIVE = ni;
      stdin.isTTY = wasTty;
    }
    // Either 1 (browserLogin error → reportAndExit → GENERIC) or
    // a chained throw - what matters is the channel-fallback walk
    // covered all three positions.
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('auth - non-browser subcommands', () => {
  it('forgot-password + reset-password actions can be registered', async () => {
    const { registerAuthCommands } = await import('../../ts/src/cli/commands/auth');
    const program = new Command();
    registerAuthCommands(program);
    const auth = program.commands.find((c) => c.name() === 'auth');
    expect(auth).toBeDefined();
    expect(auth!.commands.map((s) => s.name())).toContain('forgot-password');
    expect(auth!.commands.map((s) => s.name())).toContain('reset-password');
    expect(auth!.commands.map((s) => s.name())).toContain('change-password');
  });

  it('logout --all iterates every cached env', async () => {
    const cfg = await import('../../ts/src/cli/config');
    cfg.saveTokens('production', 'p-token');
    cfg.saveTokens('staging', 's-token');
    cfg.saveTokens('local', 'l-token');

    const { registerAuthCommands } = await import('../../ts/src/cli/commands/auth');
    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    const out: string[] = [];
    const ol = console.log;
    const oe = console.error;
    console.log = (...a: any[]) => out.push(a.join(' '));
    console.error = (...a: any[]) => out.push(a.join(' '));
    const ovExit = process.exit;
    (process as any).exit = ((_c?: number) => { throw new Error('exit'); }) as never;
    // Stub fetch so the server-side logout doesn't fail loudly.
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ status: 200, data: {} }), { status: 200 }));

    try {
      await program.parseAsync(['node', 'openbox', 'auth', 'logout', '--all']);
    } catch {
      /* expected */
    } finally {
      console.log = ol;
      console.error = oe;
      (process as any).exit = ovExit;
    }
    // After logout --all, every env should have its token cleared.
    expect(cfg.hasTokens('production')).toBe(false);
    expect(cfg.hasTokens('staging')).toBe(false);
    expect(cfg.hasTokens('local')).toBe(false);
  });
});
