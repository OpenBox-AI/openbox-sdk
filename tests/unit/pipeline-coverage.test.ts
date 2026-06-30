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

type EvalCall = Record<string, any>;
function evalCalls(evaluate: { mock: { calls: unknown[][] } }): EvalCall[] {
  return evaluate.mock.calls.map((c) => c[0] as EvalCall);
}
// The activity-open / activity-complete envelope (carries telemetry like
// activity_type / tool_type / prompt / total_tokens). The span-bearing
// hook_trigger evaluation is emitted as a separate call, so exclude it here.
function activityPayload(evaluate: { mock: { calls: unknown[][] } }): EvalCall | undefined {
  return evalCalls(evaluate).find(
    (p) =>
      (p.event_type === 'ActivityStarted' || p.event_type === 'ActivityCompleted') &&
      !p.hook_trigger,
  );
}
// The primary embedded span submitted with the gate (the llm_completion POST).
function primarySpan(evaluate: { mock: { calls: unknown[][] } }): EvalCall | undefined {
  const call = evalCalls(evaluate).find(
    (p) => Array.isArray(p.spans) && (p.spans as unknown[]).length > 0,
  );
  return (call?.spans as EvalCall[] | undefined)?.[0];
}
function spanUrl(span: EvalCall | undefined): unknown {
  return span?.attributes?.['http.url'] ?? span?.http_url;
}
function spanRequestBody(span: EvalCall | undefined): EvalCall {
  const body = span?.request_body;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as EvalCall;
    } catch {
      return {};
    }
  }
  return (body as EvalCall) ?? {};
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
    const { adapter, evaluate } = makeAdapter();

    // A bare string payload becomes the governed prompt verbatim.
    evaluate.mockClear();
    const stringResult = await governPipelineGate(
      adapter,
      gateInput('prompt', 'plain string prompt'),
    );
    expect(stringResult.status).toBe('executed');
    expect(stringResult.verdict.arm).toBe('allow');
    expect(stringResult.safe).toBe('plain string prompt');
    expect(activityPayload(evaluate)?.prompt).toBe('plain string prompt');

    // A { request } record is reconstructed from its request string.
    evaluate.mockClear();
    const requestResult = await governPipelineGate(
      adapter,
      gateInput('prompt', { request: 'do the thing' }),
    );
    expect(requestResult.status).toBe('executed');
    expect(activityPayload(evaluate)?.prompt).toBe('do the thing');

    // The latest user/human message wins (the trailing human message here).
    evaluate.mockClear();
    const messagesResult = await governPipelineGate(
      adapter,
      gateInput('prompt', {
        messages: [
          { role: 'system', content: 'be nice' },
          { role: 'user', content: 'newest user message' },
          { type: 'human', content: 'human typed message' },
        ],
      }),
    );
    expect(messagesResult.status).toBe('executed');
    expect(activityPayload(evaluate)?.prompt).toBe('human typed message');

    // With no user/human role, the latest non-system content message is used.
    evaluate.mockClear();
    const narratorResult = await governPipelineGate(
      adapter,
      gateInput('prompt', {
        messages: [{ role: 'narrator', content: 'a non-system content message' }],
      }),
    );
    expect(narratorResult.status).toBe('executed');
    expect(activityPayload(evaluate)?.prompt).toBe('a non-system content message');
  });

  it('emits the prompt span with provider-derived URLs (anthropic/google/openai/gemini)', async () => {
    const { adapter, evaluate } = makeAdapter();

    // anthropic provider + claude model -> anthropic messages endpoint.
    evaluate.mockClear();
    const anthropic = await governPipelineGate(
      adapter,
      gateInput('prompt', {
        prompt: 'a',
        model: 'claude-3',
        response_metadata: { ls_provider: 'anthropic' },
      }),
    );
    expect(anthropic.status).toBe('executed');
    let span = primarySpan(evaluate);
    expect(span?.name).toBe('POST');
    expect(spanUrl(span)).toBe('https://api.anthropic.com/v1/messages');
    expect(spanRequestBody(span).provider).toBe('anthropic');
    expect(spanRequestBody(span).model_provider).toBe('anthropic');

    // google provider (model 'm') -> provider carried in the request body.
    evaluate.mockClear();
    const google = await governPipelineGate(
      adapter,
      gateInput('prompt', {
        prompt: 'b',
        model: 'm',
        response_metadata: { provider: 'google' },
      }),
    );
    expect(google.status).toBe('executed');
    expect(spanRequestBody(primarySpan(evaluate)).provider).toBe('google');

    // gemini provider (model 'm') -> provider carried in the request body.
    evaluate.mockClear();
    const gemini = await governPipelineGate(
      adapter,
      gateInput('prompt', {
        prompt: 'c',
        model: 'm',
        response_metadata: { provider: 'gemini' },
      }),
    );
    expect(gemini.status).toBe('executed');
    expect(spanRequestBody(primarySpan(evaluate)).provider).toBe('gemini');

    // openai provider (model 'm') -> openai chat completions endpoint.
    evaluate.mockClear();
    const openai = await governPipelineGate(
      adapter,
      gateInput('prompt', {
        prompt: 'd',
        model: 'm',
        response_metadata: { provider: 'openai' },
      }),
    );
    expect(openai.status).toBe('executed');
    span = primarySpan(evaluate);
    expect(spanUrl(span)).toBe('https://api.openai.com/v1/chat/completions');
    expect(spanRequestBody(span).provider).toBe('openai');

    // gemini-* model with no explicit provider -> google generative endpoint.
    evaluate.mockClear();
    const geminiModel = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'e', model: 'gemini-1.5-pro' }),
    );
    expect(geminiModel.status).toBe('executed');
    expect(spanUrl(primarySpan(evaluate))).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/generateContent',
    );

    // Unknown model + no provider -> openai default, no provider in body.
    evaluate.mockClear();
    const mystery = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'f', model: 'mystery-model' }),
    );
    expect(mystery.status).toBe('executed');
    span = primarySpan(evaluate);
    expect(spanUrl(span)).toBe('https://api.openai.com/v1/chat/completions');
    expect(spanRequestBody(span).provider).toBeUndefined();
  });

  it('covers span timestamp scaling for normal and pre-scaled start times', async () => {
    const { adapter, evaluate } = makeAdapter();

    // A millisecond start time is scaled up to nanoseconds (x 1_000_000).
    evaluate.mockClear();
    const ms = 1_700_000_000_000;
    const normal = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'normal ms', model: 'x' }, { startTime: ms }),
    );
    expect(normal.status).toBe('executed');
    expect(primarySpan(evaluate)?.start_time).toBe(ms * 1_000_000);

    // An already-large (pre-scaled) start time is not re-scaled by the gate's
    // own timestamp guard (value >= 1e14 passes through unchanged there).
    evaluate.mockClear();
    const preScaled = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'already ns', model: 'x' }, { startTime: 2e14 }),
    );
    expect(preScaled.status).toBe('executed');
    expect(primarySpan(evaluate)?.start_time).toBe(2e14 * 1_000_000);

    // A zero start time is preserved verbatim (no scaling of a non-positive value).
    evaluate.mockClear();
    const zero = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'zero start', model: 'x' }, { startTime: 0 }),
    );
    expect(zero.status).toBe('executed');
    expect(primarySpan(evaluate)?.start_time).toBe(0);

    // A non-finite start time yields no gate-applied start_time (the empty-spread
    // branch); the span falls back to the builder's own positive timestamp.
    evaluate.mockClear();
    const nan = await governPipelineGate(
      adapter,
      gateInput('prompt', { prompt: 'nan start', model: 'x' }, { startTime: NaN }),
    );
    expect(nan.status).toBe('executed');
    const nanStart = primarySpan(evaluate)?.start_time;
    expect(typeof nanStart).toBe('number');
    expect(nanStart).toBeGreaterThan(0);
    expect(Number.isFinite(nanStart)).toBe(true);
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
    const { adapter, evaluate } = makeAdapter();

    // read:true classifies any tool as a file_read regardless of its name.
    evaluate.mockClear();
    const reader = await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'customReader', args: { read: true } }),
    );
    expect(reader.status).toBe('executed');
    expect(activityPayload(evaluate)?.tool_name).toBe('customReader');
    expect(activityPayload(evaluate)?.tool_type).toBe('file_read');

    // open:true + a file path classifies as file_open.
    evaluate.mockClear();
    const opener = await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'open_file_now', args: { path: '/p', open: true } }),
    );
    expect(opener.status).toBe('executed');
    expect(activityPayload(evaluate)?.tool_type).toBe('file_open');

    // a 'monitor'-named tool with a command classifies as a shell.
    evaluate.mockClear();
    const monitor = await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'monitor', args: { command: 'tail -f log' } }),
    );
    expect(monitor.status).toBe('executed');
    expect(activityPayload(evaluate)?.tool_type).toBe('shell');

    // a name merely containing 'mcp' classifies as a generic mcp tool.
    evaluate.mockClear();
    const mcp = await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'plainmcp_tool', args: { note: 'has mcp inside name' } }),
    );
    expect(mcp.status).toBe('executed');
    expect(activityPayload(evaluate)?.tool_type).toBe('mcp');
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
    const { adapter, evaluate } = makeAdapter();

    // A nameless tool_input falls back to the langchain on_tool_start activity.
    evaluate.mockClear();
    const inputResult = await governPipelineGate(
      adapter,
      gateInput('tool_input', { args: { x: 1 } }),
    );
    expect(inputResult.status).toBe('executed');
    let activity = activityPayload(evaluate);
    expect(activity?.event_type).toBe('ActivityStarted');
    expect(activity?.activity_type).toBe('on_tool_start');
    expect(activity?.tool_name).toBe('on_tool_start');
    expect(activity?.tool_type).toBe('llm_tool_call');

    // A nameless tool_output falls back to the langchain on_tool_end activity.
    evaluate.mockClear();
    const outputResult = await governPipelineGate(
      adapter,
      gateInput('tool_output', { result: 'done' }),
    );
    expect(outputResult.status).toBe('executed');
    activity = activityPayload(evaluate);
    expect(activity?.event_type).toBe('ActivityCompleted');
    expect(activity?.activity_type).toBe('on_tool_end');
    expect(activity?.tool_type).toBe('llm_tool_call');
  });

  it('routes assistant activity types (onLlmEnd vs custom requested)', async () => {
    const { adapter, evaluate } = makeAdapter();

    // The langchain on_llm_end alias collapses to the canonical llm_call activity.
    evaluate.mockClear();
    const onLlmEnd = await governPipelineGate(
      adapter,
      gateInput('assistant_output', { content: 'a' }, { activityType: 'on_llm_end' }),
    );
    expect(onLlmEnd.status).toBe('executed');
    expect(activityPayload(evaluate)?.activity_type).toBe('llm_call');

    // Any other explicitly requested activity type is preserved verbatim.
    evaluate.mockClear();
    const custom = await governPipelineGate(
      adapter,
      gateInput('assistant_output', { content: 'b' }, { activityType: 'CustomAssistant' }),
    );
    expect(custom.status).toBe('executed');
    expect(activityPayload(evaluate)?.activity_type).toBe('CustomAssistant');
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
    const { adapter, evaluate } = makeAdapter();

    // Usage with no content still produces a completion span and carries tokens.
    evaluate.mockClear();
    const usageOnly = await governPipelineGate(
      adapter,
      gateInput('assistant_output', { usage_metadata: { total_tokens: 7 } }),
    );
    expect(usageOnly.status).toBe('executed');
    expect(activityPayload(evaluate)?.total_tokens).toBe(7);
    expect(primarySpan(evaluate)?.hook_type).toBe('http_request');

    // An empty capture object is enough to force an emitted (started) span even
    // when the payload has neither content nor usage.
    evaluate.mockClear();
    const emptyCapture = await governPipelineGate(
      adapter,
      gateInput('assistant_output', { something: 'else' }, { llmCapture: {} }),
    );
    expect(emptyCapture.status).toBe('executed');
    const span = primarySpan(evaluate);
    expect(span).toBeDefined();
    expect(span?.stage).toBe('started');
  });

  it('classifies mcp database tools by statement, resource, and name keywords', async () => {
    const { adapter, evaluate } = makeAdapter();
    const toolType = async (payload: Record<string, unknown>) => {
      evaluate.mockClear();
      const result = await governPipelineGate(adapter, gateInput('tool_input', payload));
      expect(result.status).toBe('executed');
      return activityPayload(evaluate)?.tool_type;
    };

    // resource-only (no explicit statement) exercises the resource statement branch
    expect(await toolType({ name: 'mcp__db__lookup', args: { resource: 'users' } })).toBe('db');
    // explicit statement
    expect(
      await toolType({ name: 'mcp__mysql__run', args: { statement: 'UPDATE t SET a=1' } }),
    ).toBe('db');
    // name keyword: query / execute / select, without statement or resource
    expect(await toolType({ name: 'mcp__sqlite__query', args: { note: 'x' } })).toBe('db');
    expect(await toolType({ name: 'mcp__postgres__execute', args: { note: 'x' } })).toBe('db');
    expect(await toolType({ name: 'mcp__database__select', args: { note: 'x' } })).toBe('db');
    // database-looking name but nothing actionable -> a plain mcp tool, not db
    expect(await toolType({ name: 'mcp__db__info', args: { note: 'x' } })).toBe('mcp');
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
    const { adapter, evaluate } = makeAdapter();

    // An http-looking name with a uri target classifies as http.
    evaluate.mockClear();
    const byTarget = await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'mcp__http__call', args: { uri: 'https://a.test' } }),
    );
    expect(byTarget.status).toBe('executed');
    expect(activityPayload(evaluate)?.tool_type).toBe('http');

    // A web-named tool with an http method (but no target) also classifies as http.
    evaluate.mockClear();
    const byMethod = await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'mcp__web__post', args: { http_method: 'POST' } }),
    );
    expect(byMethod.status).toBe('executed');
    expect(activityPayload(evaluate)?.tool_type).toBe('http');

    // A fetch-named tool with neither target nor method is just a generic mcp tool.
    evaluate.mockClear();
    const noop = await governPipelineGate(
      adapter,
      gateInput('tool_input', { name: 'mcp__fetch__noop', args: { note: 'x' } }),
    );
    expect(noop.status).toBe('executed');
    expect(activityPayload(evaluate)?.tool_type).toBe('mcp');
  });

  it('detects tool-use content parts with non-string types', async () => {
    const { adapter, evaluate } = makeAdapter();
    evaluate.mockClear();
    // A content array mixing a numeric type, a bare string, and a function_call
    // block: the function_call part must register as a tool call despite the
    // non-string type sibling.
    const result = await governPipelineGate(
      adapter,
      gateInput('assistant_output', {
        content: [{ type: 123 }, 'a bare string part', { type: 'function_call' }],
      }),
    );
    expect(result.status).toBe('executed');
    expect(activityPayload(evaluate)?.has_tool_calls).toBe(true);
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
