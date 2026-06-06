import { describe, expect, it, vi } from 'vitest';
import {
  createOpenBoxGovernedRunner,
  createOpenBoxRuntimeHooks,
  createGovernedCopilotTool,
  createOpenBoxCopilotKitAdapter,
  createOpenBoxApprovalRoute,
  createOpenBoxReadinessCheck,
  type OpenBoxCopilotActionInput,
} from '../../ts/src/copilotkit/index';
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
  it('runtime Core client only needs OPENBOX_CORE_URL and OPENBOX_API_KEY', () => {
    const previous = {
      OPENBOX_API_KEY: process.env.OPENBOX_API_KEY,
      OPENBOX_API_URL: process.env.OPENBOX_API_URL,
      OPENBOX_CORE_URL: process.env.OPENBOX_CORE_URL,
      OPENBOX_AGENT_ID: process.env.OPENBOX_AGENT_ID,
      OPENBOX_PLATFORM_API_KEY: process.env.OPENBOX_PLATFORM_API_KEY,
    };
    process.env.OPENBOX_API_KEY = 'obx_test_runtime';
    process.env.OPENBOX_CORE_URL = 'http://127.0.0.1:8086';
    delete process.env.OPENBOX_API_URL;
    delete process.env.OPENBOX_AGENT_ID;
    delete process.env.OPENBOX_PLATFORM_API_KEY;

    try {
      expect(() =>
        createOpenBoxCopilotKitAdapter().getCoreClient(),
      ).not.toThrow();
    } finally {
      restoreEnv(previous);
    }
  });

  it('approval route decides through Core without backend config', async () => {
    const previous = {
      OPENBOX_API_URL: process.env.OPENBOX_API_URL,
      OPENBOX_BACKEND_API_KEY: process.env.OPENBOX_BACKEND_API_KEY,
      OPENBOX_AGENT_ID: process.env.OPENBOX_AGENT_ID,
    };
    delete process.env.OPENBOX_API_URL;
    delete process.env.OPENBOX_BACKEND_API_KEY;
    delete process.env.OPENBOX_AGENT_ID;
    const core = {
      decideApproval: vi.fn(async () => ({
        id: 'event-1',
        action: 'allow',
        decided_by: 'agent-runtime:agent-1',
        decided_at: new Date().toISOString(),
      })),
    };

    try {
      const route = createOpenBoxApprovalRoute({ core: core as any });
      const result = await route.decide({
        governanceEventId: 'event-1',
        decision: 'approve',
      });

      expect(result).toEqual({
        ok: true,
        decision: 'approve',
        eventId: 'event-1',
      });
      expect(core.decideApproval).toHaveBeenCalledWith({
        governance_event_id: 'event-1',
        workflow_id: undefined,
        run_id: undefined,
        activity_id: undefined,
        decision: 'approve',
      });
    } finally {
      restoreEnv(previous);
    }
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
          decideApproval: vi.fn(),
        } as any,
      }).check();

      expect(result.ok).toBe(true);
      expect(result.core).toBe(true);
      expect(result.capabilities.promptGovernance).toBe(true);
      expect(result.capabilities.finalOutputGovernance).toBe(true);
      expect(result.capabilities.approvals).toBe(true);
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
      'ActivityStarted',
      'ActivityCompleted',
      'WorkflowCompleted',
    ]);
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

  it('remembers a halt verdict for the runtime session', async () => {
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
    expect(second.status).toBe('session_halted');
    expect(second.reason).toBe('production action halted');
    expect(execute).not.toHaveBeenCalled();
    expect(events.map((event) => event.event_type)).toEqual([
      'WorkflowStarted',
      'ActivityStarted',
      'WorkflowCompleted',
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
      (event) => event.event_type === 'ActivityStarted',
    );
    expect(JSON.stringify(started).length).toBeLessThan(64_000);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].messages[0].content).toBe(hugeSchema);
    expect(handler.mock.calls[0][0].messages[1].content).toBe(userText);
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
      'ActivityStarted',
    ]);
    expect(mock.events[0].workflow_id).toBe(mock.events[1].workflow_id);
    expect(mock.events[0].run_id).toBe(mock.events[1].run_id);
    expect(mock.events[0].run_id).not.toBe(mock.events[0].workflow_id);
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
      'ActivityStarted',
    ]);
    expect(mock.events[0].workflow_id).toBe(
      governedBody.state.openboxWorkflowId,
    );
    expect(mock.events[0].run_id).toBe(governedBody.state.openboxRunId);
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
      'ActivityStarted',
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
      'ActivityStarted',
      'ActivityStarted',
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
      verdict: payload.activity_type === 'on_tool_start' ? 'block' : 'allow',
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
  });

  it('applies generic nested tool output redaction before returning the result', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.activity_type === 'on_tool_end' ? 'constrain' : 'allow',
      reason: 'tool output constrained',
      guardrails_result:
        payload.activity_type === 'on_tool_end'
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

  it('halts later gates in the same session after a halt verdict', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.activity_type === 'UserPromptSubmit' ? 'halt' : 'allow',
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
    expect(second.status).toBe('session_halted');
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

function createFakeRunner(events: Record<string, unknown>[]) {
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
            observer?.complete?.();
          });
          return { unsubscribe() {} };
        },
      };
    }),
  };
  return runner;
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
