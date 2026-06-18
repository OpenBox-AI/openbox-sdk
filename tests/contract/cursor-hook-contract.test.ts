// Cursor hook adapter contract test: stdin envelope, real mapper, recorded
// session, and exact stdout verdict shape.

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
type Arm = 'allow' | 'constrain' | 'block' | 'halt' | 'require_approval';

interface ActivityCall {
  eventType: string;
  activityType: string;
  payload: unknown;
}

function makeCapturingSession(
  captured: ActivityCall[],
  arm: Arm = 'allow',
  reason?: string,
) {
  return {
    activity: async (eventType: string, activityType: string, body: unknown) => {
      captured.push({ eventType, activityType, payload: body });
      return { arm, reason, riskScore: 0 };
    },
    observeActivity: async (eventType: string, activityType: string, body: unknown) => {
      captured.push({ eventType, activityType, payload: body });
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
    const activity = captured[0];
    expect(activity).toMatchObject({
      eventType: 'ActivityCompleted',
      activityType: 'LLMCompleted',
    });
    expect(activity?.payload).toMatchObject({
      sessionId: 'c',
      completion: 'done',
      output: {
        response: 'done',
        _openbox_source: 'cursor',
      },
    });
    expect((activity?.payload as any).spans?.[0]).toMatchObject({
      name: 'openbox.cursor.assistant_output',
      stage: 'completed',
      semantic_type: 'llm_completion',
      attributes: {
        'gen_ai.system': 'cursor',
        'openbox.cursor.event': 'afterAgentResponse',
      },
    });
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
              'crosses high-trust threshold—review first',
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

const permissionEvents = [
  'beforeReadFile',
  'beforeShellExecution',
  'beforeMCPExecution',
  'preToolUse',
  'beforeTabFileRead',
  'subagentStart',
] as const;

function envelopeFor(event: string): Record<string, unknown> {
  return {
    hook_event_name: event,
    conversation_id: 'contract-matrix',
    generation_id: 'contract-matrix-gen',
    prompt: 'review this',
    command: 'echo contract',
    cwd: '/tmp',
    file_path: '/tmp/openbox-contract.txt',
    tool_name: 'openbox.list_agents',
    tool_input: {},
    subagent_id: 'subagent-contract',
    subagent_type: 'agent',
    subagent_model: 'cursor-test-model',
  };
}

async function runDirectVerdict(event: string, arm: Arm) {
  const cap = capture();
  const handler = async () => ({ arm, reason: 'matrix reason' });
  await createCursorAdapter({
    core: {} as never,
    resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
    handlers: { [event]: handler } as never,
    ...adapterIO(cap, JSON.stringify(envelopeFor(event))),
  }).run();
  return JSON.parse(cap.stdout[0]);
}

describe('cursor adapter verdict matrix', () => {
  test.each(['allow', 'constrain'] as const)(
    'beforeSubmitPrompt %s → continue:true',
    async (arm) => {
      const out = await runDirectVerdict('beforeSubmitPrompt', arm);
      expect(out).toEqual({ continue: true });
    },
  );

  test.each(['block', 'halt'] as const)(
    'beforeSubmitPrompt %s → continue:false',
    async (arm) => {
      const out = await runDirectVerdict('beforeSubmitPrompt', arm);
      expect(out.continue).toBe(false);
      expect(out.user_message).toContain(arm === 'halt' ? 'HALT' : 'matrix reason');
      expect(out).not.toHaveProperty('permission');
    },
  );

  test('beforeSubmitPrompt require_approval → continue:false with resubmit guidance', async () => {
    const out = await runDirectVerdict('beforeSubmitPrompt', 'require_approval');
    expect(out.continue).toBe(false);
    expect(out.user_message).toContain('approval needed');
    expect(out.user_message).toContain('resubmit');
    expect(out).not.toHaveProperty('permission');
  });

  test.each(permissionEvents)('%s allow/constrain → permission:allow', async (event) => {
    for (const arm of ['allow', 'constrain'] as const) {
      const out = await runDirectVerdict(event, arm);
      expect(out).toEqual({ permission: 'allow' });
    }
  });

  test.each(permissionEvents)('%s block → permission:deny + user_message', async (event) => {
    const out = await runDirectVerdict(event, 'block');
    expect(out.permission).toBe('deny');
    expect(out.user_message).toBe('[OpenBox] matrix reason');
    expect(out.userMessage).toBeUndefined();
  });

  test.each(permissionEvents)('%s halt → permission:deny + hard stop agent_message', async (event) => {
    const out = await runDirectVerdict(event, 'halt');
    expect(out.permission).toBe('deny');
    expect(out.user_message).toContain('[OpenBox] HALT');
    expect(out.agent_message).toContain('do not proceed');
  });

  test.each(permissionEvents)(
    '%s require_approval → permission:deny + no-invention agent_message',
    async (event) => {
      const out = await runDirectVerdict(event, 'require_approval');
      expect(out.permission).toBe('deny');
      expect(out.permission).not.toBe('ask');
      expect(out.user_message).toContain('approval pending');
      expect(out.agent_message).toContain('Do NOT retry');
      expect(out.agent_message).toContain("don't know");
    },
  );
});
