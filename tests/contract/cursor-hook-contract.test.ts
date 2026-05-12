// End-to-end contract test for the Cursor hook adapter.
//
// What this catches that unit tests didn't:
//   - The Cursor docs say `beforeSubmitPrompt` returns `{continue, user_message?}`
//     not `{permission, ...}`; a verdictShape mismatch the SDK had been
//     emitting for months. This test asserts the exact stdout JSON shape
//     for each cursor hook event.
//   - `user_message` is snake_case per cursor.com/docs/hooks.md, NOT
//     `userMessage`. We had been emitting camelCase.
//   - Shell-tool envelopes must reach the backend with
//     `activity_type: "ShellExecution"` (canonical), not `agent_action`.
//
// How: drive `createCursorAdapter` end-to-end with a stdin envelope
// → real mappers → capturing-mock session → captured stdout JSON.

import { describe, expect, test } from 'vitest';
import { createCursorAdapter } from '../../ts/src/core-client/generated/runtime/cursor.js';
import { handleBeforeSubmitPrompt } from '../../ts/src/runtime/cursor/mappers/prompt.js';
import { handleBeforeShellExecution } from '../../ts/src/runtime/cursor/mappers/shell.js';
import { handleAfterAgentResponse } from '../../ts/src/runtime/cursor/mappers/observe.js';

interface Captured {
  stdout: string[];
  exitCodes: number[];
}

function capture(): Captured {
  return { stdout: [], exitCodes: [] };
}

function adapterIO(cap: Captured, stdin: string) {
  return {
    readStdin: async () => stdin,
    writeStdout: (s: string) => {
      cap.stdout.push(s);
    },
    exit: ((code: number) => {
      cap.exitCodes.push(code);
    }) as unknown as (code: number) => never,
  };
}

const cfg = { idleTimeoutMs: 60_000, sessionStorePath: '' } as never;

interface ActivityCall {
  eventType: string;
  activityType: string;
  payload: unknown;
}

function makeCapturingSession(
  captured: ActivityCall[],
  arm: 'allow' | 'block' | 'halt' | 'require_approval' = 'allow',
  reason?: string,
) {
  return {
    activity: async (eventType: string, activityType: string, body: { input: unknown[] }) => {
      captured.push({ eventType, activityType, payload: body.input?.[0] });
      return { arm, reason, riskScore: 0 };
    },
    workflowStarted: async () => undefined,
    workflowCompleted: async () => undefined,
  };
}

describe('cursor adapter end-to-end stdin → stdout', () => {
  test('beforeSubmitPrompt allow → {continue: true} (NOT {permission:"allow"})', async () => {
    const cap = capture();
    const captured: ActivityCall[] = [];
    await createCursorAdapter({
      core: {} as never,
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        beforeSubmitPrompt: (env) =>
          handleBeforeSubmitPrompt(env, makeCapturingSession(captured) as never, cfg),
      },
      ...adapterIO(
        cap,
        JSON.stringify({
          hook_event_name: 'beforeSubmitPrompt',
          conversation_id: 'c',
          prompt: 'hello',
        }),
      ),
    }).run();

    const out = JSON.parse(cap.stdout[0]);
    expect(out).toEqual({ continue: true });
    expect(out.permission).toBeUndefined();
    expect(captured.find((c) => c.eventType === 'ActivityStarted')?.activityType).toBe(
      'PromptSubmission',
    );
  });

  test('beforeSubmitPrompt block → {continue: false, user_message}', async () => {
    const cap = capture();
    const captured: ActivityCall[] = [];
    await createCursorAdapter({
      core: {} as never,
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        beforeSubmitPrompt: (env) =>
          handleBeforeSubmitPrompt(
            env,
            makeCapturingSession(captured, 'block', 'no banned prompts') as never,
            cfg,
          ),
      },
      ...adapterIO(
        cap,
        JSON.stringify({
          hook_event_name: 'beforeSubmitPrompt',
          conversation_id: 'c',
          prompt: 'banned',
        }),
      ),
    }).run();

    const out = JSON.parse(cap.stdout[0]);
    expect(out.continue).toBe(false);
    expect(out.user_message).toBe('[OpenBox] no banned prompts');
    expect(out.userMessage).toBeUndefined();
  });

  test('beforeShellExecution allow → {permission: "allow"} + activity_type ShellExecution', async () => {
    const cap = capture();
    const captured: ActivityCall[] = [];
    await createCursorAdapter({
      core: {} as never,
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        beforeShellExecution: (env) =>
          handleBeforeShellExecution(env, makeCapturingSession(captured) as never, cfg),
      },
      ...adapterIO(
        cap,
        JSON.stringify({
          hook_event_name: 'beforeShellExecution',
          conversation_id: 'c',
          generation_id: 'contract-shell-allow-' + Math.random().toString(36).slice(2),
          command: 'touch /tmp/x',
        }),
      ),
    }).run();

    const out = JSON.parse(cap.stdout[0]);
    expect(out).toEqual({ permission: 'allow' });
    expect(captured[0]?.activityType).toBe('ShellExecution');
    expect(captured[0]?.activityType).not.toBe('agent_action');
  });

  test('beforeShellExecution block → permission:"deny" + user_message (snake_case)', async () => {
    const cap = capture();
    const captured: ActivityCall[] = [];
    await createCursorAdapter({
      core: {} as never,
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        beforeShellExecution: (env) =>
          handleBeforeShellExecution(
            env,
            makeCapturingSession(captured, 'block', 'forbidden cmd') as never,
            cfg,
          ),
      },
      ...adapterIO(
        cap,
        JSON.stringify({
          hook_event_name: 'beforeShellExecution',
          conversation_id: 'c',
          generation_id: 'contract-shell-block-' + Math.random().toString(36).slice(2),
          command: 'rm -rf /',
        }),
      ),
    }).run();

    const out = JSON.parse(cap.stdout[0]);
    expect(out.permission).toBe('deny');
    expect(out.user_message).toBe('[OpenBox] forbidden cmd');
    expect(out.userMessage).toBeUndefined();
  });

  test('afterAgentResponse → empty object (cursor-observe verdict shape)', async () => {
    const cap = capture();
    const captured: ActivityCall[] = [];
    await createCursorAdapter({
      core: {} as never,
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        afterAgentResponse: (env) =>
          handleAfterAgentResponse(env, makeCapturingSession(captured) as never, cfg),
      },
      ...adapterIO(
        cap,
        JSON.stringify({
          hook_event_name: 'afterAgentResponse',
          conversation_id: 'c',
          response: 'done',
        }),
      ),
    }).run();

    const out = JSON.parse(cap.stdout[0]);
    expect(out).toEqual({});
  });

  test('cursor-permission require_approval (poll timed out) → deny (ask is silently no-op in Cursor; deny is the only working gate)', async () => {
    // Bundle audit (workbench.desktop.main.js): the only consumers of
    // hook `permission` branch on `=== "deny"`. `ask` is accepted by
    // the validator but no UI renders for it on tool/shell/MCP gates.
    // Returning ask = silent proceed. So we always return deny on
    // poll-timeout and surface our own toast as the actual gate.
    const cap = capture();
    const captured: ActivityCall[] = [];
    await createCursorAdapter({
      core: {} as never,
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        beforeShellExecution: (env) =>
          handleBeforeShellExecution(
            env,
            makeCapturingSession(
              captured,
              'require_approval',
              'sensitive shell command',
            ) as never,
            cfg,
          ),
      },
      ...adapterIO(
        cap,
        JSON.stringify({
          hook_event_name: 'beforeShellExecution',
          conversation_id: 'c',
          generation_id: 'contract-shell-require-' + Math.random().toString(36).slice(2),
          command: 'rm /tmp/x',
        }),
      ),
    }).run();

    const out = JSON.parse(cap.stdout[0]);
    expect(out.permission).toBe('deny');
    expect(out.permission).not.toBe('ask');
    expect(out.user_message).toContain('[OpenBox] approval pending');
  });

  test('cursor-continue require_approval (beforeSubmitPrompt) → continue:false (no inline-ask available in Cursor API)', async () => {
    const cap = capture();
    const captured: ActivityCall[] = [];
    await createCursorAdapter({
      core: {} as never,
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        beforeSubmitPrompt: (env) =>
          handleBeforeSubmitPrompt(
            env,
            makeCapturingSession(
              captured,
              'require_approval',
              'high-trust threshold exceeded',
            ) as never,
            cfg,
          ),
      },
      ...adapterIO(
        cap,
        JSON.stringify({
          hook_event_name: 'beforeSubmitPrompt',
          conversation_id: 'c',
          prompt: 'do something',
        }),
      ),
    }).run();

    const out = JSON.parse(cap.stdout[0]);
    expect(out.continue).toBe(false);
    expect(out.user_message).toContain('[OpenBox] approval needed');
    expect(out.user_message).toContain('Approve in the OpenBox notification');
    expect(out.user_message).toContain('resubmit');
    expect(out.user_message).not.toContain('dashboard');
    expect(out).not.toHaveProperty('permission');
  });

  test('reason em-dash sanitation: U+2014 / U+2013 are stripped from user_message', async () => {
    const cap = capture();
    const captured: ActivityCall[] = [];
    await createCursorAdapter({
      core: {} as never,
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        beforeShellExecution: (env) =>
          handleBeforeShellExecution(
            env,
            makeCapturingSession(
              captured,
              'block',
              'crosses high-trust threshold; review first',
            ) as never,
            cfg,
          ),
      },
      ...adapterIO(
        cap,
        JSON.stringify({
          hook_event_name: 'beforeShellExecution',
          conversation_id: 'c',
          generation_id: 'contract-shell-emdash-' + Math.random().toString(36).slice(2),
          command: 'ls',
        }),
      ),
    }).run();

    const out = JSON.parse(cap.stdout[0]);
    expect(out.user_message).not.toContain('—');
    expect(out.user_message).not.toContain('–');
    expect(out.user_message).toBe('[OpenBox] crosses high-trust threshold - review first');
  });
});
