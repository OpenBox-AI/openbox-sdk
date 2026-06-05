import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let adapterOptions: any;

vi.mock('../../ts/src/cli/env-source.js', () => ({
  applyEnvSource: vi.fn(),
}));

vi.mock('../../ts/src/logging/logger.js', () => ({
  createLogger: vi.fn(() => ({ initLogger: vi.fn() })),
}));

vi.mock('../../ts/src/logging/hook-log.js', () => ({
  makeHookLog: vi.fn(() => ({ record: vi.fn() })),
}));

vi.mock('../../ts/src/core-client/index.js', () => ({
  OpenBoxCoreClient: class {
    constructor(public opts: any) {}
  },
}));

vi.mock('../../ts/src/core-client/generated/runtime/claude-code.js', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createClaudeCodeAdapter: vi.fn((opts: any) => {
      adapterOptions = opts;
      return {
        run: async () => undefined,
      };
    }),
  };
});

vi.mock('../../ts/src/runtime/claude-code/config.js', () => ({
  loadConfig: vi.fn(() => ({
    openboxApiKey: process.env.OPENBOX_API_KEY ?? '',
    openboxEndpoint: 'http://core.test',
    governancePolicy: 'fail_open',
    governanceTimeout: 15,
    sessionDir: '/tmp/openbox-claude-hook-handler-test',
    logFile: null,
    verbose: false,
    dryRun: process.env.DRY_RUN === 'true',
    hitlEnabled: true,
    hitlPollInterval: 5,
    hitlMaxWait: Number(process.env.HITL_MAX_WAIT ?? 2),
    approvalMode: process.env.APPROVAL_MODE === 'inline' ? 'inline' : 'remote',
    taskQueue: 'claude-code-hooks',
    sendStartEvent: true,
    maxBodySize: null,
    skipTools: [],
    testDriftResponse: null,
  })),
}));

vi.mock('../../ts/src/runtime/claude-code/session-resolver.js', () => ({
  resolveSession: vi.fn((_env: any) => ({
    activity: vi.fn(async () => ({ arm: 'allow' })),
    workflowStarted: vi.fn(async () => undefined),
    workflowCompleted: vi.fn(async () => undefined),
  })),
  lastResolveCreatedFreshSession: vi.fn(() => true),
  markHalted: vi.fn(),
  clearSession: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  adapterOptions = undefined;
  process.env.OPENBOX_API_KEY = 'obx_test_claude_handler';
  delete process.env.DRY_RUN;
  delete process.env.APPROVAL_MODE;
  delete process.env.HITL_MAX_WAIT;
});

afterEach(() => {
  delete process.env.OPENBOX_API_KEY;
  delete process.env.DRY_RUN;
  delete process.env.APPROVAL_MODE;
  delete process.env.HITL_MAX_WAIT;
});

describe('runtime/claude-code/hook-handler; adapter orchestration', () => {
  const baseEnv = {
    session_id: 's1',
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/tmp',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'pwd', cwd: '/tmp' },
    tool_response: { stdout: 'ok' },
    prompt: 'say ok',
    permission_id: 'permission-1',
    reason: 'review',
    subagent_id: 'subagent-1',
    subagent_name: 'reviewer',
  };

  it('registers handlers and clamps approval wait bounds', async () => {
    process.env.HITL_MAX_WAIT = '9999';
    process.env.APPROVAL_MODE = 'inline';
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await runClaudeHook();

    expect(adapterOptions).toBeDefined();
    expect(adapterOptions.inlineApproval).toBe(true);
    expect(adapterOptions.approvalMaxWaitMs).toBe(3600_000);
    expect(Object.keys(adapterOptions.handlers)).toEqual(expect.arrayContaining([
      'preToolUse',
      'postToolUse',
      'userPromptSubmit',
      'permissionRequest',
      'sessionStart',
      'sessionEnd',
      'stop',
      'subagentStart',
      'subagentStop',
    ]));
  });

  it('dry-run handlers pass through without calling governance mappers', async () => {
    process.env.DRY_RUN = 'true';
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await runClaudeHook();
    const session = { activity: vi.fn(async () => ({ arm: 'block', reason: 'should not run' })) };
    for (const handler of Object.values(adapterOptions.handlers) as any[]) {
      await expect(handler(baseEnv, session)).resolves.toBeUndefined();
    }

    expect(session.activity).not.toHaveBeenCalled();
  });

  it('invokes live handlers and records thrown mapper errors', async () => {
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await runClaudeHook();
    const session = {
      activity: vi.fn(async () => ({ arm: 'allow' })),
      workflowStarted: vi.fn(async () => undefined),
      workflowCompleted: vi.fn(async () => undefined),
    };
    for (const handler of Object.values(adapterOptions.handlers) as any[]) {
      await handler(baseEnv, session);
    }

    expect(session.activity).toHaveBeenCalled();
    const failingSession = {
      ...session,
      activity: vi.fn(async () => {
        throw new Error('mapper failed');
      }),
    };
    await expect(adapterOptions.handlers.preToolUse(baseEnv, failingSession)).rejects.toThrow('mapper failed');
  });

  it('exits fail-open when no API key is configured', async () => {
    delete process.env.OPENBOX_API_KEY;
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await expect(runClaudeHook()).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(0);
  });
});
