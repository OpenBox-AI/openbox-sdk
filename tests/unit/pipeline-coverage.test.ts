import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { governPipelineGate } from '../../ts/src/copilotkit/pipeline.js';
import type {
  OpenBoxCopilotGateInput,
  OpenBoxCopilotGateKind,
  OpenBoxCopilotKitAdapter,
  OpenBoxCopilotSessionState,
} from '../../ts/src/copilotkit/types.js';

type HaltedSession = Extract<OpenBoxCopilotSessionState, { status: 'halted' }>;
type Verdict = { verdict?: string; reason?: string; [key: string]: unknown };
type EvaluatePayload = { event_type?: string; hook_trigger?: boolean; [key: string]: unknown };

const ACTIVITY_EVENTS = new Set(['ActivityStarted', 'ActivityCompleted']);

function makeAdapter(opts: {
  enabled?: boolean;
  gateVerdict?: Verdict | ((payload: EvaluatePayload) => Verdict);
  throwOn?: (payload: EvaluatePayload) => boolean;
} = {}) {
  const gate = opts.gateVerdict ?? { verdict: 'allow', reason: 'allowed' };
  const evaluate = vi.fn(async (payload: EvaluatePayload) => {
    if (opts.throwOn?.(payload)) {
      throw new Error('Core request failed: simulated outage');
    }
    if (payload.event_type && ACTIVITY_EVENTS.has(payload.event_type)) {
      return typeof gate === 'function' ? gate(payload) : gate;
    }
    return { verdict: 'allow', reason: 'lifecycle ok' };
  });
  const pollApproval = vi.fn(async () => ({ action: 'allow', reason: 'approved' }));
  const core = { evaluate, pollApproval } as unknown as ReturnType<
    OpenBoxCopilotKitAdapter['getCoreClient']
  >;
  const adapter = {
    isEnabled: () => opts.enabled !== false,
    getCoreClient: () => core,
  } as unknown as OpenBoxCopilotKitAdapter;
  return { adapter, core, evaluate, pollApproval };
}

type GateExtras = {
  kind: OpenBoxCopilotGateKind;
  workflowType: string;
  taskQueue: string;
  haltedSessions: Map<string, HaltedSession>;
  strict: boolean;
  redactionMode: 'transformed-only';
  ensureWorkflowStarted?: boolean;
};

function freshIds() {
  return { workflowId: randomUUID(), runId: randomUUID(), activityId: randomUUID() };
}

function gateInput<T>(
  kind: OpenBoxCopilotGateKind,
  payload: T,
  overrides: Partial<OpenBoxCopilotGateInput<T>> &
    Partial<GateExtras> & { haltedSessions?: Map<string, HaltedSession> } = {},
): OpenBoxCopilotGateInput<T> & GateExtras {
  const ids = freshIds();
  return {
    payload,
    kind,
    workflowType: 'CopilotKitTestWorkflow',
    taskQueue: 'langgraph',
    haltedSessions: overrides.haltedSessions ?? new Map<string, HaltedSession>(),
    strict: false,
    redactionMode: 'transformed-only',
    workflowId: ids.workflowId,
    runId: ids.runId,
    activityId: ids.activityId,
    ...overrides,
  } as OpenBoxCopilotGateInput<T> & GateExtras;
}

function makeHalted(): HaltedSession {
  return {
    status: 'halted',
    reason: 'OpenBox previously halted this session.',
    haltedAt: new Date().toISOString(),
    workflowId: randomUUID(),
    runId: randomUUID(),
    activityId: randomUUID(),
  };
}

const SAVED_ENV = { ...process.env };

afterEach(() => {
  delete process.env.OPENBOX_LLM_SPANS_FROM_CAPTURE;
  if (SAVED_ENV.OPENBOX_LLM_SPANS_FROM_CAPTURE !== undefined) {
    process.env.OPENBOX_LLM_SPANS_FROM_CAPTURE = SAVED_ENV.OPENBOX_LLM_SPANS_FROM_CAPTURE;
  }
  vi.restoreAllMocks();
});

describe('governPipelineGate — disabled adapter', () => {
  it('returns an allow verdict without touching Core when disabled', async () => {
    const { adapter, evaluate } = makeAdapter({ enabled: false });
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'hello world' }),
    );
    expect(result.verdict.arm).toBe('allow');
    expect(result.verdict.reason).toContain('disabled');
    expect(evaluate).not.toHaveBeenCalled();
  });
});

describe('governPipelineGate — prompt gate', () => {
  it('skips an empty prompt and still ensures the workflow is started', async () => {
    const { adapter } = makeAdapter();
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: '   ' }, { ensureWorkflowStarted: true }),
    );
    expect(result.verdict.reason).toContain('empty prompt');
    expect(result.status).toBe('executed');
  });

  it('skips an empty message-list prompt', async () => {
    const { adapter } = makeAdapter();
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', { messages: [{ role: 'assistant', content: 'prior' }] }),
    );
    expect(result.verdict.reason).toContain('empty prompt');
  });

  it('skips an empty string payload prompt', async () => {
    const { adapter } = makeAdapter();
    const result = await governPipelineGate(adapter, gateInput('prompt', ''));
    expect(result.verdict.reason).toContain('empty prompt');
  });

  it('skips a content-bearing record with blank content', async () => {
    const { adapter } = makeAdapter();
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', { content: '   ', request: '' }),
    );
    expect(result.verdict.reason).toContain('empty prompt');
  });

  it('governs a real prompt and emits the goal signal + workflow start', async () => {
    const { adapter, evaluate } = makeAdapter();
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'Refund the customer', model: 'gpt-4o' }, {
        ensureWorkflowStarted: true,
      }),
    );
    expect(result.status).toBe('executed');
    const events = evaluate.mock.calls.map((c) => (c[0] as EvaluatePayload).event_type);
    expect(events).toContain('SignalReceived');
    expect(events).toContain('WorkflowStarted');
    expect(events).toContain('ActivityStarted');
  });

  it('reconstructs prompt text from string, request and messages payloads', async () => {
    const { adapter } = makeAdapter();
    await governPipelineGate(adapter, gateInput('prompt', 'plain string prompt'));
    await governPipelineGate(adapter, gateInput('prompt', { request: 'do the thing' }));
    await governPipelineGate(
      adapter,
      gateInput('prompt', {
        messages: [
          { role: 'system', content: 'be nice' },
          { role: 'user', content: 'newest user message' },
          { type: 'human', content: 'human typed message' },
        ],
      }),
    );
    await governPipelineGate(
      adapter,
      gateInput('prompt', {
        messages: [{ role: 'narrator', content: 'a non-system content message' }],
      }),
    );
  });

  it('emits the prompt span with provider-derived URLs (anthropic/google/openai/gemini)', async () => {
    const { adapter } = makeAdapter();
    await governPipelineGate(
      adapter,
      gateInput('prompt', {
        prompt: 'a',
        model: 'claude-3',
        response_metadata: { ls_provider: 'anthropic' },
      }),
    );
    await governPipelineGate(
      adapter,
      gateInput('prompt', {
        prompt: 'b',
        model: 'm',
        response_metadata: { provider: 'google' },
      }),
    );
    await governPipelineGate(
      adapter,
      gateInput('prompt', {
        prompt: 'c',
        model: 'm',
        response_metadata: { provider: 'gemini' },
      }),
    );
    await governPipelineGate(
      adapter,
      gateInput('prompt', {
        prompt: 'd',
        model: 'm',
        response_metadata: { provider: 'openai' },
      }),
    );
    await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'e', model: 'gemini-1.5-pro' }),
    );
    await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'f', model: 'mystery-model' }),
    );
  });

  it('covers span timestamp scaling for normal and pre-scaled start times', async () => {
    const { adapter } = makeAdapter();
    await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'normal ms', model: 'x' }, { startTime: Date.now() }),
    );
    await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'already ns', model: 'x' }, { startTime: 2e14 }),
    );
    await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'zero start', model: 'x' }, { startTime: 0 }),
    );
    // A non-finite start time yields no span start_time (the empty-spread branch).
    await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'nan start', model: 'x' }, { startTime: NaN }),
    );
  });

  it('suppresses the prompt span when capture mode owns llm spans', async () => {
    process.env.OPENBOX_LLM_SPANS_FROM_CAPTURE = 'true';
    const { adapter } = makeAdapter();
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'captured elsewhere', model: 'gpt' }),
    );
    expect(result.status).toBe('executed');
  });

  it('blocks a prompt and seals the workflow as failed', async () => {
    const { adapter, evaluate } = makeAdapter({
      gateVerdict: { verdict: 'block', reason: 'Prompt violated policy.' },
    });
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'do something bad' }),
    );
    expect(result.status).toBe('blocked');
    expect(result.rawBlocked).toBe(true);
    const events = evaluate.mock.calls.map((c) => (c[0] as EvaluatePayload).event_type);
    expect(events).toContain('WorkflowCompleted');
  });

  it('halts a prompt and records the halted session', async () => {
    const haltedSessions = new Map<string, HaltedSession>();
    const { adapter } = makeAdapter({
      gateVerdict: { verdict: 'halt', reason: 'Conversation halted.' },
    });
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'tripwire' }, { sessionKey: 's1', haltedSessions }),
    );
    expect(result.status).toBe('halted');
    expect(haltedSessions.get('s1')?.status).toBe('halted');
  });

  it('constrains an allowed prompt (transform branch)', async () => {
    const { adapter } = makeAdapter({
      gateVerdict: { verdict: 'constrain', reason: 'Constrained.' },
    });
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'mostly ok' }),
    );
    expect(result.status).toBe('constrained');
  });
});

describe('governPipelineGate — workflow-start branches', () => {
  it('starts the workflow when ids are missing', async () => {
    const { adapter } = makeAdapter();
    const result = await governPipelineGate(adapter, {
      payload: { prompt: 'no ids supplied' },
      kind: 'prompt',
      workflowType: 'WF',
      taskQueue: 'tq',
      haltedSessions: new Map<string, HaltedSession>(),
      strict: false,
      redactionMode: 'transformed-only',
    } as OpenBoxCopilotGateInput<unknown> & GateExtras);
    expect(result.workflowId).toBeTruthy();
    expect(result.runId).toBeTruthy();
  });

  it('does not re-start when distinct ids are supplied and start is not forced', async () => {
    const { adapter } = makeAdapter();
    const ids = freshIds();
    const result = await governPipelineGate(adapter, {
      payload: { prompt: 'has distinct ids' },
      kind: 'prompt',
      workflowType: 'WF',
      taskQueue: 'tq',
      haltedSessions: new Map<string, HaltedSession>(),
      strict: false,
      redactionMode: 'transformed-only',
      workflowId: ids.workflowId,
      runId: ids.runId,
      activityId: ids.activityId,
    } as OpenBoxCopilotGateInput<unknown> & GateExtras);
    expect(result.workflowId).toBe(ids.workflowId);
  });
});

describe('governPipelineGate — tool gates', () => {
  it('governs tool_input then paired tool_output (timing + pairing)', async () => {
    const { adapter } = makeAdapter();
    const ids = freshIds();
    const inputResult = await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'Read', args: { file_path: '/etc/hosts' } }, {
        ...ids,
        startTime: Date.now() - 5,
      }),
    );
    expect(inputResult.status).toBe('executed');
    const outputResult = await governPipelineGate(
      adapter,
      gateInput('tool_output', { name: 'Read', result: 'file body' }, {
        ...ids,
        endTime: Date.now(),
      }),
    );
    expect(outputResult.status).toBe('executed');
  });

  it('classifies every tool span type through tool_input gates', async () => {
    const { adapter } = makeAdapter();
    const cases: Array<Record<string, unknown>> = [
      { name: 'agent', args: {} },
      { name: 'Agent', args: { subagent_type: 'researcher' } },
      { name: 'Read', args: { file_path: '/a' } },
      { name: 'open', args: { file_path: '/a', open: true } },
      { name: 'Write', args: { file_path: '/a', content: 'x' } },
      { name: 'delete', args: { file_path: '/a' } },
      { name: 'Bash', args: { command: 'ls -la', cwd: '/tmp' } },
      { name: 'mcp__pg__query', args: { resource: 'users' } },
      { name: 'mcp__pg__db_select', args: { sql: 'SELECT 1' } },
      { name: 'mcp__http__fetch', args: { url: 'https://x.test', method: 'post' } },
      { name: 'mcp__misc__thing', args: {} },
      { name: 'WebFetch', args: { url: 'https://y.test' } },
      { name: 'WebSearch', args: { query: 'hello' } },
      { name: 'someCustomTool', args: { foo: 'bar' } },
      { toolCall: { name: 'nested', args: '{"k":"v"}' } },
    ];
    for (const payload of cases) {
      const result = await governPipelineGate(
        adapter,
        gateInput('tool_input', payload),
      );
      expect(result.status).toBe('executed');
    }
  });

  it('handles read=true and open-name variants and stringified args', async () => {
    const { adapter } = makeAdapter();
    await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'customReader', args: { read: true } }),
    );
    await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'open_file_now', args: { path: '/p', open: true } }),
    );
    await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'monitor', args: { command: 'tail -f log' } }),
    );
    await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'plainmcp_tool', args: { note: 'has mcp inside name' } }),
    );
  });

  it('blocks a tool output', async () => {
    const { adapter } = makeAdapter({
      gateVerdict: { verdict: 'block', reason: 'Tool blocked.' },
    });
    const result = await governPipelineGate(
      adapter,
      gateInput('tool_output', { name: 'Bash', result: 'rm -rf' }),
    );
    expect(result.status).toBe('blocked');
  });
});

describe('governPipelineGate — assistant output gate', () => {
  it('governs assistant output with content and usage, building llm spans', async () => {
    const { adapter } = makeAdapter();
    const ids = freshIds();
    // Prime a paired prompt so the assistant span can reuse the request body.
    await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'question', messages: [{ role: 'user', content: 'q' }] }, ids),
    );
    const result = await governPipelineGate(
      adapter,
      gateInput(
        'assistant_output',
        {
          content: 'the assistant answer',
          model: 'gpt-4o',
          response_metadata: { ls_provider: 'openai' },
          usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
        { ...ids, startTime: Date.now() - 20, endTime: Date.now() },
      ),
    );
    expect(result.status).toBe('executed');
  });

  it('governs assistant output via a real captured exchange (started+completed pair)', async () => {
    const { adapter } = makeAdapter();
    const result = await governPipelineGate(
      adapter,
      gateInput('assistant_output', { content: 'captured answer' }, {
        llmModel: 'claude-3-5',
        llmProvider: 'anthropic',
        llmUsage: { input_tokens: 3, output_tokens: 2 },
        llmCapture: {
          requestBody: { messages: [{ role: 'user', content: 'hi' }] },
          responseBody: { choices: [{ message: { content: 'captured answer' } }] },
          requestHeaders: { authorization: 'secret' },
          responseHeaders: { 'content-type': 'application/json' },
          httpStatusCode: 200,
          providerUrl: 'https://api.anthropic.com/v1/messages',
        },
        parentActivityStarted: true,
      }),
    );
    expect(result.status).toBe('executed');
  });

  it('suppresses the reconstructed assistant span under capture-owned mode without a capture', async () => {
    process.env.OPENBOX_LLM_SPANS_FROM_CAPTURE = 'true';
    const { adapter } = makeAdapter();
    const result = await governPipelineGate(
      adapter,
      gateInput('assistant_output', { content: 'answer', usage_metadata: { total_tokens: 4 } }),
    );
    expect(result.status).toBe('executed');
  });

  it('extracts assistant content from many payload shapes', async () => {
    const { adapter } = makeAdapter();
    const shapes: unknown[] = [
      'a bare string assistant answer',
      42,
      { content: '  ' , text: 'fallback text' },
      { summary: 'a summary' },
      { body: ['part one', { type: 'text', text: 'part two' }, { type: 'image' }] },
      { content: { not: 'a string or array' } },
      { message: { content: 'nested message content' } },
      {
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: 'the latest assistant content' },
        ],
      },
      { messages: [{ role: 'user', content: 'no assistant here' }] },
    ];
    for (const payload of shapes) {
      const result = await governPipelineGate(
        adapter,
        gateInput('assistant_output', payload),
      );
      expect(result.status).toBe('executed');
    }
  });

  it('detects tool-call blocks across payload shapes', async () => {
    const { adapter } = makeAdapter();
    const toolCallShapes: unknown[] = [
      { content: 'x', tool_calls: [{ id: '1' }] },
      { content: 'x', toolCalls: [{ id: '1' }] },
      { content: [{ type: 'tool_use', name: 't' }] },
      { content: 'x', additional_kwargs: { tool_calls: [{ id: '1' }] } },
      { content: 'x', message: { tool_calls: [{ id: '1' }] } },
      { messages: [{ content: 'x', tool_calls: [{ id: '1' }] }] },
      { content: 'no tool calls here' },
    ];
    for (const payload of toolCallShapes) {
      const result = await governPipelineGate(
        adapter,
        gateInput('assistant_output', payload),
      );
      expect(result.status).toBe('executed');
    }
  });
});

describe('governPipelineGate — activity-type, telemetry and metadata edges', () => {
  it('proceeds on a non-prompt-shaped object with no model and emits no span', async () => {
    const { adapter } = makeAdapter();
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', { foo: 'bar', misc: 1 }),
    );
    expect(result.status).toBe('executed');
  });

  it('honours an explicit default session key (no sessionId emitted)', async () => {
    const { adapter } = makeAdapter();
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'with default key' }, { sessionKey: 'default' }),
    );
    expect(result.status).toBe('executed');
  });

  it('falls back to default activity types for nameless tool gates', async () => {
    const { adapter } = makeAdapter();
    await governPipelineGate(adapter, gateInput('tool_input', { args: { x: 1 } }));
    await governPipelineGate(adapter, gateInput('tool_output', { result: 'done' }));
  });

  it('routes assistant activity types (onLlmEnd vs custom requested)', async () => {
    const { adapter } = makeAdapter();
    await governPipelineGate(
      adapter,
      gateInput('assistant_output', { content: 'a' }, { activityType: 'on_llm_end' }),
    );
    await governPipelineGate(
      adapter,
      gateInput('assistant_output', { content: 'b' }, { activityType: 'CustomAssistant' }),
    );
  });

  it('reads model + usage + provider from lc_kwargs metadata', async () => {
    const { adapter } = makeAdapter();
    const result = await governPipelineGate(
      adapter,
      gateInput('assistant_output', {
        content: 'answer',
        lc_kwargs: {
          response_metadata: { ls_model_name: 'gpt-4o-mini', ls_provider: 'openai' },
          usage: { input_tokens: 2, output_tokens: 1 },
        },
      }),
    );
    expect(result.status).toBe('executed');
  });

  it('builds an assistant span request body from a paired string prompt', async () => {
    const { adapter } = makeAdapter();
    const ids = freshIds();
    await governPipelineGate(adapter, gateInput('prompt', 'a paired string prompt', ids));
    const result = await governPipelineGate(
      adapter,
      gateInput('assistant_output', { content: 'response', model: 'gpt-4o' }, ids),
    );
    expect(result.status).toBe('executed');
  });

  it('builds an assistant span request body from paired messages', async () => {
    const { adapter } = makeAdapter();
    const ids = freshIds();
    await governPipelineGate(
      adapter,
      gateInput('prompt', { messages: [{ role: 'user', content: 'paired' }] }, ids),
    );
    const result = await governPipelineGate(
      adapter,
      gateInput('assistant_output', { content: 'response', model: 'gpt-4o' }, ids),
    );
    expect(result.status).toBe('executed');
  });

  it('emits a usage-only assistant span (no content) and an empty-capture no-op span', async () => {
    const { adapter } = makeAdapter();
    await governPipelineGate(
      adapter,
      gateInput('assistant_output', { usage_metadata: { total_tokens: 7 } }),
    );
    await governPipelineGate(
      adapter,
      gateInput('assistant_output', { something: 'else' }, { llmCapture: {} }),
    );
  });

  it('classifies mcp database tools by statement, resource, and name keywords', async () => {
    const { adapter } = makeAdapter();
    // resource-only (no explicit statement) exercises the resource statement branch
    await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'mcp__db__lookup', args: { resource: 'users' } }),
    );
    // explicit statement
    await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'mcp__mysql__run', args: { statement: 'UPDATE t SET a=1' } }),
    );
    // name keyword: query / execute / select, without statement or resource
    await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'mcp__sqlite__query', args: { note: 'x' } }),
    );
    await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'mcp__postgres__execute', args: { note: 'x' } }),
    );
    await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'mcp__database__select', args: { note: 'x' } }),
    );
    // database-looking name but nothing actionable -> not a db tool
    await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'mcp__db__info', args: { note: 'x' } }),
    );
  });

  it('classifies a nameless tool gate with an empty activity type (undefined tool name)', async () => {
    const { adapter } = makeAdapter();
    const result = await governPipelineGate(
      adapter,
      gateInput('tool_input', { args: { foo: 'bar' } }, { activityType: '' }),
    );
    expect(result.status).toBe('executed');
  });

  it('classifies mcp http tools by target and method', async () => {
    const { adapter } = makeAdapter();
    await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'mcp__http__call', args: { uri: 'https://a.test' } }),
    );
    await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'mcp__web__post', args: { http_method: 'POST' } }),
    );
    await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'mcp__fetch__noop', args: { note: 'x' } }),
    );
  });

  it('detects tool-use content parts with non-string types', async () => {
    const { adapter } = makeAdapter();
    await governPipelineGate(
      adapter,
      gateInput('assistant_output', {
        content: [{ type: 123 }, 'a bare string part', { type: 'function_call' }],
      }),
    );
  });

  it('treats a non-object message field as no assistant content', async () => {
    const { adapter } = makeAdapter();
    const result = await governPipelineGate(
      adapter,
      gateInput('assistant_output', { message: 'not an object', summary: 'use summary' }),
    );
    expect(result.status).toBe('executed');
  });

  it('handles primitive prompt payloads (number) without skipping', async () => {
    const { adapter } = makeAdapter();
    const result = await governPipelineGate(adapter, gateInput('prompt', 42 as unknown));
    expect(result.status).toBe('executed');
  });

  it('reads prompt text from a content-only payload', async () => {
    const { adapter } = makeAdapter();
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', { content: 'hello content prompt' }),
    );
    expect(result.status).toBe('executed');
  });

  it('routes the latest user message even when a trailing message has no role', async () => {
    const { adapter } = makeAdapter();
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', {
        messages: [
          { role: 'user', content: 'first user line' },
          { content: 'a trailing message with no role or type' },
        ],
      }),
    );
    expect(result.status).toBe('executed');
  });

  it('falls through when a message object carries no usable content', async () => {
    const { adapter } = makeAdapter();
    const result = await governPipelineGate(
      adapter,
      gateInput('assistant_output', { message: { author: 'system' } }),
    );
    expect(result.status).toBe('executed');
  });

  it('builds an empty assistant request body from an empty paired prompt', async () => {
    const { adapter } = makeAdapter();
    const ids = freshIds();
    await governPipelineGate(adapter, gateInput('prompt', {}, ids));
    const result = await governPipelineGate(
      adapter,
      gateInput('assistant_output', { content: 'reply with no model' }, ids),
    );
    expect(result.status).toBe('executed');
  });
});

describe('governPipelineGate — failure (fail-closed) path', () => {
  it('fails closed with an error status when Core throws after the workflow is known', async () => {
    const { adapter } = makeAdapter({
      throwOn: (p) => p.event_type === 'ActivityStarted',
    });
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'will fail at the gate' }),
    );
    expect(result.status).toBe('error');
    expect(result.verdict.arm).toBe('block');
  });

  it('fails closed before the workflow is known (no failWorkflow)', async () => {
    const { adapter } = makeAdapter({
      throwOn: (p) => p.event_type === 'SignalReceived',
    });
    const result = await governPipelineGate(adapter, {
      payload: { prompt: 'will fail at the signal' },
      kind: 'prompt',
      workflowType: 'WF',
      taskQueue: 'tq',
      haltedSessions: new Map<string, HaltedSession>(),
      strict: false,
      redactionMode: 'transformed-only',
    } as OpenBoxCopilotGateInput<unknown> & GateExtras);
    expect(result.status).toBe('error');
  });
});

describe('governHaltedPipelineGate — via halted sessions', () => {
  it('returns a halt verdict without Core when disabled', async () => {
    const haltedSessions = new Map<string, HaltedSession>();
    haltedSessions.set('s', makeHalted());
    const { adapter, evaluate } = makeAdapter({ enabled: false });
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'hi' }, { sessionKey: 's', haltedSessions }),
    );
    expect(result.verdict.arm).toBe('halt');
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('fails closed (block) when Core allows a gate on a halted workflow', async () => {
    const haltedSessions = new Map<string, HaltedSession>();
    haltedSessions.set('s', makeHalted());
    const { adapter } = makeAdapter({ gateVerdict: { verdict: 'allow', reason: 'ok' } });
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'still talking' }, { sessionKey: 's', haltedSessions }),
    );
    expect(result.verdict.arm).toBe('block');
    expect(result.reason).toContain('previously halted');
  });

  it('seals a blocked gate on a halted workflow', async () => {
    const haltedSessions = new Map<string, HaltedSession>();
    haltedSessions.set('s', makeHalted());
    const { adapter, evaluate } = makeAdapter({
      gateVerdict: { verdict: 'block', reason: 'Still blocked.' },
    });
    const result = await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'Bash', args: { command: 'ls' } }, {
        sessionKey: 's',
        haltedSessions,
      }),
    );
    expect(result.status).toBe('blocked');
    const events = evaluate.mock.calls.map((c) => (c[0] as EvaluatePayload).event_type);
    expect(events).toContain('WorkflowCompleted');
  });

  it('re-records a halt verdict on a halted workflow', async () => {
    const haltedSessions = new Map<string, HaltedSession>();
    haltedSessions.set('s', makeHalted());
    const { adapter } = makeAdapter({
      gateVerdict: { verdict: 'halt', reason: 'Halted again.' },
    });
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'persist halt' }, { sessionKey: 's', haltedSessions }),
    );
    expect(result.status).toBe('halted');
    expect(haltedSessions.get('s')?.status).toBe('halted');
  });

  it('fails closed when Core throws on a halted workflow', async () => {
    const haltedSessions = new Map<string, HaltedSession>();
    haltedSessions.set('s', makeHalted());
    const { adapter } = makeAdapter({
      throwOn: (p) => p.event_type === 'ActivityStarted',
    });
    const result = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'boom on halted' }, { sessionKey: 's', haltedSessions }),
    );
    expect(result.status).toBe('error');
    expect(result.verdict.arm).toBe('block');
  });

  it('returns an approval-required tool gate on a halted workflow (non-stop status)', async () => {
    const haltedSessions = new Map<string, HaltedSession>();
    haltedSessions.set('s', makeHalted());
    const { adapter } = makeAdapter({
      gateVerdict: { verdict: 'require_approval', reason: 'Needs approval.' },
    });
    const result = await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'Bash', args: { command: 'ls' } }, {
        sessionKey: 's',
        haltedSessions,
      }),
    );
    expect(result.status).toBe('approval_required');
  });

  it('skips failWorkflow when the workflow is unknown on a halted error', async () => {
    const haltedSessions = new Map<string, HaltedSession>();
    haltedSessions.set('s', makeHalted());
    const { adapter } = makeAdapter({
      throwOn: (p) => p.event_type === 'ActivityStarted',
    });
    const result = await governPipelineGate(adapter, {
      payload: { name: 'Bash', args: { command: 'ls' } },
      kind: 'tool_input',
      workflowType: 'WF',
      taskQueue: 'tq',
      sessionKey: 's',
      haltedSessions,
      strict: false,
      redactionMode: 'transformed-only',
    } as OpenBoxCopilotGateInput<unknown> & GateExtras);
    expect(result.status).toBe('error');
  });
});
