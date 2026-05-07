// Live verdict matrix against a real agent + planted behavior rules.
// Dogfoods `openbox core evaluate` (the published CLI) to drive the
// governance event, then asserts the verdict shape matches what the
// rule was set to produce. Pairs with openbox-local's
// scripts/e2e-bootstrap.sh which plants:
//
//   trigger=internal    → verdict=block          (rule: e2e-deny-shell)
//   trigger=file_write  → verdict=require_approval (rule: e2e-approve-write,
//                          approval_timeout=60s)
//   trigger=file_delete → verdict=block          (rule: e2e-deny-file-delete)
//
// Other span types pass through (no rule → allow).

import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

const SHOULD_RUN =
  process.env.OPENBOX_E2E_LIVE === '1' &&
  !!process.env.OPENBOX_E2E_AGENT_ID &&
  !!process.env.OPENBOX_E2E_RUNTIME_KEY;

interface CoreVerdict {
  verdict: string;
  action: string;
  reason?: string;
  approval_id?: string;
  approval_expiration_time?: string;
}

function evaluate(opts: {
  type: string;
  args: string[];
}): CoreVerdict {
  const rtKey = process.env.OPENBOX_E2E_RUNTIME_KEY;
  if (!rtKey) throw new Error('OPENBOX_E2E_RUNTIME_KEY missing in test process');
  // tests/setup.ts pins OPENBOX_API_URL/_CORE_URL to production
  // defaults if unset. Unsetting them here lets `--env <x>`'s
  // resolveEnv() use the env's table instead of inheriting prod URLs.
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    OPENBOX_API_KEY: rtKey,
    OPENBOX_ENV: process.env.OPENBOX_ENV ?? 'local',
  };
  delete env.OPENBOX_API_URL;
  delete env.OPENBOX_CORE_URL;
  const cliEnv = process.env.OPENBOX_ENV ?? 'local';
  const result = spawnSync(
    'openbox',
    ['--env', cliEnv, '--experimental', 'core', 'evaluate', '--type', opts.type, ...opts.args],
    {
      encoding: 'utf-8',
      env,
      timeout: 30_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `core evaluate exit ${result.status} (key=${rtKey.slice(0, 14)}…):\n` +
        `STDOUT: ${result.stdout}\nSTDERR: ${result.stderr}`,
    );
  }
  // CLI prints the raw verdict envelope (JSON). Strip any leading
  // log lines (CLI sometimes prefixes with progress on stderr; on
  // stdout it should be pure JSON).
  const text = result.stdout.trim();
  const start = text.indexOf('{');
  if (start < 0) throw new Error(`no JSON in core evaluate output: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start));
}

describe.runIf(SHOULD_RUN)('core evaluate — live verdict matrix', () => {
  it('shell command → block (e2e-deny-shell rule fires)', () => {
    const r = evaluate({ type: 'shell', args: ['--command', 'echo from e2e test'] });
    expect(r.verdict).toBe('block');
    expect(r.reason).toMatch(/e2e-deny-shell/);
  });

  it('file_write → block (e2e-deny-write rule fires)', () => {
    const r = evaluate({
      type: 'file_write',
      args: ['--file-path', '/tmp/openbox-e2e.txt', '--content', 'live'],
    });
    expect(r.verdict).toBe('block');
    expect(r.reason).toMatch(/e2e-deny-write/);
  });

  it('file_read with no matching rule → allow', () => {
    // Unconditionally readable; no rule fires.
    const r = evaluate({
      type: 'file_read',
      args: ['--file-path', '/tmp/openbox-e2e-readonly.txt', '--content', 'unused'],
    });
    expect(r.verdict).toBe('allow');
  });

  it('http with no matching rule → allow', () => {
    const r = evaluate({
      type: 'http',
      args: ['--method', 'GET', '--url', 'https://example.test/x'],
    });
    expect(r.verdict).toBe('allow');
  });
});

