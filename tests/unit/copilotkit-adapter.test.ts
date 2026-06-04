import { describe, expect, it, vi } from 'vitest';
import {
  createOpenBoxGovernedRunner,
  createGovernedCopilotTool,
  createOpenBoxCopilotKitAdapter,
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

function createDemoTool(resolve: (payload: GovernanceEventPayload) => Record<string, unknown>) {
  const mock = createMockCore(resolve);
  const adapter = createOpenBoxCopilotKitAdapter({
    core: mock.core as any,
    workflowType: 'CopilotKitTestWorkflow',
    taskQueue: 'langgraph',
  });
  const execute = vi.fn(async (input: DemoInput): Promise<DemoArtifact> => ({
    body: input.request,
  }));
  const tool = createGovernedCopilotTool<DemoInput, DemoArtifact>({
    adapter,
    toolName: 'openbox_governed_action',
    description: 'Test governed action.',
    execute,
    isArtifactRedacted: (artifact) => artifact?.body.includes('[REDACTED') ?? false,
    markArtifactRedacted: (artifact) => artifact,
  });
  return { ...mock, execute, tool };
}

describe('CopilotKit OpenBox adapter', () => {
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
      verdict: payload.event_type === 'ActivityCompleted' ? 'constrain' : 'allow',
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
    const { execute, tool } = createDemoTool((payload) => ({
      verdict: payload.event_type === 'ActivityStarted' ? 'halt' : 'allow',
      reason: 'production action halted',
    }));
    const config = { configurable: { thread_id: 'halted-thread' } };

    const first = await tool.execute({
      action: 'demo_action',
      request: 'Stop production payments.',
    }, config);
    const second = await tool.execute({
      action: 'demo_action',
      request: 'Create a support ticket.',
    }, config);

    expect(first.status).toBe('halted');
    expect(second.status).toBe('session_halted');
    expect(second.reason).toBe('production action halted');
    expect(execute).not.toHaveBeenCalled();
  });

  it('blocks a prompt before the model handler runs', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.activity_type === 'on_chat_model_start' ? 'block' : 'allow',
      reason: 'prompt blocked',
    }));
    const middleware = createOpenBoxCopilotKitAdapter({ core: mock.core as any })
      .createLangChainMiddleware(createMiddlewareDeps()) as any;
    const handler = vi.fn(async () => ({ content: 'should not run' }));

    const result = await middleware.wrapModelCall({
      messages: [{ type: 'human', content: 'Export secrets.' }],
      state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
    }, handler);

    expect(handler).not.toHaveBeenCalled();
    expect(JSON.parse(result.content).status).toBe('blocked');
  });

  it('applies prompt redaction before the model handler runs', async () => {
    const mock = createMockCore((payload) => ({
      verdict: 'constrain',
      reason: 'prompt constrained',
      guardrails_result:
        payload.activity_type === 'on_chat_model_start'
          ? {
              input_type: 'activity_input',
              redacted_input: { messages: [{ content: 'Show [REDACTED_EMAIL].' }] },
              results: [{ results: [{ field: 'input.messages.0.content', status: 'transformed' }] }],
            }
          : undefined,
    }));
    const middleware = createOpenBoxCopilotKitAdapter({ core: mock.core as any })
      .createLangChainMiddleware(createMiddlewareDeps()) as any;
    const handler = vi.fn(async (request) => ({ content: request.messages[0].content }));

    const result = await middleware.wrapModelCall({
      messages: [{ type: 'human', content: 'Show alice@example.com.' }],
      state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
    }, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('Show [REDACTED_EMAIL].');
  });

  it('blocks a tool input before non-OpenBox tool execution', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.activity_type === 'on_tool_start' ? 'block' : 'allow',
      reason: 'tool input blocked',
    }));
    const middleware = createOpenBoxCopilotKitAdapter({ core: mock.core as any })
      .createLangChainMiddleware(createMiddlewareDeps()) as any;
    const handler = vi.fn(async () => ({ ok: true }));

    const result = await middleware.wrapToolCall({
      toolCall: { name: 'send_email', args: { to: 'personal Gmail' } },
      state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
    }, handler);

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
              results: [{ results: [{ field: 'output.artifact.crmPayload.contacts.0.email', status: 'transformed' }] }],
            }
          : undefined,
    }));
    const middleware = createOpenBoxCopilotKitAdapter({ core: mock.core as any })
      .createLangChainMiddleware(createMiddlewareDeps()) as any;

    const result = await middleware.wrapToolCall({
      toolCall: { name: 'crm_lookup', args: {} },
      state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
    }, async () => ({
      artifact: {
        crmPayload: {
          contacts: [{ email: 'alice@example.com', name: 'Alice' }],
        },
      },
    }));

    expect(result.artifact.crmPayload.contacts[0].email).toBe('[REDACTED_EMAIL]');
    expect(result.artifact.crmPayload.contacts[0].name).toBe('Alice');
  });

  it('blocks unsafe final assistant output before it is returned', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.activity_type === 'on_llm_end' ? 'block' : 'allow',
      reason: 'assistant output blocked',
    }));
    const middleware = createOpenBoxCopilotKitAdapter({ core: mock.core as any })
      .createLangChainMiddleware(createMiddlewareDeps()) as any;

    const result = await middleware.wrapModelCall({
      messages: [{ type: 'human', content: 'Summarize.' }],
      state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
    }, async () => ({ content: 'alice@example.com' }));

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
              results: [{ results: [{ field: 'output.content', status: 'transformed' }] }],
            }
          : undefined,
    }));
    const middleware = createOpenBoxCopilotKitAdapter({ core: mock.core as any })
      .createLangChainMiddleware(createMiddlewareDeps()) as any;

    const result = await middleware.wrapModelCall({
      messages: [{ type: 'human', content: 'Summarize.' }],
      state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
    }, async () => ({ content: 'alice@example.com' }));

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
      verdict: payload.activity_type === 'on_chat_model_start' ? 'require_approval' : 'allow',
      reason: 'approval required',
      governance_event_id: 'event-1',
      approval_id: 'approval-1',
    }));
    const middleware = createOpenBoxCopilotKitAdapter({ core: mock.core as any })
      .createLangChainMiddleware(createMiddlewareDeps()) as any;
    const handler = vi.fn(async () => ({ content: 'should not run' }));

    const result = await middleware.wrapModelCall({
      messages: [{ type: 'human', content: 'Move money.' }],
      state: { openboxWorkflowId: 'wf', openboxRunId: 'run' },
    }, handler);

    expect(handler).not.toHaveBeenCalled();
    expect(JSON.parse(result.content).status).toBe('approval_required');
  });

  it('native runner blocks a prompt before the CopilotKit runner executes', async () => {
    const mock = createMockCore((payload) => ({
      verdict: payload.activity_type === 'on_chat_model_start' ? 'block' : 'allow',
      reason: 'runtime prompt blocked',
    }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    const events = await collectObservable(runner.run({
      threadId: 'thread-1',
      agent: {},
      input: {
        threadId: 'thread-1',
        runId: 'run-1',
        messages: [{ id: 'user-1', role: 'user', content: 'Export secrets.' }],
      },
    }));

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
                messages: [{ id: 'user-1', role: 'user', content: 'Show [REDACTED_EMAIL].' }],
              },
              results: [{ results: [{ field: 'input.messages.0.content', status: 'transformed' }] }],
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

    await collectObservable(runner.run({
      threadId: 'thread-1',
      agent: {},
      input: {
        threadId: 'thread-1',
        runId: 'run-1',
        messages: [{ id: 'user-1', role: 'user', content: 'Show alice@example.com.' }],
      },
    }));

    expect(baseRunner.run).toHaveBeenCalledTimes(1);
    expect(baseRunner.lastInput.messages[0].content).toBe('Show [REDACTED_EMAIL].');
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
              results: [{ results: [{ field: 'output.content', status: 'transformed' }] }],
            }
          : undefined,
    }));
    const baseRunner = createFakeRunner([
      { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' },
      { type: 'TEXT_MESSAGE_START', messageId: 'assistant-1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-1', delta: 'Contact alice@example.com.' },
      { type: 'TEXT_MESSAGE_END', messageId: 'assistant-1' },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    const events = await collectObservable(runner.run({
      threadId: 'thread-1',
      agent: {},
      input: {
        threadId: 'thread-1',
        runId: 'run-1',
        messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
      },
    }));

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
      { type: 'TEXT_MESSAGE_START', messageId: 'assistant-1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'assistant-1', delta: 'Contact alice@example.com.' },
      { type: 'TEXT_MESSAGE_END', messageId: 'assistant-1' },
      { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' },
    ]);
    const runner = createOpenBoxGovernedRunner(baseRunner, {
      adapter: createOpenBoxCopilotKitAdapter({ core: mock.core as any }),
    });

    const events = await collectObservable(runner.run({
      threadId: 'thread-1',
      agent: {},
      input: {
        threadId: 'thread-1',
        runId: 'run-1',
        messages: [{ id: 'user-1', role: 'user', content: 'Summarize.' }],
      },
    }));

    expect(JSON.stringify(events)).toContain('final output blocked');
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
          const observer = typeof observerOrNext === 'function'
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

function collectObservable(observable: { subscribe: Function }): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const events: unknown[] = [];
    observable.subscribe({
      next: (event: unknown) => events.push(event),
      error: reject,
      complete: () => resolve(events),
    });
  });
}
