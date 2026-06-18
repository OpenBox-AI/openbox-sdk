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

type CorePayload = Record<string, any>;

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

function makeAllowingCore(captured: CorePayload[]) {
  return {
    evaluate: async (payload: CorePayload) => {
      captured.push(payload);
      return {
        verdict: 'allow',
        action: 'allow',
        risk_score: 0,
        reason: 'allow',
      };
    },
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

  test('real CursorSession sends spans as parent-plus-hook payloads', async () => {
    const promptCap = capture();
    const promptPayloads: CorePayload[] = [];
    await createCursorAdapter({
      core: makeAllowingCore(promptPayloads) as never,
      resolveSession: async () => ({
        workflowId: 'wf-cursor-contract',
        runId: 'run-cursor-contract',
      }),
      handlers: {
        beforeSubmitPrompt: (env, session) => handleBeforeSubmitPrompt(env, session, cfg),
      },
      ...adapterIO(
        promptCap,
        JSON.stringify({
          hook_event_name: 'beforeSubmitPrompt',
          conversation_id: 'c',
          generation_id: 'contract-real-session-prompt',
          prompt: 'summarize this file',
        }),
      ),
    }).run();

    expect(JSON.parse(promptCap.stdout[0])).toEqual({ continue: true });
    expect(promptPayloads).toHaveLength(3);
    const promptSignals = promptPayloads.filter(
      (payload) =>
        payload.event_type === 'SignalReceived' &&
        payload.activity_type === 'user_prompt',
    );
    expect(promptSignals).toHaveLength(1);
    expect(promptSignals[0]?.hook_trigger).toBeUndefined();
    expect(promptSignals[0]?.spans).toBeUndefined();
    expect(promptSignals[0]?.span_count).toBeUndefined();
    const promptStarts = promptPayloads.filter(
      (payload) =>
        payload.event_type === 'ActivityStarted' &&
        payload.activity_type === 'PromptSubmission',
    );
    expect(promptStarts).toHaveLength(1);
    const [promptParent] = promptStarts;
    expect(promptParent).toMatchObject({
      workflow_id: 'wf-cursor-contract',
      run_id: 'run-cursor-contract',
      session_id: 'c',
      prompt: 'summarize this file',
    });
    expect(promptParent.hook_trigger).toBeUndefined();
    expect(promptParent.spans).toBeUndefined();
    expect(promptParent.span_count).toBeUndefined();
    const promptCompleted = promptPayloads.find(
      (payload) =>
        payload.event_type === 'ActivityCompleted' &&
        payload.activity_type === 'PromptSubmission',
    );
    expect(promptCompleted?.activity_id).toBe(promptParent.activity_id);
    expect(promptCompleted?.hook_trigger).toBeUndefined();
    expect(promptCompleted?.spans).toBeUndefined();
    expect(promptCompleted?.span_count).toBeUndefined();
    expect(promptPayloads.indexOf(promptSignals[0]!)).toBeLessThan(promptPayloads.indexOf(promptParent));
    expect(promptPayloads.indexOf(promptParent)).toBeLessThan(promptPayloads.indexOf(promptCompleted!));

    const responseCap = capture();
    const responsePayloads: CorePayload[] = [];
    await createCursorAdapter({
      core: makeAllowingCore(responsePayloads) as never,
      resolveSession: async () => ({
        workflowId: 'wf-cursor-contract',
        runId: 'run-cursor-contract',
      }),
      handlers: {
        afterAgentResponse: (env, session) => handleAfterAgentResponse(env, session, cfg),
      },
      ...adapterIO(
        responseCap,
        JSON.stringify({
          hook_event_name: 'afterAgentResponse',
          conversation_id: 'c',
          generation_id: 'contract-real-session-response',
          response: {
            content: [{ type: 'text', text: 'Cursor answer.' }],
            usage_metadata: {
              input_tokens: 3,
              output_tokens: 2,
            },
            model: 'cursor-test-model',
          },
        }),
      ),
    }).run();

    expect(JSON.parse(responseCap.stdout[0])).toEqual({});
    expect(responsePayloads).toHaveLength(2);
    expect(responsePayloads[0]).toMatchObject({
      event_type: 'ActivityCompleted',
      activity_type: 'LLMCompleted',
    });
    expect(responsePayloads[1]).toMatchObject({
      event_type: 'ActivityCompleted',
      activity_type: 'LLMCompleted',
      hook_trigger: true,
    });
    const responseCompletes = responsePayloads.filter(
      (payload) =>
        payload.event_type === 'ActivityCompleted' &&
        payload.activity_type === 'LLMCompleted',
    );
    expect(responseCompletes).toHaveLength(2);
    const [responseParent, responseHook] = responseCompletes;
    expect(responseParent).toMatchObject({
      workflow_id: 'wf-cursor-contract',
      run_id: 'run-cursor-contract',
      llm_model: 'cursor-test-model',
      input_tokens: 3,
      output_tokens: 2,
      total_tokens: 5,
    });
    expect(responseParent.hook_trigger).toBeUndefined();
    expect(responseParent.spans).toBeUndefined();
    expect(responseParent.span_count).toBeUndefined();
    expect(responseHook).toMatchObject({
      workflow_id: responseParent.workflow_id,
      run_id: responseParent.run_id,
      activity_id: responseParent.activity_id,
      event_type: responseParent.event_type,
      activity_type: responseParent.activity_type,
      hook_trigger: true,
      span_count: 1,
    });
    expect(responseHook.spans?.[0]).toMatchObject({
      name: 'openbox.cursor.assistant_output',
      semantic_type: 'llm_completion',
      stage: 'completed',
      model: 'cursor-test-model',
      total_tokens: 5,
      attributes: {
        'gen_ai.system': 'cursor',
        'gen_ai.response.model': 'cursor-test-model',
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
