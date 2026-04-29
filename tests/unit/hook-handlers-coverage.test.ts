// Coverage for ts/src/runtime/{claude-code,cursor}/hook-handler.ts.
//
// The hook handlers are: read stdin → dispatch via the spec-driven
// adapter → write stdout → exit 0 (fail-open). They're invoked by the
// real claude-code / cursor binaries with a JSON payload on stdin.
//
// To exercise them in-process we:
//   1. Replace process.stdin with a Readable that yields synthetic
//      hook event JSON, then ends.
//   2. Replace process.stdout with a writable sink we can inspect.
//   3. Shim process.exit so the runtime's "fail-open exit 0" doesn't
//      kill the test runner.
//   4. Stub the OpenBoxCoreClient HTTP layer (a fake fetch) so adapter
//      calls return canned verdicts without a live core service.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable, Writable } from 'node:stream';

const originalStdin = process.stdin;
const originalStdout = process.stdout;
const originalExit = process.exit;

interface CapturedRun {
  stdout: string;
  exitCode: number | undefined;
}

async function runWithStdin(
  payload: object,
  fn: () => Promise<void>,
): Promise<CapturedRun> {
  const inputStream = Readable.from([Buffer.from(JSON.stringify(payload) + '\n', 'utf-8')]);
  // Node's process.stdin has lots of attached methods (TTY checks,
  // event emitters, etc) but the adapter just calls .on('data') /
  // 'end' / consumes via async iteration. Readable.from satisfies all
  // three.
  Object.defineProperty(process, 'stdin', { value: inputStream, configurable: true });

  let captured = '';
  const outputStream = new Writable({
    write(chunk, _enc, cb) {
      captured += chunk.toString();
      cb();
    },
  });
  Object.defineProperty(process, 'stdout', { value: outputStream, configurable: true });

  let exitCode: number | undefined;
  (process as any).exit = ((code?: number) => {
    exitCode = code;
    throw new Error('exit:' + code);
  }) as never;

  try {
    await fn();
  } catch (e) {
    if (!String((e as Error).message).startsWith('exit:')) throw e;
  } finally {
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: originalStdout, configurable: true });
    (process as any).exit = originalExit;
  }
  return { stdout: captured, exitCode };
}

beforeEach(() => {
  // Stub fetch globally so the OpenBoxCoreClient governance/evaluate
  // call returns a canned allow verdict instead of a real HTTP call.
  vi.stubGlobal('fetch', async (_url: string, _init?: RequestInit) => {
    return new Response(
      JSON.stringify({
        verdict: { arm: 'allow', reason: '' },
        guardrails_result: null,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runtime/claude-code/hook-handler', () => {
  it('exits 0 cleanly when OPENBOX_API_KEY is unset (pass-through)', async () => {
    const before = process.env.OPENBOX_API_KEY;
    delete process.env.OPENBOX_API_KEY;
    try {
      const r = await runWithStdin(
        { hook_event_name: 'PreToolUse', session_id: 'S', tool_name: 'Read', tool_input: {} },
        async () => {
          const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler');
          await runClaudeHook();
        },
      );
      expect(r.exitCode).toBe(0);
    } finally {
      if (before !== undefined) process.env.OPENBOX_API_KEY = before;
    }
  });

  it('runs the dispatch loop end-to-end when API key is set + DRY_RUN=true', async () => {
    const beforeKey = process.env.OPENBOX_API_KEY;
    const beforeDry = process.env.DRY_RUN;
    process.env.OPENBOX_API_KEY = 'obx_live_test';
    process.env.OPENBOX_ENDPOINT = 'http://localhost:8086';
    process.env.DRY_RUN = 'true';
    try {
      const r = await runWithStdin(
        { hook_event_name: 'PreToolUse', session_id: 'S', tool_name: 'Read', tool_input: { file_path: '/tmp/x' } },
        async () => {
          const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler');
          await runClaudeHook();
        },
      );
      // DRY_RUN handlers return undefined → adapter writes the
      // protocol's no-decision shape, then exits cleanly (0) or
      // returns. Either is success. The strong assertion is the
      // protocol contract: anything emitted to stdout MUST parse as
      // JSON (claude-code reads stdout as the verdict envelope).
      expect(r.exitCode === undefined || r.exitCode === 0).toBe(true);
      if (r.stdout.length > 0) {
        expect(() => JSON.parse(r.stdout)).not.toThrow();
      }
    } finally {
      if (beforeKey !== undefined) process.env.OPENBOX_API_KEY = beforeKey;
      else delete process.env.OPENBOX_API_KEY;
      if (beforeDry !== undefined) process.env.DRY_RUN = beforeDry;
      else delete process.env.DRY_RUN;
    }
  });
});

describe('runtime/cursor/hook-handler', () => {
  it('exits 0 cleanly when OPENBOX_API_KEY is unset', async () => {
    const before = process.env.OPENBOX_API_KEY;
    delete process.env.OPENBOX_API_KEY;
    try {
      const r = await runWithStdin(
        { hook_event_name: 'beforeShellExecution', conversation_id: 'C', command: 'ls' },
        async () => {
          const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler');
          await runCursorHook();
        },
      );
      expect(r.exitCode).toBe(0);
    } finally {
      if (before !== undefined) process.env.OPENBOX_API_KEY = before;
    }
  });

  it('drives the dispatch loop with API key + DRY_RUN', async () => {
    const beforeKey = process.env.OPENBOX_API_KEY;
    const beforeDry = process.env.DRY_RUN;
    process.env.OPENBOX_API_KEY = 'obx_live_test';
    process.env.OPENBOX_ENDPOINT = 'http://localhost:8086';
    process.env.DRY_RUN = 'true';
    try {
      const r = await runWithStdin(
        { hook_event_name: 'beforeShellExecution', conversation_id: 'C', command: 'ls' },
        async () => {
          const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler');
          await runCursorHook();
        },
      );
      // Same protocol contract as claude-code - DRY_RUN takes the
      // adapter all the way through dispatch + emit; clean dispatch
      // means exit 0 or no exit; anything else is a regression.
      expect(r.exitCode === undefined || r.exitCode === 0).toBe(true);
      if (r.stdout.length > 0) {
        expect(() => JSON.parse(r.stdout)).not.toThrow();
      }
    } finally {
      if (beforeKey !== undefined) process.env.OPENBOX_API_KEY = beforeKey;
      else delete process.env.OPENBOX_API_KEY;
      if (beforeDry !== undefined) process.env.DRY_RUN = beforeDry;
      else delete process.env.DRY_RUN;
    }
  });
});
