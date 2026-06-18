// SDK-invariant tests for the generated govern() runtime. These prove
// the contract advertised in specs/typespec/govern/main.tsp:
//
//   1. Lifecycle: every govern() call ends with exactly one
//      WorkflowCompleted (success path) or WorkflowFailed (throw path).
//      Sessions never hang in PENDING from the backend's perspective.
//   2. Pairing: every ActivityStarted is followed by a matching
//      ActivityCompleted (unless pre-stage block short-circuits).
//   3. Idempotent: a session can't be reused after a terminal event;
//      activity calls throw SessionAlreadyTerminatedError.
//   4. Approval polling is bounded by the server-supplied
//      approvalExpiresAt; the SDK does not impose a second total wait cap.
//
// We mock the OpenBoxCoreClient instead of hitting a live core; the
// invariants are about what the runtime emits, not about wire fidelity
// (covered by tests/e2e/core-governance.test.ts).

import { describe, expect, test, vi } from 'vitest';
import type {
  GovernanceEventPayload,
  GovernanceVerdictResponse,
} from '../../ts/src/core-client/core-client.js';
import type { OpenBoxCoreClient } from '../../ts/src/core-client/core-client.js';
import {
  govern,
  presets,
  SessionAlreadyTerminatedError,
} from '../../ts/src/core-client/generated/govern.js';
import {
  buildLLMCompletionSpan,
  buildSpan,
} from '../../ts/src/governance/spans.js';
import {
  emitN8nLlmCompletion,
  emitN8nNodePreExecute,
} from '../../ts/src/runtime/n8n/index.js';

interface MockCore {
  events: GovernanceEventPayload[];
  evaluate: ReturnType<typeof vi.fn>;
  pollApproval: ReturnType<typeof vi.fn>;
}

function createMockCore(
  verdictArm: 'allow' | 'block' | 'require_approval' = 'allow',
  overrides: Partial<GovernanceVerdictResponse> = {},
): MockCore {
  const events: GovernanceEventPayload[] = [];
  const verdict: GovernanceVerdictResponse = {
    governance_event_id: 'evt_test',
    verdict: verdictArm,
    action: verdictArm,
    risk_score: 0,
    ...overrides,
  } as GovernanceVerdictResponse;
  const evaluate = vi.fn(async (payload: GovernanceEventPayload) => {
    events.push(payload);
    return verdict;
  });
  const pollApproval = vi.fn(async () => ({
    id: 'evt_test',
    action: 'allow',
  }));
  return { events, evaluate, pollApproval };
}

function mockCoreAsClient(mock: MockCore): OpenBoxCoreClient {
  return {
    evaluate: mock.evaluate,
    pollApproval: mock.pollApproval,
  } as unknown as OpenBoxCoreClient;
}

const baseConfig = (mock: MockCore) => ({
  core: mockCoreAsClient(mock),
  // Disable exit handlers in tests; vitest registers its own handlers
  // and ours would chain unwanted listeners.
  registerExitHandlers: false,
});

describe('govern() lifecycle invariants', () => {
  test('success path emits exactly one WorkflowStarted + WorkflowCompleted', async () => {
    const mock = createMockCore('allow');
    await govern(
      { ...baseConfig(mock), preset: presets.default },
      async () => 42,
    );
    const types = mock.events.map((e) => e.event_type);
    expect(types).toEqual(['WorkflowStarted', 'WorkflowCompleted']);
  });

  test('throw path emits WorkflowStarted + WorkflowFailed (not Completed)', async () => {
    const mock = createMockCore('allow');
    await expect(
      govern(
        { ...baseConfig(mock), preset: presets.default },
        async () => {
          throw new Error('boom');
        },
      ),
    ).rejects.toThrow('boom');
    const types = mock.events.map((e) => e.event_type);
    expect(types).toEqual(['WorkflowStarted', 'WorkflowFailed']);
    const failed = mock.events.find((e) => e.event_type === 'WorkflowFailed');
    expect((failed as unknown as { error: { message: string } }).error.message).toBe('boom');
  });

  test('user code throws AFTER an activity → both ActivityStarted + ActivityCompleted + WorkflowFailed fire', async () => {
    const mock = createMockCore('allow');
    await expect(
      govern(
        { ...baseConfig(mock), preset: presets.claudeCode },
        async (session) => {
          await session.preToolUse({ input: [{ tool: 'Bash' }] });
          throw new Error('post-activity throw');
        },
      ),
    ).rejects.toThrow('post-activity throw');
    const types = mock.events.map((e) => e.event_type);
    expect(types).toEqual([
      'WorkflowStarted',
      'ActivityStarted',
      'ActivityCompleted',
      'WorkflowFailed',
    ]);
  });
});

describe('activity pairing', () => {
  test('preset.preToolUse → ActivityStarted + ActivityCompleted with matching activity_id', async () => {
    const mock = createMockCore('allow');
    await govern(
      { ...baseConfig(mock), preset: presets.claudeCode },
      async (session) => {
        await session.preToolUse({ input: [{ tool: 'Bash', cmd: 'ls' }] });
      },
    );
    const activityEvents = mock.events.filter((e) =>
      e.event_type === 'ActivityStarted' || e.event_type === 'ActivityCompleted',
    );
    expect(activityEvents).toHaveLength(2);
    expect(activityEvents[0].event_type).toBe('ActivityStarted');
    expect(activityEvents[1].event_type).toBe('ActivityCompleted');
    expect(activityEvents[0].activity_id).toBe(activityEvents[1].activity_id);
    expect(activityEvents[0].activity_type).toBe('PreToolUse');
    expect(activityEvents[1].activity_type).toBe('PreToolUse');
  });

  test('pre-stage block (verdict=block) emits ActivityStarted but NOT ActivityCompleted', async () => {
    const mock = createMockCore('block');
    await govern(
      { ...baseConfig(mock), preset: presets.claudeCode },
      async (session) => {
        const v = await session.preToolUse({ input: [{ tool: 'Bash' }] });
        expect(v.arm).toBe('block');
      },
    );
    const types = mock.events.map((e) => e.event_type);
    expect(types).toEqual([
      'WorkflowStarted',
      'ActivityStarted',
      'WorkflowCompleted',
    ]);
  });

  test('post-stage method (postToolUse) emits ActivityCompleted only', async () => {
    const mock = createMockCore('allow');
    await govern(
      { ...baseConfig(mock), preset: presets.claudeCode },
      async (session) => {
        await session.postToolUse({ input: [{ tool: 'Bash' }], output: 'ok' });
      },
    );
    const types = mock.events.map((e) => e.event_type);
    expect(types).toEqual([
      'WorkflowStarted',
      'ActivityCompleted',
      'WorkflowCompleted',
    ]);
  });

  test('SignalReceived events fire once (LangGraph interrupt is observe-only)', async () => {
    const mock = createMockCore('allow');
    await govern(
      { ...baseConfig(mock), preset: presets.langgraph },
      async (session) => {
        await session.interrupt({ input: [{ reason: 'awaiting human' }] });
      },
    );
    const signalEvents = mock.events.filter((e) => e.event_type === 'SignalReceived');
    expect(signalEvents).toHaveLength(1);
    expect(signalEvents[0].activity_type).toBe('interrupt');
    expect(signalEvents[0].hook_trigger).toBeUndefined();
    expect(signalEvents[0].spans).toBeUndefined();
    expect(signalEvents[0].span_count).toBeUndefined();
  });

  test('ActivityStarted spans are emitted as parent plus per-span hook re-evaluations', async () => {
    const mock = createMockCore('allow');
    const shellSpan = buildSpan('claude-code', 'shell', {
      command: 'npm test',
      tool_name: 'Bash',
    });
    const mcpSpan = buildSpan('claude-code', 'mcp', {
      tool_name: 'mcp__filesystem__read',
      tool_input: { path: 'README.md' },
    });

    await govern(
      { ...baseConfig(mock), preset: presets.claudeCode },
      async (session) => {
        await session.preToolUse({
          input: [{ tool: 'Bash', cmd: 'npm test' }],
          spans: [shellSpan, mcpSpan] as never,
        });
      },
    );

    const startedEvents = mock.events.filter(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'PreToolUse',
    );
    expect(startedEvents).toHaveLength(3);
    const [parent, firstHook, secondHook] = startedEvents;
    expect(parent.hook_trigger).toBeUndefined();
    expect(parent.spans).toBeUndefined();
    expect(parent.span_count).toBeUndefined();
    for (const hook of [firstHook, secondHook]) {
      expect(hook.hook_trigger).toBe(true);
      expect(hook.event_type).toBe(parent.event_type);
      expect(hook.workflow_id).toBe(parent.workflow_id);
      expect(hook.run_id).toBe(parent.run_id);
      expect(hook.activity_id).toBe(parent.activity_id);
      expect(hook.activity_type).toBe(parent.activity_type);
      expect(hook.span_count).toBe(1);
      expect(hook.spans).toHaveLength(1);
    }
    expect(firstHook.spans?.[0]).toMatchObject({
      semantic_type: 'internal',
      attributes: expect.objectContaining({
        'openbox.tool.name': 'Bash',
      }),
    });
    expect(secondHook.spans?.[0]).toMatchObject({
      semantic_type: 'llm_tool_call',
      attributes: expect.objectContaining({
        'openbox.tool.name': 'mcp__filesystem__read',
      }),
    });
  });

  test('ActivityCompleted sends LangGraph-style model usage on the parent event', async () => {
    const mock = createMockCore('allow');
    await govern(
      { ...baseConfig(mock), preset: presets.langchain },
      async (session) => {
        await session.onLlmEnd({
          output: { content: 'done' },
          sessionId: 'chat-1',
          llmModel: 'claude-opus-4-8',
          inputTokens: 123,
          outputTokens: 45,
          totalTokens: 168,
          completion: 'done',
        });
      },
    );

    const completed = mock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'on_llm_end',
    );
    expect(completed).toMatchObject({
      session_id: 'chat-1',
      llm_model: 'claude-opus-4-8',
      input_tokens: 123,
      output_tokens: 45,
      total_tokens: 168,
      completion: 'done',
    });
    expect(completed?.hook_trigger).toBeUndefined();
    expect(completed?.spans).toBeUndefined();
    expect(completed?.span_count).toBeUndefined();
  });

  test('n8n runtime helpers send node lifecycle events and hook completion spans', async () => {
    const mock = createMockCore('allow');
    await govern(
      { ...baseConfig(mock), preset: presets.n8n },
      async (session) => {
        await emitN8nNodePreExecute(session, {
          input: { chatInput: 'Draft release note.' },
          nodeName: 'Governed LLM Draft',
          sessionId: 'n8n-chat-1',
          prompt: 'Draft release note.',
        });
        await emitN8nLlmCompletion(session, {
          text: 'Draft ready.',
          model: 'gpt-4o-mini',
          usage: {
            promptTokens: 18,
            completionTokens: 7,
            totalTokens: 25,
          },
          nodeName: 'Governed LLM Draft',
          provider: 'openrouter',
          sessionId: 'n8n-chat-1',
        });
      },
    );

    const started = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'node-pre-execute',
    );
    expect(started).toMatchObject({
      session_id: 'n8n-chat-1',
      prompt: 'Draft release note.',
      activity_input: [
        expect.objectContaining({
          chatInput: 'Draft release note.',
          event_category: 'node_pre_execute',
          node_name: 'Governed LLM Draft',
          prompt: 'Draft release note.',
          _openbox_source: 'n8n',
        }),
      ],
    });
    expect(started?.hook_trigger).toBeUndefined();
    expect(started?.spans).toBeUndefined();
    expect(started?.span_count).toBeUndefined();

    const completedEvents = mock.events.filter(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'node-post-execute',
    );
    expect(completedEvents).toHaveLength(2);
    const [completedParent, completedHook] = completedEvents;
    expect(completedParent.hook_trigger).toBeUndefined();
    expect(completedParent.spans).toBeUndefined();
    expect(completedParent.span_count).toBeUndefined();
    expect(completedParent).toMatchObject({
      llm_model: 'gpt-4o-mini',
      input_tokens: 18,
      output_tokens: 7,
      total_tokens: 25,
      has_tool_calls: false,
      completion: 'Draft ready.',
      session_id: 'n8n-chat-1',
    });
    expect(completedHook.hook_trigger).toBe(true);
    expect(completedHook.event_type).toBe(completedParent.event_type);
    expect(completedHook.workflow_id).toBe(completedParent.workflow_id);
    expect(completedHook.run_id).toBe(completedParent.run_id);
    expect(completedHook.activity_id).toBe(completedParent.activity_id);
    expect(completedHook.activity_type).toBe(completedParent.activity_type);
    expect(completedHook.span_count).toBe(1);
    const span = completedHook.spans?.[0] as Record<string, unknown> | undefined;
    expect(span).toMatchObject({
      name: 'openbox.n8n.assistant_output',
      stage: 'completed',
      semantic_type: 'llm_completion',
      model: 'gpt-4o-mini',
      model_id: 'gpt-4o-mini',
      provider: 'openrouter',
      model_provider: 'openrouter',
      input_tokens: 18,
      output_tokens: 7,
      total_tokens: 25,
      attributes: expect.objectContaining({
        'gen_ai.system': 'n8n',
        'openbox.model.id': 'gpt-4o-mini',
        'openbox.model.provider': 'openrouter',
        'openbox.n8n.node_name': 'Governed LLM Draft',
        'openbox.provider': 'openrouter',
      }),
    });
    expect(JSON.parse(String(span?.response_body))).toMatchObject({
      model: 'gpt-4o-mini',
      usage: {
        prompt_tokens: 18,
        completion_tokens: 7,
        total_tokens: 25,
      },
    });
  });

  test('observeActivity emits parent plus hook span without approval polling', async () => {
    const mock = createMockCore('require_approval', {
      approval_id: 'approval-observe',
    } as Partial<GovernanceVerdictResponse>);
    await govern(
      { ...baseConfig(mock), preset: presets.cursor },
      async (session) => {
        await session.observeActivity('ActivityCompleted', 'LLMCompleted', {
          output: { response: 'Cursor answer.' },
          completion: 'Cursor answer.',
          spans: [
            buildLLMCompletionSpan({
              content: 'Cursor answer.',
              system: 'cursor',
              name: 'openbox.cursor.assistant_output',
            }),
          ],
        });
      },
    );

    const completedEvents = mock.events.filter(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'LLMCompleted',
    );
    expect(completedEvents).toHaveLength(2);
    expect(completedEvents[0]?.spans).toBeUndefined();
    expect(completedEvents[1]?.hook_trigger).toBe(true);
    expect(completedEvents[1]?.spans).toHaveLength(1);
    expect(mock.pollApproval).not.toHaveBeenCalled();
  });
});

describe('idempotent termination', () => {
  test('calling an activity after govern() resolves throws SessionAlreadyTerminatedError', async () => {
    const mock = createMockCore('allow');
    let leakedSession: import('../../ts/src/core-client/generated/govern.js').ClaudeCodeSession | undefined;
    await govern(
      { ...baseConfig(mock), preset: presets.claudeCode },
      async (session) => {
        leakedSession = session;
        // session is fine here
      },
    );
    expect(leakedSession).toBeDefined();
    await expect(
      leakedSession!.preToolUse({ input: [{}] }),
    ).rejects.toBeInstanceOf(SessionAlreadyTerminatedError);
  });

  test('terminal events fire only once even on accidental re-call', async () => {
    const mock = createMockCore('allow');
    let leakedSession: import('../../ts/src/core-client/generated/govern.js').BaseGovernedSession | undefined;
    await govern(
      { ...baseConfig(mock), preset: presets.default },
      async (session) => {
        leakedSession = session;
      },
    );
    // Try to fail() the already-completed session
    await leakedSession!.fail(new Error('late'));
    const completedCount = mock.events.filter((e) => e.event_type === 'WorkflowCompleted').length;
    const failedCount = mock.events.filter((e) => e.event_type === 'WorkflowFailed').length;
    expect(completedCount).toBe(1);
    expect(failedCount).toBe(0); // late fail() is no-op
  });
});

describe('approval polling bounds', () => {
  test('polling ignores client max-wait and waits until server decision before server expiry', async () => {
    const mock = createMockCore('allow');
    const expiresAt = new Date(Date.now() + 500).toISOString();
    mock.evaluate = vi.fn(async (payload: GovernanceEventPayload) => {
      mock.events.push(payload);
      if (payload.event_type === 'ActivityStarted') {
        return {
          governance_event_id: 'evt_test',
          verdict: 'require_approval',
          action: 'require_approval',
          approval_id: 'apr_xxx',
          approval_expiration_time: expiresAt,
          risk_score: 0,
        } as GovernanceVerdictResponse;
      }
      return {
        governance_event_id: 'evt_test',
        verdict: 'allow',
        action: 'allow',
        risk_score: 0,
      } as GovernanceVerdictResponse;
    });
    mock.pollApproval = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'apr_xxx',
        action: 'require_approval',
        approval_expiration_time: expiresAt,
      })
      .mockResolvedValueOnce({
        id: 'apr_xxx',
        action: 'require_approval',
        approval_expiration_time: expiresAt,
      })
      .mockResolvedValueOnce({
        id: 'apr_xxx',
        action: 'allow',
        approval_expiration_time: expiresAt,
        reason: 'approved after old client deadline',
      });

    await govern(
      {
        ...baseConfig(mock),
        preset: presets.claudeCode,
        approvalPollIntervalMs: 15,
        approvalPollBackoffFactor: 1,
        approvalPollJitter: 0,
        approvalMaxWaitMs: 20,
      },
      async (session) => {
        const verdict = await session.preToolUse({ input: [{ tool: 'Bash' }] });
        expect(verdict.arm).toBe('allow');
        expect(verdict.reason).toBe('approved after old client deadline');
      },
    );
    expect(mock.pollApproval).toHaveBeenCalledTimes(3);
  });

  test('polling stops at server-supplied approvalExpiresAt even if config max-wait is longer', async () => {
    const mock = createMockCore('allow');
    // Override the response with require_approval + a tight expiry.
    const expiresAt = new Date(Date.now() + 50).toISOString();
    mock.evaluate = vi.fn(async (payload: GovernanceEventPayload) => {
      mock.events.push(payload);
      if (payload.event_type === 'ActivityStarted') {
        return {
          governance_event_id: 'evt_test',
          verdict: 'require_approval',
          action: 'require_approval',
          approval_id: 'apr_xxx',
          approval_expiration_time: expiresAt,
          risk_score: 0,
        } as GovernanceVerdictResponse;
      }
      return {
        governance_event_id: 'evt_test',
        verdict: 'allow',
        action: 'allow',
        risk_score: 0,
      } as GovernanceVerdictResponse;
    });
    // Always-pending poll responses
    mock.pollApproval = vi.fn(async () => ({
      id: 'apr_xxx',
      action: 'require_approval',
    }));

    const start = Date.now();
    await govern(
      {
        ...baseConfig(mock),
        preset: presets.claudeCode,
        approvalPollIntervalMs: 10,
        approvalMaxWaitMs: 60_000, // long config, but server expires at 50ms
      },
      async (session) => {
        const verdict = await session.preToolUse({ input: [{ tool: 'Bash' }] });
        expect(verdict.arm).toBe('block');
        expect(verdict.reason).toBe('Approval expired for PreToolUse');
      },
    );
    const elapsed = Date.now() - start;
    // Should bail well before the 60s config max-wait; server expiry wins.
    expect(elapsed).toBeLessThan(2_000);
  });

  test('polling treats DB-style approvalExpiresAt timestamps as UTC', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const mock = createMockCore('allow');
      mock.evaluate = vi.fn(async (payload: GovernanceEventPayload) => {
        mock.events.push(payload);
        if (payload.event_type === 'ActivityStarted') {
          return {
            governance_event_id: 'evt_test',
            verdict: 'require_approval',
            action: 'require_approval',
            approval_id: 'apr_xxx',
            approval_expiration_time: '2026-01-01 00:00:01',
            risk_score: 0,
          } as GovernanceVerdictResponse;
        }
        return {
          governance_event_id: 'evt_test',
          verdict: 'allow',
          action: 'allow',
          risk_score: 0,
        } as GovernanceVerdictResponse;
      });
      mock.pollApproval = vi.fn(async () => ({
        id: 'apr_xxx',
        action: 'allow',
        reason: 'approved before UTC deadline',
        approval_expiration_time: '2026-01-01 00:00:01',
      }));

      const result = govern(
        {
          ...baseConfig(mock),
          preset: presets.claudeCode,
          approvalPollIntervalMs: 10,
          approvalPollJitter: 0,
        },
        async (session) => session.preToolUse({ input: [{ tool: 'Bash' }] }),
      );
      await vi.advanceTimersByTimeAsync(10);

      await expect(result).resolves.toMatchObject({
        arm: 'allow',
        reason: 'approved before UTC deadline',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test('polling treats expired approval status as terminal before verdict', async () => {
    const mock = createMockCore('allow');
    mock.evaluate = vi.fn(async (payload: GovernanceEventPayload) => {
      mock.events.push(payload);
      if (payload.event_type === 'ActivityStarted') {
        return {
          governance_event_id: 'evt_test',
          verdict: 'require_approval',
          action: 'require_approval',
          approval_id: 'apr_xxx',
          approval_expiration_time: new Date(Date.now() + 1_000).toISOString(),
          risk_score: 0,
        } as GovernanceVerdictResponse;
      }
      return {
        governance_event_id: 'evt_test',
        verdict: 'allow',
        action: 'allow',
        risk_score: 0,
      } as GovernanceVerdictResponse;
    });
    mock.pollApproval = vi.fn(async () => ({
      id: 'apr_xxx',
      action: 'allow',
      expired: true,
      reason: 'approval window expired',
    }));

    await govern(
      {
        ...baseConfig(mock),
        preset: presets.claudeCode,
        approvalPollIntervalMs: 10,
        approvalPollJitter: 0,
        approvalMaxWaitMs: 1_000,
      },
      async (session) => {
        const verdict = await session.preToolUse({ input: [{ tool: 'Bash' }] });
        expect(verdict.arm).toBe('block');
        expect(verdict.reason).toBe('approval window expired');
      },
    );
    expect(mock.pollApproval).toHaveBeenCalledTimes(1);
  });

  test('polling retries transient pollApproval failures until a decision arrives', async () => {
    const mock = createMockCore('allow');
    mock.evaluate = vi.fn(async (payload: GovernanceEventPayload) => {
      mock.events.push(payload);
      if (payload.event_type === 'ActivityStarted') {
        return {
          governance_event_id: 'evt_test',
          verdict: 'require_approval',
          action: 'require_approval',
          approval_id: 'apr_xxx',
          approval_expiration_time: new Date(Date.now() + 1_000).toISOString(),
          risk_score: 0,
        } as GovernanceVerdictResponse;
      }
      return {
        governance_event_id: 'evt_test',
        verdict: 'allow',
        action: 'allow',
        risk_score: 0,
      } as GovernanceVerdictResponse;
    });
    mock.pollApproval = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary poll outage'))
      .mockResolvedValueOnce({
        id: 'apr_xxx',
        action: 'allow',
        reason: 'approval granted',
      });

    await govern(
      {
        ...baseConfig(mock),
        preset: presets.claudeCode,
        approvalPollIntervalMs: 10,
        approvalPollJitter: 0,
        approvalMaxWaitMs: 1_000,
      },
      async (session) => {
        const verdict = await session.preToolUse({ input: [{ tool: 'Bash' }] });
        expect(verdict.arm).toBe('allow');
        expect(verdict.reason).toBe('approval granted');
      },
    );
    expect(mock.pollApproval).toHaveBeenCalledTimes(2);
  });

  test('polling accepts verdict-only approval responses', async () => {
    const mock = createMockCore('allow');
    mock.evaluate = vi.fn(async (payload: GovernanceEventPayload) => {
      mock.events.push(payload);
      if (payload.event_type === 'ActivityStarted') {
        return {
          governance_event_id: 'evt_test',
          verdict: 'require_approval',
          action: 'require_approval',
          approval_id: 'apr_xxx',
          approval_expiration_time: new Date(Date.now() + 1_000).toISOString(),
          risk_score: 0,
        } as GovernanceVerdictResponse;
      }
      return {
        governance_event_id: 'evt_test',
        verdict: 'allow',
        action: 'allow',
        risk_score: 0,
      } as GovernanceVerdictResponse;
    });
    mock.pollApproval = vi.fn(async () => ({
      id: 'apr_xxx',
      verdict: 'allow',
      reason: 'approved via verdict field',
    } as never));

    await govern(
      {
        ...baseConfig(mock),
        preset: presets.claudeCode,
        approvalPollIntervalMs: 10,
        approvalPollJitter: 0,
        approvalMaxWaitMs: 1_000,
      },
      async (session) => {
        const verdict = await session.preToolUse({ input: [{ tool: 'Bash' }] });
        expect(verdict.arm).toBe('allow');
        expect(verdict.reason).toBe('approved via verdict field');
      },
    );
    expect(mock.pollApproval).toHaveBeenCalledTimes(1);
  });

  test('exponential backoff: poll intervals grow toward the cap', async () => {
    // Set up a require_approval that never resolves so we get many poll
    // attempts. Capture the gap between successive pollApproval() calls.
    const mock = createMockCore('allow');
    mock.evaluate = vi.fn(async (payload: GovernanceEventPayload) => {
      mock.events.push(payload);
      if (payload.event_type === 'ActivityStarted') {
        return {
          governance_event_id: 'evt_test',
          verdict: 'require_approval',
          action: 'require_approval',
          approval_id: 'apr_xxx',
          approval_expiration_time: new Date(Date.now() + 1_000).toISOString(),
          risk_score: 0,
        } as GovernanceVerdictResponse;
      }
      return {
        governance_event_id: 'evt_test',
        verdict: 'allow',
        action: 'allow',
        risk_score: 0,
      } as GovernanceVerdictResponse;
    });
    const pollTimes: number[] = [];
    mock.pollApproval = vi.fn(async () => {
      pollTimes.push(Date.now());
      return { id: 'apr_xxx', action: 'require_approval' };
    });

    await govern(
      {
        ...baseConfig(mock),
        preset: presets.claudeCode,
        approvalPollIntervalMs: 20,
        approvalPollMaxIntervalMs: 200,
        approvalPollBackoffFactor: 2,
        approvalPollJitter: 0, // disable jitter for deterministic check
        approvalMaxWaitMs: 1_000,
      },
      async (session) => {
        await session.preToolUse({ input: [{ tool: 'Bash' }] });
      },
    );

    // Need at least 4 polls to see backoff progression: 20, 40, 80, 160, 200(cap)
    expect(pollTimes.length).toBeGreaterThanOrEqual(4);
    const gaps = pollTimes.slice(1).map((t, i) => t - pollTimes[i]);
    // Backoff progression: middle gaps should be larger than the first.
    // (Final gap can be clamped by remaining-time-to-deadline; by design.)
    const firstGap = gaps[0];
    const middleGap = gaps[Math.floor(gaps.length / 2)];
    expect(middleGap).toBeGreaterThan(firstGap);
    // No gap exceeds the configured cap by more than normal scheduler variance.
    for (const g of gaps) expect(g).toBeLessThanOrEqual(250);
  });

  test('jitter spreads consecutive intervals (when factor=1, fixed base + jitter)', async () => {
    const mock = createMockCore('allow');
    mock.evaluate = vi.fn(async (payload: GovernanceEventPayload) => {
      mock.events.push(payload);
      if (payload.event_type === 'ActivityStarted') {
        return {
          governance_event_id: 'evt_test',
          verdict: 'require_approval',
          action: 'require_approval',
          approval_id: 'apr_xxx',
          approval_expiration_time: new Date(Date.now() + 1_000).toISOString(),
          risk_score: 0,
        } as GovernanceVerdictResponse;
      }
      return {
        governance_event_id: 'evt_test',
        verdict: 'allow',
        action: 'allow',
        risk_score: 0,
      } as GovernanceVerdictResponse;
    });
    const pollTimes: number[] = [];
    mock.pollApproval = vi.fn(async () => {
      pollTimes.push(Date.now());
      return { id: 'apr_xxx', action: 'require_approval' };
    });

    await govern(
      {
        ...baseConfig(mock),
        preset: presets.claudeCode,
        approvalPollIntervalMs: 50,
        approvalPollMaxIntervalMs: 50,
        approvalPollBackoffFactor: 1, // no backoff; fixed base
        approvalPollJitter: 0.5, // ±50%
        approvalMaxWaitMs: 800,
      },
      async (session) => {
        await session.preToolUse({ input: [{ tool: 'Bash' }] });
      },
    );

    expect(pollTimes.length).toBeGreaterThanOrEqual(5);
    const gaps = pollTimes.slice(1).map((t, i) => t - pollTimes[i]);
    // With ±50% jitter on a 50ms base, gaps should span at least a 25ms range
    // across 5+ samples, allowing normal scheduler variance. A fixed-interval poll
    // would show gaps clustered tightly within a few ms of 50.
    const min = Math.min(...gaps);
    const max = Math.max(...gaps);
    expect(max - min).toBeGreaterThan(15);
  });

  test('first poll is fast (≤ initial interval + jitter), not the cap', async () => {
    // Regression check on the original "fixed 1s wait" behavior; now we
    // start at the configured initial interval (small) and only ramp up.
    const mock = createMockCore('allow');
    mock.evaluate = vi.fn(async (payload: GovernanceEventPayload) => {
      mock.events.push(payload);
      if (payload.event_type === 'ActivityStarted') {
        return {
          governance_event_id: 'evt_test',
          verdict: 'require_approval',
          action: 'require_approval',
          approval_id: 'apr_xxx',
          approval_expiration_time: new Date(Date.now() + 800).toISOString(),
          risk_score: 0,
        } as GovernanceVerdictResponse;
      }
      return {
        governance_event_id: 'evt_test',
        verdict: 'allow',
        action: 'allow',
        risk_score: 0,
      } as GovernanceVerdictResponse;
    });
    const pollAt: number[] = [];
    mock.pollApproval = vi.fn(async () => {
      pollAt.push(Date.now());
      // Resolve on first poll
      return { id: 'apr_xxx', action: 'allow' };
    });

    const start = Date.now();
    await govern(
      {
        ...baseConfig(mock),
        preset: presets.claudeCode,
        approvalPollIntervalMs: 30,
        approvalPollMaxIntervalMs: 5_000, // cap is high; we should NOT hit it on attempt 1
        approvalPollJitter: 0,
        approvalMaxWaitMs: 30_000,
      },
      async (session) => {
        const v = await session.preToolUse({ input: [{ tool: 'Bash' }] });
        expect(v.arm).toBe('allow');
      },
    );

    expect(pollAt.length).toBe(1);
    const firstPollDelay = pollAt[0] - start;
    // Initial 30ms wait, plus normal scheduler variance.
    expect(firstPollDelay).toBeLessThan(150);
  });
});

describe('BaseGovernedSession.activity (cross-preset escape)', () => {
  // The public `session.activity(eventType, activityType, payload)` on
  // every preset's session lets runtime adapters fire activity_types
  // beyond the bound preset's typed methods; claude-code's PreToolUse
  // hook routing is the canonical case (one hook event → 6+ tool-specific
  // activity_types from the `default` preset's vocabulary).

  test('non-custom preset can fire arbitrary activity_type via session.activity', async () => {
    const mock = createMockCore('allow');
    await govern(
      { ...baseConfig(mock), preset: presets.claudeCode },
      async (session) => {
        // claudeCode preset has preToolUse() (PreToolUse activity_type).
        // session.activity escapes to fire FileRead instead.
        await session.activity('ActivityStarted', 'FileRead', {
          input: [{ file_path: '/etc/secret' }],
        });
      },
    );
    const fileRead = mock.events.find((e) => e.activity_type === 'FileRead');
    expect(fileRead?.event_type).toBe('ActivityStarted');
    // Adapter should have fired both the explicit FileRead activity AND
    // the paired ActivityCompleted on body return; the lifecycle stays
    // intact across the escape.
    const completed = mock.events.find((e) => e.event_type === 'ActivityCompleted' && e.activity_type === 'FileRead');
    expect(completed).toBeDefined();
  });

  test('SignalReceived event_type via session.activity is fire-and-forget', async () => {
    const mock = createMockCore('allow');
    await govern(
      { ...baseConfig(mock), preset: presets.claudeCode },
      async (session) => {
        await session.activity('SignalReceived', 'user_prompt', {
          signalName: 'user_prompt',
          signalArgs: 'refactor the foo module',
          input: [{ prompt: 'refactor the foo module' }],
        });
      },
    );
    const signal = mock.events.find((e) => e.event_type === 'SignalReceived');
    expect(signal?.activity_type).toBe('user_prompt');
    expect(signal?.signal_name).toBe('user_prompt');
    expect(signal?.signal_args).toBe('refactor the foo module');
    // Signals don't get paired ActivityCompleted.
    const stray = mock.events.find((e) => e.event_type === 'ActivityCompleted' && e.activity_type === 'user_prompt');
    expect(stray).toBeUndefined();
  });

  test('openActivity defers the pair until complete() and keeps one activity id', async () => {
    const mock = createMockCore('allow');
    await govern(
      { ...baseConfig(mock), preset: presets.langchain },
      async (session) => {
        const opened = await session.openActivity('on_tool_start', {
          activityId: 'tool-activity-1',
          startTime: 1_000,
          input: [{ tool: 'crm_lookup' }],
        });
        expect(opened.activityId).toBe('tool-activity-1');
        expect(opened.verdict.arm).toBe('allow');
        // Business logic runs here; no completion has been emitted yet.
        expect(
          mock.events.filter((e) => e.event_type === 'ActivityCompleted'),
        ).toHaveLength(0);
        await opened.complete({ output: { rows: 3 }, endTime: 1_250 }, 'on_tool_end');
      },
    );
    const started = mock.events.find((e) => e.event_type === 'ActivityStarted');
    const completed = mock.events.find(
      (e) => e.event_type === 'ActivityCompleted' && e.activity_type === 'on_tool_end',
    );
    expect(started?.activity_id).toBe('tool-activity-1');
    expect(started?.start_time).toBe(1_000);
    expect(completed?.activity_id).toBe('tool-activity-1');
    expect(completed?.status).toBe('completed');
    expect(completed?.start_time).toBe(1_000);
    expect(completed?.end_time).toBe(1_250);
    expect(completed?.duration_ms).toBe(250);
  });

  test('openActivity leaves a blocked start canonically unpaired', async () => {
    const mock = createMockCore('block');
    await govern(
      { ...baseConfig(mock), preset: presets.langchain },
      async (session) => {
        const opened = await session.openActivity('on_tool_start', {
          input: [{ tool: 'crm_lookup' }],
        });
        expect(opened.verdict.arm).toBe('block');
      },
    ).catch(() => undefined);
    expect(
      mock.events.filter(
        (e) => e.event_type === 'ActivityCompleted' && e.activity_type === 'on_tool_start',
      ),
    ).toHaveLength(0);
  });
});

describe('CustomSession (free-form activity)', () => {
  test('activity("X", "pre", ...) emits ActivityStarted with activity_type=X', async () => {
    const mock = createMockCore('allow');
    await govern(
      { ...baseConfig(mock), preset: presets.custom },
      async (session) => {
        await session.activity('WireTransferApproval', 'pre', {
          input: [{ amount: 50_000 }],
        });
      },
    );
    const started = mock.events.find((e) => e.event_type === 'ActivityStarted');
    expect(started?.activity_type).toBe('WireTransferApproval');
  });

  test('activity("X", "post", ...) emits ActivityCompleted with activity_type=X', async () => {
    const mock = createMockCore('allow');
    await govern(
      { ...baseConfig(mock), preset: presets.custom },
      async (session) => {
        await session.activity('WireTransferApproval', 'post', {
          input: [{ amount: 50_000 }],
          output: { transferId: 'tx_xxx' },
        });
      },
    );
    const completed = mock.events.find((e) => e.event_type === 'ActivityCompleted');
    expect(completed?.activity_type).toBe('WireTransferApproval');
    expect(
      (completed as unknown as { activity_output: { transferId: string } }).activity_output
        .transferId,
    ).toBe('tx_xxx');
  });
});

describe('govern.attach (cross-process / harness-owned lifecycle)', () => {
  test('does NOT fire WorkflowStarted automatically', async () => {
    const mock = createMockCore('allow');
    const session = govern.attach({
      core: mockCoreAsClient(mock),
      preset: presets.claudeCode,
      workflowId: 'wf_external',
      runId: 'run_external',
    });
    // No begin/workflowStarted call from attach; caller decides when.
    await session.preToolUse({ input: [{ tool: 'Bash' }] });
    const types = mock.events.map((e) => e.event_type);
    // WorkflowStarted is missing; only the activity envelope fires.
    expect(types).not.toContain('WorkflowStarted');
    expect(types).toContain('ActivityStarted');
    expect(types).toContain('ActivityCompleted');
  });

  test('explicit workflowStarted/Completed are idempotent', async () => {
    const mock = createMockCore('allow');
    const session = govern.attach({
      core: mockCoreAsClient(mock),
      preset: presets.claudeCode,
      workflowId: 'wf_external',
      runId: 'run_external',
    });
    await session.workflowStarted();
    await session.workflowStarted(); // second call no-ops
    await session.workflowCompleted();
    await session.workflowCompleted(); // second call no-ops
    const startedCount = mock.events.filter((e) => e.event_type === 'WorkflowStarted').length;
    const completedCount = mock.events.filter((e) => e.event_type === 'WorkflowCompleted').length;
    expect(startedCount).toBe(1);
    expect(completedCount).toBe(1);
  });

  test('workflowCompleted returns terminal age result once', async () => {
    const ageResult: GovernanceVerdictResponse['age_result'] = {
      allowed: true,
      verdict: 'allow',
      reason: 'Passed governance checks',
      goal_alignment_checked: true,
      goal_drifted: false,
      fallback_used: false,
      span_results: [],
      total_spans: 1,
      violations_count: 0,
      response_time_ms: 12,
    };
    const mock = createMockCore('allow', { age_result: ageResult });
    const session = govern.attach({
      core: mockCoreAsClient(mock),
      preset: presets.claudeCode,
      workflowId: 'wf_age',
      runId: 'run_age',
    });
    await session.workflowStarted();

    const completed = await session.workflowCompleted();
    const duplicate = await session.workflowCompleted();

    expect(completed?.ageResult).toEqual(ageResult);
    expect(duplicate).toBeUndefined();
    expect(mock.events.filter((e) => e.event_type === 'WorkflowCompleted')).toHaveLength(1);
  });

  test('reuses provided workflowId/runId on every emit', async () => {
    const mock = createMockCore('allow');
    const session = govern.attach({
      core: mockCoreAsClient(mock),
      preset: presets.claudeCode,
      workflowId: 'fixed-wf',
      runId: 'fixed-run',
    });
    await session.workflowStarted();
    await session.preToolUse({ input: [{ tool: 'Bash' }] });
    await session.workflowCompleted();
    // Every event carries the same workflow_id + run_id supplied at attach.
    for (const e of mock.events) {
      expect((e as unknown as { workflow_id: string }).workflow_id).toBe('fixed-wf');
      expect((e as unknown as { run_id: string }).run_id).toBe('fixed-run');
    }
  });

  test('exit handlers default to disabled on attach', async () => {
    const mock = createMockCore('allow');
    // If exit handlers WERE registered, vitest's process state would
    // accumulate listeners across tests. We check listener count
    // before/after to confirm none were added.
    const before = process.listenerCount('SIGINT');
    govern.attach({
      core: mockCoreAsClient(mock),
      preset: presets.claudeCode,
      workflowId: 'wf_x',
      runId: 'run_x',
    });
    const after = process.listenerCount('SIGINT');
    expect(after).toBe(before);
  });
});

describe('WorkflowVerdict.guardrailsResult', () => {
  test('populated from wire response.guardrails_result', async () => {
    const mock = createMockCore('allow');
    mock.evaluate = vi.fn(async (payload: GovernanceEventPayload) => {
      mock.events.push(payload);
      return {
        governance_event_id: 'evt_test',
        verdict: 'allow',
        action: 'allow',
        risk_score: 0,
        guardrails_result: {
          input_type: 'activity_input',
          redacted_input: [{ tool: 'Bash', cmd: '<REDACTED>' }],
          validation_passed: true,
          reasons: [{ type: 'pii', field: 'cmd', reason: 'looks like a token' }],
          results: [
            {
              guardrail_type: 'pii',
              results: [{ field: 'cmd', order: 0, status: 'redacted', reason: 'token' }],
            },
          ],
        },
      } as unknown as GovernanceVerdictResponse;
    });

    let captured: import('../../ts/src/core-client/generated/govern.js').WorkflowVerdict | null = null;
    await govern(
      { ...baseConfig(mock), preset: presets.claudeCode },
      async (session) => {
        captured = await session.preToolUse({ input: [{ tool: 'Bash', cmd: 'echo $TOKEN' }] });
      },
    );

    expect(captured).not.toBeNull();
    const v = captured!;
    expect(v.guardrailsResult).toBeDefined();
    expect(v.guardrailsResult?.inputType).toBe('activity_input');
    expect(v.guardrailsResult?.validationPassed).toBe(true);
    expect(v.guardrailsResult?.reasons).toHaveLength(1);
    expect(v.guardrailsResult?.reasons[0].type).toBe('pii');
    expect(v.guardrailsResult?.fieldResults).toHaveLength(1);
    expect(v.guardrailsResult?.fieldResults[0].status).toBe('redacted');
  });

  test('failed guardrails override require_approval before polling', async () => {
    const mock = createMockCore('allow');
    mock.evaluate = vi.fn(async (payload: GovernanceEventPayload) => {
      mock.events.push(payload);
      if (payload.event_type === 'ActivityStarted') {
        return {
          governance_event_id: 'evt_test',
          verdict: 'require_approval',
          action: 'require_approval',
          approval_id: 'apr_xxx',
          risk_score: 0,
          guardrails_result: {
            input_type: 'activity_input',
            validation_passed: false,
            reasons: [
              {
                type: 'pii',
                field: 'cmd',
                reason:
                  'PII detected in command\n\nThought: this scratchpad should not leak',
              },
            ],
          },
        } as unknown as GovernanceVerdictResponse;
      }
      return {
        governance_event_id: 'evt_test',
        verdict: 'allow',
        action: 'allow',
        risk_score: 0,
      } as GovernanceVerdictResponse;
    });
    mock.pollApproval = vi.fn();

    let captured: import('../../ts/src/core-client/generated/govern.js').WorkflowVerdict | null = null;
    await govern(
      { ...baseConfig(mock), preset: presets.claudeCode },
      async (session) => {
        captured = await session.preToolUse({ input: [{ tool: 'Bash' }] });
      },
    );

    expect(captured).toMatchObject({
      arm: 'block',
      reason: 'PII detected in command',
    });
    expect(captured?.guardrailsResult?.validationPassed).toBe(false);
    expect(mock.pollApproval).not.toHaveBeenCalled();
  });

  test('absent on the verdict when wire response has no guardrails_result', async () => {
    const mock = createMockCore('allow');
    type WV = import('../../ts/src/core-client/generated/govern.js').WorkflowVerdict;
    let captured: WV | null = null;
    await govern(
      { ...baseConfig(mock), preset: presets.claudeCode },
      async (session) => {
        captured = await session.preToolUse({ input: [{ tool: 'Bash' }] });
      },
    );
    expect((captured as WV | null)?.guardrailsResult).toBeUndefined();
  });
});
