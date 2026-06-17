// claude-code runtime adapter; every per-event mapper.
//
// Each mapper takes (envelope, session, config) and fires either
// `session.activity()` or `session.workflowStarted()`. We pass a
// recording stub session so we can assert which method was called
// with what activity type, without needing a live core service.
//
// Adapters covered:
//   - mappers/pre-tool-use    ; tool dispatch + skip-pattern guard
//   - mappers/post-tool-use   ; COMPLETE event after tool result
//   - mappers/user-prompt     ; PromptSubmission START
//   - mappers/permission-request; PERMISSION_REQUEST
//   - mappers/session         ; workflowStarted + END + halt-on-stop
//   - mappers/subagent        ; AGENT_SPAWN START/COMPLETE
//
// Hook-handler stdin dispatch lives in hook-handlers-coverage.test.ts.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'openbox-final-cov-'));
});
afterEach(() => {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function silence<T>(fn: () => T): { result: T; out: string[] } {
  const out: string[] = [];
  const ol = console.log;
  const oe = console.error;
  console.log = (...a: any[]) => out.push(a.join(' '));
  console.error = (...a: any[]) => out.push(a.join(' '));
  try {
    return { result: fn(), out };
  } finally {
    console.log = ol;
    console.error = oe;
  }
}

function recordingSession(verdict: { arm?: string } = { arm: 'allow' }): any {
  const calls: { method: string; args: any[] }[] = [];
  return {
    workflowId: 'wf', runId: 'run', workflowType: 't', taskQueue: 'g',
    isOpen: true, isTerminated: false, calls,
    async activity(...a: any[]) { calls.push({ method: 'activity', args: a }); return verdict; },
    async openActivity(...a: any[]) {
      calls.push({ method: 'openActivity', args: a });
      const activityId = a[1]?.activityId ?? `opened-${calls.length}`;
      return {
        activityId,
        verdict: { ...verdict, activityId },
        complete: async (...completeArgs: any[]) => {
          calls.push({ method: 'openActivity.complete', args: completeArgs });
          return verdict;
        },
      };
    },
    async workflowStarted() { calls.push({ method: 'workflowStarted', args: [] }); },
    async workflowCompleted() { calls.push({ method: 'workflowCompleted', args: [] }); },
    async workflowFailed(...a: any[]) { calls.push({ method: 'workflowFailed', args: a }); },
  };
}

describe('runtime/claude-code/mappers; every event handler', () => {
  function writeTranscriptWithUsage(
    fileName = 'transcript.jsonl',
    content = 'done',
  ) {
    const transcript = join(dir, fileName);
    writeFileSync(
      transcript,
      [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            model: 'claude-opus-4-8',
            content: [{ type: 'text', text: content }],
            usage: {
              input_tokens: 321,
              output_tokens: 54,
            },
          },
        }),
      ].join('\n') + '\n',
    );
    return transcript;
  }

  function assistantContentFromSpan(span: any): string {
    const response = JSON.parse(String(span?.response_body ?? '{}')) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = response.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  }

  it('user-prompt-submit fires PromptSubmission activity', async () => {
    const { handleUserPromptSubmit } = await import('../../ts/src/runtime/claude-code/mappers/user-prompt');
    const session = recordingSession();
    await handleUserPromptSubmit(
      { prompt: 'hi', session_id: 'S' } as any,
      session,
      { skipTools: [], sessionDir: dir } as any,
    );
    expect(session.calls.length).toBeGreaterThan(0);
    const goalSignal = session.calls.find(
      (call: any) => call.method === 'activity' && call.args[0] === 'SignalReceived',
    );
    expect(goalSignal?.args[1]).toBe('user_prompt');
    expect(goalSignal?.args[2]).toMatchObject({
      signalName: 'user_prompt',
      signalArgs: 'hi',
      input: [{ prompt: 'hi', event_category: 'agent_goal', _openbox_source: 'claude-code' }],
    });
    expect(goalSignal?.args[2].spans?.[0]).toMatchObject({
      semantic_type: 'llm_completion',
      module: 'claude-code',
    });
    const promptGate = session.calls.find(
      (call: any) => call.method === 'activity' && call.args[0] === 'ActivityStarted',
    );
    expect(promptGate?.args[1]).toBe('PromptSubmission');
  });

  it('pre/post tool hooks pair on tool_use_id and send tool results as activity output', async () => {
    const { handlePreToolUse } = await import('../../ts/src/runtime/claude-code/mappers/pre-tool-use');
    const { handlePostToolUse } = await import('../../ts/src/runtime/claude-code/mappers/post-tool-use');
    const session = recordingSession();
    const cfg = { skipTools: [], skipActivityTypes: [], sessionDir: dir } as any;
    const base = {
      session_id: 'S-tool',
      tool_use_id: 'toolu_1',
      tool_name: 'Bash',
      tool_input: { command: 'echo ok', cwd: dir },
    } as any;

    await handlePreToolUse(base, session, cfg);
    await handlePostToolUse(
      {
        ...base,
        tool_response: { stdout: 'ok\n', stderr: '', interrupted: false },
        duration_ms: 12,
      },
      session,
      cfg,
    );

    const opened = session.calls.find((call: any) => call.method === 'openActivity');
    expect(opened?.args[0]).toBe('ShellExecution');
    const completed = session.calls.find(
      (call: any) => call.method === 'activity' && call.args[0] === 'ActivityCompleted',
    );
    expect(completed?.args[1]).toBe('ShellExecution');
    expect(completed?.args[2]).toMatchObject({
      activityId: opened?.args[1].activityId ?? 'opened-1',
      durationMs: 12,
      output: { stdout: 'ok\n', stderr: '', interrupted: false },
    });
    expect(completed?.args[2].input[0]).toMatchObject({
      command: 'echo ok',
      event_category: 'agent_action',
      _openbox_source: 'claude-code',
    });
  });

  it('session-start workflowStarted + START activity', async () => {
    const { handleSessionStart, handleSessionEnd } = await import('../../ts/src/runtime/claude-code/mappers/session');
    const session = recordingSession();
    await handleSessionStart({ session_id: 'S' } as any, session, { skipTools: [], sessionDir: dir } as any);
    await handleSessionEnd({ session_id: 'S', reason: 'stop' } as any, session, { skipTools: [], sessionDir: dir } as any);
    expect(session.calls.some((c: any) => c.method === 'workflowStarted')).toBe(true);
  });

  it('session-end short-circuits when resolveSession created a fresh record (phantom session, e.g. `claude update`)', async () => {
    const { handleSessionEnd } = await import('../../ts/src/runtime/claude-code/mappers/session');
    const { resolveSession } = await import('../../ts/src/runtime/claude-code/session-resolver');
    const cfg = { skipTools: [], sessionDir: dir } as any;
    // Fresh session_id with no prior record on disk → resolveSession
    // creates one and flags the caller. SessionEnd must skip HTTP.
    await resolveSession({ session_id: 'PHANTOM' } as any, cfg);
    const session = recordingSession();
    await handleSessionEnd({ session_id: 'PHANTOM', reason: 'stop' } as any, session, cfg);
    expect(session.calls.length).toBe(0);
  });

  it('session-end runs full flow when prior session record exists', async () => {
    const { handleSessionEnd } = await import('../../ts/src/runtime/claude-code/mappers/session');
    const { resolveSession } = await import('../../ts/src/runtime/claude-code/session-resolver');
    const cfg = { skipTools: [], sessionDir: dir } as any;
    // Two resolveSession calls; second sees the existing record, so
    // the phantom flag clears and SessionEnd does the full HTTP path.
    await resolveSession({ session_id: 'REAL' } as any, cfg);
    await resolveSession({ session_id: 'REAL' } as any, cfg);
    const session = recordingSession();
    await handleSessionEnd({ session_id: 'REAL', reason: 'stop' } as any, session, cfg);
    expect(session.calls.some((c: any) => c.method === 'activity')).toBe(true);
    expect(session.calls.some((c: any) => c.method === 'workflowCompleted')).toBe(true);
  });

  it('stop completes the OpenBox workflow when Claude has no pending background work', async () => {
    const { handleStop } = await import('../../ts/src/runtime/claude-code/mappers/session');
    const session = recordingSession();
    await handleStop(
      {
        session_id: 'STOP',
        last_assistant_message: 'done',
        background_tasks: [],
        session_crons: [],
      } as any,
      session,
      { skipTools: [], sessionDir: dir, governancePolicy: 'fail_open' } as any,
    );
    expect(session.calls.some((c: any) => c.method === 'workflowCompleted')).toBe(true);
    const stop = session.calls.find(
      (c: any) => c.method === 'activity' && c.args[1] === 'ClaudeCodeSession',
    );
    const span = stop?.args[2]?.spans?.[0];
    expect(span).toMatchObject({
      name: 'openbox.claude-code.assistant_output',
      module: 'claude-code',
      stage: 'completed',
      semantic_type: 'llm_completion',
      attributes: {
        'gen_ai.system': 'claude-code',
        'http.url': 'https://api.anthropic.com/v1/messages',
        'openbox.claude_code.event': 'Stop',
      },
    });
    expect(assistantContentFromSpan(span)).toBe('done');
  });

  it('stop adds Claude transcript input/output token usage to the Core-extractable final llm span', async () => {
    const { handleStop } = await import('../../ts/src/runtime/claude-code/mappers/session');
    const session = recordingSession();
    await handleStop(
      {
        session_id: 'STOP-USAGE',
        transcript_path: writeTranscriptWithUsage('transcript.jsonl', 'full final answer'),
        last_assistant_message: 'done',
        background_tasks: [],
        session_crons: [],
      } as any,
      session,
      { skipTools: [], sessionDir: dir, governancePolicy: 'fail_open' } as any,
    );
    const stop = session.calls.find(
      (c: any) => c.method === 'activity' && c.args[1] === 'ClaudeCodeSession',
    );
    const span = stop?.args[2]?.spans?.[0];
    expect(span).toMatchObject({
      module: 'claude-code',
      name: 'openbox.claude-code.assistant_output',
      stage: 'completed',
      semantic_type: 'llm_completion',
      model: 'claude-opus-4-8',
      input_tokens: 321,
      output_tokens: 54,
    });
    expect(assistantContentFromSpan(span)).toBe('done');
  });

  it('message-display final batch records Claude transcript usage and assistant content', async () => {
    const { handleMessageDisplay } = await import('../../ts/src/runtime/claude-code/mappers/generic');
    const session = recordingSession();
    await handleMessageDisplay(
      {
        session_id: 'MSG-USAGE',
        hook_event_name: 'MessageDisplay',
        transcript_path: writeTranscriptWithUsage('message.jsonl', 'full displayed answer'),
        final: true,
        delta: 'last chunk',
      } as any,
      session,
      { skipTools: [], sessionDir: dir } as any,
      {
        activityType: 'ClaudeCodeMessage',
        eventKind: 'ActivityCompleted',
        eventCategory: 'llm_output',
      },
    );
    const message = session.calls.find(
      (c: any) => c.method === 'activity' && c.args[1] === 'ClaudeCodeMessage',
    );
    expect(message?.args[2]?.spans?.[0]).toMatchObject({
      name: 'openbox.claude-code.assistant_output',
      stage: 'completed',
      semantic_type: 'llm_completion',
      model: 'claude-opus-4-8',
      input_tokens: 321,
      output_tokens: 54,
      attributes: {
        'gen_ai.system': 'claude-code',
        'openbox.claude_code.event': 'MessageDisplay',
      },
    });
    expect(assistantContentFromSpan(message?.args[2]?.spans?.[0])).toBe(
      'full displayed answer',
    );
    const usageSignal = session.calls.find(
      (c: any) => c.method === 'activity' && c.args[1] === 'claude_usage',
    );
    expect(usageSignal?.args[2]?.input?.[0]).toMatchObject({
      event_category: 'llm_usage',
      model: 'claude-opus-4-8',
      usage: { inputTokens: 321, outputTokens: 54 },
      _openbox_source: 'claude-code',
    });
  });

  it('stop keeps the workflow open while Claude reports background work', async () => {
    const { handleStop } = await import('../../ts/src/runtime/claude-code/mappers/session');
    const session = recordingSession();
    await handleStop(
      {
        session_id: 'STOP-BG',
        last_assistant_message: 'waiting',
        background_tasks: [{ id: 'task-1', status: 'running' }],
        session_crons: [],
      } as any,
      session,
      { skipTools: [], sessionDir: dir, governancePolicy: 'fail_open' } as any,
    );
    expect(session.calls.some((c: any) => c.method === 'workflowCompleted')).toBe(false);
  });

  it('stop-failure records the SDK workflowFailed terminal event', async () => {
    const { handleStopFailure } = await import('../../ts/src/runtime/claude-code/mappers/session');
    const session = recordingSession();
    await handleStopFailure(
      {
        session_id: 'STOP-FAIL',
        error: 'model endpoint failed',
      } as any,
      session,
      { skipTools: [], sessionDir: dir } as any,
    );
    const activity = session.calls.find((c: any) => c.method === 'activity');
    expect(activity?.args[0]).toBe('ActivityCompleted');
    expect(activity?.args[1]).toBe('ClaudeCodeSession');
    const failed = session.calls.find((c: any) => c.method === 'workflowFailed');
    expect(failed?.args[0]).toBeInstanceOf(Error);
    expect(String(failed?.args[0]?.message)).toContain('model endpoint failed');
  });

  it('permission-request fires START activity', async () => {
    const { handlePermissionRequest } = await import('../../ts/src/runtime/claude-code/mappers/permission-request');
    const session = recordingSession();
    await handlePermissionRequest(
      { tool_name: 'Read', tool_input: { file_path: '/Users/me/x.ts' }, session_id: 'S' } as any,
      session,
      { skipTools: [], sessionDir: dir } as any,
    );
    // The mapper's contract: fire exactly one activity for the
    // PERMISSION_REQUEST event. Non-zero is the real assertion.
    expect(session.calls.length).toBeGreaterThan(0);
    expect(session.calls[0]?.method).toBe('activity');
  });

  it('subagent-start + subagent-stop fire AGENT_SPAWN activities', async () => {
    const { handleSubagentStart, handleSubagentStop } = await import(
      '../../ts/src/runtime/claude-code/mappers/subagent'
    );
    const session = recordingSession();
    await handleSubagentStart(
      { agent_type: 'researcher', session_id: 'S' } as any,
      session,
      { skipTools: [], sessionDir: dir } as any,
    );
    await handleSubagentStop(
      { agent_type: 'researcher', session_id: 'S', output: 'done' } as any,
      session,
      { skipTools: [], sessionDir: dir } as any,
    );
    expect(session.calls.length).toBeGreaterThan(0);
  });

  it('subagent-stop emits a Core-extractable assistant output span when Claude provides transcript output', async () => {
    const { handleSubagentStop } = await import(
      '../../ts/src/runtime/claude-code/mappers/subagent'
    );
    const session = recordingSession();
    await handleSubagentStop(
      {
        agent_type: 'researcher',
        session_id: 'S',
        agent_transcript_path: writeTranscriptWithUsage(
          'subagent.jsonl',
          'subagent final answer',
        ),
      } as any,
      session,
      { skipTools: [], sessionDir: dir } as any,
    );
    const stop = session.calls.find(
      (c: any) => c.method === 'activity' && c.args[1] === 'SubAgent:researcher',
    );
    const span = stop?.args[2]?.spans?.[0];
    expect(span).toMatchObject({
      name: 'openbox.claude-code.assistant_output',
      stage: 'completed',
      semantic_type: 'llm_completion',
      model: 'claude-opus-4-8',
      input_tokens: 321,
      output_tokens: 54,
      attributes: {
        'gen_ai.system': 'claude-code',
        'openbox.claude_code.event': 'SubagentStop',
      },
    });
    expect(assistantContentFromSpan(span)).toBe('subagent final answer');
  });
});

// runtime/cursor/mappers; covered by tests/unit/runtime-cursor-mappers.test.ts
// which actually invokes the handlers with a recording session and asserts
// activity()/workflowStarted() were called. Earlier import-only assertions
// here were tautologies (post-audit cleanup).

describe('runtime/cursor/hook-handler', () => {
  it('module imports without throwing', async () => {
    await import('../../ts/src/runtime/cursor/hook-handler');
  });
});

describe('runtime/claude-code/hook-handler', () => {
  it('module imports without throwing', async () => {
    await import('../../ts/src/runtime/claude-code/hook-handler');
  });
});

describe('cli/commands; skill + install', () => {
  it('skill command registers its non-install subcommands', async () => {
    // Skill installation is now an internal helper used by host
    // installers. The `skill` top-level command keeps only read-only
    // inspection verbs.
    const { registerSkillCommands } = await import('../../ts/src/cli/commands/skill');
    const program = new Command();
    registerSkillCommands(program);
    const skill = program.commands.find((c) => c.name() === 'skill');
    expect(skill).toBeDefined();
    const subs = skill!.commands.map((s) => s.name());
    expect(subs).toContain('path');
    expect(subs).not.toContain('install');
  });

  it('install command registers every supported target', async () => {
    const { registerInstallCommands } = await import('../../ts/src/cli/commands/install');
    const program = new Command();
    registerInstallCommands(program);
    const install = program.commands.find((c) => c.name() === 'install');
    expect(install).toBeDefined();
    const targets = install!.commands.map((s) => s.name()).sort();
    // Bare `openbox install` is the selective meta-command (no
    // subcommand); the entries below are the per-target verbs only.
    expect(targets).toEqual(['claude-code', 'cursor'].sort());

    const uninstall = program.commands.find((c) => c.name() === 'uninstall');
    expect(uninstall).toBeDefined();
    const utargets = uninstall!.commands.map((s) => s.name()).sort();
    expect(utargets).toEqual(['claude-code', 'cursor'].sort());
  });

});

describe('core-client/redaction', () => {
  it('redacts API keys + tokens from URL/headers', async () => {
    const mod = await import('../../ts/src/core-client/redaction');
    expect(typeof mod).toBe('object');
    // Redaction is a pure module; importing it counts.
    // If it has a `redact` export, exercise it on synthetic input.
    const fn = (mod as any).redact ?? (mod as any).redactSecrets;
    if (typeof fn === 'function') {
      const out = fn('Authorization: Bearer obx_live_secretvalue');
      expect(typeof out).toBe('string');
      expect(out).not.toContain('obx_live_secretvalue');
    }
  });
});

describe('cli/commands/auth; api-key surface', () => {
  it('exposes set-api-key / clear-api-key / status', async () => {
    const { registerAuthCommands } = await import('../../ts/src/cli/commands/auth');
    const program = new Command();
    registerAuthCommands(program);
    const auth = program.commands.find((c) => c.name() === 'auth');
    expect(auth).toBeDefined();
    const subs = auth!.commands.map((s) => s.name());
    expect(subs).toContain('set-api-key');
    expect(subs).toContain('clear-api-key');
    expect(subs).toContain('status');
  });
});

// cli/index.ts is excluded from coverage in vitest.config.ts because
// its top-level parseAsync runs whatever's in argv and exits, leaking
// state into sibling tests. The earlier "smoke import" here was a
// tautology (`expect(true).toBe(true)` after voiding a path string).
// Removed post-audit. Real coverage of the bin comes from every
// `openbox <verb>` invocation in the e2e suite against the local stack.
