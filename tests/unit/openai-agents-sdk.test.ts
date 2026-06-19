import { describe, expect, it, vi } from 'vitest';
import {
  OpenBoxAgentsSDKError,
  createOpenBoxAgentsTool,
  runWithOpenBox,
} from '@openbox-ai/openbox-sdk/openai-agents-sdk';
import type {
  GovernanceEventPayload,
  GovernanceVerdictResponse,
  OpenBoxCoreClient,
} from '../../ts/src/core-client/index.js';

type VerdictArm = NonNullable<GovernanceVerdictResponse['verdict']>;

function createMockCore(
  resolve: (
    payload: GovernanceEventPayload,
  ) => Partial<GovernanceVerdictResponse>,
) {
  const events: GovernanceEventPayload[] = [];
  return {
    events,
    core: {
      evaluate: vi.fn(async (payload: GovernanceEventPayload) => {
        events.push(payload);
        return {
          governance_event_id: `evt_${events.length}`,
          verdict: 'allow',
          action: 'allow',
          risk_score: 0,
          ...resolve(payload),
        } satisfies Partial<GovernanceVerdictResponse>;
      }),
      pollApproval: vi.fn(),
    } as unknown as OpenBoxCoreClient,
  };
}

function verdict(
  arm: VerdictArm,
  extra: Partial<GovernanceVerdictResponse> = {},
): Partial<GovernanceVerdictResponse> {
  return {
    verdict: arm,
    action: arm,
    risk_score: 0,
    ...extra,
  };
}

describe('OpenAI Agents SDK OpenBox adapter', () => {
  it('wraps tool execution and emits source-stamped tool events', async () => {
    const mock = createMockCore(() => verdict('allow'));
    const toolFactory = vi.fn((config) => config);
    const execute = vi.fn(async (input) => ({ ok: true, input }));
    const details = {
      toolCall: {
        type: 'function_call',
        callId: 'call-shell-1',
        name: 'Shell',
        namespace: 'local',
        arguments: '{"command":"ls","cwd":"/tmp"}',
      },
    };
    const runContext = { traceId: 'run-context' };

    const wrapped = createOpenBoxAgentsTool(
      {
        name: 'Shell',
        description: 'run shell',
        execute,
      },
      {
        core: mock.core,
        sessionId: 'openai-agent-session',
        toolFactory,
      },
    ) as {
      execute: (
        input: unknown,
        context?: unknown,
        details?: unknown,
      ) => Promise<unknown>;
    };

    await expect(
      wrapped.execute({ command: 'ls', cwd: '/tmp' }, runContext, details),
    ).resolves.toEqual({
      ok: true,
      input: { command: 'ls', cwd: '/tmp' },
    });
    expect(execute).toHaveBeenCalledWith(
      { command: 'ls', cwd: '/tmp' },
      runContext,
      details,
    );

    expect(toolFactory).toHaveBeenCalled();
    const parent = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'ShellExecution' &&
        event.hook_trigger !== true,
    );
    expect(parent).toMatchObject({
      activity_id: 'call-shell-1',
      session_id: 'openai-agent-session',
      tool_name: 'Shell',
      tool_type: 'shell',
    });
    expect(parent?.hook_trigger).toBe(false);
    const activityInput = parent?.activity_input as unknown[] | undefined;
    expect(activityInput?.[0]).toMatchObject({
      _openbox_source: 'openai-agents-sdk',
      tool_name: 'Shell',
      tool_call_id: 'call-shell-1',
      tool_namespace: 'local',
      event_category: 'tool_input',
    });
    const hookEvent = mock.events.find(
      (event) =>
        event.activity_id === 'call-shell-1' && event.hook_trigger === true,
    );
    expect(hookEvent?.spans?.[0]).toMatchObject({
      module: 'openai-agents-sdk',
      name: 'ShellExecution',
      attributes: {
        'openbox.tool.call_id': 'call-shell-1',
        'openbox.tool.namespace': 'local',
      },
    });
    const completed = mock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'ToolCompleted' &&
        event.hook_trigger !== true,
    );
    expect(completed).toMatchObject({
      activity_id: 'call-shell-1',
      activity_type: 'ToolCompleted',
    });
    expect(completed?.hook_trigger).toBe(false);
    const completedHook = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'ToolCompleted' &&
        event.activity_id === 'call-shell-1' &&
        event.hook_trigger === true &&
        event.spans?.[0]?.stage === 'completed',
    );
    expect(completedHook?.spans?.[0]).toMatchObject({
      module: 'openai-agents-sdk',
      stage: 'completed',
      semantic_type: 'internal',
    });
  });

  it('throws a typed error when a tool is blocked', async () => {
    const mock = createMockCore((payload) =>
      payload.event_type === 'ActivityStarted' &&
      payload.activity_type === 'ShellExecution'
        ? verdict('block', { reason: 'shell blocked' })
        : verdict('allow'),
    );
    const wrapped = createOpenBoxAgentsTool(
      {
        name: 'Shell',
        execute: vi.fn(async () => 'should not run'),
      },
      {
        core: mock.core,
        sessionId: 'blocked-session',
        toolFactory: (config) => config,
      },
    ) as { execute: (input: unknown) => Promise<unknown> };

    await expect(wrapped.execute({ command: 'rm -rf /tmp/x' })).rejects.toThrow(
      OpenBoxAgentsSDKError,
    );
  });

  it('uses constrained tool input when Core returns redacted args', async () => {
    const mock = createMockCore((payload) =>
      payload.event_type === 'ActivityStarted' &&
      payload.activity_type === 'ShellExecution'
        ? verdict('constrain', {
            reason: 'redacted',
            guardrails_result: {
              input_type: 'activity_input',
              redacted_input: [{ command: 'echo [redacted]' }],
              validation_passed: true,
              reasons: [],
              field_results: [],
            },
          } as any)
        : verdict('allow'),
    );
    const execute = vi.fn(async (input) => input);
    const wrapped = createOpenBoxAgentsTool(
      {
        name: 'Shell',
        execute,
      },
      {
        core: mock.core,
        sessionId: 'constrain-session',
        toolFactory: (config) => config,
      },
    ) as { execute: (input: unknown) => Promise<unknown> };

    await expect(
      wrapped.execute({ command: 'cat secret.txt' }),
    ).resolves.toEqual({
      command: 'echo [redacted]',
    });
    expect(execute).toHaveBeenCalledWith(
      { command: 'echo [redacted]' },
      undefined,
      undefined,
    );
  });

  it('keeps concurrent same-name tool calls isolated by OpenAI tool call id', async () => {
    const mock = createMockCore(() => verdict('allow'));
    let releaseTools: () => void = () => undefined;
    const toolGate = new Promise<void>((resolve) => {
      releaseTools = resolve;
    });
    const execute = vi.fn(async (input) => {
      await toolGate;
      return { input };
    });
    const wrapped = createOpenBoxAgentsTool(
      {
        name: 'Shell',
        execute,
      },
      {
        core: mock.core,
        sessionId: 'parallel-session',
        toolFactory: (config) => config,
      },
    ) as {
      execute: (
        input: unknown,
        context?: unknown,
        details?: unknown,
      ) => Promise<unknown>;
    };

    const first = wrapped.execute({ command: 'echo one' }, undefined, {
      toolCall: {
        type: 'function_call',
        callId: 'call-one',
        name: 'Shell',
        arguments: '{}',
      },
    });
    const second = wrapped.execute({ command: 'echo two' }, undefined, {
      toolCall: {
        type: 'function_call',
        callId: 'call-two',
        name: 'Shell',
        arguments: '{}',
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseTools();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { input: { command: 'echo one' } },
      { input: { command: 'echo two' } },
    ]);

    const completedIds = mock.events
      .filter(
        (event) =>
          event.event_type === 'ActivityCompleted' &&
          event.activity_type === 'ToolCompleted' &&
          event.hook_trigger === false,
      )
      .map((event) => event.activity_id);
    expect(completedIds).toEqual(
      expect.arrayContaining(['call-one', 'call-two']),
    );
    expect(completedIds).toHaveLength(2);
  });

  it('returns constrained tool output when Core redacts completion output', async () => {
    const mock = createMockCore((payload) =>
      payload.event_type === 'ActivityCompleted' &&
      payload.activity_type === 'ToolCompleted'
        ? verdict('constrain', {
            guardrails_result: {
              input_type: 'activity_output',
              redacted_input: { output: { stdout: '[redacted]' } },
              validation_passed: true,
              reasons: [],
              field_results: [],
            },
          } as any)
        : verdict('allow'),
    );
    const wrapped = createOpenBoxAgentsTool(
      {
        name: 'Shell',
        execute: vi.fn(async () => ({ stdout: 'secret' })),
      },
      {
        core: mock.core,
        sessionId: 'output-redaction-session',
        toolFactory: (config) => config,
      },
    ) as { execute: (input: unknown) => Promise<unknown> };

    await expect(
      wrapped.execute({ command: 'cat secret.txt' }),
    ).resolves.toEqual({
      stdout: '[redacted]',
    });
  });

  it('wraps run() with workflow lifecycle and usage events', async () => {
    const mock = createMockCore(() => verdict('allow'));
    const result = {
      output: 'done',
      runContext: {
        usage: {
          inputTokens: 12,
          outputTokens: 7,
          totalTokens: 19,
        },
      },
      rawResponses: [
        {
          providerData: { model: 'gpt-4.1-mini' },
          output: [{ type: 'function_call', name: 'Shell' }],
          finishReason: 'tool_calls',
        },
      ],
    };
    const runFunction = vi.fn(async () => result);

    await expect(
      runWithOpenBox({ name: 'agent' }, 'hello', {
        core: mock.core,
        sessionId: 'run-session',
        input: 'not-forwarded',
        runFunction,
      }),
    ).resolves.toEqual(result);

    expect(runFunction).toHaveBeenCalledWith(
      { name: 'agent' },
      'hello',
      undefined,
    );
    expect(mock.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'WorkflowStarted' }),
        expect.objectContaining({
          event_type: 'ActivityStarted',
          activity_type: 'OpenAIAgentsSDKRun',
        }),
        expect.objectContaining({
          event_type: 'ActivityCompleted',
          activity_type: 'OpenAIAgentsSDKRun',
        }),
        expect.objectContaining({ event_type: 'WorkflowCompleted' }),
      ]),
    );
    const completed = mock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'OpenAIAgentsSDKRun',
    );
    expect(completed).toMatchObject({
      llm_model: 'gpt-4.1-mini',
      input_tokens: 12,
      output_tokens: 7,
      total_tokens: 19,
      has_tool_calls: true,
      finish_reason: 'tool_calls',
    });
  });
});
