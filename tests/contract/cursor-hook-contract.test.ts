// Cursor hook adapter contract test: stdin envelope, real mapper, recorded
// session, and exact stdout verdict shape.

import { describe, expect, test } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createCursorAdapter } from '../../ts/src/core-client/generated/runtime/cursor.js';
import { handleBeforeSubmitPrompt } from '../../ts/src/runtime/cursor/mappers/prompt.js';
import { handleBeforeShellExecution } from '../../ts/src/runtime/cursor/mappers/shell.js';
import {
  handleAfterAgentResponse,
  handleAfterFileEdit,
  handleAfterShellExecution,
} from '../../ts/src/runtime/cursor/mappers/observe.js';
import { handleAfterMCPExecution } from '../../ts/src/runtime/cursor/mappers/mcp-response.js';
import {
  handlePostToolUse,
  handlePostToolUseFailure,
} from '../../ts/src/runtime/cursor/mappers/tool-completion.js';

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

const cfg = {
  idleTimeoutMs: 60_000,
  sessionDir: path.join(tmpdir(), 'openbox-cursor-contract-test'),
  sessionStorePath: '',
} as never;
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
    openActivity: async (activityType: string, body: unknown) => {
      const payload = body as { activityId?: string } | undefined;
      const activityId = payload?.activityId ?? `cursor-open-${captured.length + 1}`;
      captured.push({ eventType: 'ActivityStarted', activityType, payload: body });
      return {
        activityId,
        verdict: { arm, reason, riskScore: 0 },
        complete: async (completionBody: unknown, completionActivityType?: string) => {
          captured.push({
            eventType: 'ActivityCompleted',
            activityType: completionActivityType ?? activityType,
            payload: completionBody,
          });
          return { arm, reason, riskScore: 0 };
        },
      };
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

  test('postToolUse with documented payload → empty object + completed tool telemetry', async () => {
    const cap = capture();
    const captured: ActivityCall[] = [];
    const suffix = Math.random().toString(36).slice(2);
    const command = `npm test --cursor-contract-post-${suffix}`;
    await createCursorAdapter({
      core: {} as never,
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        postToolUse: (env) =>
          handlePostToolUse(env, makeCapturingSession(captured) as never, cfg),
      },
      ...adapterIO(
        cap,
        JSON.stringify({
          hook_event_name: 'postToolUse',
          conversation_id: 'c',
          generation_id: `contract-post-tool-${suffix}`,
          tool_name: 'Shell',
          tool_input: { command },
          tool_output: '{"exitCode":0,"stdout":"ok"}',
          tool_use_id: 'tool-1',
          cwd: '/repo',
          duration: 42,
          model: 'claude-sonnet-4-20250514',
        }),
      ),
    }).run();

    expect(JSON.parse(cap.stdout[0])).toEqual({});
    expect(captured[0]).toMatchObject({
      eventType: 'ActivityCompleted',
      activityType: 'ShellExecution',
      payload: {
        activityId: 'tool-1',
        durationMs: 42,
        sessionId: 'c',
        llmModel: 'claude-sonnet-4-20250514',
        toolName: 'Shell',
        toolType: 'shell',
      },
    });
  });

  test('postToolUseFailure with documented payload → empty object + failure telemetry', async () => {
    const cap = capture();
    const captured: ActivityCall[] = [];
    const suffix = Math.random().toString(36).slice(2);
    const command = `npm test --cursor-contract-failure-${suffix}`;
    await createCursorAdapter({
      core: {} as never,
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        postToolUseFailure: (env) =>
          handlePostToolUseFailure(env, makeCapturingSession(captured) as never, cfg),
      },
      ...adapterIO(
        cap,
        JSON.stringify({
          hook_event_name: 'postToolUseFailure',
          conversation_id: 'c',
          generation_id: `contract-post-tool-failure-${suffix}`,
          tool_name: 'Shell',
          tool_input: { command },
          tool_use_id: 'tool-2',
          cwd: '/repo',
          error_message: 'Command timed out after 30s',
          failure_type: 'timeout',
          duration: 5000,
          is_interrupt: false,
        }),
      ),
    }).run();

    expect(JSON.parse(cap.stdout[0])).toEqual({});
    expect(captured[0]).toMatchObject({
      eventType: 'ActivityCompleted',
      activityType: 'ShellExecution',
      payload: {
        activityId: 'tool-2',
        durationMs: 5000,
        finishReason: 'timeout',
        toolName: 'Shell',
        toolType: 'shell',
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
    expect(promptPayloads).toHaveLength(4);
    const workflowStarted = promptPayloads.find(
      (payload) => payload.event_type === 'WorkflowStarted',
    );
    expect(workflowStarted).toMatchObject({
      workflow_id: 'wf-cursor-contract',
      run_id: 'run-cursor-contract',
    });
    expect(promptPayloads[0]).toBe(workflowStarted);
    const promptSignals = promptPayloads.filter(
      (payload) =>
        payload.event_type === 'SignalReceived' &&
        payload.activity_type === 'user_prompt',
    );
    expect(promptSignals).toHaveLength(1);
    expect(promptSignals[0]?.hook_trigger).toBe(false);
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
    expect(promptParent.hook_trigger).toBe(false);
    expect(promptParent.spans).toBeUndefined();
    expect(promptParent.span_count).toBeUndefined();
    const promptCompleted = promptPayloads.find(
      (payload) =>
        payload.event_type === 'ActivityCompleted' &&
        payload.activity_type === 'PromptSubmission',
    );
    expect(promptCompleted?.activity_id).toBe(promptParent.activity_id);
    expect(promptCompleted?.hook_trigger).toBe(false);
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
    expect(responsePayloads).toHaveLength(3);
    expect(responsePayloads[0]).toMatchObject({
      event_type: 'ActivityStarted',
      activity_type: 'LLMCompleted',
    });
    expect(responsePayloads[1]).toMatchObject({
      event_type: 'ActivityCompleted',
      activity_type: 'LLMCompleted',
      hook_trigger: false,
    });
    expect(responsePayloads[2]).toMatchObject({
      event_type: 'ActivityStarted',
      activity_type: 'LLMCompleted',
      hook_trigger: true,
    });
    const responseCompletes = responsePayloads.filter(
      (payload) =>
        payload.event_type === 'ActivityCompleted' &&
        payload.activity_type === 'LLMCompleted',
    );
    expect(responseCompletes).toHaveLength(1);
    const [responseParent] = responseCompletes;
    const responseHook = responsePayloads.find(
      (payload) =>
        payload.event_type === 'ActivityStarted' &&
        payload.activity_type === 'LLMCompleted' &&
        payload.hook_trigger === true,
    );
    expect(responseParent).toMatchObject({
      workflow_id: 'wf-cursor-contract',
      run_id: 'run-cursor-contract',
      llm_model: 'cursor-test-model',
      input_tokens: 3,
      output_tokens: 2,
      total_tokens: 5,
    });
    expect(responseParent.hook_trigger).toBe(false);
    expect(responseParent).not.toHaveProperty('spans');
    expect(responseParent).not.toHaveProperty('span_count');
    expect(responseHook).toBeDefined();
    expect(responseHook).toMatchObject({
      workflow_id: responseParent.workflow_id,
      run_id: responseParent.run_id,
      activity_id: responseParent.activity_id,
      event_type: 'ActivityStarted',
      activity_type: responseParent.activity_type,
      hook_trigger: true,
      span_count: 1,
    });
    expect(responseHook!.spans?.[0]).toMatchObject({
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

  test('real CursorSession sends postToolUse spans as parent-plus-hook payloads', async () => {
    const cap = capture();
    const payloads: CorePayload[] = [];
    const suffix = Math.random().toString(36).slice(2);
    const command = `npm test --cursor-real-post-${suffix}`;
    await createCursorAdapter({
      core: makeAllowingCore(payloads) as never,
      resolveSession: async () => ({
        workflowId: 'wf-cursor-tool-contract',
        runId: 'run-cursor-tool-contract',
      }),
      handlers: {
        postToolUse: (env, session) => handlePostToolUse(env, session, cfg),
      },
      ...adapterIO(
        cap,
        JSON.stringify({
          hook_event_name: 'postToolUse',
          conversation_id: 'c',
          generation_id: `contract-real-post-tool-${suffix}`,
          tool_name: 'Shell',
          tool_input: { command },
          tool_output: '{"exitCode":0,"stdout":"ok"}',
          tool_use_id: 'tool-contract-1',
          cwd: '/repo',
          duration: 42,
          model: 'claude-sonnet-4-20250514',
        }),
      ),
    }).run();

    expect(JSON.parse(cap.stdout[0])).toEqual({});
    expect(payloads).toHaveLength(2);
    const [parent, hook] = payloads;
    expect(parent).toMatchObject({
      workflow_id: 'wf-cursor-tool-contract',
      run_id: 'run-cursor-tool-contract',
      event_type: 'ActivityCompleted',
      activity_type: 'ShellExecution',
      activity_id: 'tool-contract-1',
      session_id: 'c',
      llm_model: 'claude-sonnet-4-20250514',
      tool_name: 'Shell',
      tool_type: 'shell',
      duration_ms: 42,
    });
    expect(parent.spans).toBeUndefined();
    expect(parent.hook_trigger).toBe(false);
    expect(hook).toMatchObject({
      workflow_id: parent.workflow_id,
      run_id: parent.run_id,
      event_type: 'ActivityStarted',
      activity_type: parent.activity_type,
      activity_id: parent.activity_id,
      hook_trigger: true,
      span_count: 1,
    });
    expect(hook.spans?.[0]).toMatchObject({
      semantic_type: 'internal',
      attributes: {
        'shell.command': command,
        'openbox.tool.name': 'Shell',
      },
    });
  });

  test('real CursorSession sends afterShellExecution spans as parent-plus-hook payloads', async () => {
    const cap = capture();
    const payloads: CorePayload[] = [];
    const suffix = Math.random().toString(36).slice(2);
    const command = `npm run cursor-after-shell-${suffix}`;
    await createCursorAdapter({
      core: makeAllowingCore(payloads) as never,
      resolveSession: async () => ({
        workflowId: 'wf-cursor-after-shell-contract',
        runId: 'run-cursor-after-shell-contract',
      }),
      handlers: {
        afterShellExecution: (env, session) => handleAfterShellExecution(env, session, cfg),
      },
      ...adapterIO(
        cap,
        JSON.stringify({
          hook_event_name: 'afterShellExecution',
          conversation_id: 'c',
          generation_id: `contract-real-after-shell-${suffix}`,
          command,
          output: 'ok',
          duration: 77,
          cwd: '/repo',
          sandbox: false,
        }),
      ),
    }).run();

    expect(JSON.parse(cap.stdout[0])).toEqual({});
    expect(payloads).toHaveLength(2);
    const [parent, hook] = payloads;
    expect(parent).toMatchObject({
      workflow_id: 'wf-cursor-after-shell-contract',
      run_id: 'run-cursor-after-shell-contract',
      event_type: 'ActivityCompleted',
      activity_type: 'ShellExecution',
      session_id: 'c',
      tool_name: 'Shell',
      tool_type: 'shell',
      duration_ms: 77,
    });
    expect(parent.spans).toBeUndefined();
    expect(parent.hook_trigger).toBe(false);
    expect(hook).toMatchObject({
      workflow_id: parent.workflow_id,
      run_id: parent.run_id,
      event_type: 'ActivityStarted',
      activity_type: parent.activity_type,
      activity_id: parent.activity_id,
      hook_trigger: true,
      span_count: 1,
    });
    expect(hook.spans?.[0]).toMatchObject({
      semantic_type: 'internal',
      attributes: {
        'shell.command': command,
        'openbox.tool.name': 'Shell',
      },
    });
  });

  test('real CursorSession sends afterMCPExecution spans as parent-plus-hook payloads', async () => {
    const cap = capture();
    const payloads: CorePayload[] = [];
    const suffix = Math.random().toString(36).slice(2);
    const toolName = `openbox.lookup_${suffix}`;
    await createCursorAdapter({
      core: makeAllowingCore(payloads) as never,
      resolveSession: async () => ({
        workflowId: 'wf-cursor-after-mcp-contract',
        runId: 'run-cursor-after-mcp-contract',
      }),
      handlers: {
        afterMCPExecution: (env, session) => handleAfterMCPExecution(env, session, cfg),
      },
      ...adapterIO(
        cap,
        JSON.stringify({
          hook_event_name: 'afterMCPExecution',
          conversation_id: 'c',
          generation_id: `contract-real-after-mcp-${suffix}`,
          tool_name: toolName,
          tool_input: { query: 'status' },
          result_json: '{"content":[{"type":"text","text":"mcp completed"}]}',
          duration: 88,
        }),
      ),
    }).run();

    expect(JSON.parse(cap.stdout[0])).toEqual({});
    expect(payloads).toHaveLength(2);
    const [parent, hook] = payloads;
    expect(parent).toMatchObject({
      workflow_id: 'wf-cursor-after-mcp-contract',
      run_id: 'run-cursor-after-mcp-contract',
      event_type: 'ActivityCompleted',
      activity_type: 'MCPToolCall',
      session_id: 'c',
      tool_name: toolName,
      tool_type: 'mcp',
      duration_ms: 88,
    });
    expect(parent.spans).toBeUndefined();
    expect(parent.hook_trigger).toBe(false);
    expect(hook).toMatchObject({
      workflow_id: parent.workflow_id,
      run_id: parent.run_id,
      event_type: 'ActivityStarted',
      activity_type: parent.activity_type,
      activity_id: parent.activity_id,
      hook_trigger: true,
      span_count: 1,
    });
    expect(hook.spans?.[0]).toMatchObject({
      semantic_type: 'mcp_tool_call',
      attributes: {
        'mcp.method': 'callTool',
        'mcp.operation': toolName,
        'mcp.server_id': 'unknown',
        'openbox.tool.name': toolName,
      },
    });
  });

  test('real CursorSession sends afterFileEdit spans as parent-plus-hook payloads', async () => {
    const cap = capture();
    const payloads: CorePayload[] = [];
    const suffix = Math.random().toString(36).slice(2);
    const filePath = `/tmp/cursor-after-file-${suffix}.ts`;
    await createCursorAdapter({
      core: makeAllowingCore(payloads) as never,
      resolveSession: async () => ({
        workflowId: 'wf-cursor-after-file-contract',
        runId: 'run-cursor-after-file-contract',
      }),
      handlers: {
        afterFileEdit: (env, session) => handleAfterFileEdit(env, session, cfg),
      },
      ...adapterIO(
        cap,
        JSON.stringify({
          hook_event_name: 'afterFileEdit',
          conversation_id: 'c',
          generation_id: `contract-real-after-file-${suffix}`,
          file_path: filePath,
          edits: [{ old_string: 'old', new_string: 'new' }],
        }),
      ),
    }).run();

    expect(JSON.parse(cap.stdout[0])).toEqual({});
    expect(payloads).toHaveLength(2);
    const [parent, hook] = payloads;
    expect(parent).toMatchObject({
      workflow_id: 'wf-cursor-after-file-contract',
      run_id: 'run-cursor-after-file-contract',
      event_type: 'ActivityCompleted',
      activity_type: 'FileEdit',
      session_id: 'c',
      tool_name: 'FileEdit',
      tool_type: 'file_write',
    });
    expect(parent.spans).toBeUndefined();
    expect(parent.hook_trigger).toBe(false);
    expect(hook).toMatchObject({
      workflow_id: parent.workflow_id,
      run_id: parent.run_id,
      event_type: 'ActivityStarted',
      activity_type: parent.activity_type,
      activity_id: parent.activity_id,
      hook_trigger: true,
      span_count: 1,
    });
    expect(hook.spans?.[0]).toMatchObject({
      semantic_type: 'file_write',
      attributes: {
        'file.path': filePath,
        'file.operation': 'write',
        'openbox.tool.name': 'FileEdit',
      },
    });
  });

  test('cursor-permission require_approval (poll timed out) -> deny (ask is silently no-op in Cursor; deny is the only working gate)', async () => {
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
