import { describe, expect, it, vi } from 'vitest';
import {
  createOpenBoxCopilotRuntime,
  createOpenBoxGovernedRunner,
  createOpenBoxRuntimeHooks,
  createGovernedCopilotTool,
  createOpenBoxCopilotKitAdapter,
  createOpenBoxApprovalRoute,
  createOpenBoxReadinessCheck,
  OpenBoxCopilotKitError,
  type OpenBoxCopilotActionInput,
} from '../../ts/src/copilotkit/index';
import {
  createOpenBoxCustomMessageRenderer,
  useOpenBoxCopilotKit,
} from '../../ts/src/copilotkit/react';
import type { GovernanceEventPayload } from '../../ts/src/core-client/index';

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
    const useDefaultRenderTool = vi.fn();
    const useRenderTool = vi.fn();

    const result = useOpenBoxCopilotKit({
      bindings: {
        useHumanInTheLoop,
        useDefaultRenderTool,
        useRenderTool,
      },
    });

    expect(result.governedToolNames).toContain('openbox_governed_action');
    expect(useHumanInTheLoop).toHaveBeenCalledTimes(2);
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
  });

  it('maps fail-closed errors to Governance Unavailable, never to a Blocked verdict', async () => {
    const { verdictFromResult } = await import(
      '../../ts/src/copilotkit/react-governance-decision'
    );
    const { verdictStyles } = await import(
      '../../ts/src/copilotkit/react-defaults'
    );
    const scenario = {
      action: 'open_revenue_queue',
      title: 'Operations Queue',
      reason: 'reason',
      capability: 'Runtime policy',
      verdict: 'allow' as const,
    };

    const errorVerdict = verdictFromResult(
      { status: 'error', verdict: 'block', reason: 'Request failed: 500' },
      scenario,
    );
    expect(errorVerdict).toBe('error');
    expect(verdictStyles.error.label).toBe('Governance Unavailable');
    // A real policy block still maps to the Blocked verdict.
    expect(
      verdictFromResult({ status: 'blocked', verdict: 'block' }, scenario),
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
    process.env.OPENBOX_API_KEY = 'obx_test_runtime';
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
    process.env.OPENBOX_API_KEY = 'obx_test_runtime';
    process.env.OPENBOX_CORE_URL = 'http://127.0.0.1:8086';
    process.env.OPENBOX_AGENT_DID = 'did:openbox:agent:test';
    process.env.OPENBOX_AGENT_PRIVATE_KEY = 'a'.repeat(44);

    try {
      const client = createOpenBoxCopilotKitAdapter().getCoreClient() as any;
      expect(client.config.agentIdentity).toEqual({
        did: 'did:openbox:agent:test',
        privateKey: 'a'.repeat(44),
      });
    } finally {
      restoreEnv(previous);
    }
  });

  it('passes explicit Core timeout into the runtime Core client', () => {
    const adapter = createOpenBoxCopilotKitAdapter({
      apiKey: 'obx_test_runtime',
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
    process.env.OPENBOX_API_KEY = 'obx_test_runtime';
    process.env.OPENBOX_CORE_URL = 'http://127.0.0.1:8086';
    process.env.OPENBOX_AGENT_DID = 'did:openbox:agent:test';
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

  it('treats Core output guardrail transforms as constrained without legacy placeholders', async () => {
    const { tool } = createDemoTool((payload) => {
      if (payload.event_type !== 'ActivityCompleted') {
        return {
          governance_event_id: 'event-start',
          verdict: 'allow',
          action: 'allow',
          risk_score: 0,
          fallback_used: false,
        };
      }
      return {
        governance_event_id: 'event-complete',
        verdict: 'allow',
        action: 'allow',
        risk_score: 0,
        fallback_used: false,
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

    expect(result.status).toBe('constrained');
    expect(result.verdict).toBe('constrain');
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
      'WorkflowStarted',
      'SignalReceived',
      'ActivityStarted',
      'ActivityCompleted',
      'WorkflowCompleted',
    ]);
    expect(events.filter((event) => event.hook_trigger)).toHaveLength(0);
    expect(events[1]).toMatchObject({
      event_type: 'SignalReceived',
      signal_name: 'user_prompt',
      signal_args: 'Create a support ticket.',
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
        event.event_type === 'ActivityCompleted' &&
        event.hook_trigger === true &&
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
      'ActivityCompleted',
      'WorkflowCompleted',
    ]);
    expect(completionParent?.hook_trigger).toBeUndefined();
    expect(completionParent?.spans).toBeUndefined();
    expect(completionHook?.hook_trigger).toBe(true);
    expect(completionHook?.span_count).toBe(1);
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
      'WorkflowStarted',
      'SignalReceived',
      'ActivityStarted',
      'WorkflowFailed',
    ]);
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
      'WorkflowStarted',
      'SignalReceived',
      'ActivityStarted',
      'WorkflowFailed',
      'ActivityStarted',
      'WorkflowFailed',
    ]);
  });

  it('blocks a prompt before the model handler runs', async () => {
    const mock = createMockCore((payload) => ({
      verdict:
        payload.activity_type === 'on_chat_model_start' ? 'block' : 'allow',
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

    expect(handler).not.toHaveBeenCalled();
    expect(result.content).toBe('');
    expect(mock.events).toEqual([]);
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

    await middleware.wrapModelCall(
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
            fallback_used: false,
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
        content: 'The queue has two governed requests ready.',
        response_metadata: {
          model_name: 'gpt-4o-mini',
          tokenUsage: {
            promptTokens: 42,
            completionTokens: 16,
            totalTokens: 58,
          },
        },
      }),
    );

    const completedParent = mock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'on_llm_end' &&
        event.hook_trigger !== true,
    );
    const completed = mock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'on_llm_end' &&
        event.hook_trigger,
    );
    expect(completedParent).toMatchObject({
      llm_model: 'gpt-4o-mini',
      input_tokens: 42,
      output_tokens: 16,
      total_tokens: 58,
      completion: 'The queue has two governed requests ready.',
    });
    expect(completedParent?.spans).toBeUndefined();
    expect(completedParent?.span_count).toBeUndefined();
    expect(completed?.status).toBe('completed');
    expect(completed?.span_count).toBe(1);
    const span = completed?.spans?.[0] as Record<string, any> | undefined;
    expect(span).toMatchObject({
      stage: 'completed',
      semantic_type: 'llm_completion',
      attributes: {
        'gen_ai.system': 'copilotkit',
        'http.method': 'POST',
        'http.url': 'https://api.openai.com/v1/chat/completions',
      },
    });
    expect(JSON.parse(String(span?.response_body))).toEqual({
      choices: [
        {
          message: {
            content: 'The queue has two governed requests ready.',
          },
        },
      ],
      model: 'gpt-4o-mini',
      usage: {
        prompt_tokens: 42,
        input_tokens: 42,
        completion_tokens: 16,
        output_tokens: 16,
        total_tokens: 58,
      },
    });
    expect(
      mock.events.some(
        (event) =>
          event.event_type === 'ActivityCompleted' &&
          event.activity_type === undefined &&
          event.hook_trigger,
      ),
    ).toBe(false);
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
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'crm_lookup' &&
        event.hook_trigger === true &&
        event.activity_id === startedParent?.activity_id,
    );

    expect(startedParent?.hook_trigger).toBeUndefined();
    expect(startedParent?.spans).toBeUndefined();
    expect(startedParent).toMatchObject({
      tool_name: 'crm_lookup',
      tool_type: 'llm_tool_call',
    });
    expect(startedParent?.activity_input).toContainEqual({
      __openbox: { tool_type: 'llm_tool_call' },
    });
    expect(completedParent?.hook_trigger).toBeUndefined();
    expect(completedParent?.spans).toBeUndefined();
    expect(completedParent).toMatchObject({
      tool_name: 'crm_lookup',
      tool_type: 'llm_tool_call',
    });
    expect(started?.hook_trigger).toBe(true);
    expect(completed?.hook_trigger).toBe(true);
    expect(started?.span_count).toBe(1);
    expect(completed?.span_count).toBe(1);
    expect(started?.spans?.[0]).toMatchObject({
      stage: 'started',
      semantic_type: 'llm_tool_call',
      attributes: expect.objectContaining({
        'openbox.tool.name': 'crm_lookup',
        'tool.name': 'crm_lookup',
      }),
    });
    expect(completed?.spans?.[0]).toMatchObject({
      stage: 'completed',
      semantic_type: 'llm_tool_call',
      attributes: expect.objectContaining({
        'openbox.tool.name': 'crm_lookup',
        'tool.name': 'crm_lookup',
      }),
    });
    expect(completed?.activity_output).toEqual({
      ok: true,
      accountTier: 'enterprise',
    });
  });

  it('passes Core AGE metadata through assistant output governance results', async () => {
    const ageResult = {
      allowed: true,
      verdict: 'allow',
      fallback_used: false,
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
      age_result: payload.hook_trigger ? ageResult : undefined,
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
      fallback_used: false,
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

  it('lets governed tools attach consumer span profiles', async () => {
    const mock = createMockCore(() => ({
      verdict: 'allow',
      reason: 'allowed',
    }));
    const adapter = createOpenBoxCopilotKitAdapter({ core: mock.core as any });
    const tool = createGovernedCopilotTool<DemoInput, DemoArtifact>({
      adapter,
      toolName: 'openbox_governed_action',
      execute: async (input) => ({ body: input.request }),
      spanProfile: () => ({
        name: 'business.queue.review',
        kind: 'client',
        attributes: {
          'openbox.operation': 'review_queue',
        },
      }),
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
    expect(started?.activity_input).toContainEqual({
      __openbox: { tool_type: 'llm_tool_call' },
    });
    const span = started?.spans?.[0] as Record<string, any> | undefined;
    expect(span).toMatchObject({
      name: 'business.queue.review',
      kind: 'client',
      attributes: expect.objectContaining({
        'openbox.action': 'demo_action',
        'openbox.operation': 'review_queue',
      }),
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
      activityType: 'on_chat_model_start',
    });

    expect(mock.events.map((event) => event.event_type)).toEqual([
      'WorkflowStarted',
      'SignalReceived',
      'ActivityStarted',
      'ActivityCompleted',
    ]);
    expect(mock.events[1]).toMatchObject({
      signal_name: 'user_prompt',
      signal_args: 'Open the revenue queue.',
    });
    // The allowed input gate is paired under one activity id.
    expect(mock.events[3].activity_id).toBe(mock.events[2].activity_id);
    expect(mock.events[0].workflow_id).toBe(mock.events[2].workflow_id);
    expect(mock.events[0].run_id).toBe(mock.events[2].run_id);
    expect(mock.events[0].run_id).not.toBe(mock.events[0].workflow_id);
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
      activityType: 'on_chat_model_start',
    });

    expect(mock.events.map((event) => event.event_type)).toEqual([
      'WorkflowStarted',
      'SignalReceived',
      'ActivityStarted',
      'ActivityCompleted',
    ]);
    expect(mock.events[1]).toMatchObject({
      event_type: 'SignalReceived',
      activity_type: 'user_prompt',
      signal_name: 'user_prompt',
      signal_args: 'Draft a renewal follow-up for the customer.',
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
      activityType: 'on_chat_model_start',
    });

    expect(result.status).toBe('error');
    expect(result.verdict.reason).toContain('503 Service Unavailable');
    expect(mock.events.map((event) => event.event_type)).toEqual([
      'WorkflowStarted',
      'SignalReceived',
      'ActivityStarted',
      'WorkflowFailed',
    ]);
    expect(mock.events[3].workflow_id).toBe(mock.events[0].workflow_id);
    expect(mock.events[3].run_id).toBe(mock.events[0].run_id);
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
    expect(governedBody.state.__openboxRuntimePromptGoverned).toBe(true);
    expect(mock.events.map((event) => event.event_type)).toEqual([
      'WorkflowStarted',
      'SignalReceived',
      'ActivityStarted',
      'ActivityCompleted',
    ]);
    expect(mock.events[1]).toMatchObject({
      signal_name: 'user_prompt',
      signal_args: 'Open the revenue queue.',
    });
    expect(mock.events[0].workflow_id).toBe(
      governedBody.state.openboxWorkflowId,
    );
    expect(mock.events[0].run_id).toBe(governedBody.state.openboxRunId);
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
      activityType: 'on_chat_model_start',
      ensureWorkflowStarted: true,
    });

    expect(result.status).toBe('executed');
    expect(events.map((event) => event.event_type)).toEqual([
      'WorkflowStarted',
      'SignalReceived',
      'ActivityStarted',
      'ActivityCompleted',
    ]);
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
      activityType: 'on_chat_model_start',
      ensureWorkflowStarted: true,
    };

    await adapter.governPrompt(input);
    await adapter.governPrompt(input);

    expect(events.map((event) => event.event_type)).toEqual([
      'WorkflowStarted',
      'SignalReceived',
      'ActivityStarted',
      'ActivityCompleted',
      'SignalReceived',
      'ActivityStarted',
      'ActivityCompleted',
    ]);
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
        payload.activity_type === 'on_chat_model_start'
          ? {
              input_type: 'activity_input',
              redacted_input: {
                messages: [{ content: 'Show [REDACTED_EMAIL].' }],
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
      verdict: payload.activity_type === 'on_llm_end' ? 'block' : 'allow',
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
      verdict: payload.activity_type === 'on_llm_end' ? 'constrain' : 'allow',
      reason: 'assistant output constrained',
      guardrails_result:
        payload.activity_type === 'on_llm_end'
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
        payload.activity_type === 'UserPromptSubmit' ||
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
    ).toEqual(['UserPromptSubmit', 'safe_tool']);
  });

  it('pauses on approval-required prompt verdict without calling the model', async () => {
    const mock = createMockCore((payload) => ({
      verdict:
        payload.activity_type === 'on_chat_model_start'
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
        payload.activity_type === 'on_chat_model_start' ? 'block' : 'allow',
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
      'WorkflowStarted',
      'SignalReceived',
      'ActivityStarted',
      'ActivityCompleted',
      'WorkflowCompleted',
    ]);
    expect(mock.events.at(-1)).toMatchObject({
      workflow_type: 'CopilotKitRuntime',
      task_queue: 'copilotkit-runtime',
    });
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
      'WorkflowStarted',
      'SignalReceived',
      'ActivityStarted',
      'ActivityCompleted',
      'WorkflowFailed',
    ]);
  });

  it('native runner redacts prompt input before the CopilotKit runner executes', async () => {
    const mock = createMockCore((payload) => ({
      verdict: 'constrain',
      reason: 'runtime prompt constrained',
      guardrails_result:
        payload.activity_type === 'on_chat_model_start'
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
      verdict: payload.activity_type === 'on_llm_end' ? 'constrain' : 'allow',
      reason: 'final output constrained',
      guardrails_result:
        payload.activity_type === 'on_llm_end'
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
      verdict: payload.activity_type === 'on_llm_end' ? 'block' : 'allow',
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
      'WorkflowFailed',
    );
    expect(mock.events.map((event) => event.event_type)).not.toContain(
      'WorkflowCompleted',
    );
  });

  it('native runner redacts custom non-text final AG-UI payloads before emit', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.activity_type === 'on_llm_end' ? 'constrain' : 'allow',
      reason: 'custom final output constrained',
      guardrails_result:
        payload.activity_type === 'on_llm_end'
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
      verdict: payload.activity_type === 'on_llm_end' ? 'constrain' : 'allow',
      reason: 'named custom final output constrained',
      guardrails_result:
        payload.activity_type === 'on_llm_end'
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
      verdict: payload.activity_type === 'on_llm_end' ? 'block' : 'allow',
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
    expect(types[0]).toBe('WorkflowStarted');
    expect(types[types.length - 1]).toBe('WorkflowCompleted');
    expect(
      mock.events.filter((event) => event.event_type === 'WorkflowStarted'),
    ).toHaveLength(1);
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
