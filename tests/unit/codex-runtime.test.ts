import { describe, expect, it, vi } from 'vitest';
import type {
  GovernanceEventPayload,
  GovernanceVerdictResponse,
  OpenBoxCoreClient,
} from '../../ts/src/core-client/index.js';
import {
  createCodexAdapter,
  type CodexEnvelope,
} from '../../ts/src/core-client/generated/runtime/codex.js';
import {
  handlePostToolUse,
  handlePreToolUse,
} from '../../ts/src/runtime/codex/mappers/tool.js';

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

function adapterIO(stdout: string[], stdin: string) {
  return {
    readStdin: async () => stdin,
    writeStdout: (data: string) => {
      stdout.push(data);
    },
    exit: ((code: number) => code) as unknown as (code: number) => never,
  };
}

const cfg = {
  sessionDir: '/tmp/openbox-codex-runtime-test',
} as never;

describe('Codex runtime adapter', () => {
  it('renders a PreToolUse block as a Codex permission denial', async () => {
    const stdout: string[] = [];
    const env: CodexEnvelope = {
      hook_event_name: 'PreToolUse',
      session_id: 'codex-session',
      tool_name: 'Shell',
      tool_input: { command: 'rm -rf /tmp/x' },
    };
    await createCodexAdapter({
      core: {} as never,
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        preToolUse: async () => ({
          arm: 'block',
          reason: 'destructive command',
          riskScore: 1,
        }),
      },
      ...adapterIO(stdout, JSON.stringify(env)),
    }).run();

    const out = JSON.parse(stdout[0]);
    expect(out.hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: '[OpenBox] destructive command',
    });
  });

  it('fails closed when submitted prompt redaction cannot be applied by Codex', async () => {
    const stdout: string[] = [];
    const env: CodexEnvelope = {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'codex-session',
      prompt: 'Summarize secret.',
    };
    await createCodexAdapter({
      core: {} as never,
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        userPromptSubmit: async () => ({
          arm: 'constrain',
          reason: 'prompt redacted',
          riskScore: 0.7,
          guardrailsResult: {
            inputType: 'activity_input',
            redactedInput: [{ prompt: 'Summarize [redacted].' }],
            validationPassed: true,
            reasons: [],
            results: [],
            fieldResults: [],
            rawLogs: {},
          },
        }),
      },
      ...adapterIO(stdout, JSON.stringify(env)),
    }).run();

    expect(JSON.parse(stdout[0])).toEqual({
      decision: 'block',
      reason: '[OpenBox] prompt redacted',
      suppressOriginalPrompt: true,
    });
  });

  it('maps constrained PostToolUse output redaction without requiring a reason', async () => {
    const stdout: string[] = [];
    const env: CodexEnvelope = {
      hook_event_name: 'PostToolUse',
      session_id: 'codex-session',
      tool_name: 'Shell',
      tool_input: { command: 'cat secret.txt' },
      tool_output: { stdout: 'secret' },
    };
    await createCodexAdapter({
      core: {} as never,
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        postToolUse: async () => ({
          arm: 'constrain',
          riskScore: 0.2,
          guardrailsResult: {
            inputType: 'activity_output',
            redactedInput: { output: { stdout: '[redacted]' } },
            validationPassed: true,
            reasons: [],
            results: [],
            fieldResults: [],
            rawLogs: {},
          },
        }),
      },
      ...adapterIO(stdout, JSON.stringify(env)),
    }).run();

    expect(JSON.parse(stdout[0])).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        updatedToolOutput: { stdout: '[redacted]' },
      },
    });
  });

  it('stamps Codex source and shell spans in paired tool mappers', async () => {
    const mock = createMockCore(() => ({ verdict: 'allow', action: 'allow' }));
    const session = await import('../../ts/src/core-client/index.js').then(
      ({ presets }) =>
        new presets.codex({
          core: mock.core,
          workflowId: 'codex-session',
          runId: 'codex-session',
          registerExitHandlers: false,
          attached: true,
        }),
    );
    const verdict = await handlePreToolUse(
      {
        hook_event_name: 'PreToolUse',
        session_id: 'codex-session',
        tool_use_id: 'tool-1',
        tool_name: 'Shell',
        tool_input: { command: 'ls', cwd: '/tmp' },
      },
      session,
      cfg,
    );

    expect(verdict?.arm).toBe('allow');
    const parent = mock.events.find((event) => event.hook_trigger !== true);
    expect(parent).toMatchObject({
      event_type: 'ActivityStarted',
      activity_type: 'ShellExecution',
      tool_name: 'Shell',
      tool_type: 'shell',
    });
    expect(parent?.hook_trigger).toBe(false);
    const activityInput = parent?.activity_input as unknown[] | undefined;
    expect(activityInput?.[0]).toMatchObject({
      _openbox_source: 'codex',
      command: 'ls',
      event_category: 'agent_action',
    });
    const hookEvent = mock.events.find((event) => event.hook_trigger === true);
    expect(hookEvent?.spans?.[0]).toMatchObject({
      name: 'ShellExecution',
      module: 'codex',
    });
    await handlePostToolUse(
      {
        hook_event_name: 'PostToolUse',
        session_id: 'codex-session',
        tool_use_id: 'tool-1',
        tool_name: 'Shell',
        tool_input: { command: 'ls', cwd: '/tmp' },
        tool_output: { stdout: 'ok\n' },
      },
      session,
      cfg,
    );
    const completed = mock.events.find(
      (event) =>
        event.event_type === 'ActivityCompleted' &&
        event.activity_type === 'ShellExecution' &&
        event.hook_trigger !== true,
    );
    expect(completed).toMatchObject({
      activity_type: 'ShellExecution',
    });
    expect(completed?.hook_trigger).toBe(false);
    const completedHook = mock.events.find(
      (event) =>
        event.event_type === 'ActivityStarted' &&
        event.activity_type === 'ShellExecution' &&
        event.hook_trigger === true &&
        event.spans?.[0]?.stage === 'completed',
    );
    expect(completedHook?.spans?.[0]).toMatchObject({
      module: 'codex',
      stage: 'completed',
      semantic_type: 'internal',
    });
  });
});
