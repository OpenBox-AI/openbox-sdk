import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  recalls: new Map<string, { runtimeKey: string }>(),
  constructed: [] as Array<{ apiUrl: string; apiKey: string }>,
  payloads: [] as any[],
}));

vi.mock('../../ts/src/file-tokens/agent-keys.js', () => ({
  recallAgentKey: vi.fn((agentId: string) => state.recalls.get(agentId)),
}));

vi.mock('../../ts/src/core-client/index.js', () => ({
  OpenBoxCoreClient: class {
    constructor(private readonly opts: { apiUrl: string; apiKey: string }) {
      state.constructed.push(opts);
    }

    async evaluate(payload: any) {
      state.payloads.push(payload);
      return {
        verdict: 'allow',
        action: 'allow',
        reason: `${this.opts.apiUrl}:${payload.activity_type}`,
      };
    }
  },
}));

function runtimeKey(prefix: 'live' | 'test'): string {
  return `obx_${prefix}_${'a'.repeat(48)}`;
}

beforeEach(() => {
  vi.resetModules();
  state.recalls.clear();
  state.constructed.length = 0;
  state.payloads.length = 0;
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
      source: 'sdk',
      event_type: 'ActivityStarted',
      activity_type: 'FileEdit',
      activity_input: [{ file_path: '/tmp/a.txt', content: 'x' }],
      span_count: 1,
    });
    expect(state.payloads[0].spans[0]).toMatchObject({
      name: 'file.write',
      semantic_type: 'file_write',
      file_path: '/tmp/a.txt',
    });
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
    expect(state.payloads[0].activity_type).toBe('ShellExecution');
    expect(state.payloads[0].spans[0].attributes).toMatchObject({
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
      ['llm', { prompt: 'hi' }, 'PromptSubmission', 'llm.chat.completion'],
      ['file_read', { file_path: '/tmp/r' }, 'FileRead', 'file.read'],
      ['http', { method: 'get', url: 'https://example.test' }, 'HTTPRequest', 'GET https://example.test'],
      ['db', { operation: 'insert', statement: 'insert 1' }, 'DatabaseQuery', 'INSERT'],
      ['mcp', { tool: 'read' }, 'MCPToolCall', 'MCPToolCall'],
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
      expect(payload.spans[0].trace_id).toHaveLength(32);
      expect(payload.spans[0].span_id).toHaveLength(16);
    }
  });
});
