// In-process coverage for hook handlers that normally run as stdin/stdout
// subprocesses under Claude Code or Cursor.

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
    // Core's /governance/evaluate returns `verdict` as a string arm
    // (mapVerdict reads response.verdict directly; a nested object would
    // normalize to a fail-closed block). Supply a real allow verdict.
    return new Response(
      JSON.stringify({
        verdict: 'allow',
        reason: '',
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
  it('denies decision-capable hooks when OPENBOX_API_KEY is unset', async () => {
    const before = process.env.OPENBOX_API_KEY;
    process.env.OPENBOX_API_KEY = '';
    try {
      const r = await runWithStdin(
        { hook_event_name: 'PreToolUse', session_id: 'S', tool_name: 'Read', tool_input: {} },
        async () => {
          const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler');
          await runClaudeHook();
        },
      );
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({
        hookSpecificOutput: {
          permissionDecision: 'deny',
          permissionDecisionReason: expect.stringContaining('missing OPENBOX_API_KEY'),
        },
      });
    } finally {
      if (before !== undefined) process.env.OPENBOX_API_KEY = before;
    }
  });

  it('runs the dispatch loop end-to-end when API key and Core URL are set', async () => {
    const beforeKey = process.env.OPENBOX_API_KEY;
    const beforeCore = process.env.OPENBOX_CORE_URL;
    // Format-valid runtime key so the OpenBoxCoreClient passes its key
    // validation and actually reaches the stubbed /evaluate fetch
    // (which returns the canned allow verdict) instead of failing closed.
    process.env.OPENBOX_API_KEY = 'obx_test_' + 'a'.repeat(48);
    process.env.OPENBOX_CORE_URL = 'http://localhost:8086';
    try {
      const r = await runWithStdin(
        { hook_event_name: 'PreToolUse', session_id: 'S', tool_name: 'Read', tool_input: { file_path: '/tmp/x' } },
        async () => {
          const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler');
          await runClaudeHook();
        },
      );
      // The fetch stub above supplies an allow verdict, so the
      // end-to-end dispatch must complete with a clean exit 0.
      expect(r.exitCode).toBe(0);
      // PreToolUse is a decision-capable hook: claude-code reads stdout
      // as the permission envelope. An allow verdict renders an explicit
      // allow permissionDecision for the PreToolUse event.
      expect(r.stdout.length).toBeGreaterThan(0);
      expect(JSON.parse(r.stdout)).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
        },
      });
    } finally {
      if (beforeKey !== undefined) process.env.OPENBOX_API_KEY = beforeKey;
      else delete process.env.OPENBOX_API_KEY;
      if (beforeCore !== undefined) process.env.OPENBOX_CORE_URL = beforeCore;
      else delete process.env.OPENBOX_CORE_URL;
    }
  });
});

describe('runtime/cursor/hook-handler', () => {
  it('denies decision-capable hooks when OPENBOX_API_KEY is unset', async () => {
    const before = process.env.OPENBOX_API_KEY;
    process.env.OPENBOX_API_KEY = '';
    try {
      const r = await runWithStdin(
        { hook_event_name: 'beforeShellExecution', conversation_id: 'C', command: 'ls' },
        async () => {
          const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler');
          await runCursorHook();
        },
      );
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({
        permission: 'deny',
        user_message: expect.stringContaining('missing OPENBOX_API_KEY'),
      });
    } finally {
      if (before !== undefined) process.env.OPENBOX_API_KEY = before;
      else delete process.env.OPENBOX_API_KEY;
    }
  });

  it('drives the dispatch loop with API key and Core URL', async () => {
    const beforeKey = process.env.OPENBOX_API_KEY;
    const beforeCore = process.env.OPENBOX_CORE_URL;
    // Format-valid runtime key so the OpenBoxCoreClient reaches the
    // stubbed /evaluate fetch (canned allow verdict) instead of failing closed.
    process.env.OPENBOX_API_KEY = 'obx_test_' + 'a'.repeat(48);
    process.env.OPENBOX_CORE_URL = 'http://localhost:8086';
    try {
      const r = await runWithStdin(
        { hook_event_name: 'beforeShellExecution', conversation_id: 'C', command: 'ls' },
        async () => {
          const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler');
          await runCursorHook();
        },
      );
      // Clean dispatch on an allow verdict completes with exit 0.
      expect(r.exitCode).toBe(0);
      // beforeShellExecution is a decision-capable cursor hook; an allow
      // verdict renders cursor's allow permission envelope on stdout.
      expect(r.stdout.length).toBeGreaterThan(0);
      expect(JSON.parse(r.stdout)).toEqual({ permission: 'allow' });
    } finally {
      if (beforeKey !== undefined) process.env.OPENBOX_API_KEY = beforeKey;
      else delete process.env.OPENBOX_API_KEY;
      if (beforeCore !== undefined) process.env.OPENBOX_CORE_URL = beforeCore;
      else delete process.env.OPENBOX_CORE_URL;
    }
  });
});
