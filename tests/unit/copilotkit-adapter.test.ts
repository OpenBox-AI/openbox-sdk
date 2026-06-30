import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import {
  createOpenBoxCopilotRuntime,
  createOpenBoxGovernedRunner,
  createOpenBoxRuntimeHooks,
  createGovernedCopilotTool,
  createOpenBoxCopilotKitAdapter,
  createOpenBoxAGUIAdapter,
  createOpenBoxApprovalRoute,
  createOpenBoxHeadlessApprovalClient,
  createOpenBoxReadinessCheck,
  createInstrumentedFetch,
  traced,
  OpenBoxCopilotKitError,
  type OpenBoxCopilotActionInput,
} from '../../ts/src/copilotkit/index';
import {
  createOpenBoxCustomMessageRenderer,
  useOpenBoxCopilotKit,
  OpenBoxGovernanceDecision,
} from '../../ts/src/copilotkit/react';
import type { GovernanceEventPayload } from '../../ts/src/core-client/index';

const FAKE_AGENT_PRIVATE_KEY = Buffer.alloc(32, 1).toString('base64');

// The custom message renderer returns a React.Fragment whose first child is
// the <OpenBoxGovernanceDecision> element carrying the resolved OpenBox tool
// result. Walk that tree (without a DOM) and parse the decision's `result`
// prop so tests can assert the actual verdict/action that was routed in,
// rather than merely that *something* rendered.
function decisionResultFromNode(node: unknown): Record<string, any> {
  expect(React.isValidElement(node)).toBe(true);
  const element = node as React.ReactElement;
  expect(element.type).toBe(React.Fragment);
  const children = React.Children.toArray(
    (element.props as { children?: React.ReactNode }).children,
  );
  const decision = children.find(
    (child): child is React.ReactElement =>
      React.isValidElement(child) && child.type === OpenBoxGovernanceDecision,
  );
  expect(decision).toBeDefined();
  const result = (decision!.props as { result?: unknown }).result;
  return JSON.parse(
    typeof result === 'string' ? result : JSON.stringify(result),
  ) as Record<string, any>;
}

type DemoInput = OpenBoxCopilotActionInput & {
  action: 'demo_action';
  request: string;
};

type DemoArtifact = {
  body: string;
};

function createMockCore(
  resolve: (payload: GovernanceEventPayload) => Record<string, unknown>,
) {
  const events: GovernanceEventPayload[] = [];
  return {
    events,
    core: {
      evaluate: vi.fn(async (payload: GovernanceEventPayload) => {
        events.push(payload);
        return resolve(payload);
      }),
      pollApproval: vi.fn(),
    },
  };
}

function createDemoTool(
  resolve: (payload: GovernanceEventPayload) => Record<string, unknown>,
) {
  const mock = createMockCore(resolve);
  const adapter = createOpenBoxCopilotKitAdapter({
    core: mock.core as any,
    workflowType: 'CopilotKitTestWorkflow',
    taskQueue: 'langgraph',
  });
  const execute = vi.fn(
    async (input: DemoInput): Promise<DemoArtifact> => ({
      body: input.request,
    }),
  );
  const tool = createGovernedCopilotTool<DemoInput, DemoArtifact>({
    adapter,
    toolName: 'openbox_governed_action',
    description: 'Test governed action.',
    execute,
    isArtifactRedacted: (artifact) =>
      artifact?.body.includes('[REDACTED') ?? false,
    markArtifactRedacted: (artifact) => artifact,
  });
  return { ...mock, execute, tool };
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('CopilotKit OpenBox adapter', () => {
  it('does not register governed backend tools as same-named frontend render tools', () => {
    const useHumanInTheLoop = vi.fn();
    const useInterrupt = vi.fn();
    const useDefaultRenderTool = vi.fn();
    const useRenderTool = vi.fn();

    const result = useOpenBoxCopilotKit({
      bindings: {
        useHumanInTheLoop,
        useInterrupt,
        useDefaultRenderTool,
        useRenderTool,
      },
    });

    expect(result.governedToolNames).toContain('openbox_governed_action');
    // Interactive review is a model-driven HITL tool (useHumanInTheLoop); the
    // deterministic governance approval is a host-driven langgraph interrupt
    // rendered via useInterrupt — not a same-named frontend tool.
    expect(useHumanInTheLoop).toHaveBeenCalledTimes(1);
    expect(useInterrupt).toHaveBeenCalledTimes(1);
    expect(useDefaultRenderTool).toHaveBeenCalledTimes(1);
    expect(useRenderTool).not.toHaveBeenCalled();
  });

  it('renders OpenBox snapshot tool messages through the React custom message renderer', () => {
    const renderer = createOpenBoxCustomMessageRenderer();
    const Render = renderer.render as (props: Record<string, unknown>) => unknown;

    const node = Render({
      position: 'after',
      message: {
        role: 'tool',
        content: JSON.stringify({
          schemaVersion: 'openbox.copilotkit.result.v1',
          action: 'open_revenue_queue',
          request: 'Open revenue queue',
          status: 'executed',
          verdict: 'allow',
        }),
      },
    });

    expect(node).not.toBeNull();
    const decision = decisionResultFromNode(node);
    expect(decision.verdict).toBe('allow');
    expect(decision.action).toBe('open_revenue_queue');
    expect(decision.status).toBe('executed');
    expect(decision.request).toBe('Open revenue queue');
  });

  it('finds LangGraph ai/tool message pairs through the React custom message renderer', () => {
    const renderer = createOpenBoxCustomMessageRenderer();
    const Render = renderer.render as (props: Record<string, unknown>) => unknown;
    const toolCallId = 'call_openbox_1';

    const node = Render({
      position: 'after',
      message: {
        type: 'ai',
        additional_kwargs: {
          tool_calls: [
            {
              id: toolCallId,
              type: 'function',
              function: { name: 'openbox_governed_action', arguments: '{}' },
            },
          ],
        },
      },
      stateSnapshot: {
        messages: [
          {
            type: 'tool',
            tool_call_id: toolCallId,
            content: JSON.stringify({
              schemaVersion: 'openbox.copilotkit.result.v1',
              action: 'view_governance_report',
              request: 'Create a governed report.',
              status: 'constrained',
              verdict: 'constrain',
            }),
          },
        ],
      },
    });

    expect(node).not.toBeNull();
    // Proves the ai->tool pairing resolved the paired tool message (by
    // tool_call_id) rather than some other message: the verdict/action below
    // come only from the snapshot tool message, not the ai message.
    const decision = decisionResultFromNode(node);
    expect(decision.verdict).toBe('constrain');
    expect(decision.action).toBe('view_governance_report');
    expect(decision.status).toBe('constrained');
    expect(decision.request).toBe('Create a governed report.');
  });

  it('maps fail-closed errors to Governance Unavailable, never to a Blocked verdict', async () => {
    const { verdictFromResult } = await import(
      '../../ts/src/copilotkit/react-governance-decision'
    );
    const { verdictStyles } = await import(
      '../../ts/src/copilotkit/react-defaults'
    );
    const errorVerdict = verdictFromResult(
      { status: 'error', verdict: 'block', reason: 'Request failed: 500' },
    );
    expect(errorVerdict).toBe('error');
    expect(verdictStyles.error.label).toBe('Governance Unavailable');
    // A real policy block still maps to the Blocked verdict.
    expect(
      verdictFromResult({ status: 'blocked', verdict: 'block' }),
    ).toBe('block');
  });

  it('maps Core policy availability failures to SDK error results, not business halts', async () => {
    const { execute, tool } = createDemoTool((payload) => {
      if (payload.event_type === 'ActivityStarted') {
        return {
          verdict: 'halt',
          reason: 'OPA unavailable - fail-closed security policy applied',
        };
      }
      return { verdict: 'allow', reason: 'allowed' };
    });

    const result = await tool.execute({
      action: 'demo_action',
      request: 'Try a governed action while policy evaluation is unavailable.',
    });

    expect(result.status).toBe('error');
    expect(result.verdict).toBe('error');
    expect(result.executed).toBe(false);
    expect(result.message).toContain('availability failure');
    expect(result.session?.status).toBe('active');
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns governed tool input approvals to the CopilotKit host without polling', async () => {
    const { core, events, execute, tool } = createDemoTool((payload) => {
      if (
        payload.event_type === 'ActivityStarted' &&
        payload.hook_trigger !== true
      ) {
        return {
          verdict: 'require_approval',
          action: 'require_approval',
          reason: 'Large refund requires approval.',
          approval_id: 'approval-large-refund',
          governance_event_id: 'event-large-refund',
          approval_expiration_time: '2027-01-01T00:00:00.000Z',
        };
      }
      return { verdict: 'allow', reason: 'allowed' };
    });

    const result = await tool.execute({
      action: 'demo_action',
      request: 'Issue a large refund.',
      amountUsd: 7500,
    });

    expect(result.status).toBe('approval_required');
    expect(result.verdict).toBe('require_approval');
    expect(result.executed).toBe(false);
    expect(result.approvalId).toBe('approval-large-refund');
    expect(result.governanceEventId).toBe('event-large-refund');
    expect(result.expiresAt).toBe('2027-01-01T00:00:00.000Z');
    expect(execute).not.toHaveBeenCalled();
    expect(core.pollApproval).not.toHaveBeenCalled();
    expect(events.map((event) => event.event_type)).toEqual([
      'SignalReceived',
      'WorkflowStarted',
      'ActivityStarted',
    ]);
  });

  it('renders OpenBox assistant tool-call snapshots through the React custom message renderer', () => {
    const renderer = createOpenBoxCustomMessageRenderer();
    const Render = renderer.render as (props: Record<string, unknown>) => unknown;

    const node = Render({
      position: 'before',
      message: {
        role: 'assistant',
        toolCalls: [
          {
            id: 'tool-call-1',
            type: 'function',
            function: { name: 'openbox_governed_action' },
          },
        ],
      },
      stateSnapshot: {
        messages: [
          {
            type: 'tool',
            tool_call_id: 'tool-call-1',
            content: JSON.stringify({
              schemaVersion: 'openbox.copilotkit.result.v1',
              action: 'open_revenue_queue',
              request: 'Open revenue queue',
              status: 'executed',
              verdict: 'allow',
            }),
          },
        ],
      },
    });

    expect(node).not.toBeNull();
    const decision = decisionResultFromNode(node);
    expect(decision.verdict).toBe('allow');
    expect(decision.action).toBe('open_revenue_queue');
    expect(decision.status).toBe('executed');
  });

  it('ignores non-OpenBox tool messages in the React custom message renderer', () => {
    const renderer = createOpenBoxCustomMessageRenderer();
    const Render = renderer.render as (props: Record<string, unknown>) => unknown;

    expect(
      Render({
        position: 'after',
        message: {
          role: 'tool',
          content: JSON.stringify({ ok: true }),
        },
      }),
    ).toBeNull();
  });

  it('runtime Core client only needs OPENBOX_CORE_URL and OPENBOX_API_KEY', () => {
    const previous = {
      OPENBOX_API_KEY: process.env.OPENBOX_API_KEY,
      OPENBOX_API_URL: process.env.OPENBOX_API_URL,
      OPENBOX_CORE_URL: process.env.OPENBOX_CORE_URL,
      OPENBOX_AGENT_ID: process.env.OPENBOX_AGENT_ID,
    };
    process.env.OPENBOX_API_KEY = 'obx_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    process.env.OPENBOX_CORE_URL = 'http://127.0.0.1:8086';
    delete process.env.OPENBOX_API_URL;
    delete process.env.OPENBOX_AGENT_ID;

    try {
      expect(() =>
        createOpenBoxCopilotKitAdapter().getCoreClient(),
      ).not.toThrow();
    } finally {
      restoreEnv(previous);
    }
  });

  it('enables governance for canonical runtime config without requiring an injected Core client', () => {
    const previous = {
      OPENBOX_API_KEY: process.env.OPENBOX_API_KEY,
      OPENBOX_CORE_URL: process.env.OPENBOX_CORE_URL,
    };
    process.env.OPENBOX_API_KEY = 'obx_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    process.env.OPENBOX_CORE_URL = 'http://127.0.0.1:8086';

    try {
      expect(createOpenBoxCopilotKitAdapter().isEnabled()).toBe(true);
      expect(
        createOpenBoxCopilotKitAdapter({
          apiKey: 'obx_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          coreUrl: 'http://127.0.0.1:8086',
        }).isEnabled(),
      ).toBe(true);
      expect(
        createOpenBoxCopilotKitAdapter({ enabled: false }).isEnabled(),
      ).toBe(false);
    } finally {
      restoreEnv(previous);
    }
  });

  it('rejects org/backend keys used as CopilotKit runtime keys', () => {
    const previous = {
      OPENBOX_API_KEY: process.env.OPENBOX_API_KEY,
      OPENBOX_CORE_URL: process.env.OPENBOX_CORE_URL,
    };
    process.env.OPENBOX_API_KEY = `obx_key_${'a'.repeat(48)}`;
    process.env.OPENBOX_CORE_URL = 'http://127.0.0.1:8086';

    try {
      expect(() => createOpenBoxCopilotKitAdapter().getCoreClient()).toThrow(
        'OpenBox CopilotKit runtime expected an agent runtime key in OPENBOX_API_KEY',
      );
    } finally {
      restoreEnv(previous);
    }
  });

  it('passes signed agent identity from env into the runtime Core client', () => {
    const previous = {
      OPENBOX_API_KEY: process.env.OPENBOX_API_KEY,
      OPENBOX_CORE_URL: process.env.OPENBOX_CORE_URL,
      OPENBOX_AGENT_DID: process.env.OPENBOX_AGENT_DID,
      OPENBOX_AGENT_PRIVATE_KEY: process.env.OPENBOX_AGENT_PRIVATE_KEY,
    };
    process.env.OPENBOX_API_KEY = 'obx_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    process.env.OPENBOX_CORE_URL = 'http://127.0.0.1:8086';
    process.env.OPENBOX_AGENT_DID = 'did:aip:550e8400-e29b-41d4-a716-446655440000';
    process.env.OPENBOX_AGENT_PRIVATE_KEY = FAKE_AGENT_PRIVATE_KEY;

    try {
      const client = createOpenBoxCopilotKitAdapter().getCoreClient() as any;
      expect(client.config.agentIdentity).toEqual({
        did: 'did:aip:550e8400-e29b-41d4-a716-446655440000',
        privateKey: FAKE_AGENT_PRIVATE_KEY,
      });
    } finally {
      restoreEnv(previous);
    }
  });

  it('passes explicit Core timeout into the runtime Core client', () => {
    const adapter = createOpenBoxCopilotKitAdapter({
      apiKey: 'obx_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      coreUrl: 'http://127.0.0.1:8086',
      coreTimeoutMs: 90_000,
    });

    const client = adapter.getCoreClient() as any;
    expect(client.config.timeoutMs).toBe(90_000);
  });

  it('rejects incomplete signed agent identity env config', () => {
    const previous = {
      OPENBOX_API_KEY: process.env.OPENBOX_API_KEY,
      OPENBOX_CORE_URL: process.env.OPENBOX_CORE_URL,
      OPENBOX_AGENT_DID: process.env.OPENBOX_AGENT_DID,
      OPENBOX_AGENT_PRIVATE_KEY: process.env.OPENBOX_AGENT_PRIVATE_KEY,
    };
    process.env.OPENBOX_API_KEY = 'obx_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    process.env.OPENBOX_CORE_URL = 'http://127.0.0.1:8086';
    process.env.OPENBOX_AGENT_DID = 'did:aip:550e8400-e29b-41d4-a716-446655440000';
    delete process.env.OPENBOX_AGENT_PRIVATE_KEY;

    try {
      expect(() => createOpenBoxCopilotKitAdapter().getCoreClient()).toThrow(
        'OpenBox signed agent identity requires both OPENBOX_AGENT_DID and OPENBOX_AGENT_PRIVATE_KEY.',
      );
    } finally {
      restoreEnv(previous);
    }
  });

  it('approval route decides through the Backend approval API', async () => {
    const previous = {
      OPENBOX_API_URL: process.env.OPENBOX_API_URL,
      OPENBOX_BACKEND_API_KEY: process.env.OPENBOX_BACKEND_API_KEY,
      OPENBOX_AGENT_ID: process.env.OPENBOX_AGENT_ID,
    };
    delete process.env.OPENBOX_API_URL;
    delete process.env.OPENBOX_BACKEND_API_KEY;
    delete process.env.OPENBOX_AGENT_ID;
    const originalFetch = globalThis.fetch;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ data: {} }),
        text: () => Promise.resolve(JSON.stringify({ data: {} })),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ data: { id: 'event-1' } }),
        text: () => Promise.resolve(JSON.stringify({ data: { id: 'event-1' } })),
      } as Response);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    try {
      const route = createOpenBoxApprovalRoute({
        apiUrl: 'https://api.openbox.test',
        backendApiKey: `obx_key_${'a'.repeat(48)}`,
        agentId: 'agent-1',
      });
      const result = await route.decide({
        governanceEventId: 'event-1',
        workflowId: 'workflow-1',
        runId: 'run-1',
        activityId: 'activity-1',
        decision: 'approve',
      });

      expect(result).toEqual({
        ok: true,
        decision: 'approve',
        eventId: 'event-1',
      });
      expect(fetchMock.mock.calls[1][0]).toBe(
        'https://api.openbox.test/agent/agent-1/approvals/event-1/decide?action=approve',
      );
      expect(fetchMock.mock.calls[1][1].method).toBe('PUT');
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv(previous);
    }
  });

  it('maps AG-UI run, tool, message, state, error, and interrupt events through OpenBox gates', async () => {
    const safe = (payload: unknown) => ({
      safe: payload,
      verdict: { arm: 'allow' as const, reason: 'allowed' },
      status: 'executed' as const,
      changed: false,
      rawBlocked: false,
      reason: 'allowed',
      message: 'allowed',
      workflowId: 'workflow-agui',
      runId: 'run-agui',
      activityId: 'activity-agui',
    });
    const adapter = {
      governPrompt: vi.fn(async ({ payload }) => safe(payload)),
      governToolInput: vi.fn(async ({ payload }) => safe(payload)),
      governToolOutput: vi.fn(async ({ payload }) => safe(payload)),
      governAssistantOutput: vi.fn(async ({ payload }) => safe(payload)),
    };
    const agui = createOpenBoxAGUIAdapter({
      adapter: adapter as any,
      sessionKey: (event) => event.threadId ?? 'agui-thread',
    });

    await agui.handleEvent({ type: 'RUN_STARTED', threadId: 'thread-1', input: { prompt: 'hi' } });
    await agui.handleEvent({ type: 'TOOL_CALL_START', threadId: 'thread-1', toolCallId: 'tool-1', toolName: 'lookup', input: { q: 'x' } });
    await agui.handleEvent({ type: 'TOOL_CALL_RESULT', threadId: 'thread-1', toolCallId: 'tool-1', toolName: 'lookup', output: { ok: true } });
    await agui.handleEvent({ type: 'TEXT_MESSAGE_CONTENT', threadId: 'thread-1', messageId: 'msg-1', delta: 'hello' });
    await agui.handleEvent({ type: 'STATE_DELTA', threadId: 'thread-1', state: { selected: 1 } });
    await agui.handleEvent({ type: 'RUN_ERROR', threadId: 'thread-1', error: new Error('boom') });
    const interrupt = await agui.handleEvent({
      type: 'INTERRUPT',
      threadId: 'thread-1',
      payload: { governanceEventId: 'event-1' },
    });

    expect(adapter.governPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'thread-1',
        ensureWorkflowStarted: true,
      }),
    );
    expect(adapter.governToolInput).toHaveBeenCalledTimes(2);
    expect(adapter.governToolOutput).toHaveBeenCalledTimes(1);
    expect(adapter.governAssistantOutput).toHaveBeenCalledTimes(3);
    expect(interrupt).toMatchObject({
      kind: 'interrupt',
      eventType: 'INTERRUPT',
      sessionKey: 'thread-1',
    });
  });

  it('normalizes usage and cost from AG-UI run completion events', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      action: 'allow',
      risk_score: 0,
      reason: 'allowed',
    }));
    const adapter = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    });
    const agui = createOpenBoxAGUIAdapter({ adapter });

    const result = await agui.handleEvent({
      type: 'RUN_FINISHED',
      threadId: 'thread-usage',
      runId: 'run-usage',
      model: 'gpt-4o-mini',
      usage: {
        inputTokens: 5,
        outputTokens: 7,
        total_cost_usd: 0.019,
      },
      output: 'done',
    });

    expect(result.kind).toBe('message');
    const completed = mock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'CopilotKitAGUI:RUN_FINISHED',
    );
    expect(completed).toMatchObject({
      llm_model: 'gpt-4o-mini',
      input_tokens: 5,
      output_tokens: 7,
      total_tokens: 12,
      cost_usd: 0.019,
      completion: 'done',
    });
    expect(completed?.activity_output).toMatchObject({
      event_type: 'RUN_FINISHED',
      model: 'gpt-4o-mini',
      usage: {
        inputTokens: 5,
        outputTokens: 7,
        total_cost_usd: 0.019,
      },
      output: 'done',
      content: 'done',
    });
  });

  it('resolves OpenBox approvals from headless non-React callers', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ data: {} }),
        text: () => Promise.resolve(JSON.stringify({ data: {} })),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ data: { id: 'event-headless' } }),
        text: () => Promise.resolve(JSON.stringify({ data: { id: 'event-headless' } })),
      } as Response);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    try {
      const client = createOpenBoxHeadlessApprovalClient({
        apiUrl: 'https://api.openbox.test',
        backendApiKey: `obx_key_${'b'.repeat(48)}`,
        agentId: 'agent-1',
      });

      const result = await client.approve({
        result: {
          governanceEventId: 'event-headless',
          workflowId: 'workflow-1',
          runId: 'run-1',
          activityId: 'activity-1',
        },
      });

      expect(result).toEqual({
        ok: true,
        decision: 'approve',
        eventId: 'event-headless',
      });
      expect(fetchMock.mock.calls[1][0]).toBe(
        'https://api.openbox.test/agent/agent-1/approvals/event-headless/decide?action=approve',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('approval route requires backend config for decisions', async () => {
    const previous = {
      OPENBOX_API_URL: process.env.OPENBOX_API_URL,
      OPENBOX_BACKEND_API_KEY: process.env.OPENBOX_BACKEND_API_KEY,
      OPENBOX_AGENT_ID: process.env.OPENBOX_AGENT_ID,
    };
    delete process.env.OPENBOX_API_URL;
    delete process.env.OPENBOX_BACKEND_API_KEY;
    delete process.env.OPENBOX_AGENT_ID;

    try {
      const route = createOpenBoxApprovalRoute({});
      await expect(
        route.decide({
          governanceEventId: 'event-1',
          workflowId: 'workflow-1',
          runId: 'run-1',
          activityId: 'activity-1',
          decision: 'approve',
        }),
      ).rejects.toThrow('OpenBox API URL is not configured.');
    } finally {
      restoreEnv(previous);
    }
  });

  it('applies Core output guardrail transforms without mutating the Core verdict', async () => {
    const { tool } = createDemoTool((payload) => {
      if (payload.event_type !== 'ActivityCompleted') {
        return {
          governance_event_id: 'event-start',
          verdict: 'allow',
          action: 'allow',
          risk_score: 0,
          governance_checks_incomplete: false,
        };
      }
      return {
        governance_event_id: 'event-complete',
        verdict: 'allow',
        action: 'allow',
        risk_score: 0,
        governance_checks_incomplete: false,
        guardrails_result: {
          input_type: 'activity_output',
          redacted_input: {
            artifact: {
              body: 'Email <EMAIL_ADDRESS> was removed.',
            },
          },
          validation_passed: true,
          reasons: [],
          results: [
            {
              guardrail_type: 'pii',
              results: [
                {
                  field: 'output.artifact.body',
                  order: 0,
                  status: 'redacted',
                },
              ],
            },
          ],
        },
      };
    });

    const result = await tool.execute({
      action: 'demo_action',
      request: 'Email avery@example.com was removed.',
    });

    expect(result.status).toBe('executed');
    expect(result.verdict).toBe('allow');
    expect(result.artifact).toEqual({
      body: 'Email <EMAIL_ADDRESS> was removed.',
    });
    expect(result.redactionSummary).toBe(
      'OpenBox redacted output.artifact.body.',
    );
  });

  it('readiness treats backend inventory config as optional when Core runtime is configured', async () => {
    const previous = {
      OPENBOX_API_URL: process.env.OPENBOX_API_URL,
      OPENBOX_BACKEND_API_KEY: process.env.OPENBOX_BACKEND_API_KEY,
      OPENBOX_AGENT_ID: process.env.OPENBOX_AGENT_ID,
    };
    delete process.env.OPENBOX_API_URL;
    delete process.env.OPENBOX_BACKEND_API_KEY;
    delete process.env.OPENBOX_AGENT_ID;

    try {
      const result = await createOpenBoxReadinessCheck({
        core: {
          evaluate: vi.fn(),
          pollApproval: vi.fn(),
        } as any,
      }).check();

      expect(result.ok).toBe(true);
      expect(result.core).toBe(true);
      expect(result.capabilities.promptGovernance).toBe(true);
      expect(result.capabilities.finalOutputGovernance).toBe(true);
      expect(result.capabilities.approvals).toBe(false);
      expect(result.guardrails).toBe(false);
      expect(result.policies).toBe(false);
      expect(result.behaviorRules).toBe(false);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([
        'backend inventory not checked: missing OPENBOX_API_URL, OPENBOX_BACKEND_API_KEY, OPENBOX_AGENT_ID',
      ]);
    } finally {
      restoreEnv(previous);
    }
  });

  it('emits workflow/tool lifecycle events around a governed tool', async () => {
    const { events, execute, tool } = createDemoTool(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));

    const result = await tool.execute({
      action: 'demo_action',
      request: 'Create a support ticket.',
    });

    expect(result.status).toBe('executed');
    expect(result.executed).toBe(true);
    expect(result.artifact).toEqual({ body: 'Create a support ticket.' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.event_type)).toEqual([
      'SignalReceived',
      'WorkflowStarted',
      'ActivityStarted',
      'ActivityCompleted',
      'WorkflowCompleted',
    ]);
    const startedParent = events.find(
      (event) => event.event_type === 'ActivityStarted' && !event.hook_trigger,
    );
    const completedParent = events.find(
      (event) => event.event_type === 'ActivityCompleted' && !event.hook_trigger,
    );
    // Canonical: a governed tool whose execute() performs no instrumented
    // sub-operation emits NO hook_trigger span evaluation. The tool ACTIVITY
    // carries no span of its own; identity rides on the parent activity, and the
    // artifact rides on the completed activity's output.
    const hookSpanEvents = events.filter(
      (event) => event.hook_trigger === true && (event.spans?.length ?? 0) > 0,
    );
    expect(hookSpanEvents).toEqual([]);
    expect(startedParent?.spans).toBeUndefined();
    expect(completedParent?.spans).toBeUndefined();
    expect(startedParent?.activity_type).toBe('openbox_governed_action');
    expect(completedParent?.activity_type).toBe('openbox_governed_action');
    expect(JSON.stringify(completedParent?.activity_output)).toContain(
      'Create a support ticket.',
    );
    expect(events[0]).toMatchObject({
      event_type: 'SignalReceived',
      signal_name: 'user_prompt',
      signal_args: ['Create a support ticket.'],
      session_id: 'default',
      prompt: 'Create a support ticket.',
      activity_input: [
        expect.objectContaining({
          prompt: 'Create a support ticket.',
          current_prompt: 'Create a support ticket.',
          goal_prompt: 'Create a support ticket.',
          original_goal: 'Create a support ticket.',
          event_category: 'agent_goal',
          is_initial_goal: true,
          _openbox_source: 'copilotkit',
        }),
      ],
    });
  });

  it('records failed governed tool execution as completed tool telemetry before workflow failure', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const adapter = createOpenBoxCopilotKitAdapter({ core: mock.core as any });
    const tool = createGovernedCopilotTool<DemoInput, DemoArtifact>({
      adapter,
      toolName: 'openbox_governed_action',
      description: 'Test governed action.',
      execute: async () => {
        throw new Error('business tool failed');
      },
    });

    const result = await tool.execute({
      action: 'demo_action',
      request: 'Create a support ticket.',
    });

    expect(result.status).toBe('error');
    expect(mock.events.map((event) => event.event_type)).toEqual([
      'SignalReceived',
      'WorkflowStarted',
      'ActivityStarted',
      'ActivityCompleted',
      'WorkflowFailed',
    ]);
    const completedParent = mock.events.find(
      (event) => event.event_type === 'ActivityCompleted' && !event.hook_trigger,
    );
    // Canonical: no instrumented sub-op in execute() -> no hook span events; the
    // failure telemetry rides on the completed activity output.
    const hookSpanEvents = mock.events.filter(
      (event) => event.hook_trigger === true && (event.spans?.length ?? 0) > 0,
    );
    expect(hookSpanEvents).toEqual([]);
    expect(completedParent?.activity_output).toEqual({
      status: 'failed',
      error: { errorName: 'Error', message: 'business tool failed' },
    });
  });

  it('does not reopen approval after an approved resume completes the tool', async () => {
    const events: GovernanceEventPayload[] = [];
    const core = {
      evaluate: vi.fn(async (payload: GovernanceEventPayload) => {
        events.push(payload);
        const rawCompletionInput = JSON.stringify(payload.activity_input ?? {});
        if (
          payload.event_type === 'ActivityCompleted' &&
          rawCompletionInput.includes('7500')
        ) {
          return {
            verdict: 'require_approval',
            action: 'require_approval',
            reason: 'approval already satisfied for this activity',
            governance_event_id: 'event-complete',
            approval_id: 'approval-duplicate',
          };
        }
        return { verdict: 'allow', action: 'allow', reason: 'allowed' };
      }),
      pollApproval: vi.fn(async () => ({
        action: 'allow',
        reason: 'approval granted',
      })),
    };
    const adapter = createOpenBoxCopilotKitAdapter({
      core: core as any,
      workflowType: 'CopilotKitTestWorkflow',
      taskQueue: 'langgraph',
    });
    const execute = vi.fn(
      async (input: DemoInput): Promise<DemoArtifact> => ({
        body: input.request,
      }),
    );
    const tool = createGovernedCopilotTool<DemoInput, DemoArtifact>({
      adapter,
      toolName: 'openbox_governed_action',
      description: 'Test governed action.',
      execute,
    });

    const result = await tool.resume({
      action: 'demo_action',
      request: 'Issue a service credit after approval for $7,500.',
      amountUsd: 7500,
      destination: 'approved customer account',
      workflowId: 'workflow-approval',
      runId: 'run-approval',
      activityId: 'activity-approval',
      approved: true,
      approvalId: 'approval-row',
      governanceEventId: 'event-start',
    });

    expect(core.pollApproval).toHaveBeenCalledWith({
      workflow_id: 'workflow-approval',
      run_id: 'run-approval',
      activity_id: 'activity-approval',
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('executed');
    expect(result.executed).toBe(true);
    expect(result.verdict).toBe('allow');
    expect(result.reason).toBe('OpenBox approval was granted.');
    const completionParent = events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.hook_trigger !== true,
    );
    const completionHook = events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.hook_trigger === true &&
        event.spans?.[0]?.stage === 'completed' &&
        event.activity_id === completionParent?.activity_id,
    );
    const activityInputJson = JSON.stringify(completionParent?.activity_input);
    const spanDataJson = JSON.stringify(
      (completionHook?.spans ?? []).map((span) => span.data ?? {}),
    );
    expect(activityInputJson).not.toContain('"amountUsd"');
    expect(activityInputJson).not.toContain('Issue a service credit');
    expect(spanDataJson).not.toContain('"amountUsd"');
    expect(spanDataJson).not.toContain('Issue a service credit');
    expect(JSON.stringify(completionParent?.activity_output)).toContain('7,500');
    expect(events.map((event) => event.event_type)).toEqual([
      'ActivityCompleted',
      'WorkflowCompleted',
    ]);
    expect(completionParent?.hook_trigger).toBe(false);
    expect(completionParent?.spans).toBeUndefined();
    // Canonical: the approval resume activity emits no hook span.
    const resumeHookSpans = events.filter(
      (event) => event.hook_trigger === true && (event.spans?.length ?? 0) > 0,
    );
    expect(resumeHookSpans).toEqual([]);
  });

  it('retries CopilotKit poll failures until the server approval expiration', async () => {
    vi.useFakeTimers();
    try {
      const startedAt = new Date('2026-01-01T00:00:00.000Z');
      vi.setSystemTime(startedAt);
      const expiresAt = new Date(
        startedAt.getTime() + 60_000,
      ).toISOString();
      let pollAttempts = 0;
      const core = {
        evaluate: vi.fn(),
        pollApproval: vi.fn(async () => {
          pollAttempts += 1;
          if (pollAttempts === 1) {
            throw new Error('temporary poll outage');
          }
          const approved = Date.now() - startedAt.getTime() >= 10_500;
          return {
            action: approved ? 'allow' : 'require_approval',
            reason: approved ? 'approval granted' : 'approval pending',
            approval_expiration_time: expiresAt,
          };
        }),
      };
      const adapter = createOpenBoxCopilotKitAdapter({
        core: core as any,
        workflowType: 'CopilotKitTestWorkflow',
        taskQueue: 'langgraph',
      });
      const { pollApproval } = await import(
        '../../ts/src/copilotkit/workflow-session'
      );

      const result = pollApproval(adapter, {
        workflowId: 'workflow-approval',
        runId: 'run-approval',
        activityId: 'activity-approval',
      });
      await vi.advanceTimersByTimeAsync(10_500);

      await expect(result).resolves.toMatchObject({
        arm: 'allow',
        reason: 'approval granted',
      });
      expect(core.pollApproval).toHaveBeenLastCalledWith({
        workflow_id: 'workflow-approval',
        run_id: 'run-approval',
        activity_id: 'activity-approval',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps camelCase CopilotKit approval status aliases', async () => {
    const expiresAt = '2027-01-01T00:00:00.000Z';
    const core = {
      evaluate: vi.fn(),
      pollApproval: vi.fn(async () => ({
        action: 'allow',
        reason: 'approval granted',
        approvalExpiresAt: expiresAt,
        trustTier: 2,
        guardrailsResult: {
          input_type: 'activity_output',
          redacted_output: { output: { secret: '[REDACTED]' } },
          validation_passed: true,
          reasons: [],
          field_results: [{ field: 'output.secret', status: 'redacted' }],
        },
      })),
    };
    const adapter = createOpenBoxCopilotKitAdapter({
      core: core as any,
      workflowType: 'CopilotKitTestWorkflow',
      taskQueue: 'langgraph',
    });
    const { pollApproval } = await import(
      '../../ts/src/copilotkit/workflow-session'
    );

    await expect(
      pollApproval(adapter, {
        workflowId: 'workflow-approval',
        runId: 'run-approval',
        activityId: 'activity-approval',
      }),
    ).resolves.toMatchObject({
      arm: 'allow',
      reason: 'approval granted',
      approvalExpiresAt: expiresAt,
      trustTier: 2,
      guardrailsResult: {
        inputType: 'activity_output',
        redactedOutput: { output: { secret: '[REDACTED]' } },
        fieldResults: [{ field: 'output.secret', status: 'redacted' }],
      },
    });
    expect(core.pollApproval).toHaveBeenCalledTimes(1);
  });

  it('keeps polling CopilotKit approvals when Core omits expiration', async () => {
    vi.useFakeTimers();
    try {
      const startedAt = new Date('2026-01-01T00:00:00.000Z');
      vi.setSystemTime(startedAt);
      const core = {
        evaluate: vi.fn(),
        pollApproval: vi.fn(async () => {
          const approved = Date.now() - startedAt.getTime() >= 61_500;
          return {
            action: approved ? 'allow' : 'require_approval',
            reason: approved ? 'approval granted after server-owned wait' : 'approval pending',
          };
        }),
      };
      const adapter = createOpenBoxCopilotKitAdapter({
        core: core as any,
        workflowType: 'CopilotKitTestWorkflow',
        taskQueue: 'langgraph',
      });
      const { pollApproval } = await import(
        '../../ts/src/copilotkit/workflow-session'
      );

      const result = pollApproval(adapter, {
        workflowId: 'workflow-approval',
        runId: 'run-approval',
        activityId: 'activity-approval',
      });
      await vi.advanceTimersByTimeAsync(61_500);

      await expect(result).resolves.toMatchObject({
        arm: 'allow',
        reason: 'approval granted after server-owned wait',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats expired CopilotKit approval status as terminal before allow verdict', async () => {
    const core = {
      evaluate: vi.fn(),
      pollApproval: vi.fn(async () => ({
        action: 'allow',
        expired: true,
        reason: 'approval window expired',
        approval_expiration_time: '2026-01-01T00:00:30.000Z',
      })),
    };
    const adapter = createOpenBoxCopilotKitAdapter({
      core: core as any,
      workflowType: 'CopilotKitTestWorkflow',
      taskQueue: 'langgraph',
    });
    const { pollApproval } = await import(
      '../../ts/src/copilotkit/workflow-session'
    );

    await expect(
      pollApproval(adapter, {
        workflowId: 'workflow-approval',
        runId: 'run-approval',
        activityId: 'activity-approval',
      }),
    ).resolves.toMatchObject({
      arm: 'block',
      reason: 'approval window expired',
    });
  });

  it('uses verdict before action when polling CopilotKit approvals', async () => {
    const core = {
      evaluate: vi.fn(),
      pollApproval: vi.fn(async () => ({
        verdict: 0,
        action: 'require_approval',
        reason: 'approval granted',
      })),
    };
    const adapter = createOpenBoxCopilotKitAdapter({
      core: core as any,
      workflowType: 'CopilotKitTestWorkflow',
      taskQueue: 'langgraph',
    });
    const { pollApproval } = await import(
      '../../ts/src/copilotkit/workflow-session'
    );

    await expect(
      pollApproval(adapter, {
        workflowId: 'workflow-approval',
        runId: 'run-approval',
        activityId: 'activity-approval',
      }),
    ).resolves.toMatchObject({
      arm: 'allow',
      reason: 'approval granted',
    });
    expect(core.pollApproval).toHaveBeenCalledTimes(1);
  });

  it('fails CLOSED (block) for unrecognized CopilotKit approval verdict strings', async () => {
    const core = {
      evaluate: vi.fn(),
      pollApproval: vi.fn(async () => ({
        verdict: 'future_verdict_value',
        action: 'require_approval',
        reason: 'unknown verdict must not silently permit',
      })),
    };
    const adapter = createOpenBoxCopilotKitAdapter({
      core: core as any,
      workflowType: 'CopilotKitTestWorkflow',
      taskQueue: 'langgraph',
    });
    const { pollApproval } = await import(
      '../../ts/src/copilotkit/workflow-session'
    );

    await expect(
      pollApproval(adapter, {
        workflowId: 'workflow-approval',
        runId: 'run-approval',
        activityId: 'activity-approval',
      }),
    ).resolves.toMatchObject({
      arm: 'block',
      reason: 'unknown verdict must not silently permit',
    });
    expect(core.pollApproval).toHaveBeenCalledTimes(1);
  });

  it('fails closed when CopilotKit approval polling receives failed guardrails', async () => {
    const core = {
      evaluate: vi.fn(),
      pollApproval: vi.fn(async () => ({
        action: 'require_approval',
        guardrails_result: {
          input_type: 'activity_input',
          validation_passed: false,
          reasons: [
            {
              type: 'pii',
              field: 'request',
              reason:
                'PII detected in request\n\nThought: hidden chain should not leak',
            },
          ],
        },
      })),
    };
    const adapter = createOpenBoxCopilotKitAdapter({
      core: core as any,
      workflowType: 'CopilotKitTestWorkflow',
      taskQueue: 'langgraph',
    });
    const { pollApproval } = await import(
      '../../ts/src/copilotkit/workflow-session'
    );

    await expect(
      pollApproval(adapter, {
        workflowId: 'workflow-approval',
        runId: 'run-approval',
        activityId: 'activity-approval',
      }),
    ).resolves.toMatchObject({
      arm: 'block',
      reason: 'PII detected in request',
      guardrailsResult: {
        validationPassed: false,
      },
    });
    expect(core.pollApproval).toHaveBeenCalledTimes(1);
  });

  it('does not locally expire DB-style CopilotKit approval timestamps', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'));
      let polls = 0;
      const core = {
        evaluate: vi.fn(),
        pollApproval: vi.fn(async () => {
          polls += 1;
          return {
            action: polls === 1 ? 'require_approval' : 'allow',
            reason: polls === 1 ? 'approval pending' : 'approval allowed by server',
            approval_expiration_time: '2026-01-01 00:00:09',
          };
        }),
      };
      const adapter = createOpenBoxCopilotKitAdapter({
        core: core as any,
        workflowType: 'CopilotKitTestWorkflow',
        taskQueue: 'langgraph',
      });
      const { pollApproval } = await import(
        '../../ts/src/copilotkit/workflow-session'
      );

      const result = pollApproval(adapter, {
        workflowId: 'workflow-approval',
        runId: 'run-approval',
        activityId: 'activity-approval',
      });
      await vi.advanceTimersByTimeAsync(750);

      await expect(result).resolves.toMatchObject({
        arm: 'allow',
        reason: 'approval allowed by server',
        approvalExpiresAt: '2026-01-01 00:00:09',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps polling on a CONSTRAIN verdict until a terminal verdict (canonical hitl.py:88)', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      let polls = 0;
      const core = {
        evaluate: vi.fn(),
        pollApproval: vi.fn(async () => {
          polls += 1;
          // CONSTRAIN is "still pending" in canonical — must keep polling, not
          // return early (the bug this guards against).
          return {
            action: polls === 1 ? 'constrain' : 'allow',
            reason:
              polls === 1 ? 'constrained, still pending' : 'approval allowed',
          };
        }),
      };
      const adapter = createOpenBoxCopilotKitAdapter({
        core: core as any,
        workflowType: 'CopilotKitTestWorkflow',
        taskQueue: 'langgraph',
      });
      const { pollApproval } = await import(
        '../../ts/src/copilotkit/workflow-session'
      );
      const result = pollApproval(adapter, {
        workflowId: 'workflow-approval',
        runId: 'run-approval',
        activityId: 'activity-approval',
      });
      await vi.advanceTimersByTimeAsync(750);
      await expect(result).resolves.toMatchObject({ arm: 'allow' });
      expect(core.pollApproval).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps polling CopilotKit approvals after elapsed expiration timestamp until server action', async () => {
    vi.useFakeTimers();
    try {
      const startedAt = new Date('2026-01-01T00:00:00.000Z');
      vi.setSystemTime(startedAt);
      const expiresAt = new Date(startedAt.getTime() + 1_000).toISOString();
      let polls = 0;
      const core = {
        evaluate: vi.fn(),
        pollApproval: vi.fn(async () => {
          polls += 1;
          return {
            action: polls === 1 ? 'require_approval' : 'allow',
            reason: polls === 1 ? 'approval pending' : 'approval allowed after timestamp',
            approval_expiration_time: expiresAt,
          };
        }),
      };
      const adapter = createOpenBoxCopilotKitAdapter({
        core: core as any,
        workflowType: 'CopilotKitTestWorkflow',
        taskQueue: 'langgraph',
      });
      const { pollApproval } = await import(
        '../../ts/src/copilotkit/workflow-session'
      );

      const result = pollApproval(adapter, {
        workflowId: 'workflow-approval',
        runId: 'run-approval',
        activityId: 'activity-approval',
      });
      await vi.advanceTimersByTimeAsync(1_500);

      await expect(result).resolves.toMatchObject({
        arm: 'allow',
        reason: 'approval allowed after timestamp',
        approvalExpiresAt: expiresAt,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed and skips execution when OpenBox blocks activity start', async () => {
    const { events, execute, tool } = createDemoTool((payload) => ({
      verdict: payload.event_type === 'ActivityStarted' ? 'block' : 'allow',
      reason: 'policy blocked',
    }));

    const result = await tool.execute({
      action: 'demo_action',
      request: 'Export customer emails.',
    });

    expect(result.status).toBe('blocked');
    expect(result.executed).toBe(false);
    expect(result.reason).toBe('policy blocked');
    expect(execute).not.toHaveBeenCalled();
    expect(events.map((event) => event.event_type)).toEqual([
      'SignalReceived',
      'WorkflowStarted',
      'ActivityStarted',
      'WorkflowCompleted',
    ]);
    // Canonical seal: a governance block closes the session with
    // WorkflowCompleted(status="failed"), mirroring langgraph_handler.
    expect(events.find((e) => e.event_type === 'WorkflowCompleted')?.status).toBe(
      'failed',
    );
    const startedParent = events.find(
      (event) => event.event_type === 'ActivityStarted' && !event.hook_trigger,
    );
    const startedHook = events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.hook_trigger === true &&
        event.activity_id === startedParent?.activity_id,
    );
    expect(startedParent?.spans).toBeUndefined();
    // Canonical: a blocked-at-start activity emits no hook span.
    const hookSpans = events.filter(
      (event) => event.hook_trigger === true && (event.spans?.length ?? 0) > 0,
    );
    expect(hookSpans).toEqual([]);
  });

  it('applies output redaction before the artifact is returned', async () => {
    const { tool } = createDemoTool((payload) => ({
      verdict:
        payload.event_type === 'ActivityCompleted' ? 'constrain' : 'allow',
      reason: 'sensitive output constrained',
      guardrails_result:
        payload.event_type === 'ActivityCompleted'
          ? {
              input_type: 'activity_output',
              redacted_input: { artifact: { body: '[REDACTED_BODY]' } },
              validation_passed: true,
              results: [
                {
                  results: [
                    {
                      field: 'output.artifact.body',
                      status: 'transformed',
                    },
                  ],
                },
              ],
            }
          : undefined,
    }));

    const result = await tool.execute({
      action: 'demo_action',
      request: 'Show confidential report.',
    });

    expect(result.status).toBe('constrained');
    expect(result.artifact).toEqual({ body: '[REDACTED_BODY]' });
    expect(result.redactionSummary).toContain('output.artifact.body');
  });

  it('rechecks OpenBox after a halt verdict for the runtime session', async () => {
    const { events, execute, tool } = createDemoTool((payload) => ({
      verdict: payload.event_type === 'ActivityStarted' ? 'halt' : 'allow',
      reason: 'production action halted',
    }));
    const config = { configurable: { thread_id: 'halted-thread' } };

    const first = await tool.execute(
      {
        action: 'demo_action',
        request: 'Stop production payments.',
      },
      config,
    );
    const second = await tool.execute(
      {
        action: 'demo_action',
        request: 'Create a support ticket.',
      },
      config,
    );

    expect(first.status).toBe('halted');
    expect(second.status).toBe('halted');
    expect(second.reason).toBe('production action halted');
    expect(execute).not.toHaveBeenCalled();
    expect(events.map((event) => event.event_type)).toEqual([
      'SignalReceived',
      'WorkflowStarted',
      'ActivityStarted',
      'WorkflowCompleted',
      'ActivityStarted',
      'WorkflowCompleted',
    ]);
    // Canonical seal: a governance halt closes the session with
    // WorkflowCompleted(status="failed").
    expect(
      events
        .filter((e) => e.event_type === 'WorkflowCompleted')
        .every((e) => e.status === 'failed'),
    ).toBe(true);
  });

  it('blocks a prompt before the model handler runs', async () => {
    const mock = createMockCore((payload) => ({
      verdict:
        payload.activity_type === 'llm_call' ? 'block' : 'allow',
      reason: 'prompt blocked',
    }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;
    const handler = vi.fn(async () => ({ content: 'should not run' }));

    const result = await middleware.wrapModelCall(
      {
        messages: [{ type: 'human', content: 'Export secrets.' }],
        state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
      },
      handler,
    );

    expect(handler).not.toHaveBeenCalled();
    expect(JSON.parse(result.content).status).toBe('blocked');
  });

  it('suppresses model continuation after a terminal OpenBox tool result', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;
    const handler = vi.fn(async () => ({ content: 'should not run' }));

    const result = await middleware.wrapModelCall(
      {
        messages: [
          { type: 'human', content: 'Review the operations queue.' },
          {
            type: 'ai',
            tool_calls: [{ name: 'openbox_governed_action', args: {} }],
          },
          {
            type: 'tool',
            content: JSON.stringify({
              schemaVersion: 'openbox.copilotkit.result.v1',
              status: 'halted',
              verdict: 'halt',
              executed: false,
              reason: 'Session is no longer active',
            }),
          },
        ],
      },
      handler,
    );

    // Terminal verdicts (halt/block/error) STOP the workflow — the runtime
    // suppresses further events, so a model continuation would be wasted. The
    // turn ends with the governed card as the answer and no extra text.
    expect(handler).not.toHaveBeenCalled();
    expect(result.content).toBe('');
    expect(mock.events).toEqual([]);
  });

  it('routes approval-required OpenBox tool results to the CopilotKit approval action', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;
    const handler = vi.fn(async () => ({ content: 'should not run' }));

    const result = await middleware.wrapModelCall(
      {
        messages: [
          { type: 'human', content: 'Issue a service credit.' },
          {
            type: 'ai',
            tool_calls: [
              { name: 'openbox_governed_approval_action', args: {} },
            ],
          },
          {
            type: 'tool',
            content: JSON.stringify({
              schemaVersion: 'openbox.copilotkit.result.v1',
              action: 'issue_large_refund',
              request: 'Issue a service credit.',
              amountUsd: 7500,
              workflowId: 'wf',
              runId: 'run',
              activityId: 'activity',
              approvalId: 'approval',
              governanceEventId: 'event',
              expiresAt: '2026-06-16T00:00:00.000Z',
              status: 'approval_required',
              verdict: 'require_approval',
              reason: 'Approval required.',
            }),
          },
        ],
      },
      handler,
    );

    expect(handler).not.toHaveBeenCalled();
    expect(result.content).toBe('');
    expect(result.tool_calls).toEqual([
      {
        id: expect.stringMatching(/^openbox_approval_/),
        name: 'openboxApprovalReview',
        args: {
          action: 'issue_large_refund',
          request: 'Issue a service credit.',
          amountUsd: 7500,
          riskReason: 'Approval required.',
          workflowId: 'wf',
          runId: 'run',
          activityId: 'activity',
          approvalId: 'approval',
          governanceEventId: 'event',
          expiresAt: '2026-06-16T00:00:00.000Z',
        },
      },
    ]);
    expect(mock.events).toEqual([]);
  });

  it('routes CopilotKit approval responses to the governed resume tool', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;
    const handler = vi.fn(async () => ({ content: 'should not run' }));

    const result = await middleware.wrapModelCall(
      {
        messages: [
          { type: 'human', content: 'Issue a service credit.' },
          {
            type: 'tool',
            content: JSON.stringify({
              nextTool: 'openbox_resume_governed_action',
              mustCallOpenBoxResumeGovernedAction: true,
              approved: true,
              workflowId: 'wf',
              runId: 'run',
              activityId: 'activity',
              approvalId: 'approval',
              governanceEventId: 'event',
              action: 'issue_large_refund',
              request: 'Issue a service credit.',
              amountUsd: 7500,
            }),
          },
        ],
      },
      handler,
    );

    expect(handler).not.toHaveBeenCalled();
    expect(result.content).toBe('');
    expect(result.tool_calls).toEqual([
      {
        id: expect.stringMatching(/^openbox_resume_/),
        name: 'openbox_resume_governed_action',
        args: {
          approved: true,
          workflowId: 'wf',
          runId: 'run',
          activityId: 'activity',
          approvalId: 'approval',
          governanceEventId: 'event',
          action: 'issue_large_refund',
          request: 'Issue a service credit.',
          amountUsd: 7500,
        },
      },
    ]);
    expect(mock.events).toEqual([]);
  });

  it('suppresses model continuation after a successful OpenBox tool result', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;
    const handler = vi.fn(async () => ({ content: 'duplicate summary' }));

    const result = await middleware.wrapModelCall(
      {
        messages: [
          { type: 'human', content: 'Review the operations queue.' },
          {
            type: 'ai',
            tool_calls: [{ name: 'openbox_governed_action', args: {} }],
          },
          {
            type: 'tool',
            content: JSON.stringify({
              schemaVersion: 'openbox.copilotkit.result.v1',
              status: 'executed',
              verdict: 'allow',
              executed: true,
              artifact: { summary: 'Queue reviewed.' },
            }),
          },
        ],
      },
      handler,
    );

    // The governed card IS the answer. Re-running the model after a governed
    // result is unreliable (gpt-5-nano re-calls the SAME governed tool instead
    // of confirming, producing a DUPLICATE governance card). End the turn here
    // so exactly one governed action runs per user prompt.
    expect(handler).not.toHaveBeenCalled();
    expect(result.content).toBe('');
  });

  it('suppresses model continuation when a per-turn App Context message trails the governed tool result', async () => {
    // Repro of the duplicate-card bug: CopilotKit/@ag-ui injects a per-turn App
    // Context developer/system message that lands AFTER the governed tool
    // result. If the short-circuit only inspected the LAST message it would miss
    // the result, the model would run again and re-call the governed tool,
    // emitting a SECOND identical "Governance decision / Allowed" card.
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;
    const handler = vi.fn(async () => ({ content: 'duplicate summary' }));

    const result = await middleware.wrapModelCall(
      {
        messages: [
          { type: 'human', content: 'Summarize Escalation.' },
          {
            type: 'ai',
            tool_calls: [{ name: 'view_governance_report', args: {} }],
          },
          {
            type: 'tool',
            content: JSON.stringify({
              schemaVersion: 'openbox.copilotkit.result.v1',
              status: 'executed',
              verdict: 'allow',
              executed: true,
              artifact: { summary: 'Escalation summarized.' },
            }),
          },
          // App Context developer message injected AFTER the governed result.
          {
            type: 'developer',
            content: 'App Context: { user: "agent", page: "escalations" }',
          },
        ],
      },
      handler,
    );

    expect(handler).not.toHaveBeenCalled();
    expect(result.content).toBe('');
  });

  it('keeps CopilotKit runtime gate payload compact without truncating allowed model input', async () => {
    const hugeSchema = 'A2UI component schema '.repeat(80_000);
    const userText = 'Show a customer account report for renewal planning.';
    const mock = createMockCore((payload) => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;
    const handler = vi.fn(async (request) => ({
      content: request.messages
        .map((message: any) => message.content)
        .join('\n'),
    }));

    const result = await middleware.wrapModelCall(
      {
        messages: [
          { type: 'system', content: hugeSchema },
          { type: 'human', content: userText },
        ],
        tools: [{ name: 'render_a2ui', description: hugeSchema }],
        state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
      },
      handler,
    );

    const started = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' && !event.hook_trigger,
    );
    expect(JSON.stringify(started).length).toBeLessThan(64_000);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].messages[0].content).toBe(hugeSchema);
    expect(handler.mock.calls[0][0].messages[1].content).toBe(userText);
  });

  it('emits Core-extractable assistant output spans for goal alignment', async () => {
    const mock = createMockCore((payload) => ({
      verdict: 'allow',
      reason: 'allowed',
      age_result: payload.hook_trigger
        ? {
            allowed: true,
            verdict: 'allow',
            governance_checks_incomplete: false,
            goal_alignment_checked: true,
            goal_drifted: false,
            span_results: [],
            total_spans: 1,
            violations_count: 0,
            response_time_ms: 12,
          }
        : undefined,
    }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;

    await middleware.wrapModelCall(
      {
        messages: [{ type: 'human', content: 'Review the queue.' }],
        state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
      },
      async () => ({
        content: [
          { type: 'text', text: 'The queue has' },
          { type: 'text', text: 'two governed requests ready.' },
        ],
        additional_kwargs: {
          tool_calls: [{ id: 'call-1', name: 'lookup_queue' }],
        },
        response_metadata: {
          ls_model_name: 'gpt-4o-mini',
          ls_provider: 'openai',
          usageMetadata: {
            promptTokenCount: 42,
            candidatesTokenCount: 16,
            totalTokenCount: 58,
          },
        },
      }),
    );

    expect(
      mock.events.map((event) => [
        event.event_type,
        event.activity_type,
        event.hook_trigger,
      ]),
    ).toEqual([
      ['SignalReceived', 'user_prompt', false],
      ['ActivityStarted', 'llm_call', false],
      ['ActivityStarted', 'llm_call', true],
      ['ActivityCompleted', 'llm_call', false],
      ['ActivityStarted', 'llm_call', true],
    ]);
    const startedParent = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'llm_call' &&
        event.hook_trigger !== true,
    );
    const completedParent = mock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'llm_call' &&
        event.hook_trigger !== true,
    );
    expect(completedParent).toMatchObject({
      llm_model: 'gpt-4o-mini',
      input_tokens: 42,
      output_tokens: 16,
      total_tokens: 58,
      has_tool_calls: true,
      completion: 'The queue has two governed requests ready.',
    });
    expect(completedParent).not.toHaveProperty('spans');
    expect(completedParent).not.toHaveProperty('span_count');
    expect(completedParent?.status).toBe('completed');
    const startedHook = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'llm_call' &&
        event.hook_trigger === true &&
        event.spans?.[0]?.stage === 'started',
    );
    const completedHook = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'llm_call' &&
        event.hook_trigger === true &&
        event.spans?.[0]?.stage === 'completed',
    );
    expect(startedHook?.span_count).toBe(1);
    expect(startedHook?.activity_id).toBe(startedParent?.activity_id);
    expect(startedHook?.spans?.[0]).toMatchObject({
      name: 'POST',
      stage: 'started',
      hook_type: 'http_request',
      request_headers: expect.objectContaining({
        authorization: '[REDACTED]',
        'content-type': 'application/json',
      }),
      attributes: expect.objectContaining({
        'http.method': 'POST',
        'http.url': 'https://api.openai.com/v1/chat/completions',
      }),
    });
    expect(completedHook?.span_count).toBe(1);
    expect(completedParent?.activity_id).toBe(startedParent?.activity_id);
    expect(completedHook?.activity_id).toBe(startedParent?.activity_id);
    const completedSpan = completedHook?.spans?.[0] as
      | Record<string, any>
      | undefined;
    // D2 canonical: the llm_completion span is a plain http_request span — usage
    // is NOT a span-root field. input/output/total_tokens ride on the completed
    // activity EVENT (asserted on completedParent above).
    expect(completedSpan).toMatchObject({
      name: 'POST',
      kind: 'CLIENT',
      stage: 'completed',
      hook_type: 'http_request',
      http_url: 'https://api.openai.com/v1/chat/completions',
      request_headers: expect.objectContaining({
        authorization: '[REDACTED]',
        'content-type': 'application/json',
      }),
      attributes: expect.objectContaining({
        'http.url': 'https://api.openai.com/v1/chat/completions',
        'http.method': 'POST',
        'http.status_code': 200,
      }),
    });
    expect(JSON.parse(String(completedSpan?.request_body))).toMatchObject({
      model: 'gpt-4o-mini',
      messages: [expect.objectContaining({ content: 'Review the queue.' })],
    });
    expect(JSON.parse(String(completedSpan?.response_body))).toMatchObject({
      model: 'gpt-4o-mini',
      usage: {
        prompt_tokens: 42,
        completion_tokens: 16,
        total_tokens: 58,
      },
    });
    const hookSpans = mock.events.flatMap((event) => event.spans ?? []);
    // The assistant's tool-call decision is part of the llm_completion span
    // (the assistant message's tool_calls live in its response_body), not a
    // separate llm_tool_call span on the llm_call — matching the reference,
    // where the tool execution is a separate governed activity.
    expect(
      hookSpans.filter((span) => span.name === 'openai.TOOL.call'),
    ).toHaveLength(0);
    for (const span of hookSpans) {
      expect(span.parent_span_id).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(hookSpans.some((span) => span.name === 'POST')).toBe(true);
  });

  it('uses LangChain request model metadata when AIMessage output omits model fields', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;

    await middleware.wrapModelCall(
      {
        model: {
          model: 'gpt-5.3-codex-spark',
          modelProvider: 'openai',
        },
        messages: [{ type: 'human', content: 'Review the queue.' }],
        state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
      },
      async () => ({
        content: '',
        tool_calls: [{ id: 'call-1', name: 'openbox_governed_action' }],
        lc_kwargs: {
          usage_metadata: {
            input_tokens: 17072,
            output_tokens: 847,
            total_tokens: 17919,
          },
          response_metadata: {
            model_provider: 'openai',
          },
        },
      }),
    );

    const completedParent = mock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'llm_call' &&
        event.hook_trigger !== true,
    );
    expect(completedParent).toMatchObject({
      llm_model: 'gpt-5.3-codex-spark',
      input_tokens: 17072,
      output_tokens: 847,
      total_tokens: 17919,
      has_tool_calls: true,
    });
    const completedHook = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'llm_call' &&
        event.hook_trigger === true &&
        event.spans?.[0]?.stage === 'completed',
    );
    const completedSpan = completedHook?.spans?.[0] as
      | Record<string, any>
      | undefined;
    // D2 canonical: model/provider/usage are NOT span-root fields. The model
    // rides on the event (llm_model, asserted on completedParent above); the
    // provider is canonically identified by the span's http_url (api.openai.com),
    // exactly as the prod-data span (no model/model_provider root fields); usage
    // rides on the event.
    expect(completedSpan).toMatchObject({
      http_url: 'https://api.openai.com/v1/chat/completions',
      attributes: expect.objectContaining({
        'http.url': 'https://api.openai.com/v1/chat/completions',
        'http.method': 'POST',
        'http.status_code': 200,
      }),
    });
  });

  it('emits same-activity tool-call spans for generic LangChain tool gates', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;

    await middleware.wrapToolCall(
      {
        toolCall: {
          name: 'crm_lookup',
          args: { customerId: 'cus_123' },
        },
        state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
      },
      async () => ({ ok: true, accountTier: 'enterprise' }),
    );

    const startedParent = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'crm_lookup' &&
        event.hook_trigger !== true,
    );
    const started = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'crm_lookup' &&
        event.hook_trigger === true &&
        event.activity_id === startedParent?.activity_id,
    );
    const completedParent = mock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'crm_lookup' &&
        event.hook_trigger !== true &&
        event.activity_id === startedParent?.activity_id,
    );
    const completed = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'crm_lookup' &&
        event.hook_trigger === true &&
        event.spans?.[0]?.stage === 'completed' &&
        event.activity_id === startedParent?.activity_id,
    );

    expect(startedParent?.hook_trigger).toBe(false);
    expect(startedParent?.spans).toBeUndefined();
    expect(startedParent).toMatchObject({
      tool_name: 'crm_lookup',
      tool_type: 'llm_tool_call',
    });
    expect(startedParent?.activity_input).toContainEqual({
      __openbox: { tool_type: 'llm_tool_call' },
    });
    expect(completedParent?.hook_trigger).toBe(false);
    expect(completedParent?.spans).toBeUndefined();
    expect(completedParent).toMatchObject({
      tool_name: 'crm_lookup',
      tool_type: 'llm_tool_call',
    });
    // Canonical: the tool input/output gate ACTIVITY carries no span (only a
    // tool's real sub-operations are spanned). The tool identity rides on the
    // parent activity above; no hook span is emitted for the gate itself.
    expect(started).toBeUndefined();
    expect(completed).toBeUndefined();
    const hookSpans = mock.events.flatMap((event) => event.spans ?? []);
    expect(hookSpans).toEqual([]);
    expect(completedParent?.activity_output).toEqual({
      ok: true,
      accountTier: 'enterprise',
    });
  });

  it('maps CopilotKit runtime tool gates into backend-classifiable semantic spans', async () => {
    const cases = [
      {
        name: 'Read',
        args: { file_path: 'fixtures/hostname.txt' },
        toolType: 'file_read',
        span: {
          span_type: 'file_io',
          attributes: expect.objectContaining({
            'file.path': 'fixtures/hostname.txt',
            'file.operation': 'read',
          }),
        },
      },
      {
        name: 'WebFetch',
        args: { method: 'PATCH', url: 'https://example.com/patch' },
        toolType: 'http',
        span: {
          span_type: 'http',
          attributes: expect.objectContaining({
            'http.method': 'PATCH',
            'http.url': 'https://example.com/patch',
          }),
        },
      },
      {
        name: 'mcp__postgres__query',
        args: { operation: 'SELECT', resource: 'accounts' },
        toolType: 'db',
        span: {
          span_type: 'database',
          attributes: expect.objectContaining({
            'db.system': 'postgresql',
            'db.operation': 'SELECT',
            'db.statement': 'database resource accounts',
          }),
        },
      },
      {
        name: 'mcp__web__request',
        args: { method: 'POST', url: 'https://example.com/mcp' },
        toolType: 'http',
        span: {
          span_type: 'http',
          attributes: expect.objectContaining({
            'http.method': 'POST',
            'http.url': 'https://example.com/mcp',
          }),
        },
      },
      {
        name: 'mcp__openbox__status',
        args: {},
        toolType: 'mcp',
        span: {
          span_type: 'mcp_tool_call',
          attributes: expect.objectContaining({
            'mcp.method': 'callTool',
            'mcp.operation': 'status',
            'mcp.server_id': 'openbox',
          }),
        },
      },
      {
        name: 'Bash',
        args: { command: 'echo hello' },
        toolType: 'shell',
        span: {
          span_type: 'function',
          attributes: expect.objectContaining({
            'shell.command': 'echo hello',
          }),
        },
      },
    ];

    for (const entry of cases) {
      const mock = createMockCore(() => ({
        verdict: 'allow',
        reason: 'allowed',
      }));
      const adapter = createOpenBoxCopilotKitAdapter({
        core: mock.core as any,
      });

      await adapter.governToolInput({
        payload: { name: entry.name, args: entry.args },
        activityType: entry.name,
        sessionKey: `semantic-${entry.name}`,
      });

      const parent = mock.events.find(
        (event) => event.event_type === 'ActivityStarted' && !event.hook_trigger,
      );
      const hook = mock.events.find(
        (event) =>
          event.event_type === 'ActivityStarted' &&
          event.hook_trigger === true &&
          Array.isArray(event.spans) &&
          event.spans.length > 0,
      );

      expect(parent, entry.name).toMatchObject({
        tool_name: entry.name,
        tool_type: entry.toolType,
      });
      expect(parent?.activity_input, entry.name).toContainEqual({
        __openbox: { tool_type: entry.toolType },
      });
      // Canonical: the tool gate activity carries no span — only the parent
      // activity (classified by tool_type) is emitted, no hook span.
      expect(hook, entry.name).toBeUndefined();
    }
  });

  it('passes Core AGE metadata through assistant output governance results', async () => {
    const ageResult = {
      allowed: true,
      verdict: 'allow',
      governance_checks_incomplete: false,
      goal_alignment_checked: true,
      goal_drifted: false,
      span_results: [],
      total_spans: 1,
      violations_count: 0,
      response_time_ms: 9,
    };
    const mock = createMockCore((payload) => ({
      verdict: 'allow',
      reason: 'allowed',
      age_result:
        payload.event_type === 'ActivityCompleted' &&
        payload.activity_type === 'llm_call'
          ? ageResult
          : undefined,
    }));
    const adapter = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
      workflowType: 'CopilotKitTestWorkflow',
      taskQueue: 'langgraph',
    });

    const result = await adapter.governAssistantOutput({
      payload: { content: 'The update stays aligned with the customer task.' },
      workflowId: 'wf',
      runId: 'run',
      activityId: 'activity-1',
    });
    const copilotResult = adapter.toOpenBoxCopilotResult(
      result.verdict,
      result,
    );

    expect((result.verdict as unknown as Record<string, unknown>).ageResult).toEqual(
      ageResult,
    );
    expect(copilotResult.ageResult).toEqual(ageResult);
  });

  it('merges terminal AGE metadata into standalone governed tool results', async () => {
    const ageResult = {
      allowed: true,
      verdict: 'allow',
      governance_checks_incomplete: false,
      goal_alignment_checked: true,
      goal_drifted: false,
      span_results: [],
      total_spans: 1,
      violations_count: 0,
      response_time_ms: 11,
    };
    const { tool } = createDemoTool((payload) => ({
      verdict: 'allow',
      reason: 'allowed',
      age_result:
        payload.event_type === 'WorkflowCompleted' ? ageResult : undefined,
    }));

    const result = await tool.execute({
      action: 'demo_action',
      request: 'Review the customer escalation.',
    });

    expect(result.status).toBe('executed');
    expect(result.ageResult).toEqual(ageResult);
  });

  it('captures a governed tool sub-operation as a function_call hook span', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const adapter = createOpenBoxCopilotKitAdapter({ core: mock.core as any });
    // Canonical: instead of a hand-declared spanProfile, the tool performs a real
    // instrumented sub-operation (a traced function) that is auto-captured.
    const reviewQueue = traced('review_queue', (request: string) => ({
      body: request,
    }));
    const tool = createGovernedCopilotTool<DemoInput, DemoArtifact>({
      adapter,
      toolName: 'openbox_governed_action',
      execute: async (input) => reviewQueue(input.request),
    });

    const before = Date.now();
    await tool.execute({
      action: 'demo_action',
      request: 'Review the queue.',
    });
    const after = Date.now();

    const started = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.hook_trigger &&
        Array.isArray(event.spans) &&
        event.spans.length > 0,
    );
    const parentStarted = mock.events.find(
      (event) => event.event_type === 'ActivityStarted' && !event.hook_trigger,
    );
    expect(parentStarted?.activity_input).toContainEqual({
      __openbox: { tool_type: 'llm_tool_call' },
    });
    const span = started?.spans?.[0] as Record<string, any> | undefined;
    expect(span).toMatchObject({
      name: 'review_queue',
      kind: 'INTERNAL',
      hook_type: 'function_call',
    });
    const startedAtMs = Number(span?.start_time) / 1_000_000;
    expect(startedAtMs).toBeGreaterThanOrEqual(before - 1000);
    expect(startedAtMs).toBeLessThanOrEqual(after + 1000);
  });

  it('opens a workflow before standalone runtime gates when state IDs are missing', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const adapter = createOpenBoxCopilotKitAdapter({ core: mock.core as any });

    await adapter.governPrompt({
      payload: {
        messages: [{ role: 'user', content: 'Open the revenue queue.' }],
      },
      sessionKey: 'missing-state',
      activityType: 'llm_call',
    });

    expect(mock.events.map((event) => event.event_type)).toEqual([
      'SignalReceived',
      'WorkflowStarted',
      'ActivityStarted',
      'ActivityStarted',
    ]);
    expect(mock.events[0]).toMatchObject({
      signal_name: 'user_prompt',
      signal_args: ['Open the revenue queue.'],
      session_id: 'missing-state',
      prompt: 'Open the revenue queue.',
      activity_input: [
        expect.objectContaining({
          prompt: 'Open the revenue queue.',
          current_prompt: 'Open the revenue queue.',
          goal_prompt: 'Open the revenue queue.',
          original_goal: 'Open the revenue queue.',
          event_category: 'agent_goal',
          is_initial_goal: true,
          _openbox_source: 'copilotkit',
        }),
      ],
    });
    expect(mock.events[2]).toMatchObject({
      event_type: 'ActivityStarted',
      activity_type: 'llm_call',
      activity_input: [{ prompt: 'Open the revenue queue.' }],
    });
    expect(mock.events[3]).toMatchObject({
      event_type: 'ActivityStarted',
      activity_type: 'llm_call',
      hook_trigger: true,
      span_count: 1,
    });
    expect(mock.events[3].activity_id).toBe(mock.events[2].activity_id);
    expect(mock.events[3].spans?.[0]).toMatchObject({
      name: 'POST',
      stage: 'started',
      hook_type: 'http_request',
      request_headers: expect.objectContaining({
        authorization: '[REDACTED]',
        'content-type': 'application/json',
      }),
      attributes: expect.objectContaining({
        'http.method': 'POST',
        'http.url': 'https://api.openai.com/v1/chat/completions',
      }),
    });
    expect(mock.events[1].workflow_id).toBe(mock.events[2].workflow_id);
    expect(mock.events[1].run_id).toBe(mock.events[2].run_id);
    expect(mock.events[1].run_id).not.toBe(mock.events[1].workflow_id);

    const outputMock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const outputAdapter = createOpenBoxCopilotKitAdapter({ core: outputMock.core as any });
    await outputAdapter.governToolOutput({
      payload: { toolName: 'crm_lookup', ok: true },
      sessionKey: 'missing-tool-state',
      activityId: 'standalone-tool-output',
    });
    const outputEvents = outputMock.events.filter(
      (event) => event.activity_id === 'standalone-tool-output',
    );
    // Canonical: a standalone tool-output gate carries NO tool-activity span, so
    // there is no ensured ActivityStarted parent and no hook span — only the
    // ActivityCompleted, which carries the raw tool data on the activity itself.
    expect(outputEvents.map((event) => [event.event_type, event.hook_trigger])).toEqual([
      ['ActivityCompleted', false],
    ]);
    expect(outputEvents[0]).toMatchObject({
      event_type: 'ActivityCompleted',
      activity_id: 'standalone-tool-output',
      activity_type: 'crm_lookup',
    });
    expect(outputEvents[0].spans ?? []).toHaveLength(0);
  });

  it('skips empty prompt activity gates after opening the workflow', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const adapter = createOpenBoxCopilotKitAdapter({ core: mock.core as any });

    const result = await adapter.governPrompt({
      payload: {
        messages: [
          { role: 'system', content: 'Use the CRM schema.' },
          { role: 'tool', content: 'cached lookup' },
        ],
      },
      sessionKey: 'empty-prompt',
      activityType: 'llm_call',
    });

    expect(result.status).toBe('executed');
    expect(mock.events.map((event) => event.event_type)).toEqual([
      'WorkflowStarted',
    ]);
  });

  it('emits the goal-alignment prompt signal for content-shaped prompts', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const adapter = createOpenBoxCopilotKitAdapter({ core: mock.core as any });

    await adapter.governPrompt({
      payload: { content: 'Draft a renewal follow-up for the customer.' },
      sessionKey: 'content-prompt',
      activityType: 'llm_call',
    });

    expect(mock.events.map((event) => event.event_type)).toEqual([
      'SignalReceived',
      'WorkflowStarted',
      'ActivityStarted',
      'ActivityStarted',
    ]);
    expect(mock.events[0]).toMatchObject({
      event_type: 'SignalReceived',
      activity_type: 'user_prompt',
      signal_name: 'user_prompt',
      signal_args: ['Draft a renewal follow-up for the customer.'],
    });
  });

  it('marks standalone runtime gate workflows failed when Core errors after start', async () => {
    const mock = createMockCore((payload) => {
      if (payload.event_type === 'ActivityStarted') {
        throw new Error('Request failed: 503 Service Unavailable');
      }
      return {
        verdict: 'allow',
        reason: 'allowed',
      };
    });
    const adapter = createOpenBoxCopilotKitAdapter({ core: mock.core as any });

    const result = await adapter.governPrompt({
      payload: {
        messages: [{ role: 'user', content: 'Check a database update.' }],
      },
      sessionKey: 'core-error-after-start',
      activityType: 'llm_call',
    });

    expect(result.status).toBe('error');
    expect(result.verdict.reason).toContain('503 Service Unavailable');
    expect(mock.events.map((event) => event.event_type)).toEqual([
      'SignalReceived',
      'WorkflowStarted',
      'ActivityStarted',
      'WorkflowFailed',
    ]);
    expect(mock.events[3].workflow_id).toBe(mock.events[1].workflow_id);
    expect(mock.events[3].run_id).toBe(mock.events[1].run_id);
  });

  it('runtime handler stores distinct OpenBox workflow IDs on governed input state', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const hooks = createOpenBoxRuntimeHooks({
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });
    const request = new Request(
      'http://localhost/api/copilotkit/agent/run/default',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: 'thread-1',
          runId: 'copilot-run-1',
          messages: [
            { id: 'user-1', role: 'user', content: 'Open the revenue queue.' },
          ],
          state: {},
        }),
      },
    );

    const governedRequest = await hooks.onBeforeHandler({
      request,
      path: '/api/copilotkit/agent/run/default',
      runtime: {},
      route: { method: 'agent/run', agentId: 'default' },
    });
    const governedBody = await (governedRequest as Request).json();

    expect(governedBody.state.openboxWorkflowId).toEqual(expect.any(String));
    expect(governedBody.state.openboxRunId).toBe('copilot-run-1');
    expect(governedBody.state.openboxRunId).not.toBe(
      governedBody.state.openboxWorkflowId,
    );
    expect(governedBody.state.openboxSession.workflowId).toBe(
      governedBody.state.openboxWorkflowId,
    );
    expect(governedBody.state.openboxSession.runId).toBe(
      governedBody.state.openboxRunId,
    );
    expect(governedBody.state.openboxPromptActivityId).toEqual(expect.any(String));
    expect(governedBody.state.openboxSession.promptActivityId).toBe(
      governedBody.state.openboxPromptActivityId,
    );
    expect(governedBody.state.__openboxRuntimePromptGoverned).toBe(true);
    expect(mock.events.map((event) => event.event_type)).toEqual([
      'SignalReceived',
      'WorkflowStarted',
      'ActivityStarted',
      'ActivityStarted',
    ]);
    expect(mock.events[0]).toMatchObject({
      signal_name: 'user_prompt',
      signal_args: ['Open the revenue queue.'],
    });
    expect(mock.events[1].workflow_id).toBe(
      governedBody.state.openboxWorkflowId,
    );
    expect(mock.events[1].run_id).toBe(governedBody.state.openboxRunId);
    expect(mock.events[2].activity_id).toBe(
      governedBody.state.openboxPromptActivityId,
    );
  });

  it('runtime handler starts a fresh OpenBox workflow when CopilotKit state carries old IDs', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const hooks = createOpenBoxRuntimeHooks({
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });
    const request = new Request(
      'http://localhost/api/copilotkit/agent/run/default',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: 'thread-1',
          runId: 'copilot-run-2',
          messages: [
            { id: 'user-2', role: 'user', content: 'Open the revenue queue.' },
          ],
          state: {
            openboxWorkflowId: 'old-workflow',
            openboxRunId: 'old-run',
            openboxSession: {
              status: 'active',
              workflowId: 'old-workflow',
              runId: 'old-run',
            },
          },
        }),
      },
    );

    const governedRequest = await hooks.onBeforeHandler({
      request,
      path: '/api/copilotkit/agent/run/default',
      runtime: {},
      route: { method: 'agent/run', agentId: 'default' },
    });
    const governedBody = await (governedRequest as Request).json();

    expect(governedBody.state.openboxWorkflowId).not.toBe('old-workflow');
    expect(governedBody.state.openboxRunId).toBe('copilot-run-2');
    expect(mock.events[0].workflow_id).toBe(
      governedBody.state.openboxWorkflowId,
    );
    expect(mock.events[0].workflow_id).not.toBe('old-workflow');
    expect(mock.events[0].run_id).toBe('copilot-run-2');
  });

  it('runtime handler streams prompt blocks as governed tool results', async () => {
    const mock = createMockCore(() => ({
      verdict: 'block',
      reason: 'prompt blocked',
    }));
    const hooks = createOpenBoxRuntimeHooks({
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });
    const request = new Request(
      'http://localhost/api/copilotkit/agent/run/default',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: 'thread-block',
          runId: 'run-block',
          messages: [
            { id: 'user-1', role: 'user', content: 'Export customer emails.' },
          ],
          state: {},
        }),
      },
    );

    let response: Response | undefined;
    try {
      await hooks.onBeforeHandler({
        request,
        path: '/api/copilotkit/agent/run/default',
        runtime: {},
        route: { method: 'agent/run', agentId: 'default' },
      });
    } catch (error) {
      response = error as Response;
    }

    expect(response).toBeInstanceOf(Response);
    const events = parseSseEvents(await response!.text());
    expect(events.map((event) => event.type)).toEqual([
      'RUN_STARTED',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
      'TOOL_CALL_RESULT',
      'RUN_FINISHED',
    ]);
    expect(events.find((event) => event.type === 'TOOL_CALL_START')).toMatchObject({
      toolCallName: 'openbox_governed_action',
    });
    expect(
      JSON.parse(
        String(events.find((event) => event.type === 'TOOL_CALL_RESULT')?.content),
      ).status,
    ).toBe('blocked');
  });

  it('runtime hooks no-op for routes, agents, disabled adapters, and malformed bodies', async () => {
    const enabledAdapter = createOpenBoxCopilotKitAdapter({
      core: createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }))
        .core as any,
    });
    const hooks = createOpenBoxRuntimeHooks({
      adapter: enabledAdapter,
      agents: ['default'],
    });
    const request = new Request('http://localhost/api/copilotkit', {
      method: 'POST',
      body: JSON.stringify({ threadId: 'thread-1', messages: [] }),
    });

    await expect(
      hooks.onBeforeHandler({
        request,
        path: '/api/copilotkit',
        runtime: {},
        route: { method: 'health' },
      }),
    ).resolves.toBeUndefined();
    await expect(
      hooks.onBeforeHandler({
        request,
        path: '/api/copilotkit/agent/run/other',
        runtime: {},
        route: { method: 'agent/run', agentId: 'other' },
      }),
    ).resolves.toBeUndefined();

    const disabledHooks = createOpenBoxRuntimeHooks({
      adapter: createOpenBoxCopilotKitAdapter({ enabled: false }),
    });
    await expect(
      disabledHooks.onBeforeHandler({
        request,
        path: '/api/copilotkit/agent/run/default',
        runtime: {},
        route: { method: 'agent/run', agentId: 'default' },
      }),
    ).resolves.toBeUndefined();

    await expect(
      hooks.onBeforeHandler({
        request: new Request('http://localhost/api/copilotkit/agent/run/default', {
          method: 'POST',
          body: '{not-json',
        }),
        path: '/api/copilotkit/agent/run/default',
        runtime: {},
        route: { method: 'agent/run', agentId: 'default' },
      }),
    ).resolves.toBeUndefined();
    await expect(
      hooks.onResponse({
        request,
        response: new Response('ok'),
        path: '/api/copilotkit/agent/run/default',
        runtime: {},
        route: { method: 'agent/run', agentId: 'default' },
      }),
    ).resolves.toBeUndefined();
  });

  it('runtime error hook maps OpenBox errors to JSON and ignores ordinary errors', async () => {
    const hooks = createOpenBoxRuntimeHooks({
      adapter: createOpenBoxCopilotKitAdapter({ enabled: false }),
    });
    const request = new Request('http://localhost/api/copilotkit/agent/run/default');

    const response = await hooks.onError({
      request,
      path: '/api/copilotkit/agent/run/default',
      runtime: {},
      route: { method: 'agent/run', agentId: 'default' },
      error: new OpenBoxCopilotKitError('runtime missing'),
    });

    expect(response?.status).toBe(500);
    expect(response?.headers.get('content-type')).toContain('application/json');
    expect(await response?.json()).toEqual({ error: 'runtime missing' });
    await expect(
      hooks.onError({
        request,
        path: '/api/copilotkit/agent/run/default',
        runtime: {},
        route: { method: 'agent/run', agentId: 'default' },
        error: new Error('plain error'),
      }),
    ).resolves.toBeUndefined();
  });

  it('continues when a runtime workflow start is already persisted', async () => {
    const events: GovernanceEventPayload[] = [];
    const adapter = createOpenBoxCopilotKitAdapter({
      core: {
        evaluate: vi.fn(async (payload: GovernanceEventPayload) => {
          events.push(payload);
          if (payload.event_type === 'WorkflowStarted') {
            throw new Error(
              'ERROR: duplicate key value violates unique constraint "UQ_SESSIONS_WORKFLOW_RUN"',
            );
          }
          return { verdict: 'allow', reason: 'allowed' };
        }),
        pollApproval: vi.fn(),
      } as any,
    });

    const result = await adapter.governPrompt({
      payload: { messages: [{ role: 'user', content: 'Open queue.' }] },
      workflowId: 'workflow-1',
      runId: 'run-1',
      sessionKey: 'thread-1',
      activityType: 'llm_call',
      ensureWorkflowStarted: true,
    });

    expect(result.status).toBe('executed');
    expect(events.map((event) => event.event_type)).toEqual([
      'SignalReceived',
      'WorkflowStarted',
      'ActivityStarted',
      'ActivityStarted',
    ]);
  });

  it('treats failClosed false as a compatibility no-op for governance failures', async () => {
    const adapter = createOpenBoxCopilotKitAdapter({
      failClosed: false,
      core: {
        evaluate: vi.fn(async () => {
          throw new Error('core offline');
        }),
        pollApproval: vi.fn(),
      } as any,
    });

    const result = await adapter.governPrompt({
      payload: { messages: [{ role: 'user', content: 'Open queue.' }] },
      workflowId: 'workflow-fail-closed',
      runId: 'run-fail-closed',
      sessionKey: 'thread-fail-closed',
      activityType: 'llm_call',
    });

    expect(result.status).toBe('error');
    expect(result.verdict).toMatchObject({
      arm: 'block',
      reason: expect.stringContaining('failed closed'),
    });
  });

  it('treats governanceMode observe as a compatibility no-op for blocked gates', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.activity_type === 'send_email' ? 'block' : 'allow',
      reason: 'tool input blocked',
    }));
    const middleware = createOpenBoxCopilotKitAdapter({
      governanceMode: 'observe',
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;
    const handler = vi.fn(async () => ({ ok: true }));

    const result = await middleware.wrapToolCall(
      {
        toolCall: { name: 'send_email', args: { to: 'personal Gmail' } },
        state: { openboxWorkflowId: 'wf-observe', openboxRunId: 'run-observe' },
      },
      handler,
    );

    expect(handler).not.toHaveBeenCalled();
    expect(JSON.parse(result)).toMatchObject({
      status: 'blocked',
      reason: 'tool input blocked',
    });
  });

  it('does not start the same runtime workflow twice in one agent process', async () => {
    const events: GovernanceEventPayload[] = [];
    const adapter = createOpenBoxCopilotKitAdapter({
      core: {
        evaluate: vi.fn(async (payload: GovernanceEventPayload) => {
          events.push(payload);
          return { verdict: 'allow', reason: 'allowed' };
        }),
        pollApproval: vi.fn(),
      } as any,
    });

    const input = {
      payload: { messages: [{ role: 'user', content: 'Open queue.' }] },
      workflowId: 'repeated-workflow-start',
      runId: 'repeated-run-start',
      sessionKey: 'repeated-thread',
      activityType: 'llm_call',
      ensureWorkflowStarted: true,
    };

    await adapter.governPrompt(input);
    await adapter.governPrompt(input);

    expect(events.map((event) => event.event_type)).toEqual([
      'SignalReceived',
      'WorkflowStarted',
      'ActivityStarted',
      'ActivityStarted',
      'SignalReceived',
      'ActivityStarted',
      'ActivityStarted',
    ]);
    expect(events[0]).toMatchObject({
      signal_args: ['Open queue.'],
      prompt: 'Open queue.',
      activity_input: [
        expect.objectContaining({
          prompt: 'Open queue.',
          current_prompt: 'Open queue.',
          goal_prompt: 'Open queue.',
          original_goal: 'Open queue.',
          is_initial_goal: true,
        }),
      ],
    });
    expect(events[4]).toMatchObject({
      signal_args: ['Open queue.'],
      prompt: 'Open queue.',
      activity_input: [
        expect.objectContaining({
          prompt: 'Open queue.',
          current_prompt: 'Open queue.',
          goal_prompt: 'Open queue.',
          original_goal: 'Open queue.',
          is_initial_goal: false,
        }),
      ],
    });
  });

  it('preserves the first CopilotKit prompt as the session goal on later turns', async () => {
    const events: GovernanceEventPayload[] = [];
    const adapter = createOpenBoxCopilotKitAdapter({
      core: {
        evaluate: vi.fn(async (payload: GovernanceEventPayload) => {
          events.push(payload);
          return { verdict: 'allow', reason: 'allowed' };
        }),
        pollApproval: vi.fn(),
      } as any,
    });

    await adapter.governPrompt({
      payload: { messages: [{ role: 'user', content: 'Review the queue.' }] },
      workflowId: 'goal-workflow-1',
      runId: 'goal-run-1',
      sessionKey: 'goal-thread',
      activityType: 'llm_call',
    });
    await adapter.governPrompt({
      payload: { messages: [{ role: 'user', content: 'Send the queue externally.' }] },
      workflowId: 'goal-workflow-2',
      runId: 'goal-run-2',
      sessionKey: 'goal-thread',
      activityType: 'llm_call',
    });

    const signals = events.filter((event) => event.event_type === 'SignalReceived');
    expect(signals).toHaveLength(2);
    expect(signals[0]).toMatchObject({
      signal_args: ['Review the queue.'],
      prompt: 'Review the queue.',
      activity_input: [
        expect.objectContaining({
          prompt: 'Review the queue.',
          current_prompt: 'Review the queue.',
          goal_prompt: 'Review the queue.',
          original_goal: 'Review the queue.',
          is_initial_goal: true,
        }),
      ],
    });
    expect(signals[1]).toMatchObject({
      signal_args: ['Send the queue externally.'],
      prompt: 'Send the queue externally.',
      activity_input: [
        expect.objectContaining({
          prompt: 'Send the queue externally.',
          current_prompt: 'Send the queue externally.',
          goal_prompt: 'Review the queue.',
          original_goal: 'Review the queue.',
          is_initial_goal: false,
        }),
      ],
    });
  });

  it('preserves the original CopilotKit runner prototype for local thread handlers', () => {
    class LocalRunner {
      run() {
        return { subscribe() {} };
      }

      listThreads() {
        return [{ id: 'thread-1' }];
      }
    }
    const baseRunner = new LocalRunner();
    const governedRunner = createOpenBoxGovernedRunner(baseRunner as any, {
      adapter: createOpenBoxCopilotKitAdapter({ enabled: false }),
    });

    expect(governedRunner).toBeInstanceOf(LocalRunner);
    expect((governedRunner as any).listThreads()).toEqual([
      { id: 'thread-1' },
    ]);
  });

  it('applies prompt redaction before the model handler runs', async () => {
    const mock = createMockCore((payload) => ({
      verdict: 'constrain',
      reason: 'prompt constrained',
      guardrails_result:
        payload.activity_type === 'llm_call'
          ? {
              input_type: 'activity_input',
              redacted_input: {
                messages: [{ content: 'Show [REDACTED_EMAIL].' }],
              },
              results: [],
            }
          : undefined,
    }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;
    const handler = vi.fn(async (request) => ({
      content: request.messages[0].content,
    }));

    const result = await middleware.wrapModelCall(
      {
        messages: [{ type: 'human', content: 'Show alice@example.com.' }],
        state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
      },
      handler,
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('Show [REDACTED_EMAIL].');
  });

  it('blocks a tool input before non-OpenBox tool execution', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.activity_type === 'send_email' ? 'block' : 'allow',
      reason: 'tool input blocked',
    }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;
    const handler = vi.fn(async () => ({ ok: true }));

    const result = await middleware.wrapToolCall(
      {
        toolCall: { name: 'send_email', args: { to: 'personal Gmail' } },
        state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
      },
      handler,
    );

    expect(handler).not.toHaveBeenCalled();
    expect(JSON.parse(result).status).toBe('blocked');
    const parent = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'send_email' &&
        event.hook_trigger !== true,
    );
    expect(parent?.activity_input).toContainEqual({
      __openbox: { tool_type: 'llm_tool_call' },
    });
    expect(parent?.tool_type).toBe('llm_tool_call');
  });

  it('marks CopilotKit Task tool input as a2a activity metadata', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;
    const handler = vi.fn(async () => ({ ok: true }));

    await middleware.wrapToolCall(
      {
        toolCall: {
          name: 'Task',
          args: { subagent_type: 'researcher', prompt: 'Find sources.' },
        },
        state: { openboxWorkflowId: 'wf-task', openboxRunId: 'run-task' },
      },
      handler,
    );

    const parent = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'Task' &&
        event.hook_trigger !== true,
    );
    expect(parent?.activity_input).toContainEqual({
      __openbox: { tool_type: 'a2a', subagent_name: 'researcher' },
    });
    expect(parent?.tool_type).toBe('a2a');
  });

  it('applies generic nested tool output redaction before returning the result', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.activity_type === 'crm_lookup' ? 'constrain' : 'allow',
      reason: 'tool output constrained',
      guardrails_result:
        payload.activity_type === 'crm_lookup'
          ? {
              input_type: 'activity_output',
              redacted_input: {
                artifact: {
                  crmPayload: {
                    contacts: [{ email: '[REDACTED_EMAIL]' }],
                  },
                },
              },
              results: [
                {
                  results: [
                    {
                      field: 'output.artifact.crmPayload.contacts.0.email',
                      status: 'transformed',
                    },
                  ],
                },
              ],
            }
          : undefined,
    }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;

    const result = await middleware.wrapToolCall(
      {
        toolCall: { name: 'crm_lookup', args: {} },
        state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
      },
      async () => ({
        artifact: {
          crmPayload: {
            contacts: [{ email: 'alice@example.com', name: 'Alice' }],
          },
        },
      }),
    );

    expect(result.artifact.crmPayload.contacts[0].email).toBe(
      '[REDACTED_EMAIL]',
    );
    expect(result.artifact.crmPayload.contacts[0].name).toBe('Alice');
  });

  it('blocks unsafe final assistant output before it is returned', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.activity_type === 'llm_call' ? 'block' : 'allow',
      reason: 'assistant output blocked',
    }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;

    const result = await middleware.wrapModelCall(
      {
        messages: [{ type: 'human', content: 'Summarize.' }],
        state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
      },
      async () => ({ content: 'alice@example.com' }),
    );

    expect(JSON.parse(result.content).status).toBe('blocked');
    expect(result.content).not.toContain('alice@example.com');
  });

  it('redacts final assistant output before it is returned', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.activity_type === 'llm_call' ? 'constrain' : 'allow',
      reason: 'assistant output constrained',
      guardrails_result:
        payload.activity_type === 'llm_call'
          ? {
              input_type: 'activity_output',
              redacted_input: { content: '[REDACTED_EMAIL]' },
              results: [
                {
                  results: [{ field: 'output.content', status: 'transformed' }],
                },
              ],
            }
          : undefined,
    }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;

    const result = await middleware.wrapModelCall(
      {
        messages: [{ type: 'human', content: 'Summarize.' }],
        state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
      },
      async () => ({ content: 'alice@example.com' }),
    );

    expect(result.content).toBe('[REDACTED_EMAIL]');
  });

  it('rechecks OpenBox for later gates in the same session after a halt verdict', async () => {
    const mock = createMockCore((payload) => ({
      verdict:
        payload.activity_type === 'llm_call' ||
        payload.activity_type === 'safe_tool'
          ? 'halt'
          : 'allow',
      reason: 'session halted',
    }));
    const adapter = createOpenBoxCopilotKitAdapter({ core: mock.core as any });
    const first = await adapter.governPrompt({
      payload: { message: 'Stop production.' },
      sessionKey: 'thread-1',
    });
    const second = await adapter.governToolInput({
      payload: { name: 'safe_tool', args: {} },
      sessionKey: 'thread-1',
    });

    expect(first.status).toBe('halted');
    expect(second.status).toBe('halted');
    expect(
      mock.events
        .filter(
          (event) =>
            event.event_type === 'ActivityStarted' &&
            event.hook_trigger !== true,
        )
        .map((event) => event.activity_type),
    ).toEqual(['llm_call', 'safe_tool']);
  });

  it('pauses on approval-required prompt verdict without calling the model', async () => {
    const mock = createMockCore((payload) => ({
      verdict:
        payload.activity_type === 'llm_call'
          ? 'require_approval'
          : 'allow',
      reason: 'approval required',
      governance_event_id: 'event-1',
      approval_id: 'approval-1',
    }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;
    const handler = vi.fn(async () => ({ content: 'should not run' }));

    const result = await middleware.wrapModelCall(
      {
        messages: [{ type: 'human', content: 'Move money.' }],
        state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
      },
      handler,
    );

    expect(handler).not.toHaveBeenCalled();
    expect(JSON.parse(result.content).status).toBe('approval_required');
  });

  it('native runner blocks a prompt before the CopilotKit runner executes', async () => {
    const mock = createMockCore((payload) => ({
      verdict:
        payload.activity_type === 'llm_call' ? 'block' : 'allow',
      reason: 'runtime prompt blocked',
    }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    const events = await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [
            { id: 'user-1', role: 'user', content: 'Export secrets.' },
          ],
        },
      }),
    );

    expect(baseRunner.run).not.toHaveBeenCalled();
    expect(JSON.stringify(events)).toContain('runtime prompt blocked');
  });

  it('native runner completes the OpenBox workflow when the CopilotKit stream completes', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({
        core: mock.core as any,
        agentWorkflowType: 'CopilotKitRuntime',
        taskQueue: 'copilotkit-runtime',
      }),
    });

    await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
        },
      }),
    );

    expect(mock.events.map((event) => event.event_type)).toEqual([
      'SignalReceived',
      'WorkflowStarted',
      'ActivityStarted',
      'ActivityStarted',
      'WorkflowCompleted',
    ]);
    expect(mock.events.at(-1)).toMatchObject({
      workflow_type: 'CopilotKitRuntime',
      task_queue: 'copilotkit-runtime',
    });
  });

  it('native runner resets the langgraph thread checkpoint on a non-resume run, keeping the thread id', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const deleted: string[] = [];
    const agent = {
      client: {
        threads: {
          delete: vi.fn(async (threadId: string) => {
            deleted.push(threadId);
          }),
        },
      },
    };
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent,
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
        },
      }),
    );

    // The prior-turn checkpoint is cleared so prepareStream starts clean.
    expect(agent.client.threads.delete).toHaveBeenCalledTimes(1);
    expect(deleted).toEqual(['thread-1']);
    // The frontend-pinned thread id is unchanged: the agent still runs against
    // (and stamps its events with) 'thread-1', so the frontend stays in sync.
    expect(baseRunner.run).toHaveBeenCalledTimes(1);
    expect(baseRunner.lastInput.threadId).toBe('thread-1');
  });

  it('native runner does NOT reset the thread on a resume run (continues the paused thread)', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const agent = {
      client: { threads: { delete: vi.fn(async () => undefined) } },
    };
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent,
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Approve.' }],
          // A HITL approval resume must keep the paused checkpoint.
          forwardedProps: { command: { resume: { approved: true } } },
        },
      }),
    );

    expect(agent.client.threads.delete).not.toHaveBeenCalled();
    expect(baseRunner.run).toHaveBeenCalledTimes(1);
    expect(baseRunner.lastInput.threadId).toBe('thread-1');
  });

  it('native runner survives a langgraph thread-reset failure on a non-resume run', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const agent = {
      client: {
        threads: {
          delete: vi.fn(async () => {
            throw new Error('thread not found');
          }),
        },
      },
    };
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    // A delete failure (e.g. the thread does not exist on the first turn) must
    // never break the turn — the run still proceeds.
    const events = await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent,
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
        },
      }),
    );

    expect(agent.client.threads.delete).toHaveBeenCalledTimes(1);
    expect(baseRunner.run).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(events)).toContain('RUN_FINISHED');
  });

  it('native runner fails the OpenBox workflow when the CopilotKit stream errors', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const baseRunner = createFailingRunner(
      [{ type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' }],
      new Error('stream failed'),
    );
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    await expect(
      collectObservable(
        runner.run({
          threadId: 'thread-1',
          agent: {},
          input: {
            threadId: 'thread-1',
            runId: 'run-1',
            messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
          },
        }),
      ),
    ).rejects.toThrow('stream failed');

    expect(mock.events.map((event) => event.event_type)).toEqual([
      'SignalReceived',
      'WorkflowStarted',
      'ActivityStarted',
      'ActivityStarted',
      'WorkflowFailed',
    ]);
  });

  it('native runner redacts prompt input before the CopilotKit runner executes', async () => {
    const mock = createMockCore((payload) => ({
      verdict: 'constrain',
      reason: 'runtime prompt constrained',
      guardrails_result:
        payload.activity_type === 'llm_call'
          ? {
              input_type: 'activity_input',
              redacted_input: {
                messages: [
                  {
                    id: 'user-1',
                    role: 'user',
                    content: 'Show [REDACTED_EMAIL].',
                  },
                ],
              },
              results: [
                {
                  results: [
                    {
                      field: 'input.messages.0.content',
                      status: 'transformed',
                    },
                  ],
                },
              ],
            }
          : undefined,
    }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [
            { id: 'user-1', role: 'user', content: 'Show alice@example.com.' },
          ],
        },
      }),
    );

    expect(baseRunner.run).toHaveBeenCalledTimes(1);
    expect(baseRunner.lastInput.messages[0].content).toBe(
      'Show [REDACTED_EMAIL].',
    );
  });

  it('native runner buffers and redacts final assistant text before emit', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.activity_type === 'llm_call' ? 'constrain' : 'allow',
      reason: 'final output constrained',
      guardrails_result:
        payload.activity_type === 'llm_call'
          ? {
              input_type: 'activity_output',
              redacted_input: { content: 'Contact [REDACTED_EMAIL].' },
              results: [
                {
                  results: [{ field: 'output.content', status: 'transformed' }],
                },
              ],
            }
          : undefined,
    }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      {
        type: 'TEXT_MESSAGE_START',
        messageId: 'assistant-1',
        role: 'assistant',
      },
      {
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'assistant-1',
        delta: 'Contact alice@example.com.',
      },
      { type: 'TEXT_MESSAGE_END', messageId: 'assistant-1' },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    const events = await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
        },
      }),
    );

    expect(JSON.stringify(events)).toContain('Contact [REDACTED_EMAIL].');
    expect(JSON.stringify(events)).not.toContain('alice@example.com');
  });

  it('defers the assistant gate to the agent when assistantOutputOwner is "agent"', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const adapter = createOpenBoxCopilotKitAdapter({ core: mock.core as any });
    const govSpy = vi.spyOn(adapter, 'governAssistantOutput');
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      { type: 'TEXT_MESSAGE_START', messageId: 'assistant-1', role: 'assistant' },
      {
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'assistant-1',
        delta: 'Reviewed by the agent.',
      },
      { type: 'TEXT_MESSAGE_END', messageId: 'assistant-1' },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter,
      assistantOutputOwner: 'agent',
    });

    const events = await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
        },
      }),
    );

    // The runtime streams the agent's already-governed output verbatim...
    expect(JSON.stringify(events)).toContain('Reviewed by the agent.');
    // ...and does NOT re-govern the assistant output (single-owner = agent),
    // so the same llm_call is not completed twice.
    expect(govSpy).not.toHaveBeenCalled();
  });

  it('propagates consumer unsubscribe to the source subscription (no stream leak on disconnect)', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const unsubscribeSpy = vi.fn();
    let sourceObserver: unknown;
    const baseRunner = {
      run: () => ({
        subscribe: (obs: unknown) => {
          sourceObserver = obs;
          return { unsubscribe: unsubscribeSpy };
        },
      }),
    } as any;
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });
    const sub = runner
      .run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'hi' }],
        },
      })
      .subscribe({ next() {}, error() {}, complete() {} }) as {
      unsubscribe(): void;
    };
    // Wait for the async prompt gate + source wiring to complete.
    const deadline = Date.now() + 2000;
    while (!sourceObserver && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(sourceObserver).toBeTruthy();
    expect(unsubscribeSpy).not.toHaveBeenCalled();
    sub.unsubscribe();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('native runner records model usage and cost on the assistant output hook span', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      {
        type: 'TEXT_MESSAGE_START',
        messageId: 'assistant-1',
        role: 'assistant',
        model: 'gpt-4o-mini',
        provider: 'openai',
      },
      {
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'assistant-1',
        delta: 'Reviewed.',
      },
      {
        type: 'TEXT_MESSAGE_END',
        messageId: 'assistant-1',
        usage: {
          inputTokens: 100,
          outputTokens: 25,
          cost_usd: 0.0042,
        },
      },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
        },
      }),
    );

    expect(mock.events.map((event) => event.event_type)).toEqual([
      'SignalReceived',
      'WorkflowStarted',
      'ActivityStarted',
      'ActivityStarted',
      'ActivityCompleted',
      'ActivityStarted',
      'WorkflowCompleted',
    ]);
    const startedParent = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'llm_call' &&
        event.hook_trigger !== true,
    );
    const completedParent = mock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'llm_call' &&
        event.hook_trigger !== true,
    );
    const completedHook = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'llm_call' &&
        event.hook_trigger === true &&
        event.spans?.[0]?.stage === 'completed',
    );
    const startedHook = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'llm_call' &&
        event.hook_trigger === true &&
        event.spans?.[0]?.stage === 'started',
    );
    expect(completedParent).toMatchObject({
      llm_model: 'gpt-4o-mini',
      input_tokens: 100,
      output_tokens: 25,
      total_tokens: 125,
      cost_usd: 0.0042,
      completion: 'Reviewed.',
    });
    expect(completedParent?.activity_id).toBe(startedParent?.activity_id);
    expect(startedHook?.activity_id).toBe(startedParent?.activity_id);
    expect(completedHook?.activity_id).toBe(startedParent?.activity_id);
    expect(startedHook?.spans?.[0]).toMatchObject({
      name: 'POST',
      stage: 'started',
      hook_type: 'http_request',
      request_headers: expect.objectContaining({
        authorization: '[REDACTED]',
        'content-type': 'application/json',
      }),
      attributes: expect.objectContaining({
        'http.method': 'POST',
        'http.url': 'https://api.openai.com/v1/chat/completions',
      }),
    });
    // D2 canonical: usage/cost are NOT span-root fields — they ride on the
    // completed activity EVENT (completedParent above asserts input/output/
    // total_tokens + cost_usd). The span keeps its canonical http identity.
    expect(completedHook?.spans?.[0]).toMatchObject({
      name: 'POST',
      kind: 'CLIENT',
      hook_type: 'http_request',
      http_url: 'https://api.openai.com/v1/chat/completions',
      request_headers: expect.objectContaining({
        authorization: '[REDACTED]',
        'content-type': 'application/json',
      }),
    });
    expect(JSON.parse(String(completedHook?.spans?.[0]?.request_body))).toMatchObject({
      model: 'gpt-4o-mini',
      messages: [expect.objectContaining({ content: 'Summarize.' })],
    });
    expect(JSON.parse(String(completedHook?.spans?.[0]?.response_body))).toMatchObject({
      model: 'gpt-4o-mini',
      usage: {
        prompt_tokens: 100,
        completion_tokens: 25,
        total_tokens: 125,
      },
    });
  });

  it('native runner merges RUN_FINISHED model usage into the assistant output span', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      {
        type: 'TEXT_MESSAGE_START',
        messageId: 'assistant-1',
        role: 'assistant',
      },
      {
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'assistant-1',
        delta: 'Reviewed.',
      },
      { type: 'TEXT_MESSAGE_END', messageId: 'assistant-1' },
      {
        type: 'RUN_FINISHED',
        threadId: 'thread-1',
        runId: 'run-1',
        model: 'claude-3-5-sonnet-latest',
        provider: 'anthropic',
        usage: {
          inputTokens: 120,
          outputTokens: 45,
          totalTokens: 165,
          costUsd: 0.031,
        },
      },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
        },
      }),
    );

    const completedParent = mock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'llm_call' &&
        event.hook_trigger !== true,
    );
    const completedHook = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'llm_call' &&
        event.hook_trigger === true &&
        event.spans?.[0]?.stage === 'completed',
    );

    expect(completedParent).toMatchObject({
      llm_model: 'claude-3-5-sonnet-latest',
      input_tokens: 120,
      output_tokens: 45,
      total_tokens: 165,
      cost_usd: 0.031,
    });
    // D2 canonical: usage/cost are NOT span-root fields — they ride on the
    // completed activity EVENT (completedParent above asserts input/output/
    // total_tokens + cost_usd). The span keeps its canonical http identity.
    expect(completedHook?.spans?.[0]).toMatchObject({
      name: 'POST',
      kind: 'CLIENT',
      hook_type: 'http_request',
      http_url: 'https://api.anthropic.com/v1/messages',
      request_headers: expect.objectContaining({
        'x-api-key': '[REDACTED]',
        'content-type': 'application/json',
      }),
    });
  });

  it('native runner records raw CopilotKit tool calls as same-activity tool spans', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      {
        type: 'TOOL_CALL_START',
        threadId: 'thread-1',
        runId: 'run-1',
        toolCallId: 'call-1',
        toolCallName: 'crm_lookup',
      },
      {
        type: 'TOOL_CALL_ARGS',
        threadId: 'thread-1',
        runId: 'run-1',
        toolCallId: 'call-1',
        delta: '{"customerId":"cus_123"}',
      },
      {
        type: 'TOOL_CALL_END',
        threadId: 'thread-1',
        runId: 'run-1',
        toolCallId: 'call-1',
      },
      {
        type: 'TOOL_CALL_RESULT',
        threadId: 'thread-1',
        runId: 'run-1',
        messageId: 'tool-message-1',
        toolCallId: 'call-1',
        role: 'tool',
        content: '{"ok":true,"accountTier":"enterprise"}',
      },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    const events = await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Lookup account.' }],
        },
      }),
    );

    expect((events as Array<Record<string, any>>).map((event) => event.type)).toEqual([
      'RUN_STARTED',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
      'TOOL_CALL_RESULT',
      'RUN_FINISHED',
    ]);
    // Canonical: crm_lookup is a TOOL activity → parent started+completed only,
    // NO tool-activity (function_call) span. The llm_call keeps its started
    // llm_completion span (the prompt-started hook). The raw CopilotKit tool-call
    // data rides on the crm_lookup parent activity (asserted below), not a span.
    expect(mock.events.map((event) => event.event_type)).toEqual([
      'SignalReceived',
      'WorkflowStarted',
      'ActivityStarted',
      'ActivityStarted',
      'ActivityStarted',
      'ActivityCompleted',
      'WorkflowCompleted',
    ]);

    const startedParent = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'crm_lookup' &&
        event.hook_trigger !== true,
    );
    const completedParent = mock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'crm_lookup' &&
        event.hook_trigger !== true &&
        event.activity_id === startedParent?.activity_id,
    );
    expect(startedParent?.spans).toBeUndefined();
    expect(completedParent?.spans).toBeUndefined();
    expect(startedParent).toMatchObject({
      activity_id: 'call-1',
      tool_name: 'crm_lookup',
      tool_type: 'llm_tool_call',
    });
    expect(startedParent?.activity_input).toContainEqual(expect.objectContaining({
      source: 'copilotkit',
      event_type: 'TOOL_CALL_START',
      event_types: ['TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END'],
      thread_id: 'thread-1',
      run_id: 'run-1',
      tool_call_id: 'call-1',
      toolCallId: 'call-1',
      raw_args: '{"customerId":"cus_123"}',
      args: { customerId: 'cus_123' },
      copilotkit: expect.objectContaining({
        toolCallId: 'call-1',
        toolName: 'crm_lookup',
        eventTypes: ['TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END'],
        rawArgs: '{"customerId":"cus_123"}',
      }),
    }));
    expect(completedParent).toMatchObject({
      activity_id: 'call-1',
      tool_name: 'crm_lookup',
      tool_type: 'llm_tool_call',
      activity_output: expect.objectContaining({
        source: 'copilotkit',
        event_type: 'TOOL_CALL_RESULT',
        result_event_type: 'TOOL_CALL_RESULT',
        thread_id: 'thread-1',
        run_id: 'run-1',
        message_id: 'tool-message-1',
        tool_call_id: 'call-1',
        toolCallId: 'call-1',
        content: '{"ok":true,"accountTier":"enterprise"}',
        result: { ok: true, accountTier: 'enterprise' },
        copilotkit: expect.objectContaining({
          toolCallId: 'call-1',
          toolName: 'crm_lookup',
          resultEventType: 'TOOL_CALL_RESULT',
          messageId: 'tool-message-1',
          role: 'tool',
        }),
      }),
    });
    // Canonical: a CopilotKit tool call is the tool ACTIVITY, not a real
    // sub-operation, so it produces NO function_call span. The raw tool-call
    // request/result data rides on the parent activity (started/completed,
    // asserted above), never a hook span.
  });

  it('native runner preserves tool-result ordering before final assistant output in one session', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      {
        type: 'TOOL_CALL_START',
        threadId: 'thread-1',
        runId: 'run-1',
        toolCallId: 'call-1',
        toolCallName: 'crm_lookup',
      },
      {
        type: 'TOOL_CALL_ARGS',
        threadId: 'thread-1',
        runId: 'run-1',
        toolCallId: 'call-1',
        delta: '{"customerId":"cus_123"}',
      },
      {
        type: 'TOOL_CALL_END',
        threadId: 'thread-1',
        runId: 'run-1',
        toolCallId: 'call-1',
      },
      {
        type: 'TOOL_CALL_RESULT',
        threadId: 'thread-1',
        runId: 'run-1',
        messageId: 'tool-message-1',
        toolCallId: 'call-1',
        role: 'tool',
        content: '{"ok":true,"accountTier":"enterprise"}',
      },
      {
        type: 'TEXT_MESSAGE_START',
        threadId: 'thread-1',
        runId: 'run-1',
        messageId: 'assistant-1',
        role: 'assistant',
      },
      {
        type: 'TEXT_MESSAGE_CONTENT',
        threadId: 'thread-1',
        runId: 'run-1',
        messageId: 'assistant-1',
        delta: 'Account lookup completed.',
      },
      {
        type: 'TEXT_MESSAGE_END',
        threadId: 'thread-1',
        runId: 'run-1',
        messageId: 'assistant-1',
      },
      {
        type: 'RUN_FINISHED',
        threadId: 'thread-1',
        runId: 'run-1',
        model: 'gpt-5.4',
        provider: 'openai-compatible',
        usage: {
          inputTokens: 321,
          outputTokens: 87,
          totalTokens: 408,
          costUsd: 0.0042,
        },
      },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    const events = await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [
            {
              id: 'user-1',
              role: 'user',
              content: 'Lookup account and summarize the result.',
            },
          ],
        },
      }),
    );

    expect((events as Array<Record<string, any>>).map((event) => event.type)).toEqual([
      'RUN_STARTED',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
      'TOOL_CALL_RESULT',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ]);
    // Canonical: crm_lookup is a TOOL activity → parent started+completed only,
    // NO tool-activity (function_call) span. The llm_call keeps its started+
    // completed llm_completion span pair (the prompt-started and assistant-
    // completed hooks). So the tool's two function_call hooks are absent here.
    expect(mock.events.map((event) => event.event_type)).toEqual([
      'SignalReceived',
      'WorkflowStarted',
      'ActivityStarted',
      'ActivityStarted',
      'ActivityStarted',
      'ActivityCompleted',
      'ActivityCompleted',
      'ActivityStarted',
      'WorkflowCompleted',
    ]);

    const toolCompleteIndex = mock.events.findIndex(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'crm_lookup',
    );
    const assistantCompleteIndex = mock.events.findIndex(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'llm_call',
    );
    const assistantCompleted = mock.events[assistantCompleteIndex];
    const assistantHook = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'llm_call' &&
        event.hook_trigger === true &&
        event.spans?.[0]?.stage === 'completed',
    );
    const assistantStartHook = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'llm_call' &&
        event.hook_trigger === true &&
        event.spans?.[0]?.stage === 'started',
    );

    expect(toolCompleteIndex).toBeGreaterThan(0);
    expect(assistantCompleteIndex).toBeGreaterThan(toolCompleteIndex);
    expect(assistantCompleted).toMatchObject({
      llm_model: 'gpt-5.4',
      input_tokens: 321,
      output_tokens: 87,
      total_tokens: 408,
      cost_usd: 0.0042,
    });
    expect(assistantStartHook?.activity_id).toBe(assistantCompleted.activity_id);
    // D2 canonical: usage/cost ride on the completed activity EVENT
    // (assistantCompleted above asserts total_tokens + cost_usd), not the span.
    // The span keeps its canonical http identity (name POST).
    expect(assistantHook?.spans?.[0]).toMatchObject({
      name: 'POST',
    });
  });

  it('native runner stops after a governed tool-output block without duplicating source tool events', async () => {
    const mock = createMockCore((payload) => ({
      verdict:
        payload.event_type === 'ActivityCompleted' &&
        payload.activity_type === 'crm_lookup'
          ? 'block'
          : 'allow',
      reason: 'tool output blocked',
    }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      {
        type: 'TOOL_CALL_START',
        threadId: 'thread-1',
        runId: 'run-1',
        toolCallId: 'call-1',
        toolCallName: 'crm_lookup',
      },
      {
        type: 'TOOL_CALL_ARGS',
        threadId: 'thread-1',
        runId: 'run-1',
        toolCallId: 'call-1',
        delta: '{"customerId":"cus_123"}',
      },
      {
        type: 'TOOL_CALL_END',
        threadId: 'thread-1',
        runId: 'run-1',
        toolCallId: 'call-1',
      },
      {
        type: 'TOOL_CALL_RESULT',
        threadId: 'thread-1',
        runId: 'run-1',
        messageId: 'tool-message-1',
        toolCallId: 'call-1',
        role: 'tool',
        content: '{"email":"jane@example.com"}',
      },
      {
        type: 'TEXT_MESSAGE_START',
        threadId: 'thread-1',
        runId: 'run-1',
        messageId: 'assistant-1',
        role: 'assistant',
      },
      {
        type: 'TEXT_MESSAGE_CONTENT',
        threadId: 'thread-1',
        runId: 'run-1',
        messageId: 'assistant-1',
        delta: 'I used the blocked tool output.',
      },
      {
        type: 'TEXT_MESSAGE_END',
        threadId: 'thread-1',
        runId: 'run-1',
        messageId: 'assistant-1',
      },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    const events = await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [
            {
              id: 'user-1',
              role: 'user',
              content: 'Lookup account and summarize the result.',
            },
          ],
        },
      }),
    );
    const typedEvents = events as Array<Record<string, any>>;
    const sourceToolTypes = typedEvents
      .filter((event) => event.toolCallId === 'call-1')
      .map((event) => event.type);
    const emittedTypes = typedEvents.map((event) => event.type);

    expect(sourceToolTypes).toEqual([
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
    ]);
    expect(JSON.stringify(typedEvents)).toContain('tool output blocked');
    expect(emittedTypes).not.toContain('TEXT_MESSAGE_START');
    expect(emittedTypes).not.toContain('TEXT_MESSAGE_CONTENT');
    expect(emittedTypes).not.toContain('TEXT_MESSAGE_END');
    expect(emittedTypes).not.toContain('RUN_FINISHED');
    expect(mock.events.map((event) => event.event_type)).toContain(
      'WorkflowCompleted',
    );
    expect(mock.events.map((event) => event.event_type)).not.toContain(
      'WorkflowFailed',
    );
    // Canonical seal: governance stop → WorkflowCompleted(status="failed").
    expect(
      mock.events.find((event) => event.event_type === 'WorkflowCompleted')
        ?.status,
    ).toBe('failed');
  });

  it('native runner keeps RUN_FINISHED after late final assistant text', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
      {
        type: 'TEXT_MESSAGE_START',
        messageId: 'assistant-1',
        role: 'assistant',
      },
      {
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'assistant-1',
        delta: 'Reviewed.',
      },
      { type: 'TEXT_MESSAGE_END', messageId: 'assistant-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    const events = await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
        },
      }),
    );
    const types = events.map((event: any) => event.type);

    expect(types).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ]);
  });

  it('native runner blocks unsafe final assistant text before emit', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.activity_type === 'llm_call' ? 'block' : 'allow',
      reason: 'final output blocked',
    }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      {
        type: 'TEXT_MESSAGE_START',
        messageId: 'assistant-1',
        role: 'assistant',
      },
      {
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'assistant-1',
        delta: 'Contact alice@example.com.',
      },
      { type: 'TEXT_MESSAGE_END', messageId: 'assistant-1' },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    const events = await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
        },
      }),
    );

    expect(JSON.stringify(events)).toContain('final output blocked');
    expect(JSON.stringify(events)).not.toContain('alice@example.com');
    expect(mock.events.map((event) => event.event_type)).toContain(
      'WorkflowCompleted',
    );
    expect(mock.events.map((event) => event.event_type)).not.toContain(
      'WorkflowFailed',
    );
    // Canonical seal: governance stop → WorkflowCompleted(status="failed").
    expect(
      mock.events.find((event) => event.event_type === 'WorkflowCompleted')
        ?.status,
    ).toBe('failed');
  });

  it('native runner does not re-govern final payload after an OpenBox governed tool result', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.event_type === 'ActivityCompleted' ? 'block' : 'allow',
      reason:
        payload.event_type === 'ActivityCompleted'
          ? 'redundant final output blocked'
          : 'allowed',
    }));
    const openBoxResult = {
      schemaVersion: 'openbox.copilotkit.result.v1',
      status: 'executed',
      verdict: 'allow',
      executed: true,
      action: 'open_operations_queue',
      request: 'Review queue.',
      reason: 'OpenBox allowed this action.',
    };
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      {
        type: 'TOOL_CALL_RESULT',
        toolCallId: 'openbox-tool-call',
        content: JSON.stringify(openBoxResult),
      },
      {
        type: 'RUN_FINISHED',
        threadId: 'thread-1',
        runId: 'run-1',
        output: { messages: [{ content: JSON.stringify(openBoxResult) }] },
      },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    const events = await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Review queue.' }],
        },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'TOOL_CALL_RESULT',
        content: JSON.stringify(openBoxResult),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'RUN_FINISHED' }),
    );
    expect(JSON.stringify(events)).not.toContain(
      'redundant final output blocked',
    );
    expect(
      mock.events.filter((event) => event.event_type === 'ActivityCompleted'),
    ).toHaveLength(0);
  });

  it('native runner recognizes OpenBox governed tool results outside content', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.event_type === 'ActivityCompleted' ? 'halt' : 'allow',
      reason:
        payload.event_type === 'ActivityCompleted'
          ? 'redundant runtime gate halted'
          : 'allowed',
    }));
    const openBoxResult = {
      schemaVersion: 'openbox.copilotkit.result.v1',
      status: 'blocked',
      verdict: 'block',
      executed: false,
      action: 'export_governance_identifiers',
      request: 'Send exception ids.',
      reason: 'OpenBox blocked this identifier export.',
    };
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      {
        type: 'TOOL_CALL_RESULT',
        toolCallId: 'openbox-tool-call',
        result: openBoxResult,
      },
      {
        type: 'RUN_FINISHED',
        threadId: 'thread-1',
        runId: 'run-1',
        output: { content: 'This should not be governed again.' },
      },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    const events = await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [
            { id: 'user-1', role: 'user', content: 'Send exception ids.' },
          ],
        },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'TOOL_CALL_RESULT',
        result: openBoxResult,
      }),
    );
    expect(JSON.stringify(events)).not.toContain('redundant runtime gate halted');
    expect(
      mock.events.filter((event) => event.event_type === 'ActivityCompleted'),
    ).toHaveLength(0);
  });

  it('native runner redacts custom non-text final AG-UI payloads before emit', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.activity_type === 'llm_call' ? 'constrain' : 'allow',
      reason: 'custom final output constrained',
      guardrails_result:
        payload.activity_type === 'llm_call'
          ? {
              input_type: 'activity_output',
              redacted_input: {
                summary: 'Contact [REDACTED_EMAIL].',
                nested: { contact: '[REDACTED_EMAIL]' },
              },
              results: [
                {
                  results: [{ field: 'output.data', status: 'transformed' }],
                },
              ],
            }
          : undefined,
    }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      {
        type: 'CUSTOM',
        name: 'assistant_final_artifact',
        final: true,
        data: {
          summary: 'Contact alice@example.com.',
          nested: { contact: 'alice@example.com' },
        },
      },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    const events = await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
        },
      }),
    );

    expect(JSON.stringify(events)).toContain('[REDACTED_EMAIL]');
    expect(JSON.stringify(events)).not.toContain('alice@example.com');
  });

  it('native runner redacts custom AG-UI final_output payloads without final flags', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.activity_type === 'llm_call' ? 'constrain' : 'allow',
      reason: 'named custom final output constrained',
      guardrails_result:
        payload.activity_type === 'llm_call'
          ? {
              input_type: 'activity_output',
              redacted_input: {
                card: {
                  title: 'Renewal contact',
                  contact: '[REDACTED_EMAIL]',
                },
              },
              results: [
                {
                  results: [{ field: 'output.payload.card.contact', status: 'transformed' }],
                },
              ],
            }
          : undefined,
    }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      {
        type: 'CUSTOM_EVENT',
        event: 'final_output',
        payload: {
          card: {
            title: 'Renewal contact',
            contact: 'alice@example.com',
          },
        },
      },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    const events = await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
        },
      }),
    );

    expect(JSON.stringify(events)).toContain('[REDACTED_EMAIL]');
    expect(JSON.stringify(events)).not.toContain('alice@example.com');
  });

  it('native runner blocks custom non-text final AG-UI payloads before emit', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.activity_type === 'llm_call' ? 'block' : 'allow',
      reason: 'custom final output blocked',
    }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      {
        type: 'CUSTOM',
        name: 'assistant_final_artifact',
        final: true,
        data: {
          summary: 'Contact alice@example.com.',
        },
      },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    const events = await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
        },
      }),
    );

    expect(JSON.stringify(events)).toContain('custom final output blocked');
    expect(JSON.stringify(events)).not.toContain('alice@example.com');
  });

  it('native runner completes the workflow on RUN_FINISHED even without observer.complete()', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const baseRunner = createFakeRunner(
      [
        { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
        { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
      ],
      { complete: false },
    );
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    runner.run({
      threadId: 'thread-1',
      agent: {},
      input: {
        threadId: 'thread-1',
        runId: 'run-1',
        messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
      },
    }).subscribe({});
    await waitFor(() =>
      mock.events.some((event) => event.event_type === 'WorkflowCompleted'),
    );

    const types = mock.events.map((event) => event.event_type);
    expect(types).toContain('WorkflowStarted');
    expect(types).toContain('WorkflowCompleted');
    expect(types).not.toContain('WorkflowFailed');
  });

  it('native runner fails the workflow on RUN_ERROR even without observer.error()', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const baseRunner = createFakeRunner(
      [
        { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
        { type: 'RUN_ERROR', message: 'agent thread creation failed' },
      ],
      { complete: false },
    );
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    runner.run({
      threadId: 'thread-1',
      agent: {},
      input: {
        threadId: 'thread-1',
        runId: 'run-1',
        messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
      },
    }).subscribe({});
    await waitFor(() =>
      mock.events.some((event) => event.event_type === 'WorkflowFailed'),
    );

    const types = mock.events.map((event) => event.event_type);
    expect(types).toContain('WorkflowFailed');
    expect(types).not.toContain('WorkflowCompleted');
  });

  it('drops malformed CopilotKit interrupt meta-events before they reach subscribers', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      {
        type: 'MetaEvent',
        name: 'CopilotKitLangGraphInterruptEvent',
        data: { value: { interrupt: 'missing-messages' } },
      },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    const events = await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
        },
      }),
    );

    expect(events).not.toContainEqual(
      expect.objectContaining({
        name: 'CopilotKitLangGraphInterruptEvent',
      }),
    );
    expect(mock.events.map((event) => event.event_type)).toContain(
      'WorkflowCompleted',
    );
  });

  it('governs runs without an agentId even when an agents filter is configured', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const baseRunner = createFakeRunner(
      [
        { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
        { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
      ],
      { complete: false },
    );
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
      agents: ['default'],
    });

    // CopilotKit's SSE handler shape: { threadId, agent, input }, no agentId.
    runner.run({
      threadId: 'thread-1',
      agent: {},
      input: {
        threadId: 'thread-1',
        runId: 'run-1',
        messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
      },
    }).subscribe({});
    await waitFor(() =>
      mock.events.some((event) => event.event_type === 'WorkflowCompleted'),
    );

    expect(mock.events.map((event) => event.event_type)).toContain(
      'WorkflowStarted',
    );
  });

  it('wraps CopilotKit runtimes with a governed runner and keeps runtime properties', () => {
    const adapter = createOpenBoxCopilotKitAdapter({
      core: createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }))
        .core as any,
    });
    const baseRunner = createFakeRunner([]);
    const baseRuntime = { runner: baseRunner, name: 'runtime-1' };

    const wrapped = createOpenBoxCopilotRuntime({
      runtime: baseRuntime,
      adapter,
    });

    expect(wrapped.runtime).not.toBe(baseRuntime);
    expect(wrapped.runtime.name).toBe('runtime-1');
    expect(wrapped.runtime.runner).toBe(wrapped.runner);
    expect(wrapped.runner).not.toBe(baseRunner);
    expect(wrapped.hooks).toHaveProperty('onBeforeHandler');
  });

  it('requires a runner before creating a governed CopilotKit runtime', () => {
    expect(() =>
      createOpenBoxCopilotRuntime({
        runtime: {},
        adapter: createOpenBoxCopilotKitAdapter({ enabled: false }),
      }),
    ).toThrow('CopilotKit runtime runner is required');
  });

  it('bypasses governance only for explicitly mismatched agent ids', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
      agents: ['default'],
    });

    await collectObservable(
      runner.run({
        threadId: 'thread-1',
        agentId: 'other-agent',
        agent: {},
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
        },
      }),
    );

    expect(mock.events).toHaveLength(0);
    expect(baseRunner.run).toHaveBeenCalledTimes(1);
  });

  it('uses agent object identifiers and function subscribers for governed runs', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
      agents: ['named-agent'],
      sessionKey: (input) => `custom:${input.threadId}`,
    });

    const events = await new Promise<unknown[]>((resolve, reject) => {
      const received: unknown[] = [];
      runner.run({
        threadId: 'thread-1',
        agent: { name: 'named-agent' },
        input: {
          threadId: 'thread-1',
          runId: 'run-1',
          messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
        },
      }).subscribe(
        (event: unknown) => received.push(event),
        reject,
        () => resolve(received),
      );
    });

    expect(events.map((event: any) => event.type)).toEqual([
      'RUN_STARTED',
      'RUN_FINISHED',
    ]);
    expect(baseRunner.run).toHaveBeenCalledTimes(1);
    expect(mock.events.map((event) => event.event_type)).toContain(
      'WorkflowStarted',
    );
    expect(mock.events[0].workflow_id).toEqual(expect.any(String));
  });

  it('middleware opens one owned workflow lazily and closes it when state drops the IDs', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;

    const runtime = { config: { configurable: { thread_id: 'thread-drop' } } };
    await middleware.wrapModelCall(
      {
        messages: [{ type: 'human', content: 'Open queue.' }],
        configurable: { thread_id: 'thread-drop' },
        state: {},
      },
      async () => ({ content: 'done' }),
    );
    await middleware.afterAgent(
      { messages: [], configurable: { thread_id: 'thread-drop' } },
      runtime,
    );

    const workflowIds = new Set(mock.events.map((event) => event.workflow_id));
    expect(workflowIds.size).toBe(1);
    const types = mock.events.map((event) => event.event_type);
    expect(types.slice(0, 3)).toEqual([
      'SignalReceived',
      'WorkflowStarted',
      'ActivityStarted',
    ]);
    expect(types[types.length - 1]).toBe('WorkflowCompleted');
    expect(
      mock.events.filter((event) => event.event_type === 'WorkflowStarted'),
    ).toHaveLength(1);
    expect(
      mock.events.some((event) => event.activity_type === 'LangChainStart'),
    ).toBe(false);
  });

  it('middleware adopts the runtime workflow from state and leaves its terminal event to the runtime', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(createMiddlewareDeps()) as any;

    const state = {
      messages: [],
      openboxWorkflowId: 'runtime-workflow',
      openboxRunId: 'runtime-run',
      __openboxRuntimePromptGoverned: true,
    };
    const runtime = { config: { configurable: { thread_id: 'thread-adopt' } } };
    await middleware.wrapToolCall(
      {
        toolCall: { name: 'crm_lookup', args: {} },
        configurable: { thread_id: 'thread-adopt' },
        state,
      },
      async () => ({ ok: true }),
    );
    await middleware.afterAgent(
      { ...state, configurable: { thread_id: 'thread-adopt' } },
      runtime,
    );

    const types = mock.events.map((event) => event.event_type);
    expect(types).not.toContain('WorkflowStarted');
    expect(types).not.toContain('WorkflowCompleted');
    expect(
      new Set(mock.events.map((event) => event.workflow_id)),
    ).toEqual(new Set(['runtime-workflow']));
  });

  it('governed tool rides the active task workflow without opening or closing it', async () => {
    const { registerActiveWorkflow, clearActiveWorkflow } = await import(
      '../../ts/src/copilotkit/workflow-session'
    );
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const adapter = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
      workflowType: 'CopilotKitTestWorkflow',
      taskQueue: 'langgraph',
    });
    const tool = createGovernedCopilotTool<DemoInput, DemoArtifact>({
      adapter,
      toolName: 'openbox_governed_action',
      description: 'Test governed action.',
      execute: async (input) => ({ body: input.request }),
    });
    registerActiveWorkflow(adapter, 'default', {
      workflowId: 'task-workflow',
      runId: 'task-run',
      owned: false,
    });
    try {
      const result = await tool.execute({
        action: 'demo_action',
        request: 'Open the queue.',
      });

      expect(result.status).toBe('executed');
      expect(result.workflowId).toBe('task-workflow');
      const types = mock.events.map((event) => event.event_type);
      expect(types).not.toContain('WorkflowStarted');
      expect(types).not.toContain('WorkflowCompleted');
      expect(types).toContain('ActivityStarted');
      expect(types).toContain('ActivityCompleted');
      expect(
        new Set(mock.events.map((event) => event.workflow_id)),
      ).toEqual(new Set(['task-workflow']));
    } finally {
      clearActiveWorkflow(adapter, 'default');
    }
  });

  it('native runner skips WorkflowCompleted when a governed result already ended the workflow', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const baseRunner = createFakeRunner(
      [
        { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
        {
          type: 'TOOL_CALL_RESULT',
          messageId: 'tool-1',
          toolCallId: 'call-1',
          role: 'tool',
          content: JSON.stringify({
            schemaVersion: 'openbox.copilotkit.result.v1',
            status: 'halted',
            verdict: 'halt',
            action: 'disable_production_payments',
          }),
        },
        { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
      ],
      { complete: false },
    );
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    runner.run({
      threadId: 'thread-1',
      agent: {},
      input: {
        threadId: 'thread-1',
        runId: 'run-1',
        messages: [{ id: 'user-1', role: 'user', content: 'Halt this.' }],
      },
    }).subscribe({});
    // Give the scheduled terminal a chance to (incorrectly) fire.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const types = mock.events.map((event) => event.event_type);
    expect(types).not.toContain('WorkflowCompleted');
    expect(types).not.toContain('WorkflowFailed');
  });

  it('pairs governed-tool sub-operation started and completed hook spans by span_id', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const adapter = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
      workflowType: 'CopilotKitTestWorkflow',
      taskQueue: 'langgraph',
    });
    // The governed tool's execute() performs ONE instrumented sub-operation (a
    // traced function), which is captured as a function_call span pair and
    // submitted as a hook_trigger eval on the completed activity.
    const review = traced('review_queue', (request: string) => ({ body: request }));
    const tool = createGovernedCopilotTool<DemoInput, DemoArtifact>({
      adapter,
      toolName: 'openbox_governed_action',
      description: 'Test governed action.',
      execute: async (input) => review(input.request),
    });

    await tool.execute({
      action: 'demo_action',
      request: 'Create a support ticket.',
    });

    const startedHook = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.hook_trigger === true &&
        event.spans?.[0]?.stage === 'started',
    )?.spans?.[0] as Record<string, any> | undefined;
    const completedHook = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.hook_trigger === true &&
        event.spans?.[0]?.stage === 'completed',
    )?.spans?.[0] as Record<string, any> | undefined;

    expect(startedHook?.hook_type).toBe('function_call');
    expect(startedHook?.name).toBe('review_queue');
    expect(startedHook?.span_id).toMatch(/^[0-9a-f]{16}$/);
    expect(startedHook?.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(completedHook?.span_id).toBe(startedHook?.span_id);
    expect(completedHook?.trace_id).toBe(startedHook?.trace_id);
  });

  it('emits no span on the approval resume activity (HITL carries no span)', async () => {
    const events: GovernanceEventPayload[] = [];
    const core = {
      evaluate: vi.fn(async (payload: GovernanceEventPayload) => {
        events.push(payload);
        return { verdict: 'allow', action: 'allow', reason: 'allowed' };
      }),
      pollApproval: vi.fn(async () => ({ action: 'allow', reason: 'approved' })),
    };
    const adapter = createOpenBoxCopilotKitAdapter({
      core: core as any,
      workflowType: 'CopilotKitTestWorkflow',
      taskQueue: 'langgraph',
    });
    const tool = createGovernedCopilotTool<DemoInput, DemoArtifact>({
      adapter,
      toolName: 'openbox_governed_action',
      description: 'Test governed action.',
      execute: async (input) => ({ body: input.request }),
    });

    await tool.resume({
      action: 'demo_action',
      request: 'Issue a service credit after approval.',
      amountUsd: 7500,
      workflowId: 'workflow-approval',
      runId: 'run-approval',
      activityId: 'activity-approval',
      approved: true,
      approvalId: 'approval-row',
      governanceEventId: 'event-start',
    });

    // Canonical: the approval/HITL resume activity carries no span (no sub-op).
    const hookSpanEvents = events.filter(
      (event) => event.hook_trigger === true && (event.spans?.length ?? 0) > 0,
    );
    expect(hookSpanEvents).toEqual([]);
    const completedParent = events.find(
      (event) => event.event_type === 'ActivityCompleted' && !event.hook_trigger,
    );
    expect(completedParent?.spans).toBeUndefined();
  });

  it('completes the llm_call activity when a governed route short-circuits the model call', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const deps = {
      ...createMiddlewareDeps(),
      routeLatestUserPrompt: () => ({
        toolName: 'openbox_governed_action',
        args: { request: 'open the queue' },
      }),
    };
    const middleware = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
    }).createLangChainMiddleware(deps) as any;
    const handler = vi.fn(async () => ({ content: 'should not run' }));

    const result = await middleware.wrapModelCall(
      {
        messages: [{ type: 'human', content: 'Open the queue.' }],
        state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
      },
      handler,
    );

    // The model is short-circuited: a routed tool-call is returned instead.
    expect(handler).not.toHaveBeenCalled();
    expect(result.tool_calls?.[0]?.name).toBe('openbox_governed_action');

    // Every ActivityStarted(llm_call) must have a matching ActivityCompleted.
    const llmStarts = mock.events.filter(
      (e) =>
        e.event_type === 'ActivityStarted' &&
        e.activity_type === 'llm_call' &&
        e.hook_trigger !== true,
    );
    const llmCompletes = mock.events.filter(
      (e) =>
        e.event_type === 'ActivityCompleted' &&
        e.activity_type === 'llm_call' &&
        e.hook_trigger !== true,
    );
    expect(llmStarts).toHaveLength(1);
    expect(llmCompletes).toHaveLength(1);
    expect(llmCompletes[0]?.activity_id).toBe(llmStarts[0]?.activity_id);
  });

  it('assembles a streamed (SSE) response into a chat.completion response_body', async () => {
    const { createCapturingFetch, runWithLLMCapture, capturedLLMExchanges } =
      await import('../../ts/src/copilotkit/otel-capture');
    const sse = [
      'data: {"id":"chatcmpl-X","object":"chat.completion.chunk","created":1,"model":"gpt-5-nano","service_tier":"default","system_fingerprint":null,"choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_J","type":"function","function":{"name":"openbox_governed_action","arguments":""}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-X","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"action"}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-X","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\":\\"open\\"}"}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-X","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
      'data: {"id":"chatcmpl-X","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}',
      'data: [DONE]',
      '',
    ].join('\n\n');
    const baseFetch = async () =>
      new Response(sse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    const capturing = createCapturingFetch(baseFetch as unknown as typeof fetch);
    const exchange = await runWithLLMCapture(async () => {
      await capturing('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: '{}',
      });
      return capturedLLMExchanges()[0];
    });
    const body = exchange?.responseBody as Record<string, any>;
    expect(typeof body).toBe('object');
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.tool_calls[0].function).toEqual({
      name: 'openbox_governed_action',
      arguments: '{"action":"open"}',
    });
    expect(body.choices[0].finish_reason).toBe('tool_calls');
    expect(body.usage.total_tokens).toBe(3);
  });

  it('captures the real LLM request/response via the instrumented fetch', async () => {
    const { createCapturingFetch, runWithLLMCapture, latestCapturedLLMExchange } =
      await import('../../ts/src/copilotkit/otel-capture');
    const fakeFetch = async () =>
      new Response(
        JSON.stringify({
          id: 'chatcmpl-1',
          model: 'gpt-4o-2024-08-06',
          system_fingerprint: 'fp_x',
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'req_abc',
            'openai-version': '2020-10-01',
          },
        },
      );
    const capturing = createCapturingFetch(fakeFetch as unknown as typeof fetch);
    const captured = await runWithLLMCapture(async () => {
      await capturing('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer sk-live',
          'content-type': 'application/json',
          'x-stainless-lang': 'js',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      return latestCapturedLLMExchange();
    });

    expect(captured?.httpStatusCode).toBe(200);
    expect(captured?.requestHeaders.authorization).toBe('Bearer sk-live');
    expect(captured?.requestHeaders['x-stainless-lang']).toBe('js');
    expect(captured?.responseHeaders['x-request-id']).toBe('req_abc');
    expect((captured?.requestBody as any).messages[0].content).toBe('hi');
    expect((captured?.responseBody as any).system_fingerprint).toBe('fp_x');
  });

});

function createMiddlewareDeps() {
  return {
    createMiddleware: (definition: any) => definition,
    AIMessage: class {
      content: unknown;
      tool_calls?: unknown;

      constructor(message: any) {
        this.content = message.content;
        this.tool_calls = message.tool_calls;
      }
    },
  };
}

function createFakeRunner(
  events: Record<string, unknown>[],
  options: { complete?: boolean } = {},
) {
  const runner = {
    lastInput: undefined as any,
    run: vi.fn((request: any) => {
      runner.lastInput = request.input;
      return {
        subscribe(observerOrNext?: any, error?: any, complete?: any) {
          const observer =
            typeof observerOrNext === 'function'
              ? { next: observerOrNext, error, complete }
              : observerOrNext;
          queueMicrotask(() => {
            for (const event of events) observer?.next?.(event);
            if (options.complete !== false) observer?.complete?.();
          });
          return { unsubscribe() {} };
        },
      };
    }),
  };
  return runner;
}

async function waitFor(check: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!check()) throw new Error('waitFor timed out');
}

function createFailingRunner(events: Record<string, unknown>[], error: Error) {
  const runner = {
    lastInput: undefined as any,
    run: vi.fn((request: any) => {
      runner.lastInput = request.input;
      return {
        subscribe(observerOrNext?: any, onError?: any) {
          const observer =
            typeof observerOrNext === 'function'
              ? { next: observerOrNext, error: onError }
              : observerOrNext;
          queueMicrotask(() => {
            for (const event of events) observer?.next?.(event);
            observer?.error?.(error);
          });
          return { unsubscribe() {} };
        },
      };
    }),
  };
  return runner;
}

function parseSseEvents(body: string): Array<Record<string, any>> {
  return body
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const data = chunk
        .split('\n')
        .find((line) => line.startsWith('data: '));
      return data ? JSON.parse(data.slice('data: '.length)) : {};
    });
}

function collectObservable(observable: {
  subscribe: Function;
}): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const events: unknown[] = [];
    observable.subscribe({
      next: (event: unknown) => events.push(event),
      error: reject,
      complete: () => resolve(events),
    });
  });
}

describe('CopilotKit canonical sub-op span capture', () => {
  type SubOpInput = OpenBoxCopilotActionInput & {
    action: 'demo_action';
    request: string;
  };

  function subOpAdapter() {
    const mock = createMockCore(() => ({ verdict: 'allow', reason: 'allowed' }));
    const adapter = createOpenBoxCopilotKitAdapter({
      core: mock.core as any,
      workflowType: 'CopilotKitTestWorkflow',
      taskQueue: 'langgraph',
    });
    return { mock, adapter };
  }

  function hookSpans(events: GovernanceEventPayload[]): Record<string, any>[] {
    return events
      .filter((event) => event.hook_trigger === true)
      .flatMap((event) => (event.spans ?? []) as Record<string, any>[]);
  }

  it('captures a non-LLM HTTP sub-operation as an http_request span pair', async () => {
    const { mock, adapter } = subOpAdapter();
    const baseFetch = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const instrumented = createInstrumentedFetch(baseFetch);
    const tool = createGovernedCopilotTool<SubOpInput, { body: string }>({
      adapter,
      toolName: 'openbox_governed_action',
      execute: async (input) => {
        await instrumented('https://api.example.com/widgets', {
          method: 'POST',
          headers: {
            authorization: 'Bearer secret',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ q: input.request }),
        });
        return { body: input.request };
      },
    });

    await tool.execute({ action: 'demo_action', request: 'fetch widgets' });

    const spans = hookSpans(mock.events).filter(
      (span) => span.hook_type === 'http_request',
    );
    const started = spans.find((span) => span.stage === 'started');
    const completed = spans.find((span) => span.stage === 'completed');
    expect(started).toBeDefined();
    expect(completed).toBeDefined();
    expect(started?.span_id).toBe(completed?.span_id);
    expect(String(completed?.http_url)).toContain('api.example.com');
    // Sensitive request headers are redacted on the captured span (the SDK keeps
    // the auth scheme and redacts the secret).
    expect(completed?.request_headers.authorization).toBe('[REDACTED]');
  });

  it('captures a traced function as a function_call span pair', async () => {
    const { mock, adapter } = subOpAdapter();
    const compute = traced('compute_total', (n: number) => n * 2);
    const tool = createGovernedCopilotTool<SubOpInput, { body: string }>({
      adapter,
      toolName: 'openbox_governed_action',
      execute: async (input) => {
        compute(21);
        return { body: input.request };
      },
    });

    await tool.execute({ action: 'demo_action', request: 'compute' });

    const spans = hookSpans(mock.events).filter(
      (span) => span.name === 'compute_total',
    );
    const started = spans.find((span) => span.stage === 'started');
    const completed = spans.find((span) => span.stage === 'completed');
    expect(started?.hook_type).toBe('function_call');
    expect(started?.span_id).toBe(completed?.span_id);
  });

  it('emits zero spans when execute() performs no instrumented sub-operation', async () => {
    const { mock, adapter } = subOpAdapter();
    const tool = createGovernedCopilotTool<SubOpInput, { body: string }>({
      adapter,
      toolName: 'openbox_governed_action',
      execute: async (input) => ({ body: input.request }),
    });

    await tool.execute({ action: 'demo_action', request: 'no io' });

    const allSpans = mock.events.flatMap(
      (event) => (event.spans ?? []) as unknown[],
    );
    expect(allSpans).toEqual([]);
  });

  it('captured span pairs carry canonical field shapes (ids, timing, redaction, truncation)', async () => {
    const { mock, adapter } = subOpAdapter();
    const baseFetch = (async () =>
      new Response('x'.repeat(9000), {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })) as unknown as typeof fetch;
    const instrumented = createInstrumentedFetch(baseFetch);
    const tool = createGovernedCopilotTool<SubOpInput, { body: string }>({
      adapter,
      toolName: 'openbox_governed_action',
      execute: async (input) => {
        await instrumented('https://api.example.com/big', {
          method: 'POST',
          headers: { cookie: 'session=abc', 'content-type': 'text/plain' },
          body: 'y'.repeat(9000),
        });
        return { body: input.request };
      },
    });

    await tool.execute({ action: 'demo_action', request: 'big' });

    const spans = hookSpans(mock.events).filter(
      (span) => span.hook_type === 'http_request',
    );
    const started = spans.find((span) => span.stage === 'started');
    const completed = spans.find((span) => span.stage === 'completed');
    // 16-hex span_id, 32-hex trace_id.
    expect(started?.span_id).toMatch(/^[0-9a-f]{16}$/);
    expect(started?.trace_id).toMatch(/^[0-9a-f]{32}$/);
    // started has no end/duration; completed has numeric end/duration.
    expect(started?.end_time ?? null).toBeNull();
    expect(started?.duration_ns ?? null).toBeNull();
    expect(typeof completed?.end_time).toBe('number');
    expect(typeof completed?.duration_ns).toBe('number');
    // Sensitive header redaction (SDK convention).
    expect(completed?.request_headers.cookie).toBe('[REDACTED]');
    // Body truncation at 8192 with the literal suffix.
    expect(String(started?.request_body)).toContain('...[truncated]');
    expect(String(started?.request_body).length).toBeLessThanOrEqual(
      8192 + '...[truncated]'.length,
    );
  });
});
