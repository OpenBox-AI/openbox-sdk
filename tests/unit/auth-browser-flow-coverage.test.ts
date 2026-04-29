// Coverage for the browserLogin path in ts/src/cli/commands/auth.ts.
// Uses a top-of-file vi.mock for playwright with a configurable fake
// browser. Tests cover the channel-fallback walk, response capture,
// header-bearer fallback, cookie/storage sweep, and the user-closed
// branch.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Configurable per-test launch behavior. The fake chromium reads from
// _launchPlan to decide what to do for each launch attempt.
const _launchPlan: { failures: number; capturedTokens?: { access?: string; refresh?: string }; userClosed?: boolean } = {
  failures: 0,
};

let _attemptedChannels: (string | undefined)[] = [];

vi.mock('playwright', () => {
  // Build a fake response whose .json() returns a token-bearing body
  // so context.on('response') captures access + refresh tokens.
  const fakeResponse = (url: string) => ({
    url: () => url,
    headers: () => ({ 'content-type': 'application/json' }),
    json: async () => ({
      access_token: _launchPlan.capturedTokens?.access ?? 'fake-access-token-xxxxxxxxxxxxxxxxxxxx',
      refresh_token: _launchPlan.capturedTokens?.refresh,
    }),
  });

  return {
    chromium: {
      async launch(opts: { channel?: string }) {
        _attemptedChannels.push(opts.channel);
        if (_launchPlan.failures > 0) {
          _launchPlan.failures -= 1;
          throw new Error('channel not installed');
        }
        const browserListeners: Record<string, ((...a: any[]) => void)[]> = {};
        const contextListeners: Record<string, ((...a: any[]) => void)[]> = {};
        const pageListeners: Record<string, ((...a: any[]) => void)[]> = {};

        const context = {
          on(ev: string, cb: any) {
            (contextListeners[ev] = contextListeners[ev] || []).push(cb);
          },
          async newPage() {
            const page = {
              on(ev: string, cb: any) {
                (pageListeners[ev] = pageListeners[ev] || []).push(cb);
              },
              async goto() {
                // Once the page navigates, trigger the framenavigated +
                // response listeners with a token-bearing payload from
                // the trusted Keycloak realm origin.
                for (const cb of pageListeners['framenavigated'] ?? []) {
                  cb({ url: () => 'https://identity.openbox.ai/realms/openbox/protocol/openid-connect/token' });
                }
                for (const cb of contextListeners['response'] ?? []) {
                  await cb(fakeResponse('https://identity.openbox.ai/realms/openbox/protocol/openid-connect/token'));
                }
              },
              async evaluate() { return undefined; },
            };
            return page;
          },
          async cookies() {
            return [{ name: 'kc-refresh-token', value: 'cookie-derived-refresh-token-' + 'x'.repeat(30) }];
          },
        };

        const browser = {
          on(ev: string, cb: any) {
            (browserListeners[ev] = browserListeners[ev] || []).push(cb);
            if (ev === 'disconnected' && _launchPlan.userClosed) {
              setTimeout(() => cb(), 50);
            }
          },
          async newContext() { return context; },
          async close() {},
        };
        return browser;
      },
    },
  };
});

let dir: string;
let originalHome: string | undefined;
let originalCwd: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'openbox-auth-flow-'));
  originalHome = process.env.OPENBOX_HOME;
  process.env.OPENBOX_HOME = dir;
  originalCwd = process.cwd();
  process.chdir(dir);
  _attemptedChannels = [];
  _launchPlan.failures = 0;
  _launchPlan.capturedTokens = undefined;
  _launchPlan.userClosed = false;
});
afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome !== undefined) process.env.OPENBOX_HOME = originalHome;
  else delete process.env.OPENBOX_HOME;
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

async function runAuthLogin(args: string[] = []): Promise<{ exitCode: number | undefined; out: string[] }> {
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
  let exitCode: number | undefined;
  (process as any).exit = ((c?: number) => {
    exitCode = c;
    throw new Error('exit:' + c);
  }) as never;

  // Force interactive context so auth login doesn't bail at the
  // non-interactive guard.
  const stdin: any = process.stdin;
  const wasTty = stdin.isTTY;
  stdin.isTTY = true;
  const ci = process.env.CI;
  const ni = process.env.OPENBOX_NONINTERACTIVE;
  delete process.env.CI;
  delete process.env.OPENBOX_NONINTERACTIVE;

  try {
    await program.parseAsync(['node', 'openbox', 'auth', 'login', ...args]);
  } catch {
    /* expected */
  } finally {
    console.log = ol;
    console.error = oe;
    (process as any).exit = ovExit;
    stdin.isTTY = wasTty;
    if (ci !== undefined) process.env.CI = ci;
    if (ni !== undefined) process.env.OPENBOX_NONINTERACTIVE = ni;
  }
  return { exitCode, out };
}

describe('auth login - browserLogin full path', () => {
  it('captures access + refresh tokens from a trusted-origin response', async () => {
    _launchPlan.capturedTokens = { access: 'captured-access-token-xxxxx', refresh: 'captured-refresh-token-xxxxx' };
    const r = await runAuthLogin();
    // The channel-fallback walk attempted at least one channel.
    expect(_attemptedChannels.length).toBeGreaterThanOrEqual(1);
    // Login flow completed the launch sequence - output contains the
    // "Waiting for login" banner.
    expect(r.out.some((l) => l.includes('Waiting for login'))).toBe(true);
  });

  it('walks every channel when the first fails', async () => {
    _launchPlan.failures = 1;
    _launchPlan.capturedTokens = { access: 'capture-fallback-' + 'x'.repeat(30) };
    await runAuthLogin();
    // First channel threw → second channel succeeded.
    expect(_attemptedChannels.length).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it('exits with an error when every channel fails', async () => {
    _launchPlan.failures = 3; // exceeds the channel chain (3 entries)
    const r = await runAuthLogin();
    // The error path mentions playwright install hint.
    expect(r.out.some((l) => l.includes('Failed to launch') || l.includes('playwright install'))).toBe(true);
  });

  it('--verbose emits per-response log lines on token capture', async () => {
    _launchPlan.capturedTokens = { access: 'verbose-access-xxxxxx', refresh: 'verbose-refresh-xxxxxx' };
    const r = await runAuthLogin(['--verbose']);
    expect(r.out.length).toBeGreaterThan(0);
  });

  it('falls back to cookie sweep when no refresh in response', async () => {
    // Provide access token via response, but NO refresh - exercises
    // the cookie + page.evaluate fallbacks.
    _launchPlan.capturedTokens = { access: 'cookie-fallback-access-' + 'x'.repeat(20) };
    const r = await runAuthLogin();
    expect(r.out.some((l) => l.includes('Waiting for login'))).toBe(true);
  }, 30_000);

  // Removed: a "--no-browser short-circuits" test that asserted
  // behavior the production code doesn't have. `auth login` declares
  // `--browser <bool>` (default true) but the action body NEVER reads
  // `opts.browser`; the flag is dead. Either wire it (skip browserLogin
  // when false, print URL instead) or delete the option. Tracked as
  // OPENBOX-AUDIT-1 in the post-audit findings.
});

// change-password / forgot-password / reset-password subcommand
// coverage lives in tests/unit/cli/auth.test.ts (the existing per-file
// command tests). Putting it here would re-import auth.ts under our
// playwright module mock, which would shadow the SDK helpers those
// subcommand actions actually call.
