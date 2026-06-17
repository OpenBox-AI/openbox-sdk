import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let adapterOptions: any;
let coreClientOptions: any;
let stdinIteratorSpy: any;

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
    constructor(public opts: any) {
      coreClientOptions = opts;
    }
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
  getConfigDir: vi.fn(() => '/tmp/openbox-claude-hook-handler-test/.claude-hooks'),
  loadConfig: vi.fn(() => ({
    openboxApiKey: process.env.OPENBOX_API_KEY ?? '',
    openboxEndpoint: 'http://core.test',
    agentIdentity: process.env.OPENBOX_AGENT_DID && process.env.OPENBOX_AGENT_PRIVATE_KEY
      ? {
        did: process.env.OPENBOX_AGENT_DID,
        privateKey: process.env.OPENBOX_AGENT_PRIVATE_KEY,
      }
      : undefined,
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
    skipActivityTypes: [],
    testDriftResponse: null,
  })),
}));

vi.mock('../../ts/src/runtime/claude-code/session-resolver.js', () => ({
  resolveSession: vi.fn((_env: any) => ({
    activity: vi.fn(async () => ({ arm: 'allow' })),
    openActivity: vi.fn(async () => ({ activityId: 'activity-test' })),
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
  coreClientOptions = undefined;
  process.env.OPENBOX_API_KEY = 'obx_test_claude_handler';
  delete process.env.DRY_RUN;
  delete process.env.APPROVAL_MODE;
  delete process.env.HITL_MAX_WAIT;
  delete process.env.OPENBOX_AGENT_DID;
  delete process.env.OPENBOX_AGENT_PRIVATE_KEY;
  delete process.env.OPENBOX_HOME;
});

afterEach(() => {
  stdinIteratorSpy?.mockRestore?.();
  stdinIteratorSpy = undefined;
  delete process.env.OPENBOX_API_KEY;
  delete process.env.DRY_RUN;
  delete process.env.APPROVAL_MODE;
  delete process.env.HITL_MAX_WAIT;
  delete process.env.OPENBOX_AGENT_DID;
  delete process.env.OPENBOX_AGENT_PRIVATE_KEY;
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

  const mockHookStdin = (env: Record<string, unknown> = baseEnv) => {
    stdinIteratorSpy?.mockRestore?.();
    stdinIteratorSpy = vi
      .spyOn(process.stdin as any, Symbol.asyncIterator as any)
      .mockImplementation((async function* () {
        yield Buffer.from(JSON.stringify(env));
      }) as any);
  };

  it('registers handlers and clamps approval wait bounds', async () => {
    process.env.HITL_MAX_WAIT = '9999';
    process.env.APPROVAL_MODE = 'inline';
    mockHookStdin();
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await runClaudeHook();

    expect(adapterOptions).toBeDefined();
    expect(adapterOptions.inlineApproval).toBe(true);
    expect(adapterOptions.approvalMaxWaitMs).toBe(3600_000);
    expect(Object.keys(adapterOptions.handlers)).toEqual(expect.arrayContaining([
      'preToolUse',
      'postToolUse',
      'postToolUseFailure',
      'postToolBatch',
      'userPromptSubmit',
      'userPromptExpansion',
      'permissionRequest',
      'permissionDenied',
      'setup',
      'instructionsLoaded',
      'messageDisplay',
      'sessionStart',
      'sessionEnd',
      'preCompact',
      'postCompact',
      'stop',
      'stopFailure',
      'subagentStart',
      'subagentStop',
      'taskCreated',
      'taskCompleted',
      'teammateIdle',
      'configChange',
      'cwdChanged',
      'fileChanged',
      'worktreeRemove',
      'elicitation',
      'elicitationResult',
    ]));
  });

  it('dry-run handlers pass through without calling governance mappers', async () => {
    process.env.DRY_RUN = 'true';
    mockHookStdin();
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await runClaudeHook();
    const session = { activity: vi.fn(async () => ({ arm: 'block', reason: 'should not run' })) };
    for (const handler of Object.values(adapterOptions.handlers) as any[]) {
      await expect(handler(baseEnv, session)).resolves.toBeUndefined();
    }

    expect(session.activity).not.toHaveBeenCalled();
  });

  it('passes signed agent identity through to the Core client', async () => {
    process.env.OPENBOX_AGENT_DID = 'did:openbox:agent:test';
    process.env.OPENBOX_AGENT_PRIVATE_KEY = 'a'.repeat(44);
    mockHookStdin();
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await runClaudeHook();

    expect(coreClientOptions?.agentIdentity).toEqual({
      did: 'did:openbox:agent:test',
      privateKey: 'a'.repeat(44),
    });
  });

  it('invokes live handlers and records thrown mapper errors', async () => {
    mockHookStdin();
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await runClaudeHook();
    const session = {
      activity: vi.fn(async () => ({ arm: 'allow' })),
      openActivity: vi.fn(async () => ({ activityId: 'activity-test' })),
      workflowStarted: vi.fn(async () => undefined),
      workflowCompleted: vi.fn(async () => undefined),
    };
    for (const handler of Object.values(adapterOptions.handlers) as any[]) {
      await handler(baseEnv, session);
    }

    expect(session.activity).toHaveBeenCalled();
    expect(session.openActivity).toHaveBeenCalled();
    const failingSession = {
      ...session,
      activity: vi.fn(async () => {
        throw new Error('mapper failed');
      }),
    };
    await expect(adapterOptions.handlers.preToolUse(baseEnv, failingSession)).resolves.toBeUndefined();
  });

  it('exits fail-open when no API key is configured', async () => {
    delete process.env.OPENBOX_API_KEY;
    mockHookStdin();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await expect(runClaudeHook()).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(0);
  });
});
