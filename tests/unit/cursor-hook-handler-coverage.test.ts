import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let adapterOptions: any;
let activityVerdict: any = { arm: 'allow' };
let validateApiKeyCalls = 0;
let socketConnects = 0;
const socketEvents: any[] = [];

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
    return {
      notifyPending: (payload: any) => socketEvents.push({ type: 'pending', payload }),
      awaitDecision: async (id: string) => {
        socketEvents.push({ type: 'await', id });
        return { kind: 'decision', decision: { action: 'approve', reason: 'ok' } };
      },
      close: () => socketEvents.push({ type: 'close' }),
    };
  }),
}));

vi.mock('../../ts/src/core-client/index.js', () => ({
  OpenBoxCoreClient: class {
    constructor(public opts: any) {}
    async validateApiKey() {
      validateApiKeyCalls += 1;
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
  loadConfig: vi.fn(() => ({
    openboxApiKey: process.env.OPENBOX_API_KEY ?? '',
    openboxEndpoint: 'http://core.test',
    governancePolicy: 'fail_open',
    governanceTimeout: 15,
    activityType: 'CursorIDE',
    sessionDir: '/tmp/openbox-cursor-hook-handler-test',
    logFile: null,
    verbose: false,
    dryRun: process.env.DRY_RUN === 'true',
    hitlEnabled: true,
    hitlPollInterval: 5,
    hitlMaxWait: 2,
    approvalMode: process.env.APPROVAL_MODE === 'inline' ? 'inline' : 'remote',
    taskQueue: 'cursor-hooks',
    sendStartEvent: true,
    sendActivityStartEvent: true,
    maxBodySize: null,
    skipActivityTypes: [],
    testDriftResponse: null,
  })),
}));

vi.mock('../../ts/src/runtime/cursor/session-resolver.js', () => ({
  resolveSession: vi.fn((_env: any) => ({
    activity: vi.fn(async () => activityVerdict),
    workflowStarted: vi.fn(async () => undefined),
    workflowCompleted: vi.fn(async () => undefined),
  })),
  markHalted: vi.fn(),
  clearSession: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  adapterOptions = undefined;
  activityVerdict = { arm: 'allow' };
  validateApiKeyCalls = 0;
  socketConnects = 0;
  socketEvents.length = 0;
  process.env.OPENBOX_API_KEY = 'obx_test_cursor_handler';
  delete process.env.DRY_RUN;
  delete process.env.APPROVAL_MODE;
});

afterEach(() => {
  delete process.env.OPENBOX_API_KEY;
  delete process.env.DRY_RUN;
  delete process.env.APPROVAL_MODE;
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
    process.env.APPROVAL_MODE = 'inline';
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

  it('dry-run handlers pass through without calling governance mappers', async () => {
    process.env.DRY_RUN = 'true';
    const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler.ts');

    await runCursorHook();
    const out = await adapterOptions.handlers.beforeSubmitPrompt(
      { conversation_id: 'c', prompt: 'hello' },
      { activity: vi.fn(async () => ({ arm: 'block', reason: 'should not run' })) },
    );

    expect(out).toBeUndefined();
  });

  it('invokes every registered live handler and records thrown mapper errors', async () => {
    const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler.ts');

    await runCursorHook();
    const session = {
      activity: vi.fn(async () => ({ arm: 'allow' })),
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
      workspace_roots: ['/workspace/project'],
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
    };
    await expect(
      adapterOptions.handlers.subagentStart(base, failingSession),
    ).rejects.toThrow('mapper failed');
  });

  it('exits fail-open when no API key is configured', async () => {
    delete process.env.OPENBOX_API_KEY;
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const { runCursorHook } = await import('../../ts/src/runtime/cursor/hook-handler.ts');

    await expect(runCursorHook()).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(0);
  });
});
