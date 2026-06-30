import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  recalls: new Map<string, { runtimeKey: string }>(),
  constructed: [] as Array<{ apiUrl: string; apiKey: string }>,
  payloads: [] as any[],
  responses: [] as any[],
}));

vi.mock('../../ts/src/file-tokens/agent-keys.js', () => ({
  recallAgentKey: vi.fn((agentId: string) => state.recalls.get(agentId)),
}));

vi.mock('../../ts/src/core-client/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ts/src/core-client/index.js')>();
  return {
    ...actual,
    OpenBoxCoreClient: class {
    constructor(private readonly opts: { apiUrl: string; apiKey: string }) {
      state.constructed.push(opts);
    }

    async evaluate(payload: any) {
      state.payloads.push(payload);
      const response = state.responses.shift();
      if (response) return response;
      return {
        verdict: 'allow',
        action: 'allow',
        reason: `${this.opts.apiUrl}:${payload.activity_type}`,
      };
    }
  },
  };
});

function runtimeKey(prefix: 'live' | 'test'): string {
  return `obx_${prefix}_${'a'.repeat(48)}`;
}

beforeEach(() => {
  vi.resetModules();
  state.recalls.clear();
  state.constructed.length = 0;
  state.payloads.length = 0;
  state.responses.length = 0;
  delete process.env.OPENBOX_API_KEY;
  delete process.env.OPENBOX_CORE_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('governance/check', () => {
  it('uses explicit runtime key and core URL override to evaluate a mapped span', async () => {
    const { checkGovernance } = await import('../../ts/src/governance/check.ts');

    const result = await checkGovernance({
      agentId: 'agent-1',
      spanType: 'file_write',
      activityInput: { file_path: '/tmp/a.txt', content: 'x' },
      apiKey: runtimeKey('test'),
      coreUrl: 'https://core.dev.test/ob',
    });

    expect(result.verdict).toBe('allow');
    expect(state.constructed).toEqual([
      { apiUrl: 'https://core.dev.test/ob', apiKey: runtimeKey('test') },
    ]);
    expect(state.payloads[0]).toMatchObject({
      source: 'workflow-telemetry',
      event_type: 'WorkflowStarted',
      workflow_type: 'SdkCheck',
      task_queue: 'sdk',
      hook_trigger: false,
    });
    expect(state.payloads[1]).toMatchObject({
      source: 'workflow-telemetry',
      event_type: 'ActivityStarted',
      activity_type: 'FileEdit',
      activity_input: [{ file_path: '/tmp/a.txt', content: 'x' }],
    });
    expect(state.payloads[1].hook_trigger).toBe(false);
    expect(state.payloads[1]).not.toHaveProperty('spans');
    expect(state.payloads[1]).not.toHaveProperty('span_count');
    expect(state.payloads[2]).toMatchObject({
      source: 'workflow-telemetry',
      event_type: 'ActivityStarted',
      activity_type: 'FileEdit',
      activity_input: [{ file_path: '/tmp/a.txt', content: 'x' }],
      hook_trigger: true,
      span_count: 1,
    });
    expect(state.payloads[1].workflow_id).toBe(state.payloads[0].workflow_id);
    expect(state.payloads[1].run_id).toBe(state.payloads[0].run_id);
    expect(state.payloads[2].workflow_id).toBe(state.payloads[1].workflow_id);
    expect(state.payloads[2].run_id).toBe(state.payloads[1].run_id);
    expect(state.payloads[2].activity_id).toBe(state.payloads[1].activity_id);
    expect(state.payloads[2].spans[0]).not.toHaveProperty('semantic_type');
    expect(state.payloads[2].spans[0].attributes).not.toHaveProperty('openbox.semantic_type');
    expect(state.payloads[2].spans[0]).toMatchObject({
      activity_id: state.payloads[1].activity_id,
      name: 'file.write',
      file_path: '/tmp/a.txt',
    });
  });

  it('treats uppercase continue/constrain parent verdicts as allowish before returning hook verdict', async () => {
    state.responses.push(
      { verdict: 'allow', action: 'allow', reason: 'workflow started' },
      { verdict: ' CONTINUE ', action: 'CONTINUE', reason: 'parent allowed' },
      { verdict: 'block', action: 'block', reason: 'hook blocked' },
    );
    const { checkGovernance } = await import('../../ts/src/governance/check.ts');

    const result = await checkGovernance({
      agentId: 'agent-1',
      spanType: 'shell',
      activityInput: { command: 'rm -rf dist', cwd: '/tmp' },
      apiKey: runtimeKey('test'),
      coreUrl: 'https://core.dev.test/ob',
    });

    expect(result).toMatchObject({
      verdict: 'block',
      reason: 'hook blocked',
    });
    expect(state.payloads).toHaveLength(3);
  });

  it('emits a goal signal before the governed action when goal context is supplied', async () => {
    const { checkGovernance } = await import('../../ts/src/governance/check.ts');

    await checkGovernance({
      agentId: 'agent-1',
      spanType: 'llm_embedding',
      activityInput: { prompt: 'embed this', model: 'text-embedding-3-small' },
      goal: 'answer the customer question',
      sessionId: 'mcp-session-1',
      apiKey: runtimeKey('test'),
      coreUrl: 'https://core.dev.test/ob',
    });

    expect(state.payloads[0]).toMatchObject({ event_type: 'WorkflowStarted' });
    expect(state.payloads[1]).toMatchObject({
      event_type: 'SignalReceived',
      activity_type: 'user_prompt',
      activity_input: [{ prompt: 'answer the customer question', event_category: 'agent_goal' }],
      signal_name: 'user_prompt',
      signal_args: 'answer the customer question',
      prompt: 'answer the customer question',
    });
    expect(state.payloads[2]).toMatchObject({
      event_type: 'ActivityStarted',
      activity_type: 'EMBEDDING',
      session_id: 'mcp-session-1',
    });
  });

  it('fails closed before Core when strict goal context is required but missing', async () => {
    const { checkGovernance } = await import('../../ts/src/governance/check.ts');

    await expect(
      checkGovernance({
        agentId: 'agent-1',
        spanType: 'shell',
        activityInput: { command: 'pwd' },
        requireGoalContext: true,
        apiKey: runtimeKey('test'),
        coreUrl: 'https://core.dev.test/ob',
      }),
    ).rejects.toThrow('goal context is required');
    expect(state.payloads).toHaveLength(0);
  });

  it('still emits the hook span when the parent verdict blocks', async () => {
    state.responses.push(
      { verdict: 'allow', action: 'allow', reason: 'workflow started' },
      { verdict: 'block', action: 'block', reason: 'parent blocked' },
      { verdict: 'allow', action: 'allow', reason: 'hook persisted' },
    );
    const { checkGovernance } = await import('../../ts/src/governance/check.ts');

    const result = await checkGovernance({
      agentId: 'agent-1',
      spanType: 'mcp',
      activityInput: { tool_name: 'danger_tool', tool_input: { id: 1 } },
      apiKey: runtimeKey('test'),
      coreUrl: 'https://core.dev.test/ob',
    });

    expect(result).toMatchObject({
      verdict: 'block',
      reason: 'parent blocked',
    });
    expect(state.payloads).toHaveLength(3);
    expect(state.payloads[0]).toMatchObject({
      event_type: 'WorkflowStarted',
      hook_trigger: false,
    });
    expect(state.payloads[1]).toMatchObject({
      event_type: 'ActivityStarted',
      activity_type: 'MCPToolCall',
      hook_trigger: false,
    });
    expect(state.payloads[1]).not.toHaveProperty('spans');
    expect(state.payloads[1]).not.toHaveProperty('span_count');
    expect(state.payloads[2]).toMatchObject({
      event_type: 'ActivityStarted',
      activity_type: 'MCPToolCall',
      hook_trigger: true,
      span_count: 1,
    });
    expect(state.payloads[1].workflow_id).toBe(state.payloads[0].workflow_id);
    expect(state.payloads[1].run_id).toBe(state.payloads[0].run_id);
    expect(state.payloads[2].workflow_id).toBe(state.payloads[1].workflow_id);
    expect(state.payloads[2].run_id).toBe(state.payloads[1].run_id);
    expect(state.payloads[2].activity_id).toBe(state.payloads[1].activity_id);
    expect(state.payloads[2].spans[0]).not.toHaveProperty('semantic_type');
    expect(state.payloads[2].spans[0].attributes).not.toHaveProperty('openbox.semantic_type');
    expect(state.payloads[2].spans[0]).toMatchObject({
      attributes: {
        'mcp.method': 'callTool',
        'mcp.operation': 'danger_tool',
        'mcp.server_id': 'unknown',
        'tool.name': 'danger_tool',
      },
    });
    expect(state.payloads[2].spans[0].attributes).not.toHaveProperty('openbox.tool.name');
  });

  it('skips org keys in env and falls back to the agent key cache', async () => {
    process.env.OPENBOX_API_KEY = 'obx_key_' + 'b'.repeat(48);
    process.env.OPENBOX_CORE_URL = 'https://core.from-env.test';
    state.recalls.set('agent-cache', { runtimeKey: runtimeKey('test') });
    const { checkGovernance } = await import('../../ts/src/governance/check.ts');

    await checkGovernance({
      agentId: 'agent-cache',
      spanType: 'shell',
      activityInput: { command: 'echo ok', cwd: '/tmp' },
    });

    expect(state.constructed[0]).toEqual({
      apiUrl: 'https://core.from-env.test',
      apiKey: runtimeKey('test'),
    });
    const hookPayload = state.payloads.at(-1);
    expect(hookPayload.activity_type).toBe('ShellExecution');
    expect(hookPayload.hook_trigger).toBe(true);
    expect(hookPayload.spans[0].attributes).toMatchObject({
      'shell.command': 'echo ok',
      'shell.cwd': '/tmp',
    });
  });

  it('throws actionable errors for missing keys', async () => {
    const { checkGovernance } = await import('../../ts/src/governance/check.ts');

    await expect(
      checkGovernance({
        agentId: 'missing',
        spanType: 'llm',
        activityInput: { prompt: 'hello' },
      }),
    ).rejects.toThrow(/No agent runtime key/);
  });

  it('maps every supported span type into a core governance payload', async () => {
    const { checkGovernance } = await import('../../ts/src/governance/check.ts');
    const cases = [
      ['llm', { prompt: 'hi' }, 'PromptSubmission', 'POST'],
      ['file_read', { file_path: '/tmp/r' }, 'FileRead', 'file.read'],
      ['file_delete', { file_path: '/tmp/d' }, 'FileDelete', 'file.delete'],
      ['http', { method: 'get', url: 'https://example.test' }, 'HTTPRequest', 'HTTP GET'],
      ['db', { operation: 'insert', statement: 'insert 1' }, 'DatabaseQuery', 'INSERT'],
      ['db', { query: 'SELECT 1' }, 'DatabaseQuery', 'SELECT'],
      ['mcp', { tool: 'read' }, 'MCPToolCall', 'MCP callTool read'],
    ] as const;

    for (const [spanType, activityInput, activityType, spanName] of cases) {
      await checkGovernance({
        spanType,
        activityInput,
        apiKey: runtimeKey('test'),
        coreUrl: 'https://core.map.test',
      });
      const payload = state.payloads.at(-1);
      expect(payload.activity_type).toBe(activityType);
      expect(payload.spans[0].name).toBe(spanName);
      expect(payload.spans[0]).not.toHaveProperty('semantic_type');
      expect(payload.spans[0].attributes).not.toHaveProperty('openbox.semantic_type');
      if (spanType === 'mcp') {
        // Canonical: MCP collapses to a function_call span (span_type stripped;
        // synthetic openbox.* attr stripped). OTel-native mcp.*/tool.* survive.
        expect(payload.spans[0]).not.toHaveProperty('span_type');
        expect(payload.spans[0]).toMatchObject({
          attributes: {
            'mcp.method': 'callTool',
            'mcp.operation': 'read',
            'mcp.server_id': 'unknown',
            'tool.name': 'read',
          },
        });
        expect(payload.spans[0].attributes).not.toHaveProperty('openbox.tool.name');
      }
      expect(payload.spans[0].trace_id).toHaveLength(32);
      expect(payload.spans[0].span_id).toHaveLength(16);
    }
  });
});
