import { describe, expect, it, vi } from 'vitest';
import {
  OpenBoxAgentsSDKError,
  createOpenBoxAgentHooks,
  createOpenBoxTracingProcessor,
  createOpenBoxAgentsTool,
  openBoxInputGuardrail,
  openBoxToolInputGuardrail,
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

  it('fails closed when constrained tool input has field-only redaction', async () => {
    const mock = createMockCore((payload) =>
      payload.event_type === 'ActivityStarted' &&
      payload.activity_type === 'ShellExecution'
        ? verdict('constrain', {
            reason: 'redacted',
            guardrails_result: {
              input_type: 'activity_input',
              validation_passed: true,
              reasons: [],
              field_results: [{ field: 'command', status: 'redacted' }],
            },
          })
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
        sessionId: 'field-only-redaction-session',
        toolFactory: (config) => config,
      },
    ) as { execute: (input: unknown) => Promise<unknown> };

    await expect(
      wrapped.execute({ command: 'cat secret.txt' }),
    ).rejects.toThrow(OpenBoxAgentsSDKError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('uses constrained tool output when Core returns redacted output', async () => {
    const mock = createMockCore((payload) =>
      payload.event_type === 'ActivityCompleted' &&
      payload.activity_type === 'ToolCompleted'
        ? verdict('constrain', {
            reason: 'redacted output',
            guardrails_result: {
              input_type: 'activity_output',
              redacted_output: { output: { stdout: '[redacted]' } },
              validation_passed: true,
              reasons: [],
              field_results: [{ field: 'output.stdout', status: 'redacted' }],
            },
          } as never)
        : verdict('allow'),
    );
    const execute = vi.fn(async () => ({ stdout: 'secret' }));
    const wrapped = createOpenBoxAgentsTool(
      {
        name: 'Shell',
        execute,
      },
      {
        core: mock.core,
        sessionId: 'constrain-output-session',
        toolFactory: (config) => config,
      },
    ) as { execute: (input: unknown) => Promise<unknown> };

    await expect(wrapped.execute({ command: 'cat secret.txt' })).resolves.toEqual({
      stdout: '[redacted]',
    });
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
    const workflowStarted = mock.events.find(
      (event) => event.event_type === 'WorkflowStarted',
    );
    const goalSignal = mock.events.find(
      (event) =>
        event.event_type === 'SignalReceived' &&
        event.activity_type === 'user_prompt',
    );
    const runStarted = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'OpenAIAgentsSDKRun' &&
        event.hook_trigger !== true,
    );
    expect(goalSignal).toMatchObject({
      event_type: 'SignalReceived',
      activity_type: 'user_prompt',
      signal_name: 'user_prompt',
      signal_args: 'hello',
      session_id: 'run-session',
      prompt: 'hello',
    });
    const goalActivityInput = goalSignal?.activity_input as
      | unknown[]
      | undefined;
    expect(goalActivityInput?.[0]).toMatchObject({
      _openbox_source: 'openai-agents-sdk',
      event_category: 'agent_goal',
      session_id: 'run-session',
      input: 'hello',
    });
    expect(mock.events.indexOf(goalSignal!)).toBeGreaterThan(
      mock.events.indexOf(workflowStarted!),
    );
    expect(mock.events.indexOf(goalSignal!)).toBeLessThan(
      mock.events.indexOf(runStarted!),
    );
    expect(mock.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'WorkflowStarted' }),
        expect.objectContaining({
          event_type: 'SignalReceived',
          activity_type: 'user_prompt',
        }),
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
    expect(completed?.spans).toBeUndefined();
    const completedHook = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'OpenAIAgentsSDKRun' &&
        event.hook_trigger === true,
    );
    expect(completedHook?.spans?.[0]).toMatchObject({
      module: 'openai-agents-sdk',
      name: 'openbox.openai-agents-sdk.assistant_output',
      semantic_type: 'llm_completion',
      model: 'gpt-4.1-mini',
      input_tokens: 12,
      output_tokens: 7,
      total_tokens: 19,
    });
  });

  it('creates native AgentHooks lifecycle handlers backed by OpenBox sessions', async () => {
    const mock = createMockCore(() => verdict('allow'));
    const hooks = createOpenBoxAgentHooks({
      core: mock.core,
      sessionId: 'hooks-session',
    }) as any;

    await hooks.onAgentStart({}, { name: 'Planner' }, [{ role: 'user', content: 'hi' }]);
    await hooks.onAgentToolStart(
      {},
      { name: 'Planner' },
      { name: 'Shell' },
      {
        toolCall: {
          callId: 'hook-call-1',
          name: 'Shell',
          namespace: 'local',
          arguments: '{"command":"pwd"}',
        },
      },
    );
    await hooks.onAgentToolEnd(
      {},
      { name: 'Planner' },
      { name: 'Shell' },
      'ok',
      {
        toolCall: {
          callId: 'hook-call-1',
          name: 'Shell',
          arguments: '{"command":"pwd"}',
        },
      },
    );
    await hooks.onAgentHandoff({}, { name: 'Planner' }, { name: 'Reviewer' });
    await hooks.onAgentEnd({}, { name: 'Planner' }, { output: 'done' });

    const goalSignal = mock.events.find(
      (event) =>
        event.event_type === 'SignalReceived' &&
        event.activity_type === 'user_prompt',
    );
    const runStarted = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'OpenAIAgentsSDKRun' &&
        event.hook_trigger !== true,
    );
    expect(goalSignal?.signal_name).toBe('user_prompt');
    expect(goalSignal?.signal_args).toEqual([{ role: 'user', content: 'hi' }]);
    const goalActivityInput = goalSignal?.activity_input as
      | unknown[]
      | undefined;
    expect(goalActivityInput?.[0]).toMatchObject({
      _openbox_source: 'openai-agents-sdk',
      event_category: 'agent_goal',
      session_id: 'hooks-session',
      input: [{ role: 'user', content: 'hi' }],
    });
    expect(mock.events.indexOf(goalSignal!)).toBeLessThan(
      mock.events.indexOf(runStarted!),
    );
    expect(mock.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'WorkflowStarted' }),
        expect.objectContaining({
          event_type: 'SignalReceived',
          activity_type: 'user_prompt',
        }),
        expect.objectContaining({
          activity_id: 'hook-call-1',
          activity_type: 'ShellExecution',
        }),
        expect.objectContaining({
          activity_type: 'AgentHandoff',
          from_agent_did: 'Planner',
        }),
        expect.objectContaining({ event_type: 'WorkflowCompleted' }),
      ]),
    );
  });

  it('observes OpenAI trace spans for generations, handoffs, guardrails, and tools', async () => {
    const mock = createMockCore(() => verdict('allow'));
    const processor = createOpenBoxTracingProcessor({
      core: mock.core,
      sessionId: 'trace-session',
    });
    const trace = {
      traceId: 'trace-1',
      name: 'agent trace',
      toJSON: () => ({ traceId: 'trace-1', name: 'agent trace' }),
    };

    await processor.onTraceStart(trace);
    await processor.onSpanEnd({
      spanId: 'gen-span',
      traceId: 'trace-1',
      spanData: {
        type: 'generation',
        model: 'gpt-4.1-mini',
        usage: { input_tokens: 4, output_tokens: 6 },
      },
    });
    await processor.onSpanEnd({
      spanId: 'handoff-span',
      traceId: 'trace-1',
      spanData: { type: 'handoff', from_agent: 'Planner', to_agent: 'Reviewer' },
    });
    await processor.onSpanEnd({
      spanId: 'guardrail-span',
      traceId: 'trace-1',
      spanData: { type: 'guardrail', name: 'safety', triggered: false },
    });
    await processor.onSpanEnd({
      spanId: 'tool-span',
      traceId: 'trace-1',
      spanData: {
        type: 'function',
        name: 'MCPFetch',
        input: '{"url":"https://example.test"}',
        output: '{"ok":true}',
        mcp_data: '{"server":"demo"}',
      },
    });
    await processor.onTraceEnd(trace);

    const goalSignal = mock.events.find(
      (event) =>
        event.event_type === 'SignalReceived' &&
        event.activity_type === 'user_prompt',
    );
    const runStarted = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'OpenAIAgentsSDKRun' &&
        event.hook_trigger !== true,
    );
    expect(goalSignal).toMatchObject({
      signal_name: 'user_prompt',
      session_id: 'trace-session',
      signal_args: expect.objectContaining({
        trace_id: 'trace-1',
        name: 'agent trace',
      }),
    });
    const goalActivityInput = goalSignal?.activity_input as
      | unknown[]
      | undefined;
    expect(goalActivityInput?.[0]).toMatchObject({
      _openbox_source: 'openai-agents-sdk',
      event_category: 'agent_goal',
      session_id: 'trace-session',
      input: expect.objectContaining({
        trace_id: 'trace-1',
        name: 'agent trace',
      }),
    });
    expect(mock.events.indexOf(goalSignal!)).toBeLessThan(
      mock.events.indexOf(runStarted!),
    );
    expect(mock.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'SignalReceived',
          activity_type: 'user_prompt',
        }),
        expect.objectContaining({
          activity_type: 'AgentHandoff',
          from_agent_did: 'Planner',
        }),
        expect.objectContaining({
          activity_type: 'GuardrailEvaluation',
        }),
        expect.objectContaining({
          activity_id: 'tool-span',
          activity_type: 'HTTPRequest',
          tool_name: 'MCPFetch',
        }),
        expect.objectContaining({
          event_type: 'ActivityCompleted',
          activity_type: 'OpenAIAgentsSDKRun',
          input_tokens: 4,
          output_tokens: 6,
          total_tokens: 10,
        }),
      ]),
    );
  });

  it('maps OpenBox guardrail verdicts to native OpenAI guardrail shapes', async () => {
    const mock = createMockCore(() =>
      verdict('block', {
        reason: 'unsafe input',
      }),
    );
    const inputGuardrail = openBoxInputGuardrail({
      core: mock.core,
      sessionId: 'input-guardrail-session',
    });

    const result = await inputGuardrail.execute({ input: 'unsafe' });
    expect(result).toMatchObject({
      tripwireTriggered: true,
      outputInfo: {
        openbox: {
          arm: 'block',
          reason: 'unsafe input',
        },
      },
    });
  });

  it('maps OpenBox tool guardrail verdicts to fail-closed tool behavior', async () => {
    const mock = createMockCore(() =>
      verdict('require_approval', {
        reason: 'needs review',
      }),
    );
    const guardrail = openBoxToolInputGuardrail({
      core: mock.core,
      sessionId: 'tool-guardrail-session',
    });

    const result = await guardrail.run({
      toolCall: {
        name: 'Shell',
        arguments: '{"command":"deploy"}',
      },
    });
    expect(result).toMatchObject({
      behavior: { type: 'throwException' },
      outputInfo: {
        openbox: {
          arm: 'require_approval',
          reason: 'needs review',
        },
      },
    });
  });
});
