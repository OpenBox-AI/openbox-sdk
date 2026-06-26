import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HOOK_EVENTS as ANTHROPIC_AGENT_HOOK_EVENTS } from '@anthropic-ai/claude-agent-sdk';
import type {
  HookCallbackMatcher,
  HookInput,
  HookJSONOutput,
  Query,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
  OPENBOX_ANTHROPIC_AGENT_DEFAULT_HOOK_EVENTS,
  OPENBOX_ANTHROPIC_AGENT_OPT_IN_HOOK_EVENTS,
  createOpenBoxAnthropicAgentHooks,
  createOpenBoxAnthropicAgentSDK,
  verifyOpenBoxAnthropicAgentSDKConfig,
  withOpenBoxAnthropicAgentOptions,
} from '@openbox-ai/openbox-sdk/anthropic-agent-sdk';
import type {
  GovernanceEventPayload,
  GovernanceVerdictResponse,
  OpenBoxCoreClient,
} from '../../ts/src/core-client/index.js';

type VerdictArm = NonNullable<GovernanceVerdictResponse['verdict']>;
const RUNTIME_ENV_KEYS = [
  'OPENBOX_API_KEY',
  'OPENBOX_CORE_URL',
  'OPENBOX_AGENT_DID',
  'OPENBOX_AGENT_PRIVATE_KEY',
] as const;

function createMockCore(
  resolve: (payload: GovernanceEventPayload) => Partial<GovernanceVerdictResponse>,
) {
  const events: GovernanceEventPayload[] = [];
  return {
    events,
    core: {
      evaluate: vi.fn(async (payload: GovernanceEventPayload) => {
        events.push(payload);
        return {
          governance_event_id: `evt_${events.length}`,
          verdict: 'allow',
          action: 'allow',
          risk_score: 0,
          ...resolve(payload),
        } satisfies Partial<GovernanceVerdictResponse>;
      }),
      pollApproval: vi.fn(),
    } as unknown as OpenBoxCoreClient,
  };
}

function verdict(
  arm: VerdictArm,
  extra: Partial<GovernanceVerdictResponse> = {},
): Partial<GovernanceVerdictResponse> {
  return {
    verdict: arm,
    action: arm,
    risk_score: 0,
    ...extra,
  };
}

function withRuntimeEnv<T>(
  values: Partial<Record<(typeof RUNTIME_ENV_KEYS)[number], string | undefined>>,
  fn: () => T,
): T {
  const previous = Object.fromEntries(
    RUNTIME_ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Partial<Record<(typeof RUNTIME_ENV_KEYS)[number], string | undefined>>;
  for (const key of RUNTIME_ENV_KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of RUNTIME_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runHook(
  hooks: ReturnType<typeof createOpenBoxAnthropicAgentHooks>,
  event: keyof ReturnType<typeof createOpenBoxAnthropicAgentHooks>,
  input: Record<string, unknown>,
  toolUseId?: string,
): Promise<HookJSONOutput> {
  const matcher = hooks[event]?.[0];
  expect(matcher).toBeDefined();
  return matcher!.hooks[0](
    input as HookInput,
    toolUseId,
    { signal: new AbortController().signal },
  );
}

const baseInput = {
  hook_event_name: 'PreToolUse',
  session_id: 'sess_agent_sdk',
  transcript_path: '/tmp/transcript.jsonl',
  cwd: '/tmp/project',
};

describe('Anthropic Agent SDK OpenBox adapter', () => {
  it('diagnoses runtime-only Anthropic Agent SDK configuration without host file mutation', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'openbox-anthropic-agent-sdk-doctor-'));

    const checks = withRuntimeEnv(
      {
        OPENBOX_API_KEY: 'obx_live_runtime',
        OPENBOX_CORE_URL: 'https://core.openbox.test',
        OPENBOX_AGENT_DID: undefined,
        OPENBOX_AGENT_PRIVATE_KEY: undefined,
      },
      () => verifyOpenBoxAnthropicAgentSDKConfig({ worktreeRoot: join(cwd, 'worktrees') }),
    );
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'runtime-enabled', status: 'pass' }),
        expect.objectContaining({ name: 'api-key', status: 'pass' }),
        expect.objectContaining({ name: 'core-url', status: 'pass' }),
        expect.objectContaining({ name: 'signed-agent-identity', status: 'skip' }),
        expect.objectContaining({ name: 'runtime-defaults', status: 'pass' }),
      ]),
    );
    expect(existsSync(join(cwd, 'worktrees'))).toBe(false);

    const failures = withRuntimeEnv(
      {
        OPENBOX_API_KEY: 'not-a-runtime-key',
        OPENBOX_CORE_URL: undefined,
        OPENBOX_AGENT_DID: 'did:aip:550e8400-e29b-41d4-a716-446655440000',
        OPENBOX_AGENT_PRIVATE_KEY: undefined,
      },
      () => verifyOpenBoxAnthropicAgentSDKConfig({ worktreeRoot: join(cwd, 'worktrees') }),
    );
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'api-key', status: 'fail' }),
        expect.objectContaining({ name: 'core-url', status: 'fail' }),
        expect.objectContaining({ name: 'signed-agent-identity', status: 'fail' }),
      ]),
    );
    expect(existsSync(join(cwd, 'worktrees'))).toBe(false);
  });

  it('reads optional project-local Anthropic Agent SDK runtime config without mutation', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'openbox-anthropic-agent-sdk-config-'));
    const configDir = join(cwd, '.openbox', 'anthropic-agent-sdk');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, '.env'),
      [
        'OPENBOX_API_KEY="obx_live_project"',
        'OPENBOX_CORE_URL="https://core.project.test"',
        'OPENBOX_AGENT_DID="did:aip:550e8400-e29b-41d4-a716-446655440000"',
        `OPENBOX_AGENT_PRIVATE_KEY="${Buffer.alloc(32, 1).toString('base64')}"`,
      ].join('\n') + '\n',
    );

    const checks = withRuntimeEnv(
      {
        OPENBOX_API_KEY: undefined,
        OPENBOX_CORE_URL: undefined,
        OPENBOX_AGENT_DID: undefined,
        OPENBOX_AGENT_PRIVATE_KEY: undefined,
      },
      () => verifyOpenBoxAnthropicAgentSDKConfig({ cwd, worktreeRoot: join(cwd, 'worktrees') }),
    );

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'api-key', status: 'pass' }),
        expect.objectContaining({ name: 'core-url', status: 'pass' }),
        expect.objectContaining({ name: 'signed-agent-identity', status: 'pass' }),
      ]),
    );
    expect(existsSync(join(cwd, 'worktrees'))).toBe(false);
  });

  it('prepends OpenBox hooks without mutating user options', () => {
    const mock = createMockCore(() => verdict('allow'));
    const userHook = vi.fn(async () => ({}));
    const userMatcher = {
      matcher: 'Bash',
      hooks: [userHook],
      timeout: 3,
    } satisfies HookCallbackMatcher;
    const options = {
      hooks: {
        PreToolUse: [userMatcher],
      },
    };

    const wrapped = withOpenBoxAnthropicAgentOptions(options, {
      core: mock.core,
      hookTimeoutSeconds: 7,
    });

    expect(wrapped).not.toBe(options);
    expect(wrapped.hooks).not.toBe(options.hooks);
    expect(wrapped.hooks?.PreToolUse).not.toBe(options.hooks.PreToolUse);
    expect(options.hooks.PreToolUse).toEqual([userMatcher]);
    expect(wrapped.hooks?.PreToolUse?.[0]).toMatchObject({ timeout: 7 });
    expect(wrapped.hooks?.PreToolUse?.[1]).toBe(userMatcher);
  });

  it('registers every official Agent SDK hook except WorktreeCreate by default', () => {
    const mock = createMockCore(() => verdict('allow'));
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });
    const registered = Object.keys(hooks).sort();
    const expectedDefaultEvents = ANTHROPIC_AGENT_HOOK_EVENTS.filter(
      (event) => event !== 'WorktreeCreate',
    );

    expect(OPENBOX_ANTHROPIC_AGENT_DEFAULT_HOOK_EVENTS).toEqual(expectedDefaultEvents);
    expect(registered).toEqual(expectedDefaultEvents.slice().sort());
    expect(registered).toEqual(
      [...OPENBOX_ANTHROPIC_AGENT_DEFAULT_HOOK_EVENTS].sort(),
    );
    expect(OPENBOX_ANTHROPIC_AGENT_OPT_IN_HOOK_EVENTS).toEqual([
      'WorktreeCreate',
    ]);
    expect((hooks as Record<string, unknown>).WorktreeCreate).toBeUndefined();
  });

  it('registers WorktreeCreate only when opt-in and returns a managed path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openbox-anthropic-worktrees-'));
    try {
      const mock = createMockCore(() => verdict('allow'));
      const hooks = createOpenBoxAnthropicAgentHooks({
        core: mock.core,
        includeOptInHooks: true,
        worktreeRoot: root,
      });

      expect(Object.keys(hooks).sort()).toEqual(
        [...OPENBOX_ANTHROPIC_AGENT_DEFAULT_HOOK_EVENTS, ...OPENBOX_ANTHROPIC_AGENT_OPT_IN_HOOK_EVENTS].sort(),
      );

      const output = await runHook(hooks, 'WorktreeCreate', {
        ...baseInput,
        hook_event_name: 'WorktreeCreate',
        name: 'feature/test branch',
      });
      const hookOutput = (output as Record<string, unknown>).hookSpecificOutput as Record<string, unknown>;
      const worktreePath = String(hookOutput.worktreePath);

      expect(hookOutput.hookEventName).toBe('WorktreeCreate');
      expect(worktreePath).toContain(root);
      expect(worktreePath).toContain('feature-test-branch');
      expect(existsSync(worktreePath)).toBe(true);
      expect(mock.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event_type: 'ActivityStarted',
            activity_type: 'AnthropicAgentSDKWorkspaceChange',
            activity_input: [
              expect.objectContaining({
                event_category: 'worktree_create',
                worktree_path: worktreePath,
              }),
            ],
          }),
        ]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('observes generic Agent SDK hooks without decision output', async () => {
    const mock = createMockCore(() => verdict('allow'));
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    await expect(runHook(hooks, 'Setup', {
      ...baseInput,
      hook_event_name: 'Setup',
      trigger: 'init',
    })).resolves.toEqual({});
    await expect(runHook(hooks, 'Notification', {
      ...baseInput,
      hook_event_name: 'Notification',
      message: 'background task finished',
      notification_type: 'info',
    })).resolves.toEqual({});
    await expect(runHook(hooks, 'CwdChanged', {
      ...baseInput,
      hook_event_name: 'CwdChanged',
      old_cwd: '/tmp/old',
      new_cwd: '/tmp/new',
    })).resolves.toEqual({});

    expect(mock.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'ActivityStarted',
          activity_type: 'AnthropicAgentSDKSession',
          activity_input: [expect.objectContaining({ event_category: 'setup' })],
        }),
        expect.objectContaining({
          event_type: 'SignalReceived',
          activity_type: 'AnthropicAgentSDKMessage',
          activity_input: [expect.objectContaining({ event_category: 'agent_notification' })],
        }),
        expect.objectContaining({
          event_type: 'SignalReceived',
          activity_type: 'AnthropicAgentSDKWorkspaceChange',
          activity_input: [expect.objectContaining({ event_category: 'cwd_changed' })],
        }),
      ]),
    );
  });

  it('emits prompt submit gate after the goal signal with LLM hook spans', async () => {
    const mock = createMockCore(() => verdict('allow'));
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    const output = await runHook(hooks, 'UserPromptSubmit', {
      ...baseInput,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Summarize this repository.',
    });

    expect(output).toEqual({});
    const signalEvent = mock.events.find(
      (event) =>
        event.event_type === 'SignalReceived' &&
        event.activity_type === 'user_prompt',
    );
    expect(signalEvent).toMatchObject({
      session_id: 'sess_agent_sdk',
      signal_name: 'user_prompt',
      signal_args: 'Summarize this repository.',
      prompt: 'Summarize this repository.',
      activity_input: [
        expect.objectContaining({
          prompt: 'Summarize this repository.',
          session_id: 'sess_agent_sdk',
          event_category: 'agent_goal',
          _openbox_source: 'anthropic-agent-sdk',
        }),
      ],
    });
    expect(signalEvent?.hook_trigger).toBe(false);
    expect(signalEvent?.spans).toBeUndefined();
    expect(signalEvent?.span_count).toBeUndefined();
    const promptEvents = mock.events.filter(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'PromptSubmission',
    );
    expect(promptEvents).toHaveLength(2);
    const parent = promptEvents.find((event) => event.hook_trigger !== true);
    const hook = promptEvents.find((event) => event.hook_trigger === true);
    expect(parent).toBeDefined();
    expect(hook).toBeDefined();
    expect(parent!.hook_trigger).toBe(false);
    expect(parent!.spans).toBeUndefined();
    expect(parent!.span_count).toBeUndefined();
    expect(parent!.prompt).toBe('Summarize this repository.');
    expect(mock.events.indexOf(signalEvent!)).toBeLessThan(mock.events.indexOf(parent!));
    expect(parent!.activity_input).toEqual([
      expect.objectContaining({
        event_category: 'llm_prompt',
        prompt: 'Summarize this repository.',
        _openbox_source: 'anthropic-agent-sdk',
      }),
    ]);
    expect(hook).toMatchObject({
      workflow_id: parent!.workflow_id,
      run_id: parent!.run_id,
      activity_id: parent!.activity_id,
      activity_type: parent!.activity_type,
      hook_trigger: true,
      span_count: 1,
    });
    expect(hook?.spans?.[0]).toMatchObject({
      name: 'llm.chat.completion',
      module: 'anthropic-agent-sdk',
      stage: 'started',
      attributes: expect.objectContaining({
        'gen_ai.system': 'anthropic-agent-sdk',
        'http.method': 'POST',
      }),
    });
    expect(JSON.parse(String((hook?.spans?.[0] as any)?.request_body)).messages[0].content).toBe(
      'Summarize this repository.',
    );
  });

  it('gates prompt expansions with LLM hook spans', async () => {
    const mock = createMockCore((payload) =>
      payload.event_type === 'ActivityStarted' &&
      payload.activity_type === 'PromptSubmission' &&
      payload.hook_trigger !== true
        ? verdict('block', { reason: 'slash expansion not allowed' })
        : verdict('allow'),
    );
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    const output = await runHook(hooks, 'UserPromptExpansion', {
      ...baseInput,
      hook_event_name: 'UserPromptExpansion',
      expansion_type: 'slash_command',
      command_name: 'deploy',
      command_args: 'production',
      prompt: 'Deploy production now.',
    });

    expect(output).toEqual({
      decision: 'block',
      reason: '[OpenBox] slash expansion not allowed',
    });
    const promptEvents = mock.events.filter(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'PromptSubmission',
    );
    expect(promptEvents).toHaveLength(2);
    const parent = promptEvents.find((event) => event.hook_trigger !== true);
    const hook = promptEvents.find((event) => event.hook_trigger === true);
    expect(parent).toBeDefined();
    expect(hook).toBeDefined();
    expect(parent!.activity_input).toEqual([
      expect.objectContaining({
        event_category: 'llm_prompt_expansion',
        command_name: 'deploy',
        command_args: 'production',
        prompt: 'Deploy production now.',
      }),
    ]);
    expect(parent!.spans).toBeUndefined();
    expect(parent!.span_count).toBeUndefined();
    expect(hook).toMatchObject({
      workflow_id: parent!.workflow_id,
      run_id: parent!.run_id,
      activity_id: parent!.activity_id,
      activity_type: parent!.activity_type,
      hook_trigger: true,
      span_count: 1,
    });
    expect(hook?.spans?.[0]).toMatchObject({
      name: 'llm.chat.completion',
      module: 'anthropic-agent-sdk',
      stage: 'started',
      attributes: expect.objectContaining({
        'gen_ai.system': 'anthropic-agent-sdk',
        'http.method': 'POST',
      }),
    });
    expect(JSON.parse(String((hook?.spans?.[0] as any)?.request_body)).messages[0].content).toBe(
      'Deploy production now.',
    );
  });

  it('fails closed when prompt redaction cannot be applied by the host', async () => {
    const mock = createMockCore((payload) =>
      payload.event_type === 'ActivityStarted' &&
      payload.activity_type === 'PromptSubmission'
        ? verdict('constrain', {
            reason: 'prompt redacted',
            guardrails_result: {
              input_type: 'activity_input',
              redacted_input: [{ prompt: 'Summarize [redacted].' }],
              validation_passed: true,
              reasons: [],
              results: [],
              raw_logs: {},
            },
          })
        : verdict('allow'),
    );
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    const output = await runHook(hooks, 'UserPromptSubmit', {
      ...baseInput,
      prompt: 'Summarize secret.',
    });

    expect(output).toEqual({
      decision: 'block',
      reason: '[OpenBox] prompt redacted',
    });
  });

  it('fails closed on field-only prompt redaction without replacement input', async () => {
    const mock = createMockCore((payload) =>
      payload.event_type === 'ActivityStarted' &&
      payload.activity_type === 'PromptSubmission'
        ? verdict('constrain', {
            reason: 'prompt redacted',
            guardrails_result: {
              input_type: 'activity_input',
              validation_passed: true,
              reasons: [],
              field_results: [{ field: 'prompt', status: 'redacted' }],
              raw_logs: {},
            },
          })
        : verdict('allow'),
    );
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    const output = await runHook(hooks, 'UserPromptSubmit', {
      ...baseInput,
      prompt: 'Summarize secret.',
    });

    expect(output).toEqual({
      decision: 'block',
      reason: '[OpenBox] prompt redacted',
    });
  });

  it('maps a constrained PreToolUse verdict to allow plus updated input', async () => {
    const mock = createMockCore((payload) => {
      if (payload.event_type === 'ActivityStarted') {
        return verdict('constrain', {
          reason: 'redacted shell command',
          guardrails_result: {
            input_type: 'activity_input',
            redacted_input: [{ command: 'echo [redacted]' }],
            validation_passed: true,
            reasons: [],
            results: [],
            raw_logs: {},
          },
        });
      }
      return verdict('allow');
    });
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    const output = await runHook(hooks, 'PreToolUse', {
      ...baseInput,
      tool_name: 'Bash',
      tool_input: { command: 'echo secret' },
      tool_use_id: 'tool_1',
    });

    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { command: 'echo [redacted]' },
        additionalContext: '[OpenBox] redacted shell command',
      },
    });
  });

  it('denies constrained PreToolUse when field-only input redaction has no replacement', async () => {
    const mock = createMockCore((payload) => {
      if (payload.event_type === 'ActivityStarted') {
        return verdict('constrain', {
          reason: 'redacted shell command',
          guardrails_result: {
            input_type: 'activity_input',
            validation_passed: true,
            reasons: [],
            field_results: [{ field: 'command', status: 'redacted' }],
            raw_logs: {},
          },
        });
      }
      return verdict('allow');
    });
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    const output = await runHook(hooks, 'PreToolUse', {
      ...baseInput,
      tool_name: 'Bash',
      tool_input: { command: 'cat secret.txt' },
      tool_use_id: 'tool_field_only',
    });

    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          '[OpenBox] redacted shell command. OpenBox did not provide replacement input, so the original action was blocked.',
      },
    });
  });

  it('maps approval-required PreToolUse verdicts to ask or defer', async () => {
    const createApprovalCore = () =>
      createMockCore((payload) =>
        payload.event_type === 'ActivityStarted'
          ? verdict('require_approval', { reason: 'needs reviewer' })
          : verdict('allow'),
      );
    const askMock = createApprovalCore();
    const deferMock = createApprovalCore();

    const askOutput = await runHook(
      createOpenBoxAnthropicAgentHooks({ core: askMock.core }),
      'PreToolUse',
      {
        ...baseInput,
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf tmp' },
        tool_use_id: 'tool_ask',
      },
    );
    const deferOutput = await runHook(
      createOpenBoxAnthropicAgentHooks({
        core: deferMock.core,
        approvalMode: 'defer',
      }),
      'PreToolUse',
      {
        ...baseInput,
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf tmp' },
        tool_use_id: 'tool_defer',
      },
    );

    expect(askOutput).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: '[OpenBox] needs reviewer',
      },
    });
    expect(deferOutput).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'defer',
        permissionDecisionReason: '[OpenBox] needs reviewer',
      },
    });
  });

  it('pairs post-tool telemetry with the approval-required pre-tool activity', async () => {
    const mock = createMockCore((payload) =>
      payload.event_type === 'ActivityStarted'
        ? verdict('require_approval', { reason: 'needs reviewer' })
        : verdict('allow'),
    );
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    await runHook(hooks, 'PreToolUse', {
      ...baseInput,
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_use_id: 'tool_inline_approval',
    });
    await runHook(hooks, 'PostToolUse', {
      ...baseInput,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: 'ok',
      tool_use_id: 'tool_inline_approval',
      duration_ms: 25,
    });

    const parent = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'ShellExecution' &&
        event.hook_trigger !== true,
    );
    const completed = mock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'ShellExecution' &&
        event.hook_trigger !== true,
    );

    expect(parent?.activity_id).toBeDefined();
    expect(parent).toMatchObject({
      tool_name: 'Bash',
      tool_type: 'shell',
    });
    expect(completed?.activity_id).toBe(parent?.activity_id);
    expect(completed?.duration_ms).toBe(25);
    expect(completed).toMatchObject({
      tool_name: 'Bash',
      tool_type: 'shell',
    });
  });

  it('classifies HTTP-shaped MCP tools as HTTPRequest across PreToolUse and PostToolUse', async () => {
    const mock = createMockCore(() => verdict('allow'));
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });
    const env = {
      ...baseInput,
      tool_name: 'mcp__web__request',
      tool_input: { url: 'https://example.test/ping', method: 'post' },
      tool_use_id: 'tool_mcp_http',
    };

    await runHook(hooks, 'PreToolUse', env);
    await runHook(hooks, 'PostToolUse', {
      ...env,
      hook_event_name: 'PostToolUse',
      tool_response: { status: 200 },
      duration_ms: 18,
    });

    const started = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'HTTPRequest' &&
        event.hook_trigger !== true,
    );
    const completed = mock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'HTTPRequest' &&
        event.hook_trigger !== true,
    );
    expect(started).toMatchObject({
      tool_name: 'mcp__web__request',
      tool_type: 'http',
    });
    expect(started?.activity_input).toContainEqual({
      __openbox: { tool_type: 'http' },
    });
    expect(completed?.activity_id).toBe(started?.activity_id);
    expect(completed).toMatchObject({
      tool_name: 'mcp__web__request',
      tool_type: 'http',
      duration_ms: 18,
    });
    expect(completed?.activity_input).toContainEqual({
      __openbox: { tool_type: 'http' },
    });
    const completedHook = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'HTTPRequest' &&
        event.hook_trigger === true &&
        event.spans?.[0]?.stage === 'completed',
    );
    expect(completedHook?.spans?.[0]).toMatchObject({
      stage: 'completed',
      attributes: expect.objectContaining({
        'http.method': 'POST',
        'http.url': 'https://example.test/ping',
      }),
    });
  });

  it('treats failClosed false as a compatibility no-op for decision-capable hooks', async () => {
    const core = {
      evaluate: vi.fn(async () => {
        throw new Error('core offline');
      }),
      pollApproval: vi.fn(),
    } as unknown as OpenBoxCoreClient;
    const hooks = createOpenBoxAnthropicAgentHooks({ core, failClosed: false });

    const output = await runHook(hooks, 'PreToolUse', {
      ...baseInput,
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_use_id: 'tool_fail_closed',
    });

    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          '[OpenBox] OpenBox governance failed while processing Anthropic Agent SDK PreToolUse: core offline',
      },
    });
  });

  it('maps PermissionDenied verdicts to retry decisions', async () => {
    const allowMock = createMockCore(() => verdict('allow'));
    const blockMock = createMockCore((payload) =>
      payload.event_type === 'ActivityStarted'
        ? verdict('block', { reason: 'do not retry denied tool' })
        : verdict('allow'),
    );

    const allowOutput = await runHook(
      createOpenBoxAnthropicAgentHooks({ core: allowMock.core }),
      'PermissionDenied',
      {
        ...baseInput,
        hook_event_name: 'PermissionDenied',
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        tool_use_id: 'tool_denied_allow',
        reason: 'auto mode denied',
      },
    );
    const blockOutput = await runHook(
      createOpenBoxAnthropicAgentHooks({ core: blockMock.core }),
      'PermissionDenied',
      {
        ...baseInput,
        hook_event_name: 'PermissionDenied',
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf tmp' },
        tool_use_id: 'tool_denied_block',
        reason: 'auto mode denied',
      },
    );

    expect(allowOutput).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionDenied',
        retry: true,
      },
    });
    expect(blockOutput).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionDenied',
        retry: false,
      },
    });
    const permissionEvent = allowMock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'ShellExecution',
    );
    expect(permissionEvent?.activity_input).toContainEqual({
      __openbox: { tool_type: 'shell' },
    });
    expect(permissionEvent).toMatchObject({
      tool_name: 'Bash',
      tool_type: 'shell',
    });
    expect(permissionEvent?.activity_input).toContainEqual(
      expect.objectContaining({
        event_category: 'permission_denied',
        tool_name: 'Bash',
        reason: 'auto mode denied',
      }),
    );
    expect(permissionEvent?.hook_trigger).toBe(false);
    expect(permissionEvent?.spans).toBeUndefined();
    expect(permissionEvent?.span_count).toBeUndefined();
    const permissionHook = allowMock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'ShellExecution' &&
        event.hook_trigger === true,
    );
    expect(permissionHook).toMatchObject({
      event_type: permissionEvent?.event_type,
      workflow_id: permissionEvent?.workflow_id,
      run_id: permissionEvent?.run_id,
      activity_id: permissionEvent?.activity_id,
      activity_type: permissionEvent?.activity_type,
      hook_trigger: true,
      span_count: 1,
    });
    expect(permissionHook?.spans?.[0]).toMatchObject({
      name: 'ShellExecution',
      module: 'anthropic-agent-sdk',
      attributes: expect.objectContaining({
        'shell.command': 'npm test',
        'openbox.tool.name': 'Bash',
        'tool.name': 'Bash',
      }),
    });
    expect(permissionHook?.spans?.[0]).not.toHaveProperty('semantic_type');
    expect(permissionHook?.spans?.[0]?.attributes).not.toHaveProperty(
      'openbox.semantic_type',
    );
  });

  it('maps task, config, and elicitation verdicts to Agent SDK outputs', async () => {
    const mock = createMockCore((payload) => {
      if (payload.activity_type === 'AnthropicAgentSDKTask') {
        return verdict('block', { reason: 'task is out of scope' });
      }
      if (payload.activity_type === 'AnthropicAgentSDKConfigChange') {
        return verdict('block', { reason: 'config change denied' });
      }
      if (payload.activity_type === 'MCPElicitation') {
        return verdict('constrain', {
          reason: 'redacted elicitation response',
          guardrails_result: {
            input_type: 'activity_input',
            redacted_input: [{ answer: '[redacted]' }],
            validation_passed: true,
            reasons: [],
            results: [],
            raw_logs: {},
          },
        });
      }
      return verdict('allow');
    });
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    await expect(runHook(hooks, 'TaskCreated', {
      ...baseInput,
      hook_event_name: 'TaskCreated',
      task_id: 'task_1',
      task_subject: 'Deploy production',
      team_name: 'release',
    })).resolves.toEqual({
      continue: false,
      stopReason: '[OpenBox] task is out of scope',
    });
    await expect(runHook(hooks, 'ConfigChange', {
      ...baseInput,
      hook_event_name: 'ConfigChange',
      source: 'project_settings',
      file_path: '/tmp/project/.claude/settings.json',
    })).resolves.toEqual({
      decision: 'block',
      reason: '[OpenBox] config change denied',
    });
    await expect(runHook(hooks, 'ElicitationResult', {
      ...baseInput,
      hook_event_name: 'ElicitationResult',
      mcp_server_name: 'openbox',
      elicitation_id: 'elicit_1',
      response: { answer: 'secret' },
    })).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: 'ElicitationResult',
        action: 'accept',
        content: { answer: '[redacted]' },
      },
    });
  });

  it('pairs PreToolUse and PostToolUse activity ids from the Agent SDK tool id', async () => {
    const mock = createMockCore(() => verdict('allow'));
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    await runHook(hooks, 'PreToolUse', {
      ...baseInput,
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_use_id: 'tool_pair',
    });
    await runHook(hooks, 'PostToolUse', {
      ...baseInput,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: { stdout: 'ok' },
      tool_use_id: 'tool_pair',
      duration_ms: 42,
    });

    const started = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'ShellExecution',
    );
    const completed = mock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'ShellExecution',
    );
    expect(started?.activity_id).toBeDefined();
    expect(started).toMatchObject({
      tool_name: 'Bash',
      tool_type: 'shell',
    });
    expect(completed?.activity_id).toBe(started?.activity_id);
    expect(completed?.duration_ms).toBe(42);
    expect(completed).toMatchObject({
      tool_name: 'Bash',
      tool_type: 'shell',
    });
    expect(started?.activity_input).toContainEqual({
      __openbox: { tool_type: 'shell' },
    });
    expect(completed?.activity_input).toContainEqual({
      __openbox: { tool_type: 'shell' },
    });
    const completedHook = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'ShellExecution' &&
        event.hook_trigger === true &&
        event.spans?.[0]?.stage === 'completed',
    );
    expect(completedHook?.spans?.[0]).toMatchObject({
      stage: 'completed',
    });
    expect(completedHook?.spans?.[0]).not.toHaveProperty('semantic_type');
    expect(completedHook?.spans?.[0]?.attributes).not.toHaveProperty(
      'openbox.semantic_type',
    );

    const alternateMock = createMockCore(() => verdict('allow'));
    const alternateHooks = createOpenBoxAnthropicAgentHooks({ core: alternateMock.core });
    await runHook(alternateHooks, 'PostToolUse', {
      ...baseInput,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: { stdout: 'ok' },
      tool_use_id: 'missing_pre_tool',
      duration_ms: 42,
    });
    const alternateCompleted = alternateMock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'ShellExecution',
    );
    const alternateEvents = alternateMock.events.filter(
      (event) => event.activity_id === alternateCompleted?.activity_id,
    );
    expect(alternateEvents.map((event) => [event.event_type, event.hook_trigger])).toEqual([
      ['ActivityStarted', false],
      ['ActivityCompleted', false],
      ['ActivityStarted', true],
    ]);
    expect(alternateEvents[0].spans).toBeUndefined();
    expect(alternateEvents[2].spans?.[0]).toMatchObject({
      activity_id: alternateCompleted?.activity_id,
      stage: 'completed',
      attributes: expect.objectContaining({
        'openbox.tool.name': 'Bash',
        'tool.name': 'Bash',
      }),
    });
    expect(alternateEvents[2].spans?.[0]).not.toHaveProperty('semantic_type');
    expect(alternateEvents[2].spans?.[0]?.attributes).not.toHaveProperty(
      'openbox.semantic_type',
    );

    const failureMock = createMockCore(() => verdict('allow'));
    const failureHooks = createOpenBoxAnthropicAgentHooks({ core: failureMock.core });
    await runHook(failureHooks, 'PostToolUseFailure', {
      ...baseInput,
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      error: 'exit 1',
      tool_use_id: 'missing_pre_failure',
      duration_ms: 42,
    });
    const failureCompleted = failureMock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'PostToolUseFailure',
    );
    const failureEvents = failureMock.events.filter(
      (event) => event.activity_id === failureCompleted?.activity_id,
    );
    expect(failureEvents.map((event) => [event.event_type, event.hook_trigger])).toEqual([
      ['ActivityStarted', false],
      ['ActivityCompleted', false],
      ['ActivityStarted', true],
    ]);
    expect(failureEvents[2].spans?.[0]).toMatchObject({
      activity_id: failureCompleted?.activity_id,
      stage: 'completed',
      attributes: expect.objectContaining({
        'openbox.tool.name': 'Bash',
        'tool.name': 'Bash',
      }),
    });
  });

  it('marks Agent/Task and subagent hooks as a2a activity metadata', async () => {
    const mock = createMockCore(() => verdict('allow'));
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    await runHook(hooks, 'PreToolUse', {
      ...baseInput,
      tool_name: 'Task',
      tool_input: { subagent_type: 'researcher', prompt: 'Find sources.' },
      tool_use_id: 'tool_subagent',
    });
    await runHook(hooks, 'SubagentStart', {
      ...baseInput,
      hook_event_name: 'SubagentStart',
      subagent_type: 'writer',
    });

    const taskStarted = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'AgentSpawn',
    );
    expect(taskStarted?.activity_input).toContainEqual({
      __openbox: { tool_type: 'a2a', subagent_name: 'researcher' },
    });
    expect(taskStarted).toMatchObject({
      tool_name: 'Task',
      tool_type: 'a2a',
    });
    const subagentStarted = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'AgentSpawn' &&
        (event.activity_input as unknown[] | undefined)?.some(
          (entry: unknown) =>
            typeof entry === 'object' &&
            entry !== null &&
            '__openbox' in entry &&
            (entry as any).__openbox.subagent_name === 'writer',
        ),
    );
    expect(subagentStarted?.activity_input).toContainEqual({
      __openbox: { tool_type: 'a2a', subagent_name: 'writer' },
    });
  });

  it('maps constrained tool output to updatedToolOutput', async () => {
    const mock = createMockCore((payload) => {
      if (payload.event_type === 'ActivityCompleted') {
        return verdict('constrain', {
          guardrails_result: {
            input_type: 'activity_output',
            redacted_input: { output: { stdout: '[redacted]' } },
            validation_passed: true,
            reasons: [],
            results: [],
            raw_logs: {},
          },
        });
      }
      return verdict('allow');
    });
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    const output = await runHook(hooks, 'PostToolUse', {
      ...baseInput,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'cat secret.txt' },
      tool_response: { stdout: 'secret' },
      tool_use_id: 'tool_output',
    });

    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        updatedToolOutput: { stdout: '[redacted]' },
      },
    });
  });

  it('prefers compatibility redacted_output for constrained Anthropic tool output', async () => {
    const mock = createMockCore((payload) => {
      if (payload.event_type === 'ActivityCompleted') {
        return verdict('constrain', {
          guardrails_result: {
            input_type: 'activity_output',
            redacted_input: { output: { stdout: 'legacy' } },
            redacted_output: { output: { stdout: '[redacted]' } },
            validation_passed: true,
            reasons: [],
            field_results: [{ field: 'output.stdout', status: 'redacted' }],
            raw_logs: {},
          } as never,
        });
      }
      return verdict('allow');
    });
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    const output = await runHook(hooks, 'PostToolUse', {
      ...baseInput,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'cat secret.txt' },
      tool_response: { stdout: 'secret' },
      tool_use_id: 'tool_output_current',
    });

    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        updatedToolOutput: { stdout: '[redacted]' },
      },
    });
  });

  it('blocks assistant/session stop when OpenBox halts the final output', async () => {
    const mock = createMockCore((payload) =>
      payload.event_type === 'ActivityCompleted' &&
      payload.activity_type === 'AnthropicAgentSDKSession'
        ? verdict('halt', { reason: 'final answer includes restricted data' })
        : verdict('allow'),
    );
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    const output = await runHook(hooks, 'Stop', {
      ...baseInput,
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'restricted data',
    });

    expect(output).toEqual({
      continue: false,
      stopReason: '[OpenBox] final answer includes restricted data',
    });
    expect(mock.events.some((event) => event.event_type === 'WorkflowCompleted')).toBe(false);
  });

  it('records StopFailure as observe-only failed workflow telemetry', async () => {
    const mock = createMockCore(() => verdict('allow'));
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    expect(hooks.StopFailure).toBeDefined();
    const output = await runHook(hooks, 'StopFailure', {
      ...baseInput,
      hook_event_name: 'StopFailure',
      error: 'rate_limit',
      error_details: 'API request exhausted retries',
      last_assistant_message: 'partial assistant answer',
    });

    expect(output).toEqual({});
    const sessionEvents = mock.events.filter(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'AnthropicAgentSDKSession',
    );
    expect(sessionEvents).toHaveLength(1);
    const [parent] = sessionEvents;
    const hook = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'AnthropicAgentSDKSession' &&
        event.hook_trigger === true &&
        event.activity_id === parent?.activity_id,
    );
    expect(parent.hook_trigger).toBe(false);
    expect(parent.spans).toBeUndefined();
    expect(parent.span_count).toBeUndefined();
    expect(parent.activity_input).toEqual([
      expect.objectContaining({
        event_category: 'session_stop_failure',
        error: 'rate_limit',
        error_details: 'API request exhausted retries',
        last_assistant_message: 'partial assistant answer',
        _openbox_source: 'anthropic-agent-sdk',
      }),
    ]);
    expect(parent.activity_output).toEqual(
      expect.objectContaining({
        event_category: 'session_stop_failure_output',
        error: 'rate_limit',
        error_details: 'API request exhausted retries',
        content: 'partial assistant answer',
        _openbox_source: 'anthropic-agent-sdk',
      }),
    );
    expect(parent.completion).toBe('partial assistant answer');
    expect(hook?.hook_trigger).toBe(true);
    expect(hook?.event_type).toBe('ActivityStarted');
    expect(hook?.workflow_id).toBe(parent.workflow_id);
    expect(hook?.run_id).toBe(parent.run_id);
    expect(hook?.activity_id).toBe(parent.activity_id);
    expect(hook?.activity_type).toBe(parent.activity_type);
    expect(hook?.span_count).toBe(1);
    const span = hook?.spans?.[0] as any;
    expect(span).toMatchObject({
      name: 'openbox.anthropic-agent-sdk.assistant_output',
      stage: 'completed',
    });
    expect(span).not.toHaveProperty('semantic_type');
    expect(span?.attributes).not.toHaveProperty('openbox.semantic_type');
    expect(JSON.parse(span.response_body).choices[0].message.content).toBe(
      'partial assistant answer',
    );

    expect(mock.events.some((event) => event.event_type === 'WorkflowCompleted')).toBe(false);
    expect(
      mock.events.find((event) => event.event_type === 'WorkflowFailed')?.error,
    ).toEqual({
      type: 'Error',
      message: 'rate_limit: API request exhausted retries',
    });
  });

  it('completes active SessionEnd hooks without creating phantom sessions', async () => {
    const mock = createMockCore(() => verdict('allow'));
    const hooks = createOpenBoxAnthropicAgentHooks({ core: mock.core });

    await expect(runHook(hooks, 'SessionEnd', {
      ...baseInput,
      hook_event_name: 'SessionEnd',
      session_id: 'never_opened',
      reason: 'exit',
    })).resolves.toEqual({});
    expect(mock.events).toEqual([]);

    await runHook(hooks, 'SessionStart', {
      ...baseInput,
      hook_event_name: 'SessionStart',
      session_id: 'sess_end',
    });
    await expect(runHook(hooks, 'SessionEnd', {
      ...baseInput,
      hook_event_name: 'SessionEnd',
      session_id: 'sess_end',
      reason: 'exit',
    })).resolves.toEqual({});

    expect(mock.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'ActivityCompleted',
          activity_type: 'AnthropicAgentSDKSession',
          activity_input: [expect.objectContaining({ event_category: 'session_end' })],
        }),
        expect.objectContaining({
          event_type: 'WorkflowCompleted',
        }),
      ]),
    );
  });

  it('delegates Agent SDK query methods and emits result usage telemetry', async () => {
    const { assistantContentAndUsage } = await import(
      '../../ts/src/anthropic-agent-sdk/payloads'
    );
    expect(
      assistantContentAndUsage({
        type: 'assistant',
        session_id: 'sess_query',
        message: {
          model: 'claude-sonnet-4-5',
          content: [
            { type: 'text', text: 'Working' },
            { type: 'text', text: 'now.' },
            { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} },
          ],
          usage: { input_tokens: 10, output_tokens: 4 },
        },
      } as SDKMessage as never),
    ).toMatchObject({
      content: 'Working now.',
      model: 'claude-sonnet-4-5',
      hasToolCalls: true,
    });

    const mock = createMockCore(() => verdict('allow'));
    const source = createMockQuery([
      {
        type: 'assistant',
        session_id: 'sess_query',
        message: {
          model: 'claude-sonnet-4-5',
          content: [{ type: 'text', text: 'Working.' }],
          usage: { input_tokens: 10, output_tokens: 4 },
        },
      },
      {
        type: 'result',
        session_id: 'sess_query',
        subtype: 'success',
        is_error: false,
        result: 'Done.',
        total_cost_usd: 0.0123,
        duration_ms: 1200,
        duration_api_ms: 900,
        num_turns: 1,
        permission_denials: { Bash: 1 },
        usage: { input_tokens: 10, output_tokens: 5 },
        modelUsage: {
          'claude-sonnet-4-5': { inputTokens: 10, outputTokens: 5 },
        },
        stop_reason: 'end_turn',
      },
    ] as unknown as SDKMessage[]);
    const query = vi.fn(() => source);
    const sdk = createOpenBoxAnthropicAgentSDK({
      core: mock.core,
      query: query as any,
    });

    const wrapped = sdk.query({ prompt: 'hello', options: { maxTurns: 1 } });
    await wrapped.interrupt();
    for await (const _message of wrapped) {
      // Drain the stream so the result observer runs.
    }

    expect(source.interrupt).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({
      prompt: 'hello',
      options: expect.objectContaining({
        maxTurns: 1,
        hooks: expect.any(Object),
      }),
    });
    const usage = mock.events.find(
      (event) =>
        event.event_type === 'SignalReceived' &&
        event.activity_type === 'anthropic_agent_sdk_usage',
    );
    expect(usage?.activity_input).toEqual([
      expect.objectContaining({
        total_cost_usd: 0.0123,
        duration_ms: 1200,
        duration_api_ms: 900,
        num_turns: 1,
        permission_denials: { Bash: 1 },
        _openbox_source: 'anthropic-agent-sdk',
      }),
    ]);
    const assistantEvents = mock.events.filter(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'LLMCompleted',
    );
    expect(assistantEvents).toHaveLength(1);
    const [assistantParent] = assistantEvents;
    const assistantHook = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'LLMCompleted' &&
        event.hook_trigger === true &&
        event.activity_id === assistantParent?.activity_id,
    );
    expect(assistantParent.hook_trigger).toBe(false);
    expect(assistantParent).not.toHaveProperty('spans');
    expect(assistantParent).not.toHaveProperty('span_count');
    expect(assistantParent).toMatchObject({
      llm_model: 'claude-sonnet-4-5',
      input_tokens: 10,
      output_tokens: 5,
      has_tool_calls: false,
      completion: 'Done.',
    });
    expect(assistantHook?.hook_trigger).toBe(true);
    expect(assistantHook?.event_type).toBe('ActivityStarted');
    expect(assistantHook?.workflow_id).toBe(assistantParent.workflow_id);
    expect(assistantHook?.run_id).toBe(assistantParent.run_id);
    expect(assistantHook?.activity_id).toBe(assistantParent.activity_id);
    expect(assistantHook?.activity_type).toBe(assistantParent.activity_type);
    expect(assistantHook?.span_count).toBe(1);
    expect(assistantHook?.spans?.[0]).toMatchObject({
      name: 'openbox.anthropic-agent-sdk.assistant_output',
      stage: 'completed',
    });
    expect(assistantHook?.spans?.[0]).not.toHaveProperty('semantic_type');
    expect(assistantHook?.spans?.[0]?.attributes).not.toHaveProperty(
      'openbox.semantic_type',
    );
    expect(
      mock.events.some((event) => event.event_type === 'WorkflowCompleted'),
    ).toBe(true);
  });

  it('emits per-model synthetic usage spans for multi-model result telemetry', async () => {
    const mock = createMockCore(() => verdict('allow'));
    const source = createMockQuery([
      {
        type: 'result',
        session_id: 'sess_multi_model',
        subtype: 'success',
        is_error: false,
        result: 'Done with multiple models.',
        total_cost_usd: 0.021,
        duration_ms: 1400,
        duration_api_ms: 1000,
        num_turns: 2,
        permission_denials: [],
        usage: { input_tokens: 30, output_tokens: 12 },
        modelUsage: {
          'claude-sonnet-4-5': {
            inputTokens: 10,
            outputTokens: 4,
            cacheReadInputTokens: 3,
            cacheCreationInputTokens: 2,
            webSearchRequests: 1,
            cost_usd: '0.006',
            contextWindow: 200000,
            maxOutputTokens: 8192,
          },
          'claude-opus-4-8': {
            inputTokens: 20,
            outputTokens: 8,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            webSearchRequests: 0,
            costUsd: '0.015',
            contextWindow: 200000,
            maxOutputTokens: 8192,
          },
        },
        stop_reason: 'end_turn',
      },
    ] as unknown as SDKMessage[]);
    const sdk = createOpenBoxAnthropicAgentSDK({
      core: mock.core,
      query: vi.fn(() => source) as any,
    });

    for await (const _message of sdk.query({ prompt: 'hello' })) {
      // Drain the stream so the result observer runs.
    }

    const assistantEvents = mock.events.filter(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'LLMCompleted',
    );
    expect(assistantEvents).toHaveLength(1);
    const [assistantParent] = assistantEvents;
    const hookEvents = mock.events.filter(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'LLMCompleted' &&
        event.hook_trigger === true &&
        event.activity_id === assistantParent?.activity_id,
    );
    expect(hookEvents).toHaveLength(3);
    const [contentHook, ...syntheticHooks] = hookEvents;
    expect(assistantParent).toMatchObject({
      input_tokens: 30,
      output_tokens: 12,
      total_tokens: 42,
      completion: 'Done with multiple models.',
    });
    expect(assistantParent.llm_model).toBeUndefined();
    expect(contentHook?.hook_trigger).toBe(true);
    expect(contentHook?.activity_id).toBe(assistantParent.activity_id);
    expect(contentHook?.spans?.[0]).toMatchObject({
      name: 'openbox.anthropic-agent-sdk.assistant_output',
    });
    expect(contentHook?.spans?.[0]).not.toHaveProperty('semantic_type');
    expect(contentHook?.spans?.[0]?.attributes).not.toHaveProperty(
      'openbox.semantic_type',
    );
    expect((contentHook.spans?.[0] as any).input_tokens).toBeUndefined();

    expect(syntheticHooks).toHaveLength(2);
    for (const hook of syntheticHooks) {
      expect(hook.hook_trigger).toBe(true);
      expect(hook.event_type).toBe('ActivityStarted');
      expect(hook.workflow_id).toBe(assistantParent.workflow_id);
      expect(hook.run_id).toBe(assistantParent.run_id);
      expect(hook.activity_id).toBe(assistantParent.activity_id);
      expect(hook.activity_type).toBe(assistantParent.activity_type);
      expect(hook.span_count).toBe(1);
    }
    const spans = syntheticHooks.map((event) => event.spans?.[0] as any);
    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'openbox.synthetic.model_usage',
          model_id: 'claude-sonnet-4-5',
          provider: 'anthropic',
          model_provider: 'anthropic',
          status: { code: 'OK' },
          input_tokens: 10,
          output_tokens: 4,
          total_tokens: 14,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 2,
          web_search_requests: 1,
          cost_usd: 0.006,
          attributes: expect.objectContaining({
            'gen_ai.usage.cache_read_input_tokens': 3,
            'gen_ai.usage.cache_creation_input_tokens': 2,
            'gen_ai.usage.web_search_requests': 1,
            'openbox.usage.web_search_requests': 1,
            'openbox.usage.cost_usd': 0.006,
            'openbox.web_search.requests': 1,
            'openbox.cost.usd': 0.006,
          }),
          data: expect.objectContaining({ cost_usd: 0.006 }),
        }),
        expect.objectContaining({
          name: 'openbox.synthetic.model_usage',
          model_id: 'claude-opus-4-8',
          provider: 'anthropic',
          model_provider: 'anthropic',
          input_tokens: 20,
          output_tokens: 8,
          total_tokens: 28,
          data: expect.objectContaining({ cost_usd: 0.015 }),
        }),
      ]),
    );
    expect(spans.map((span) => JSON.parse(span.response_body).usage)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          input_tokens: 10,
          output_tokens: 4,
          total_tokens: 14,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 2,
          web_search_requests: 1,
          cost_usd: 0.006,
        }),
        expect.objectContaining({ input_tokens: 20, output_tokens: 8, total_tokens: 28 }),
      ]),
    );
  });

  it('marks open sessions failed when the wrapped query throws', async () => {
    const mock = createMockCore(() => verdict('allow'));
    const source = createThrowingQuery();
    const sdk = createOpenBoxAnthropicAgentSDK({
      core: mock.core,
      query: vi.fn(() => source) as any,
    });
    await runHook(sdk.hooks, 'SessionStart', {
      ...baseInput,
      hook_event_name: 'SessionStart',
      session_id: 'sess_throw',
      source: 'startup',
    });

    const wrapped = sdk.query({ prompt: 'hello' });
    await expect(wrapped.next()).rejects.toThrow('stream failed');

    expect(
      mock.events.some((event) => event.event_type === 'WorkflowFailed'),
    ).toBe(true);
  });
});

function createMockQuery(messages: SDKMessage[]): Query & {
  interrupt: ReturnType<typeof vi.fn>;
} {
  async function* stream() {
    for (const message of messages) yield message;
  }
  const iterator = stream();
  const source = {
    next: iterator.next.bind(iterator),
    return: iterator.return?.bind(iterator),
    throw: iterator.throw?.bind(iterator),
    [Symbol.asyncIterator]() {
      return source;
    },
    interrupt: vi.fn(async () => undefined),
    close: vi.fn(),
  };
  return source as unknown as Query & { interrupt: ReturnType<typeof vi.fn> };
}

function createThrowingQuery(): Query {
  const source = {
    async next() {
      throw new Error('stream failed');
    },
    async return(value?: void) {
      return { done: true as const, value };
    },
    async throw(error?: unknown) {
      throw error;
    },
    [Symbol.asyncIterator]() {
      return source;
    },
    close: vi.fn(),
  };
  return source as unknown as Query;
}
