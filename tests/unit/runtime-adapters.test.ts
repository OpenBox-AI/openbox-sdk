/**
 * Tests for the spec-driven runtime adapters
 * (ts/src/core-client/generated/runtime/{claude-code,cursor}.ts).
 *
 * Verifies the verdict-shape registry: each @verdictShape value in the
 * spec produces the expected stdout JSON for each verdict arm. Since
 * the adapter modules are auto-generated, we exercise them through
 * their public factory + run() with stubbed stdin/stdout/exit.
 */
import { describe, expect, test, vi } from 'vitest';
import type {
  GovernanceEventPayload,
  GovernanceVerdictResponse,
} from '../../ts/src/core-client/core-client.js';
import type { OpenBoxCoreClient } from '../../ts/src/core-client/core-client.js';
import {
  createClaudeCodeAdapter,
  type ClaudeCodeEnvelope,
} from '../../ts/src/core-client/generated/runtime/claude-code.js';
import {
  createCursorAdapter,
  type CursorEnvelope,
} from '../../ts/src/core-client/generated/runtime/cursor.js';
import type { WorkflowVerdict } from '../../ts/src/core-client/generated/govern.js';

function makeMockCore(
  verdictArm: 'allow' | 'block' | 'halt' | 'require_approval' = 'allow',
): OpenBoxCoreClient {
  const events: GovernanceEventPayload[] = [];
  const verdict: GovernanceVerdictResponse = {
    governance_event_id: 'evt_test',
    verdict: verdictArm,
    action: verdictArm,
    risk_score: 0,
  } as GovernanceVerdictResponse;
  return {
    evaluate: vi.fn(async (p: GovernanceEventPayload) => {
      events.push(p);
      return verdict;
    }),
    pollApproval: vi.fn(async () => ({ id: 'evt_test', action: 'allow' })),
  } as unknown as OpenBoxCoreClient;
}

interface CapturedAdapter {
  stdout: string[];
  exitCodes: number[];
}

function capture(): CapturedAdapter {
  return { stdout: [], exitCodes: [] };
}

function adapterIO(cap: CapturedAdapter, stdin: string) {
  return {
    readStdin: async () => stdin,
    writeStdout: (data: string) => {
      cap.stdout.push(data);
    },
    exit: ((code: number) => {
      cap.exitCodes.push(code);
    }) as unknown as (code: number) => never,
  };
}

const verdict = (
  arm: WorkflowVerdict['arm'],
  reason?: string,
  extra: Partial<WorkflowVerdict> = {},
): WorkflowVerdict => ({
  arm,
  reason,
  riskScore: 0,
  ...extra,
});

// ─── claude-code adapter ───────────────────────────────────────────────────

describe('createClaudeCodeAdapter', () => {
  const baseEnv: ClaudeCodeEnvelope = {
    hook_event_name: 'PreToolUse',
    session_id: 's1',
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
  };

  test('permission-decision allow → permissionDecision:"allow"', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        preToolUse: async () => verdict('allow'),
      },
      ...adapterIO(cap, JSON.stringify(baseEnv)),
    }).run();
    expect(cap.stdout).toHaveLength(1);
    const out = JSON.parse(cap.stdout[0]);
    expect(out.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(cap.exitCodes).toEqual([0]);
  });

  test('permission-decision block → permissionDecision:"deny" + reason', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        preToolUse: async () => verdict('block', 'destructive command'),
      },
      ...adapterIO(cap, JSON.stringify(baseEnv)),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toBe(
      '[OpenBox] destructive command',
    );
  });

  test('permission-decision require_approval → permissionDecision:"ask"', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        preToolUse: async () => verdict('require_approval', 'review needed'),
      },
      ...adapterIO(cap, JSON.stringify(baseEnv)),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.hookSpecificOutput.permissionDecision).toBe('ask');
  });

  test('permission-decision constrain → allow + updatedInput + additionalContext', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        preToolUse: async () => verdict('constrain', 'redacted command', {
          guardrailsResult: {
            inputType: 'activity_input',
            redactedInput: { command: 'echo [redacted]' },
            validationPassed: true,
            reasons: [],
            fieldResults: [],
          },
        }),
      },
      ...adapterIO(cap, JSON.stringify(baseEnv)),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(out.hookSpecificOutput.updatedInput).toEqual({ command: 'echo [redacted]' });
    expect(out.hookSpecificOutput.additionalContext).toBe('[OpenBox] redacted command');
  });

  test('permission-decision require_approval + deferApproval → permissionDecision:"defer"', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      deferApproval: true,
      handlers: {
        preToolUse: async () => verdict('require_approval', 'queue reviewer'),
      },
      ...adapterIO(cap, JSON.stringify(baseEnv)),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.hookSpecificOutput.permissionDecision).toBe('defer');
  });

  test('decision-block (PostToolUse) allow → empty object', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        postToolUse: async () => verdict('allow'),
      },
      ...adapterIO(
        cap,
        JSON.stringify({ ...baseEnv, hook_event_name: 'PostToolUse' }),
      ),
    }).run();
    expect(JSON.parse(cap.stdout[0])).toEqual({});
  });

  test('decision-block (PostToolUse) block → {decision:"block", reason}', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        postToolUse: async () => verdict('block', 'output contains secret'),
      },
      ...adapterIO(
        cap,
        JSON.stringify({ ...baseEnv, hook_event_name: 'PostToolUse' }),
      ),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.decision).toBe('block');
    expect(out.reason).toBe('[OpenBox] output contains secret');
  });

  test('decision-block constrain → hookSpecificOutput.additionalContext + updatedToolOutput', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        postToolUse: async () => verdict('constrain', 'tool output redacted', {
          guardrailsResult: {
            inputType: 'activity_output',
            redactedInput: { stdout: '[redacted]', stderr: '', interrupted: false, isImage: false },
            validationPassed: true,
            reasons: [],
            fieldResults: [],
          },
        }),
      },
      ...adapterIO(
        cap,
        JSON.stringify({ ...baseEnv, hook_event_name: 'PostToolUse' }),
      ),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(out.hookSpecificOutput.additionalContext).toBe('[OpenBox] tool output redacted');
    expect(out.hookSpecificOutput.updatedToolOutput.stdout).toBe('[redacted]');
  });

  test('permission-request allow → decision.behavior:"allow"', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        permissionRequest: async () => verdict('allow'),
      },
      ...adapterIO(
        cap,
        JSON.stringify({ ...baseEnv, hook_event_name: 'PermissionRequest' }),
      ),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.hookSpecificOutput.hookEventName).toBe('PermissionRequest');
    expect(out.hookSpecificOutput.decision.behavior).toBe('allow');
  });

  test('permission-request constrain → allow + updatedInput', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        permissionRequest: async () => verdict('constrain', undefined, {
          guardrailsResult: {
            inputType: 'activity_input',
            redactedInput: { command: 'npm test' },
            validationPassed: true,
            reasons: [],
            fieldResults: [],
          },
        }),
      },
      ...adapterIO(
        cap,
        JSON.stringify({ ...baseEnv, hook_event_name: 'PermissionRequest' }),
      ),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.hookSpecificOutput.decision.behavior).toBe('allow');
    expect(out.hookSpecificOutput.decision.updatedInput).toEqual({ command: 'npm test' });
  });

  test('permission-denied-retry allow → retry:true', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        permissionDenied: async () => verdict('allow'),
      },
      ...adapterIO(
        cap,
        JSON.stringify({ ...baseEnv, hook_event_name: 'PermissionDenied' }),
      ),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.hookSpecificOutput.hookEventName).toBe('PermissionDenied');
    expect(out.hookSpecificOutput.retry).toBe(true);
  });

  test('permission-denied-retry block → retry:false', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        permissionDenied: async () => verdict('block', 'do not retry'),
      },
      ...adapterIO(
        cap,
        JSON.stringify({ ...baseEnv, hook_event_name: 'PermissionDenied' }),
      ),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.hookSpecificOutput.retry).toBe(false);
  });

  test('additional-context block → hookSpecificOutput.additionalContext', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        postToolUseFailure: async () => verdict('block', 'retry with a safer command'),
      },
      ...adapterIO(
        cap,
        JSON.stringify({ ...baseEnv, hook_event_name: 'PostToolUseFailure' }),
      ),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.hookSpecificOutput.hookEventName).toBe('PostToolUseFailure');
    expect(out.hookSpecificOutput.additionalContext).toBe(
      '[OpenBox] retry with a safer command',
    );
  });

  test('additional-context constrain → hookSpecificOutput.additionalContext', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        postToolUseFailure: async () => verdict('constrain', 'try npm test -- --runInBand'),
      },
      ...adapterIO(
        cap,
        JSON.stringify({ ...baseEnv, hook_event_name: 'PostToolUseFailure' }),
      ),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.hookSpecificOutput.hookEventName).toBe('PostToolUseFailure');
    expect(out.hookSpecificOutput.additionalContext).toBe(
      '[OpenBox] try npm test -- --runInBand',
    );
  });

  test('continue-block block → continue:false + stopReason', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        taskCreated: async () => verdict('block', 'task is out of scope'),
      },
      ...adapterIO(
        cap,
        JSON.stringify({ ...baseEnv, hook_event_name: 'TaskCreated' }),
      ),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.continue).toBe(false);
    expect(out.stopReason).toBe('[OpenBox] task is out of scope');
  });

  test('elicitation-response block → decline', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        elicitation: async () => verdict('block', 'do not collect this input'),
      },
      ...adapterIO(
        cap,
        JSON.stringify({ ...baseEnv, hook_event_name: 'Elicitation' }),
      ),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.hookSpecificOutput.hookEventName).toBe('Elicitation');
    expect(out.hookSpecificOutput.action).toBe('decline');
    expect(out.hookSpecificOutput.content).toEqual({});
  });

  test('elicitation-response constrain → accept redacted content', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        elicitationResult: async () => verdict('constrain', 'redacted answer', {
          guardrailsResult: {
            inputType: 'activity_input',
            redactedInput: { answer: '[redacted]' },
            validationPassed: true,
            reasons: [],
            fieldResults: [],
          },
        }),
      },
      ...adapterIO(
        cap,
        JSON.stringify({ ...baseEnv, hook_event_name: 'ElicitationResult' }),
      ),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.hookSpecificOutput.hookEventName).toBe('ElicitationResult');
    expect(out.hookSpecificOutput.action).toBe('accept');
    expect(out.hookSpecificOutput.content).toEqual({ answer: '[redacted]' });
  });

  test('elicitation-response halt → cancel', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        elicitationResult: async () => verdict('halt', 'stop elicitation'),
      },
      ...adapterIO(
        cap,
        JSON.stringify({ ...baseEnv, hook_event_name: 'ElicitationResult' }),
      ),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.hookSpecificOutput.hookEventName).toBe('ElicitationResult');
    expect(out.hookSpecificOutput.action).toBe('cancel');
  });

  test('none-shape (SessionStart) → no stdout, exit 0', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        sessionStart: async () => undefined,
      },
      ...adapterIO(
        cap,
        JSON.stringify({ ...baseEnv, hook_event_name: 'SessionStart' }),
      ),
    }).run();
    expect(cap.stdout).toEqual([]);
    expect(cap.exitCodes).toEqual([0]);
  });

  test('missing handler → fallback allow stdout', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {}, // none
      ...adapterIO(cap, JSON.stringify(baseEnv)),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.hookSpecificOutput.permissionDecision).toBe('allow');
  });

  test('empty stdin → exit 0, no stdout', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: { preToolUse: async () => verdict('allow') },
      ...adapterIO(cap, '   '),
    }).run();
    expect(cap.stdout).toEqual([]);
    expect(cap.exitCodes).toEqual([0]);
  });

  test('malformed JSON → exit 0, no stdout', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: { preToolUse: async () => verdict('allow') },
      ...adapterIO(cap, '{not json'),
    }).run();
    expect(cap.stdout).toEqual([]);
    expect(cap.exitCodes).toEqual([0]);
  });

  test('unknown event_name → exit 0, no stdout', async () => {
    const cap = capture();
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: { preToolUse: async () => verdict('allow') },
      ...adapterIO(
        cap,
        JSON.stringify({ ...baseEnv, hook_event_name: 'TotallyMadeUp' }),
      ),
    }).run();
    expect(cap.stdout).toEqual([]);
    expect(cap.exitCodes).toEqual([0]);
  });

  test('resolveSession is called with the parsed envelope', async () => {
    const cap = capture();
    const resolveSession = vi.fn(async () => ({ workflowId: 'w', runId: 'r' }));
    await createClaudeCodeAdapter({
      core: makeMockCore(),
      resolveSession,
      handlers: { preToolUse: async () => verdict('allow') },
      ...adapterIO(cap, JSON.stringify(baseEnv)),
    }).run();
    expect(resolveSession).toHaveBeenCalledWith(baseEnv);
  });
});

// ─── cursor adapter ───────────────────────────────────────────────────

describe('createCursorAdapter', () => {
  const baseEnv: CursorEnvelope = {
    hook_event_name: 'beforeShellExecution',
    conversation_id: 'c1',
    generation_id: 'g1',
    command: 'ls',
  };

  test('cursor-permission allow → {permission:"allow"}', async () => {
    const cap = capture();
    await createCursorAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: { beforeShellExecution: async () => verdict('allow') },
      ...adapterIO(cap, JSON.stringify(baseEnv)),
    }).run();
    expect(JSON.parse(cap.stdout[0])).toEqual({ permission: 'allow' });
  });

  test('cursor-permission block → permission:"deny" + user_message', async () => {
    const cap = capture();
    await createCursorAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        beforeShellExecution: async () => verdict('block', 'forbidden cmd'),
      },
      ...adapterIO(cap, JSON.stringify(baseEnv)),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.permission).toBe('deny');
    expect(out.user_message).toBe('[OpenBox] forbidden cmd');
  });

  test('cursor-permission halt → "OpenBox HALT:" prefix', async () => {
    const cap = capture();
    await createCursorAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        beforeShellExecution: async () => verdict('halt', 'session halted'),
      },
      ...adapterIO(cap, JSON.stringify(baseEnv)),
    }).run();
    const out = JSON.parse(cap.stdout[0]);
    expect(out.permission).toBe('deny');
    expect(out.user_message).toMatch(/^\[OpenBox\] HALT:/);
  });

  test('cursor-observe (afterShellExecution) → empty object', async () => {
    const cap = capture();
    await createCursorAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: { afterShellExecution: async () => verdict('allow') },
      ...adapterIO(
        cap,
        JSON.stringify({ ...baseEnv, hook_event_name: 'afterShellExecution' }),
      ),
    }).run();
    expect(JSON.parse(cap.stdout[0])).toEqual({});
  });

  test('none-shape (sessionStart) → no stdout', async () => {
    const cap = capture();
    await createCursorAdapter({
      core: makeMockCore(),
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: { sessionStart: async () => undefined },
      ...adapterIO(
        cap,
        JSON.stringify({ ...baseEnv, hook_event_name: 'sessionStart' }),
      ),
    }).run();
    expect(cap.stdout).toEqual([]);
  });
});
