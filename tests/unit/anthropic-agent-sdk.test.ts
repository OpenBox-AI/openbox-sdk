import { describe, expect, it, vi } from 'vitest';
import type {
  HookCallbackMatcher,
  HookInput,
  HookJSONOutput,
  Query,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
  createOpenBoxAnthropicAgentHooks,
  createOpenBoxAnthropicAgentSDK,
  withOpenBoxAnthropicAgentOptions,
} from '@openbox-ai/openbox-sdk/anthropic-agent-sdk';
import type {
  GovernanceEventPayload,
  GovernanceVerdictResponse,
  OpenBoxCoreClient,
} from '../../ts/src/core-client/index.js';

type VerdictArm = NonNullable<GovernanceVerdictResponse['verdict']>;

function createMockCore(
  resolve: (payload: GovernanceEventPayload) => Partial<GovernanceVerdictResponse>,
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

async function runHook(
  hooks: ReturnType<typeof createOpenBoxAnthropicAgentHooks>,
  event: keyof ReturnType<typeof createOpenBoxAnthropicAgentHooks>,
  input: Record<string, unknown>,
  toolUseId?: string,
): Promise<HookJSONOutput> {
  const matcher = hooks[event]?.[0];
  expect(matcher).toBeDefined();
  return matcher!.hooks[0](
    input as HookInput,
    toolUseId,
    { signal: new AbortController().signal },
  );
}

const baseInput = {
  hook_event_name: 'PreToolUse',
  session_id: 'sess_agent_sdk',
  transcript_path: '/tmp/transcript.jsonl',
  cwd: '/tmp/project',
};

describe('Anthropic Agent SDK OpenBox adapter', () => {
  it('prepends OpenBox hooks without mutating user options', () => {
    const mock = createMockCore(() => verdict('allow'));
    const userHook = vi.fn(async () => ({}));
    const userMatcher = {
      matcher: 'Bash',
      hooks: [userHook],
      timeout: 3,
    } satisfies HookCallbackMatcher;
    const options = {
      hooks: {
        PreToolUse: [userMatcher],
      },
    };

    const wrapped = withOpenBoxAnthropicAgentOptions(options, {
      core: mock.core,
      hookTimeoutSeconds: 7,
    });

    expect(wrapped).not.toBe(options);
    expect(wrapped.hooks).not.toBe(options.hooks);
    expect(wrapped.hooks?.PreToolUse).not.toBe(options.hooks.PreToolUse);
    expect(options.hooks.PreToolUse).toEqual([userMatcher]);
    expect(wrapped.hooks?.PreToolUse?.[0]).toMatchObject({ timeout: 7 });
    expect(wrapped.hooks?.PreToolUse?.[1]).toBe(userMatcher);
  });

  it('maps a constrained PreToolUse verdict to allow plus updated input', async () => {
    const mock = createMockCore((payload) => {
      if (payload.event_type === 'ActivityStarted') {
        return verdict('constrain', {
          reason: 'redacted shell command',
          guardrails_result: {
            input_type: 'activity_input',
            redacted_input: { command: 'echo [redacted]' },
            validation_passed: true,
            reasons: [],
            results: [],
            raw_logs: {},
          },
        });
      }
      return verdict('allow');
    });
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    const output = await runHook(hooks, 'PreToolUse', {
      ...baseInput,
      tool_name: 'Bash',
      tool_input: { command: 'echo secret' },
      tool_use_id: 'tool_1',
    });

    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { command: 'echo [redacted]' },
        additionalContext: '[OpenBox] redacted shell command',
      },
    });
  });

  it('maps approval-required PreToolUse verdicts to ask or defer', async () => {
    const createApprovalCore = () =>
      createMockCore((payload) =>
        payload.event_type === 'ActivityStarted'
          ? verdict('require_approval', { reason: 'needs reviewer' })
          : verdict('allow'),
      );
    const askMock = createApprovalCore();
    const deferMock = createApprovalCore();

    const askOutput = await runHook(
      createOpenBoxAnthropicAgentHooks({ core: askMock.core }),
      'PreToolUse',
      {
        ...baseInput,
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf tmp' },
        tool_use_id: 'tool_ask',
      },
    );
    const deferOutput = await runHook(
      createOpenBoxAnthropicAgentHooks({
        core: deferMock.core,
        approvalMode: 'defer',
      }),
      'PreToolUse',
      {
        ...baseInput,
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf tmp' },
        tool_use_id: 'tool_defer',
      },
    );

    expect((askOutput as any).hookSpecificOutput.permissionDecision).toBe('ask');
    expect((deferOutput as any).hookSpecificOutput.permissionDecision).toBe('defer');
  });

  it('pairs PreToolUse and PostToolUse activity ids from the Agent SDK tool id', async () => {
    const mock = createMockCore(() => verdict('allow'));
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    await runHook(hooks, 'PreToolUse', {
      ...baseInput,
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_use_id: 'tool_pair',
    });
    await runHook(hooks, 'PostToolUse', {
      ...baseInput,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: { stdout: 'ok' },
      tool_use_id: 'tool_pair',
      duration_ms: 42,
    });

    const started = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'ShellExecution',
    );
    const completed = mock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'ShellExecution',
    );
    expect(started?.activity_id).toBeDefined();
    expect(completed?.activity_id).toBe(started?.activity_id);
    expect(completed?.duration_ms).toBe(42);
    expect(started?.activity_input).toContainEqual({
      __openbox: { tool_type: 'shell' },
    });
    expect(completed?.activity_input).toContainEqual({
      __openbox: { tool_type: 'shell' },
    });
  });

  it('maps constrained tool output to updatedToolOutput', async () => {
    const mock = createMockCore((payload) => {
      if (payload.event_type === 'ActivityCompleted') {
        return verdict('constrain', {
          reason: 'tool output redacted',
          guardrails_result: {
            input_type: 'activity_output',
            redacted_input: { stdout: '[redacted]' },
            validation_passed: true,
            reasons: [],
            results: [],
            raw_logs: {},
          },
        });
      }
      return verdict('allow');
    });
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    const output = await runHook(hooks, 'PostToolUse', {
      ...baseInput,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'cat secret.txt' },
      tool_response: { stdout: 'secret' },
      tool_use_id: 'tool_output',
    });

    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: '[OpenBox] tool output redacted',
        updatedToolOutput: { stdout: '[redacted]' },
      },
    });
  });

  it('blocks assistant/session stop when OpenBox halts the final output', async () => {
    const mock = createMockCore((payload) =>
      payload.event_type === 'ActivityCompleted' &&
      payload.activity_type === 'AnthropicAgentSDKSession'
        ? verdict('halt', { reason: 'final answer includes restricted data' })
        : verdict('allow'),
    );
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    const output = await runHook(hooks, 'Stop', {
      ...baseInput,
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'restricted data',
    });

    expect(output).toEqual({
      continue: false,
      stopReason: '[OpenBox] final answer includes restricted data',
    });
    expect(mock.events.some((event) => event.event_type === 'WorkflowCompleted')).toBe(false);
  });

  it('delegates Agent SDK query methods and emits result usage telemetry', async () => {
    const mock = createMockCore(() => verdict('allow'));
    const source = createMockQuery([
      {
        type: 'assistant',
        session_id: 'sess_query',
        message: {
          model: 'claude-sonnet-4-5',
          content: [{ type: 'text', text: 'Working.' }],
          usage: { input_tokens: 10, output_tokens: 4 },
        },
      },
      {
        type: 'result',
        session_id: 'sess_query',
        subtype: 'success',
        is_error: false,
        result: 'Done.',
        total_cost_usd: 0.0123,
        duration_ms: 1200,
        duration_api_ms: 900,
        num_turns: 1,
        permission_denials: { Bash: 1 },
        usage: { input_tokens: 10, output_tokens: 5 },
        modelUsage: {
          'claude-sonnet-4-5': { inputTokens: 10, outputTokens: 5 },
        },
        stop_reason: 'end_turn',
      },
    ] as SDKMessage[]);
    const query = vi.fn(() => source);
    const sdk = createOpenBoxAnthropicAgentSDK({
      core: mock.core,
      query: query as any,
    });

    const wrapped = sdk.query({ prompt: 'hello', options: { maxTurns: 1 } });
    await wrapped.interrupt();
    for await (const _message of wrapped) {
      // Drain the stream so the result observer runs.
    }

    expect(source.interrupt).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({
      prompt: 'hello',
      options: expect.objectContaining({
        maxTurns: 1,
        hooks: expect.any(Object),
      }),
    });
    const usage = mock.events.find(
      (event) =>
        event.event_type === 'SignalReceived' &&
        event.activity_type === 'anthropic_agent_sdk_usage',
    );
    expect(usage?.activity_input).toEqual([
      expect.objectContaining({
        total_cost_usd: 0.0123,
        duration_ms: 1200,
        duration_api_ms: 900,
        num_turns: 1,
        permission_denials: { Bash: 1 },
        _openbox_source: 'anthropic-agent-sdk',
      }),
    ]);
    const assistantEvents = mock.events.filter(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'LLMCompleted',
    );
    expect(assistantEvents).toHaveLength(2);
    const [assistantParent, assistantHook] = assistantEvents;
    expect(assistantParent.hook_trigger).toBeUndefined();
    expect(assistantParent.spans).toBeUndefined();
    expect(assistantParent.span_count).toBeUndefined();
    expect(assistantParent).toMatchObject({
      llm_model: 'claude-sonnet-4-5',
      input_tokens: 10,
      output_tokens: 5,
      completion: 'Done.',
    });
    expect(assistantHook.hook_trigger).toBe(true);
    expect(assistantHook.event_type).toBe(assistantParent.event_type);
    expect(assistantHook.workflow_id).toBe(assistantParent.workflow_id);
    expect(assistantHook.run_id).toBe(assistantParent.run_id);
    expect(assistantHook.activity_id).toBe(assistantParent.activity_id);
    expect(assistantHook.activity_type).toBe(assistantParent.activity_type);
    expect(assistantHook.span_count).toBe(1);
    expect(assistantHook.spans?.[0]).toMatchObject({
      name: 'openbox.anthropic-agent-sdk.assistant_output',
      stage: 'completed',
      semantic_type: 'llm_completion',
    });
    expect(
      mock.events.some((event) => event.event_type === 'WorkflowCompleted'),
    ).toBe(true);
  });

  it('marks open sessions failed when the wrapped query throws', async () => {
    const mock = createMockCore(() => verdict('allow'));
    const source = createThrowingQuery();
    const sdk = createOpenBoxAnthropicAgentSDK({
      core: mock.core,
      query: vi.fn(() => source) as any,
    });
    await runHook(sdk.hooks, 'SessionStart', {
      ...baseInput,
      hook_event_name: 'SessionStart',
      session_id: 'sess_throw',
      source: 'startup',
    });

    const wrapped = sdk.query({ prompt: 'hello' });
    await expect(wrapped.next()).rejects.toThrow('stream failed');

    expect(
      mock.events.some((event) => event.event_type === 'WorkflowFailed'),
    ).toBe(true);
  });
});

function createMockQuery(messages: SDKMessage[]): Query & {
  interrupt: ReturnType<typeof vi.fn>;
} {
  async function* stream() {
    for (const message of messages) yield message;
  }
  const iterator = stream();
  const source = {
    next: iterator.next.bind(iterator),
    return: iterator.return?.bind(iterator),
    throw: iterator.throw?.bind(iterator),
    [Symbol.asyncIterator]() {
      return source;
    },
    interrupt: vi.fn(async () => undefined),
    close: vi.fn(),
  };
  return source as unknown as Query & { interrupt: ReturnType<typeof vi.fn> };
}

function createThrowingQuery(): Query {
  const source = {
    async next() {
      throw new Error('stream failed');
    },
    async return(value?: void) {
      return { done: true as const, value };
    },
    async throw(error?: unknown) {
      throw error;
    },
    [Symbol.asyncIterator]() {
      return source;
    },
    close: vi.fn(),
  };
  return source as unknown as Query;
}
