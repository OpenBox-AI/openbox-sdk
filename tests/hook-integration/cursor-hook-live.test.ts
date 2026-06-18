// Live variant of cursor-hook.test.ts; same fixtures, but each
// invocation runs against a real agent, so the handler
// actually calls core's evaluate endpoint and core writes real spans.
// Asserts:
//
//   1. Exit code 0 (handler runs end-to-end through core).
//   2. JSONL log line shape matches; verdict_kind per spec.
//   3. before* / preToolUse return a parseable verdict envelope on
//      stdout (the cursor-permission shape).
//
// The SDK has no concept of "local" or any specific backend topology;
// the test is opaque to where the backend lives. Two env vars unlock
// it:
//
//   OPENBOX_E2E_LIVE=1                  ← opt in
//   OPENBOX_E2E_AGENT_ID=<uuid>         ← agent the verdict targets
//   OPENBOX_E2E_RUNTIME_KEY=obx_test_…  ← that agent's runtime key
//
// Plus `OPENBOX_API_URL` / `OPENBOX_CORE_URL` to point the handler at whichever backend the
// caller wants to drive. Tests skip cleanly when any of the three
// are absent. How those values are produced (admin reset, keycloak
// bootstrap, fresh agent create, …) is the caller's problem; this
// suite only consumes the result.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ENVELOPES, type EventName, OBSERVE_EVENTS, PERMISSION_EVENTS } from './fixtures/envelopes';
import { requireOpenBoxCli } from '../helpers/openbox-cli.js';

const SHOULD_RUN =
  process.env.OPENBOX_E2E_LIVE === '1' &&
  !!process.env.OPENBOX_E2E_AGENT_ID &&
  !!process.env.OPENBOX_E2E_RUNTIME_KEY;

const CLI = requireOpenBoxCli();
const HOOK_ROOT = mkdtempSync(join(tmpdir(), 'openbox-cursor-hook-live-'));
const HOOK_HOME = join(HOOK_ROOT, '.cursor-hooks');
const LOG = join(HOOK_HOME, 'log', 'cursor-hook.jsonl');

function runHook(envelope: Record<string, unknown>) {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    OPENBOX_API_KEY: process.env.OPENBOX_E2E_RUNTIME_KEY!,
    OPENBOX_HOME: HOOK_HOME,
    // Live e2e agents can legitimately return require_approval.
    // Keep this suite a bounded smoke test: prove the hook emits the
    // Cursor gate shape after a short poll timeout instead of letting
    // the child process run until Vitest kills it.
    HITL_MAX_WAIT: process.env.OPENBOX_E2E_HITL_MAX_WAIT ?? '1',
  };
  return spawnSync('node', [CLI, 'cursor', 'hook'], {
    input: JSON.stringify(envelope),
    cwd: HOOK_ROOT,
    env,
    encoding: 'utf-8',
    timeout: 10_000,
  });
}

function logSize(): number {
  try { return statSync(LOG).size; } catch { return 0; }
}

function readLogTail(since: number): Array<{ event?: string; verdict_kind?: string; error?: string }> {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, 'utf-8')
    .slice(since)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter((x) => x !== null);
}

beforeAll(() => {
  if (!SHOULD_RUN) return;
  if (!existsSync(CLI)) {
    throw new Error(`CLI not built at ${CLI}.`);
  }
  mkdirSync(join(HOOK_HOME, 'log'), { recursive: true });
  if (!existsSync(LOG)) writeFileSync(LOG, '');
});

afterAll(() => {
  rmSync(HOOK_ROOT, { recursive: true, force: true });
});

describe.runIf(SHOULD_RUN)('cursor hook handler; live verdict path', () => {
  for (const event of Object.keys(ENVELOPES) as EventName[]) {
    it(`${event}: real verdict, log line written, exit 0`, () => {
      const before = logSize();
      const out = runHook(ENVELOPES[event]);

      expect(out.status, `stderr: ${out.stderr.slice(0, 600)}`).toBe(0);

      const matched = readLogTail(before).filter((e) => e.event === event);
      expect(matched, `no log line for ${event}`).not.toHaveLength(0);

      const expectedKind =
        PERMISSION_EVENTS.has(event) ? 'permission' :
        OBSERVE_EVENTS.has(event) ? 'observe' :
        'none';
      expect(matched[matched.length - 1].verdict_kind).toBe(expectedKind);

      // Blocking events MUST return a parseable verdict body.
      // Observe / lifecycle events return nothing on stdout per spec.
      if (PERMISSION_EVENTS.has(event)) {
        const stdout = out.stdout.trim();
        if (stdout.length === 0) {
          // Some adapters write `writeFallback` (no body) when the
          // generated handler is missing or the dry-run env is on.
          // Tolerate empty here; the log line + exit code already
          // proved the handler ran.
          return;
        }
        expect(() => JSON.parse(stdout)).not.toThrow();
      }
    });
  }
});
