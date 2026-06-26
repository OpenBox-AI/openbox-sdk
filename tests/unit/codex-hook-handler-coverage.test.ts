import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let adapterOptions: any;
let coreClientOptions: any;
let stdinIteratorSpy: any;
let mockApprovalMode: 'remote' | 'inline' | 'defer' = 'remote';
let mockRequireGoalContext = false;
let mockDefaultGoal: string | undefined;
let mockPeekGoal: unknown = { goal: 'existing goal' };
let mockIsStarted = false;

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

vi.mock('../../ts/src/core-client/generated/runtime/codex.js', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createCodexAdapter: vi.fn((opts: any) => {
      adapterOptions = opts;
      return {
        run: async () => undefined,
      };
    }),
  };
});

vi.mock('../../ts/src/runtime/codex/config.js', () => ({
  getConfigDir: vi.fn(() => '/tmp/openbox-codex-hook-handler-test/.openbox/codex'),
  loadConfig: vi.fn(() => ({
    openboxApiKey: process.env.OPENBOX_API_KEY ?? '',
    openboxEndpoint: 'http://core.test',
    agentIdentity: undefined,
    governancePolicy: 'fail_closed',
    governanceTimeout: 15,
    sessionDir: '/tmp/openbox-codex-hook-handler-test',
    logFile: null,
    verbose: false,
    hitlEnabled: true,
    hitlPollInterval: 5,
    hitlMaxWait: 2,
    approvalMode: mockApprovalMode,
    taskQueue: 'codex',
    sendStartEvent: true,
    sendActivityStartEvent: true,
    maxBodySize: null,
    requireGoalContext: mockRequireGoalContext,
    defaultGoal: mockDefaultGoal,
  })),
}));

vi.mock('../../ts/src/runtime/codex/session-resolver.js', () => ({
  stableCodexSessionKey: vi.fn((env: any) => env.session_id ?? env.conversation_id ?? env.turn_id),
  codexSessionKey: vi.fn((env: any) => env.session_id ?? env.conversation_id ?? env.turn_id ?? 'codex:unscoped'),
  resolveSession: vi.fn((_env: any) => ({
    workflowId: 'codex-workflow',
    runId: 'codex-run',
  })),
  isStarted: vi.fn(() => mockIsStarted),
  peekGoal: vi.fn(() => mockPeekGoal),
  recordGoal: vi.fn(),
  markStarted: vi.fn(),
  markHalted: vi.fn(),
  clearSession: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  adapterOptions = undefined;
  coreClientOptions = undefined;
  mockApprovalMode = 'remote';
  mockRequireGoalContext = false;
  mockDefaultGoal = undefined;
  mockPeekGoal = { goal: 'existing goal' };
  mockIsStarted = false;
  process.env.OPENBOX_API_KEY = 'obx_test_codex_handler';
  delete process.env.OPENBOX_HOME;
});

afterEach(() => {
  stdinIteratorSpy?.mockRestore?.();
  stdinIteratorSpy = undefined;
  delete process.env.OPENBOX_API_KEY;
  delete process.env.OPENBOX_HOME;
});

describe('runtime/codex/hook-handler; governance orchestration', () => {
  const baseEnv = {
    hook_event_name: 'PreToolUse',
    session_id: 'codex-session',
    tool_use_id: 'tool-1',
    tool_name: 'Read',
    tool_input: { file_path: 'fixtures/hostname.txt' },
  };

  const mockHookStdin = (env: Record<string, unknown> = baseEnv) => {
    stdinIteratorSpy?.mockRestore?.();
    stdinIteratorSpy = vi
      .spyOn(process.stdin as any, Symbol.asyncIterator as any)
      .mockImplementation((async function* () {
        yield Buffer.from(JSON.stringify(env));
      }) as any);
  };

  it('registers handlers and passes Core client timeout configuration', async () => {
    mockHookStdin();
    const { runCodexHook } = await import('../../ts/src/runtime/codex/hook-handler.ts');

    await runCodexHook();

    expect(adapterOptions).toBeDefined();
    expect(Object.keys(adapterOptions.handlers)).toEqual([
      'userPromptSubmit',
      'preToolUse',
      'permissionRequest',
      'postToolUse',
      'stop',
    ]);
    expect(coreClientOptions).toMatchObject({
      apiKey: 'obx_test_codex_handler',
      apiUrl: 'http://core.test',
      timeoutMs: 15_000,
    });
    expect(adapterOptions.inlineApproval).toBe(false);
    expect(adapterOptions.deferApproval).toBe(false);
  });

  it('passes Codex defer approval mode without entering the local poll loop', async () => {
    mockApprovalMode = 'defer';
    mockHookStdin();
    const { runCodexHook } = await import('../../ts/src/runtime/codex/hook-handler.ts');

    await runCodexHook();

    expect(adapterOptions.inlineApproval).toBe(true);
    expect(adapterOptions.deferApproval).toBe(true);
  });

  it('starts the workflow before decision-capable tool gates', async () => {
    mockHookStdin();
    const { runCodexHook } = await import('../../ts/src/runtime/codex/hook-handler.ts');
    const { markStarted } = await import('../../ts/src/runtime/codex/session-resolver.js');

    await runCodexHook();
    const session = {
      workflowStarted: vi.fn(async () => undefined),
      openActivity: vi.fn(async () => ({
        activityId: 'activity-test',
        verdict: {
          arm: 'require_approval',
          reason: 'review file read',
          riskScore: 0.8,
        },
      })),
    };

    await expect(adapterOptions.handlers.preToolUse(baseEnv, session)).resolves.toMatchObject({
      arm: 'require_approval',
      reason: 'review file read',
    });
    expect(session.workflowStarted).toHaveBeenCalledTimes(1);
    expect(markStarted).toHaveBeenCalledWith(baseEnv, expect.any(Object));
    expect(session.openActivity).toHaveBeenCalledTimes(1);
    expect(session.workflowStarted.mock.invocationCallOrder[0]).toBeLessThan(
      session.openActivity.mock.invocationCallOrder[0],
    );
  });

  it('does not replay WorkflowStarted after the session store says the workflow is started', async () => {
    mockIsStarted = true;
    mockHookStdin();
    const { runCodexHook } = await import('../../ts/src/runtime/codex/hook-handler.ts');

    await runCodexHook();
    const session = {
      workflowStarted: vi.fn(async () => undefined),
      openActivity: vi.fn(async () => ({
        activityId: 'activity-test',
        verdict: {
          arm: 'allow',
          riskScore: 0,
        },
      })),
    };

    await expect(adapterOptions.handlers.preToolUse(baseEnv, session)).resolves.toMatchObject({
      arm: 'allow',
    });
    expect(session.workflowStarted).not.toHaveBeenCalled();
    expect(session.openActivity).toHaveBeenCalledTimes(1);
  });

  it('fails closed when Core returns a governance-checks-incomplete allow for a decision hook', async () => {
    mockHookStdin();
    const { runCodexHook } = await import('../../ts/src/runtime/codex/hook-handler.ts');

    await runCodexHook();
    const session = {
      workflowStarted: vi.fn(async () => undefined),
      openActivity: vi.fn(async () => ({
        activityId: 'activity-test',
        verdict: {
          arm: 'allow',
          riskScore: 0,
          governanceChecksIncomplete: true,
        },
      })),
    };

    await expect(adapterOptions.handlers.preToolUse(baseEnv, session)).resolves.toMatchObject({
      arm: 'block',
      reason: expect.stringContaining('required governance checks did not complete'),
    });
  });

  it('fails closed in strict goal mode when a tool gate has no session goal', async () => {
    mockRequireGoalContext = true;
    mockPeekGoal = null;
    mockHookStdin();
    const { runCodexHook } = await import('../../ts/src/runtime/codex/hook-handler.ts');

    await runCodexHook();
    const session = {
      workflowStarted: vi.fn(async () => undefined),
      openActivity: vi.fn(async () => ({
        activityId: 'activity-test',
        verdict: { arm: 'allow' },
      })),
    };

    await expect(adapterOptions.handlers.preToolUse(baseEnv, session)).resolves.toMatchObject({
      arm: 'block',
      reason: expect.stringContaining('goal context is required'),
    });
    expect(session.openActivity).not.toHaveBeenCalled();
  });
});
