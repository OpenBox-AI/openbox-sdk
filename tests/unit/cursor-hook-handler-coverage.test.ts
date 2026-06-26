import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let adapterOptions: any;
let coreClientOptions: any;
let activityVerdict: any = { arm: 'allow' };
let validateApiKeyCalls = 0;
let socketConnects = 0;
let stdinIteratorSpy: any;
let mockApprovalMode: 'remote' | 'inline' = 'remote';
let mockRequireGoalContext = false;
let mockDefaultGoal: string | undefined;
let mockPeekGoal: unknown = { goal: 'existing goal' };
let mockIsStarted = false;
let socketUnavailable = false;
let socketTimesOut = false;
let socketCloseThrows = false;
let validateApiKeyFails = false;
const socketEvents: any[] = [];
// Mock-only raw 32-byte Ed25519 key encoded at runtime; not a real credential.
const FAKE_AGENT_PRIVATE_KEY = Buffer.alloc(32, 1).toString('base64');

vi.mock('../../ts/src/cli/env-source.js', () => ({
  applyEnvSource: vi.fn(),
}));

vi.mock('../../ts/src/logging/logger.js', () => ({
  createLogger: vi.fn(() => ({ initLogger: vi.fn() })),
}));

vi.mock('../../ts/src/logging/hook-log.js', () => ({
  makeHookLog: vi.fn(() => ({ record: vi.fn() })),
}));

vi.mock('../../ts/src/approvals/socket-client.js', () => ({
  connectApprovalSocket: vi.fn(async () => {
    socketConnects += 1;
    if (socketUnavailable) return null;
    return {
      notifyPending: (payload: any) => socketEvents.push({ type: 'pending', payload }),
      awaitDecision: async (id: string) => {
        socketEvents.push({ type: 'await', id });
        if (socketTimesOut) return { kind: 'timeout' };
        return { kind: 'decision', decision: { action: 'approve', reason: 'ok' } };
      },
      close: () => {
        socketEvents.push({ type: 'close' });
        if (socketCloseThrows) throw new Error('close failed');
      },
    };
  }),
}));

vi.mock('../../ts/src/core-client/index.js', () => ({
  OpenBoxCoreClient: class {
    constructor(public opts: any) {
      coreClientOptions = opts;
    }
    async validateApiKey() {
      validateApiKeyCalls += 1;
      if (validateApiKeyFails) throw new Error('invalid key');
      return { agent_id: 'agent-from-key' };
    }
  },
}));

vi.mock('../../ts/src/core-client/generated/runtime/cursor.js', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createCursorAdapter: vi.fn((opts: any) => {
      adapterOptions = opts;
      return {
        run: async () => undefined,
      };
    }),
  };
});

vi.mock('../../ts/src/runtime/cursor/config.js', () => ({
  getConfigDir: vi.fn(() => '/tmp/openbox-cursor-hook-handler-test/.openbox/cursor'),
  loadConfig: vi.fn(() => ({
    openboxApiKey: process.env.OPENBOX_API_KEY ?? '',
    openboxEndpoint: 'http://core.test',
    agentIdentity: process.env.OPENBOX_AGENT_DID && process.env.OPENBOX_AGENT_PRIVATE_KEY
      ? {
        did: process.env.OPENBOX_AGENT_DID,
        privateKey: process.env.OPENBOX_AGENT_PRIVATE_KEY,
      }
      : undefined,
    governancePolicy: 'fail_closed',
    governanceTimeout: 15,
    activityType: 'CursorIDE',
    sessionDir: '/tmp/openbox-cursor-hook-handler-test',
    logFile: null,
    verbose: false,
    hitlEnabled: true,
    hitlPollInterval: 5,
    hitlMaxWait: 2,
    approvalMode: mockApprovalMode,
    taskQueue: 'cursor',
    sendStartEvent: true,
    sendActivityStartEvent: true,
    maxBodySize: null,
    requireGoalContext: mockRequireGoalContext,
    defaultGoal: mockDefaultGoal,
  })),
}));

vi.mock('../../ts/src/runtime/cursor/session-resolver.js', () => ({
  resolveSession: vi.fn((_env: any) => ({
    activity: vi.fn(async () => activityVerdict),
    openActivity: vi.fn(async () => ({
      activityId: 'cursor-handler-activity',
      verdict: activityVerdict,
    })),
    workflowStarted: vi.fn(async () => undefined),
    workflowCompleted: vi.fn(async () => undefined),
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
  activityVerdict = { arm: 'allow' };
  validateApiKeyCalls = 0;
  socketConnects = 0;
  socketEvents.length = 0;
  mockApprovalMode = 'remote';
  mockRequireGoalContext = false;
  mockDefaultGoal = undefined;
  mockPeekGoal = { goal: 'existing goal' };
  mockIsStarted = false;
  socketUnavailable = false;
  socketTimesOut = false;
  socketCloseThrows = false;
  validateApiKeyFails = false;
  process.env.OPENBOX_API_KEY = 'obx_test_cursor_handler';
  delete process.env.OPENBOX_AGENT_DID;
  delete process.env.OPENBOX_AGENT_PRIVATE_KEY;
  stdinIteratorSpy?.mockRestore?.();
  stdinIteratorSpy = vi
    .spyOn(process.stdin as any, Symbol.asyncIterator as any)
    .mockImplementation((async function* () {
      yield Buffer.from(JSON.stringify({
        conversation_id: 'cursor-handler-stdin',
        generation_id: 'cursor-handler-generation',
        hook_event_name: 'beforeShellExecution',
        command: 'pwd',
        cwd: '/tmp',
      }));
    }) as any);
});

afterEach(() => {
  stdinIteratorSpy?.mockRestore?.();
  stdinIteratorSpy = undefined;
  delete process.env.OPENBOX_API_KEY;
  delete process.env.OPENBOX_HOME;
  delete process.env.OPENBOX_AGENT_DID;
  delete process.env.OPENBOX_AGENT_PRIVATE_KEY;
});

describe('runtime/cursor/hook-handler; adapter orchestration', () => {
  it('registers Cursor handlers and exposes pending approval socket lifecycle', async () => {
    const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler.ts');

    await runCursorHook();

    expect(adapterOptions).toBeDefined();
    expect(adapterOptions.inlineApproval).toBe(false);
    expect(adapterOptions.approvalMaxWaitMs).toBe(2000);
    expect(Object.keys(adapterOptions.handlers)).toEqual(expect.arrayContaining([
      'beforeSubmitPrompt',
      'beforeShellExecution',
      'beforeMCPExecution',
      'beforeReadFile',
      'preToolUse',
      'beforeTabFileRead',
      'subagentStart',
      'subagentStop',
    ]));

    await adapterOptions.onPendingApproval(
      {
        approvalId: 'approval-1',
        governanceEventId: 'ge-1',
        reason: 'needs review',
        expiresAt: '2030-01-01T00:00:00.000Z',
      },
      {
        hook_event_name: 'beforeShellExecution',
        command: 'pwd',
        tool_name: 'Shell',
        tool_input: { command: 'pwd' },
      },
    );
    const decision = await adapterOptions.awaitExternalDecision(
      { approvalId: 'approval-1', governanceEventId: 'ge-1' },
      { hook_event_name: 'beforeShellExecution' },
    );
    adapterOptions.onApprovalResolved();

    expect(socketConnects).toBe(1);
    expect(validateApiKeyCalls).toBe(1);
    expect(socketEvents).toEqual([
      {
        type: 'pending',
        payload: expect.objectContaining({
          governance_event_id: 'ge-1',
          agent_id: 'agent-from-key',
          hook_event_name: 'beforeShellExecution',
          source: 'cursor',
          summary: 'pwd',
        }),
      },
      { type: 'await', id: 'ge-1' },
      { type: 'close' },
    ]);
    expect(decision).toEqual({ action: 'approve', reason: 'ok' });
  });

  it('does not surface observe-only approvals and supports inline mode', async () => {
    mockApprovalMode = 'inline';
    const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler.ts');

    await runCursorHook();
    await adapterOptions.onPendingApproval(
      { approvalId: 'observe-approval' },
      { hook_event_name: 'afterShellExecution', command: 'already-ran' },
    );
    const decision = await adapterOptions.awaitExternalDecision(
      { approvalId: 'observe-approval' },
      { hook_event_name: 'afterShellExecution' },
    );

    expect(adapterOptions.inlineApproval).toBe(true);
    expect(socketConnects).toBe(0);
    expect(decision).toBeUndefined();
  });

  it('passes signed agent identity through to the Core client', async () => {
    process.env.OPENBOX_AGENT_DID = 'did:aip:550e8400-e29b-41d4-a716-446655440000';
    // gitleaks:allow - deterministic test fixture generated above, not a credential.
    process.env.OPENBOX_AGENT_PRIVATE_KEY = FAKE_AGENT_PRIVATE_KEY;
    const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler.ts');

    await runCursorHook();

    expect(coreClientOptions?.agentIdentity).toEqual({
      did: 'did:aip:550e8400-e29b-41d4-a716-446655440000',
      privateKey: FAKE_AGENT_PRIVATE_KEY,
    });
  });

  it('covers approval socket alternate branches and summary sources', async () => {
    const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler.ts');

    await runCursorHook();
    await adapterOptions.onPendingApproval(
      { approvalId: 'tool-string', reason: 'review' },
      { hook_event_name: 'beforeMCPExecution', tool_name: 'Tool', tool_input: 'raw' },
    );
    await adapterOptions.onPendingApproval(
      { approvalId: 'tool-object' },
      { hook_event_name: 'beforeMCPExecution', tool_name: 'Tool', tool_input: { a: 1 } },
    );
    await adapterOptions.onPendingApproval(
      { approvalId: 'file-path' },
      { hook_event_name: 'beforeReadFile', file_path: '/tmp/secret.txt' },
    );
    await adapterOptions.onPendingApproval(
      { approvalId: 'prompt' },
      { hook_event_name: 'beforeSubmitPrompt', prompt: 'think about it' },
    );
    await adapterOptions.onPendingApproval(
      { approvalId: 'empty' },
      { hook_event_name: 'beforeSubmitPrompt' },
    );

    expect(socketEvents.filter((event) => event.type === 'pending').map((event) => event.payload.summary)).toEqual([
      'Tool(raw)',
      'Tool({"a":1})',
      '/tmp/secret.txt',
      'think about it',
      '',
    ]);

    socketTimesOut = true;
    await expect(
      adapterOptions.awaitExternalDecision(
        { approvalId: 'timeout' },
        { hook_event_name: 'beforeShellExecution' },
      ),
    ).resolves.toBeUndefined();

    socketCloseThrows = true;
    expect(() => adapterOptions.onApprovalResolved()).not.toThrow();
  });

  it('does not surface approvals when the socket is unavailable', async () => {
    const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler.ts');

    socketUnavailable = true;
    await runCursorHook();
    await adapterOptions.onPendingApproval(
      { approvalId: 'null' },
      { hook_event_name: 'beforeShellExecution', command: 'pwd' },
    );
    await expect(
      adapterOptions.awaitExternalDecision(
        { approvalId: 'null' },
        { hook_event_name: 'beforeShellExecution' },
      ),
    ).resolves.toBeUndefined();
    expect(socketConnects).toBe(1);
  });

  it('surfaces pending approvals without agent id when key validation fails', async () => {
    validateApiKeyFails = true;
    const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler.ts');

    await runCursorHook();
    await adapterOptions.onPendingApproval(
      { approvalId: 'validation-failure' },
      { hook_event_name: 'beforeShellExecution', command: 'pwd' },
    );

    expect(validateApiKeyCalls).toBe(1);
    expect(socketEvents).toContainEqual({
      type: 'pending',
      payload: expect.objectContaining({
        governance_event_id: 'validation-failure',
        agent_id: '',
        summary: 'pwd',
      }),
    });
  });

  it('invokes every registered live handler and records thrown mapper errors', async () => {
    const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler.ts');

    await runCursorHook();
    const session = {
      activity: vi.fn(async () => ({ arm: 'allow' })),
      openActivity: vi.fn(async () => ({
        activityId: 'cursor-live-handler-activity',
        verdict: { arm: 'allow' },
      })),
      workflowStarted: vi.fn(async () => undefined),
      workflowCompleted: vi.fn(async () => undefined),
    };
    const base = {
      conversation_id: `hook-handler-${Date.now()}`,
      generation_id: `gen-${Date.now()}`,
      hook_event_name: 'beforeShellExecution',
      prompt: 'say ok',
      command: 'pwd',
      file_path: '/tmp/openbox-cursor-handler-outside.txt',
      cwd: '/tmp',
      workspace_roots: ['/project/root'],
      server_name: 'openbox',
      tool_name: 'Shell',
      tool_input: { command: 'pwd', cwd: '/tmp' },
      response: { content: [{ type: 'text', text: 'ok' }] },
      subagent_id: 'subagent-1',
      subagent_name: 'reviewer',
    };

    await adapterOptions.handlers.beforeSubmitPrompt(base, session);
    await adapterOptions.handlers.beforeShellExecution(base, session);
    await adapterOptions.handlers.beforeMCPExecution(base, session);
    await adapterOptions.handlers.beforeReadFile(base, session);
    await adapterOptions.handlers.preToolUse({ ...base, generation_id: `gen-pre-${Date.now()}` }, session);
    await adapterOptions.handlers.afterMCPExecution(base, session);
    await adapterOptions.handlers.afterAgentResponse(base, session);
    await adapterOptions.handlers.afterAgentThought(base, session);
    await adapterOptions.handlers.afterShellExecution(base, session);
    await adapterOptions.handlers.afterFileEdit(base, session);
    await adapterOptions.handlers.sessionStart(base, session);
    await adapterOptions.handlers.stop(base, session);
    await adapterOptions.handlers.postToolUse(base, session);
    await adapterOptions.handlers.postToolUseFailure(base, session);
    await adapterOptions.handlers.beforeTabFileRead({ ...base, file_path: '/tmp/openbox-tab-read.txt' }, session);
    await adapterOptions.handlers.afterTabFileEdit(base, session);
    await adapterOptions.handlers.sessionEnd(base, session);
    await adapterOptions.handlers.preCompact(base, session);
    await adapterOptions.handlers.subagentStart(base, session);
    await adapterOptions.handlers.subagentStop(base, session);

    expect(session.activity).toHaveBeenCalled();
    const failingSession = {
      ...session,
      activity: vi.fn(async () => {
        throw new Error('mapper failed');
      }),
      openActivity: vi.fn(async () => {
        throw new Error('mapper failed');
      }),
    };
    await expect(
      adapterOptions.handlers.subagentStart(base, failingSession),
    ).resolves.toMatchObject({
      arm: 'block',
      reason: expect.stringContaining('mapper failed'),
    });
  });

  it('fails closed when Core returns a governance-checks-incomplete allow for a decision hook', async () => {
    const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler.ts');

    await runCursorHook();
    const session = {
      activity: vi.fn(async () => ({ arm: 'allow' })),
      openActivity: vi.fn(async () => ({
        activityId: 'cursor-governance-checks-incomplete-activity',
        verdict: {
          arm: 'allow',
          riskScore: 0,
          governanceChecksIncomplete: true,
        },
      })),
      workflowStarted: vi.fn(async () => undefined),
      workflowCompleted: vi.fn(async () => undefined),
    };

    await expect(
      adapterOptions.handlers.beforeShellExecution(
        {
          conversation_id: 'cursor-governance-checks-incomplete',
          generation_id: 'cursor-governance-checks-incomplete-generation',
          hook_event_name: 'beforeShellExecution',
          command: 'pwd',
          cwd: '/tmp',
        },
        session,
      ),
    ).resolves.toMatchObject({
      arm: 'block',
      reason: expect.stringContaining('required governance checks did not complete'),
    });
  });

  it('does not replay WorkflowStarted after the session store says the workflow is started', async () => {
    mockIsStarted = true;
    const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler.ts');

    await runCursorHook();
    const session = {
      activity: vi.fn(async () => ({ arm: 'allow' })),
      openActivity: vi.fn(async () => ({
        activityId: 'cursor-started-session',
        verdict: { arm: 'allow' },
      })),
      workflowStarted: vi.fn(async () => undefined),
      workflowCompleted: vi.fn(async () => undefined),
    };

    await expect(
      adapterOptions.handlers.beforeShellExecution(
        {
          conversation_id: 'cursor-started',
          generation_id: 'cursor-started-generation',
          hook_event_name: 'beforeShellExecution',
          command: 'pwd',
          cwd: '/tmp',
        },
        session,
      ),
    ).resolves.toMatchObject({
      arm: 'allow',
    });
    expect(session.workflowStarted).not.toHaveBeenCalled();
    expect(session.openActivity).toHaveBeenCalledTimes(1);
  });

  it('fails closed in strict goal mode when a permission gate has no session goal', async () => {
    mockRequireGoalContext = true;
    mockPeekGoal = null;
    const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler.ts');

    await runCursorHook();
    const session = {
      activity: vi.fn(async () => ({ arm: 'allow' })),
      openActivity: vi.fn(async () => ({
        activityId: 'cursor-strict-goal',
        verdict: { arm: 'allow' },
      })),
      workflowStarted: vi.fn(async () => undefined),
      workflowCompleted: vi.fn(async () => undefined),
    };

    await expect(
      adapterOptions.handlers.beforeShellExecution(
        {
          conversation_id: 'cursor-strict',
          generation_id: 'cursor-strict-generation',
          hook_event_name: 'beforeShellExecution',
          command: 'pwd',
          cwd: '/tmp',
        },
        session,
      ),
    ).resolves.toMatchObject({
      arm: 'block',
      reason: expect.stringContaining('goal context is required'),
    });
    expect(session.openActivity).not.toHaveBeenCalled();
  });

  it('writes fail-closed deny output when no API key is configured', async () => {
    delete process.env.OPENBOX_API_KEY;
    let stdout = '';
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: any) => {
      stdout += String(chunk);
      return true;
    }) as any);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler.ts');

    await expect(runCursorHook()).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(0);
    expect(JSON.parse(stdout)).toMatchObject({
      permission: 'deny',
      user_message: expect.stringContaining('missing OPENBOX_API_KEY'),
    });
    write.mockRestore();
  });
});
