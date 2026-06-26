import { existsSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let adapterOptions: any;
let coreClientOptions: any;
let stdinIteratorSpy: any;
let mockHitlMaxWait = 2;
let mockApprovalMode: 'remote' | 'inline' | 'defer' = 'remote';
let mockWorktreeRoot = '/tmp/openbox-claude-hook-handler-test/worktrees';
let mockRequireGoalContext = false;
let mockDefaultGoal: string | undefined;
let mockPeekGoal: unknown = { goal: 'existing goal' };
let mockIsStarted = false;
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
  getConfigDir: vi.fn(() => '/tmp/openbox-claude-hook-handler-test/.openbox/claude-code'),
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
    sessionDir: '/tmp/openbox-claude-hook-handler-test',
    logFile: null,
    verbose: false,
    hitlEnabled: true,
    hitlPollInterval: 5,
    hitlMaxWait: mockHitlMaxWait,
    approvalMode: mockApprovalMode,
    taskQueue: 'claude-code-hooks',
    sendStartEvent: true,
    sendActivityStartEvent: true,
    maxBodySize: null,
    requireGoalContext: mockRequireGoalContext,
    defaultGoal: mockDefaultGoal,
    worktreeRoot: mockWorktreeRoot,
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
  mockHitlMaxWait = 2;
  mockApprovalMode = 'remote';
  mockWorktreeRoot = '/tmp/openbox-claude-hook-handler-test/worktrees';
  mockRequireGoalContext = false;
  mockDefaultGoal = undefined;
  mockPeekGoal = { goal: 'existing goal' };
  mockIsStarted = false;
  rmSync(mockWorktreeRoot, { recursive: true, force: true });
  process.env.OPENBOX_API_KEY = 'obx_test_claude_handler';
  delete process.env.OPENBOX_AGENT_DID;
  delete process.env.OPENBOX_AGENT_PRIVATE_KEY;
  delete process.env.OPENBOX_HOME;
});

afterEach(() => {
  stdinIteratorSpy?.mockRestore?.();
  stdinIteratorSpy = undefined;
  delete process.env.OPENBOX_API_KEY;
  delete process.env.OPENBOX_AGENT_DID;
  delete process.env.OPENBOX_AGENT_PRIVATE_KEY;
  rmSync(mockWorktreeRoot, { recursive: true, force: true });
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
    mockHitlMaxWait = 9999;
    mockApprovalMode = 'inline';
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
      'worktreeCreate',
      'worktreeRemove',
      'elicitation',
      'elicitationResult',
    ]));
  });

  it('creates an opt-in managed WorktreeCreate path after Core allows it', async () => {
    mockHookStdin();
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await runClaudeHook();
    const env: Record<string, any> = {
      ...baseEnv,
      hook_event_name: 'WorktreeCreate',
      name: 'Feature Auth!*',
    };
    const session = {
      activity: vi.fn(async () => ({ arm: 'allow', riskScore: 0 })),
    };

    await expect(
      adapterOptions.handlers.worktreeCreate(env, session),
    ).resolves.toMatchObject({ arm: 'allow' });

    expect(env.worktree_path).toMatch(
      /^\/tmp\/openbox-claude-hook-handler-test\/worktrees\/Feature-Auth-[a-z0-9]+$/,
    );
    expect(existsSync(env.worktree_path)).toBe(true);
    expect(session.activity).toHaveBeenCalledWith(
      'ActivityStarted',
      'ClaudeCodeWorkspaceChange',
      expect.objectContaining({
        input: [
          expect.objectContaining({
            _openbox_source: 'claude-code',
            event_category: 'worktree_create',
            name: 'Feature Auth!*',
            worktree_path: env.worktree_path,
          }),
        ],
      }),
    );
  });

  it('does not create a WorktreeCreate path when Core blocks it', async () => {
    mockHookStdin();
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await runClaudeHook();
    const env: Record<string, any> = {
      ...baseEnv,
      hook_event_name: 'WorktreeCreate',
      name: 'blocked-worktree',
    };
    const session = {
      activity: vi.fn(async () => ({
        arm: 'block',
        reason: 'blocked',
        riskScore: 1,
      })),
    };

    await expect(
      adapterOptions.handlers.worktreeCreate(env, session),
    ).resolves.toMatchObject({ arm: 'block' });

    expect(env.worktree_path).toBeUndefined();
    expect(existsSync(mockWorktreeRoot)).toBe(false);
  });

  it('decision-capable handler errors return a fail-closed verdict', async () => {
    mockHookStdin();
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await runClaudeHook();
    const session = {
      workflowStarted: vi.fn(async () => undefined),
      activity: vi.fn(async () => {
        throw new Error('mapper failed');
      }),
      openActivity: vi.fn(async () => {
        throw new Error('mapper failed');
      }),
    };
    await expect(adapterOptions.handlers.preToolUse(baseEnv, session)).resolves.toMatchObject({
      arm: 'block',
      reason: expect.stringContaining('mapper failed'),
    });
  });

  it('starts the workflow before decision-capable tool gates', async () => {
    mockHookStdin();
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await runClaudeHook();
    const session = {
      workflowStarted: vi.fn(async () => undefined),
      openActivity: vi.fn(async () => ({
        activityId: 'activity-test',
        verdict: { arm: 'block', reason: 'blocked' },
      })),
    };

    await expect(adapterOptions.handlers.preToolUse(baseEnv, session)).resolves.toMatchObject({
      arm: 'block',
      reason: 'blocked',
    });
    expect(session.workflowStarted).toHaveBeenCalledTimes(1);
    expect(session.openActivity).toHaveBeenCalledTimes(1);
    expect(session.workflowStarted.mock.invocationCallOrder[0]).toBeLessThan(
      session.openActivity.mock.invocationCallOrder[0],
    );
  });

  it('does not replay WorkflowStarted after the session store says the workflow is started', async () => {
    mockIsStarted = true;
    mockHookStdin();
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await runClaudeHook();
    const session = {
      workflowStarted: vi.fn(async () => undefined),
      openActivity: vi.fn(async () => ({
        activityId: 'activity-test',
        verdict: { arm: 'allow' },
      })),
    };

    await expect(adapterOptions.handlers.preToolUse(baseEnv, session)).resolves.toMatchObject({
      arm: 'allow',
    });
    expect(session.workflowStarted).not.toHaveBeenCalled();
    expect(session.openActivity).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a decision-capable hook gets a governance-checks-incomplete allow', async () => {
    mockHookStdin();
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await runClaudeHook();
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
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await runClaudeHook();
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

  it('passes signed agent identity through to the Core client', async () => {
    process.env.OPENBOX_AGENT_DID = 'did:aip:550e8400-e29b-41d4-a716-446655440000';
    // gitleaks:allow - deterministic test fixture generated above, not a credential.
    process.env.OPENBOX_AGENT_PRIVATE_KEY = FAKE_AGENT_PRIVATE_KEY;
    mockHookStdin();
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await runClaudeHook();

    expect(coreClientOptions?.agentIdentity).toEqual({
      did: 'did:aip:550e8400-e29b-41d4-a716-446655440000',
      privateKey: FAKE_AGENT_PRIVATE_KEY,
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
      openActivity: vi.fn(async () => {
        throw new Error('mapper failed');
      }),
    };
    await expect(adapterOptions.handlers.preToolUse(baseEnv, failingSession)).resolves.toMatchObject({
      arm: 'block',
      reason: expect.stringContaining('mapper failed'),
    });
  });

  it('writes fail-closed deny output when no API key is configured', async () => {
    delete process.env.OPENBOX_API_KEY;
    mockHookStdin();
    let stdout = '';
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: any) => {
      stdout += String(chunk);
      return true;
    }) as any);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const { runClaudeHook } = await import('../../ts/src/runtime/claude-code/hook-handler.ts');

    await expect(runClaudeHook()).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(0);
    expect(JSON.parse(stdout)).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('missing OPENBOX_API_KEY'),
      },
    });
    write.mockRestore();
  });
});
