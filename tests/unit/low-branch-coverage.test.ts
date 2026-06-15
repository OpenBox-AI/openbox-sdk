import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createOpenBoxApprovalClient } from '../../ts/src/copilotkit/react-approval-client.ts';
import { hookEventLabel, HOOK_EVENT_LABELS } from '../../ts/src/governance/hook-event-labels.ts';
import {
  buildMcpGovernanceSpan,
  MCP_ACTIVITY_TYPE_MAP,
} from '../../ts/src/runtime/mcp/governance-span.ts';

const temps: string[] = [];
const originalStdinIsTTY = process.stdin.isTTY;
const originalStdoutIsTTY = process.stdout.isTTY;
const originalEnv = { ...process.env };

afterEach(() => {
  for (const dir of temps.splice(0)) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  Object.defineProperty(process.stdout, 'isTTY', {
    value: originalStdoutIsTTY,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(process.stdin, 'isTTY', {
    value: originalStdinIsTTY,
    configurable: true,
  });
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  vi.doUnmock('../../ts/src/install/from-spec.js');
  vi.restoreAllMocks();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'openbox-low-branch-'));
  temps.push(dir);
  return dir;
}

function recordingSession(verdict: any = { arm: 'allow', reason: 'ok' }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  return {
    calls,
    activity: vi.fn(async (...args: unknown[]) => {
      calls.push({ method: 'activity', args });
      return verdict;
    }),
    workflowStarted: vi.fn(async (...args: unknown[]) => {
      calls.push({ method: 'workflowStarted', args });
      return undefined;
    }),
    workflowCompleted: vi.fn(async (...args: unknown[]) => {
      calls.push({ method: 'workflowCompleted', args });
      return undefined;
    }),
  };
}

describe('low-branch utility coverage', () => {
  it('posts approval decisions and surfaces backend or malformed response failures', async () => {
    const okFetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, id: 'decision-1' }),
    })) as any;
    await expect(
      createOpenBoxApprovalClient({
        endpoint: '/custom/decide',
        fetcher: okFetcher,
      }).decide({
        decision: 'approve',
        governanceEventId: 'event-1',
      }),
    ).resolves.toEqual({ ok: true, id: 'decision-1' });
    expect(okFetcher).toHaveBeenCalledWith(
      '/custom/decide',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'approve',
          governanceEventId: 'event-1',
        }),
      }),
    );

    await expect(
      createOpenBoxApprovalClient({
        fetcher: vi.fn(async () => ({
          ok: true,
          json: async () => ({ ok: false, error: 'no approval' }),
        })) as any,
      }).decide({ decision: 'reject', governanceEventId: 'event-reject-1' }),
    ).rejects.toThrow('no approval');
    await expect(
      createOpenBoxApprovalClient({
        fetcher: vi.fn(async () => ({
          ok: false,
          json: async () => {
            throw new Error('not json');
          },
        })) as any,
      }).decide({ decision: 'reject', governanceEventId: 'event-reject-2' }),
    ).rejects.toThrow('OpenBox approval decision failed.');
  });

  it('labels known, unknown, and empty hook events', () => {
    const known = Object.keys(HOOK_EVENT_LABELS)[0];
    expect(hookEventLabel(undefined)).toBe('Action');
    expect(hookEventLabel(null)).toBe('Action');
    expect(hookEventLabel('unknown-event')).toBe('unknown-event');
    expect(hookEventLabel(known)).toBe(HOOK_EVENT_LABELS[known]);
  });

  it('builds MCP governance spans for each supported span type and default fallbacks', () => {
    const cases = [
      ['llm', { prompt: 'hi' }, 'llm.chat.completion'],
      ['file_read', { file_path: '/tmp/read.txt' }, 'file.read'],
      ['file_write', { file_path: '/tmp/write.txt' }, 'file.write'],
      ['shell', { command: 'echo ok', cwd: '/repo' }, 'ShellExecution'],
      ['http', { method: 'get', url: 'https://example.test' }, 'GET https://example.test'],
      ['db', { operation: 'insert', statement: 'insert 1' }, 'INSERT'],
      ['mcp', { tool_name: 'search' }, 'tool.search'],
      ['unknown', {}, 'unknown'],
    ] as const;

    for (const [spanType, input, name] of cases) {
      const span = buildMcpGovernanceSpan(spanType, input);
      expect(span.name).toBe(name);
      expect(String(span.span_id)).toMatch(/^[0-9a-f]{16}$/);
      expect(String(span.trace_id)).toMatch(/^[0-9a-f]{32}$/);
      expect(span.status).toEqual({ code: 'OK', description: null });
    }

    expect(buildMcpGovernanceSpan('http', {}).name).toBe(
      'POST https://api.example.com',
    );
    expect(buildMcpGovernanceSpan('db', {}).db_operation).toBe('SELECT');
    expect(buildMcpGovernanceSpan('mcp', {}).function).toBe('mcp.call');
    expect(MCP_ACTIVITY_TYPE_MAP).toMatchObject({
      llm: 'PromptSubmission',
      file_read: 'FileRead',
      file_write: 'FileEdit',
      shell: 'ShellExecution',
      http: 'HTTPRequest',
      db: 'DatabaseQuery',
      mcp: 'MCPToolCall',
    });
  });

  it('covers prompt and MCP mapper skip and halt branches', async () => {
    const { handleBeforeSubmitPrompt } = await import(
      '../../ts/src/runtime/cursor/mappers/prompt.ts'
    );
    const { handleBeforeMCPExecution } = await import(
      '../../ts/src/runtime/cursor/mappers/mcp.ts'
    );
    const { handleSubagentStart } = await import(
      '../../ts/src/runtime/cursor/mappers/subagent.ts'
    );
    const { handleUserPromptSubmit } = await import(
      '../../ts/src/runtime/claude-code/mappers/user-prompt.ts'
    );
    const cfg = { sessionDir: tempDir(), skipTools: [] } as any;

    const emptyPromptSession = recordingSession();
    await expect(
      handleBeforeSubmitPrompt({ conversation_id: 'cursor-empty', prompt: '   ' } as any, emptyPromptSession as any, cfg),
    ).resolves.toBeUndefined();
    expect(emptyPromptSession.activity).not.toHaveBeenCalled();

    const emptyClaudeSession = recordingSession();
    await expect(
      handleUserPromptSubmit({ session_id: 'claude-empty', prompt: '' } as any, emptyClaudeSession as any, cfg),
    ).resolves.toBeUndefined();
    expect(emptyClaudeSession.activity).not.toHaveBeenCalled();

    const emptyMcpSession = recordingSession();
    await expect(
      handleBeforeMCPExecution({ conversation_id: 'cursor-mcp-empty' } as any, emptyMcpSession as any, cfg),
    ).resolves.toBeUndefined();
    expect(emptyMcpSession.activity).not.toHaveBeenCalled();

    const haltedCursor = recordingSession({ arm: 'halt', reason: 'stop cursor' });
    await expect(
      handleBeforeSubmitPrompt(
        { conversation_id: 'cursor-halt', prompt: 'halt this' } as any,
        haltedCursor as any,
        cfg,
      ),
    ).resolves.toMatchObject({ arm: 'halt' });
    expect(haltedCursor.activity).toHaveBeenCalled();

    const haltedMcp = recordingSession({ arm: 'halt', reason: 'stop mcp' });
    await expect(
      handleBeforeMCPExecution(
        {
          conversation_id: 'cursor-mcp-halt',
          tool_name: 'read_file',
          tool_input: { path: '/tmp/a.txt' },
        } as any,
        haltedMcp as any,
        cfg,
      ),
    ).resolves.toMatchObject({ arm: 'halt' });
    expect(haltedMcp.activity).toHaveBeenCalled();

    const haltedSubagent = recordingSession({ arm: 'halt', reason: 'stop subagent' });
    await expect(
      handleSubagentStart(
        { conversation_id: 'cursor-subagent-halt', subagent_model: 'claude' } as any,
        haltedSubagent as any,
        cfg,
      ),
    ).resolves.toMatchObject({ arm: 'halt' });
    expect(haltedSubagent.activity).toHaveBeenCalled();

    const haltedClaude = recordingSession({ arm: 'halt', reason: 'stop claude' });
    await expect(
      handleUserPromptSubmit(
        { session_id: 'claude-halt', prompt: 'halt this' } as any,
        haltedClaude as any,
        cfg,
      ),
    ).resolves.toMatchObject({ arm: 'halt' });
    expect(haltedClaude.activity).toHaveBeenCalled();
  });

  it('covers CLI color and non-interactive switches', async () => {
    const { color } = await import('../../ts/src/cli/colors.ts');
    const {
      assumeYes,
      isJsonMode,
      isMachineMode,
      isNonInteractive,
      isQuiet,
      setArgvForTesting,
      useColor,
    } = await import('../../ts/src/cli/non-interactive.ts');

    delete process.env.CI;
    delete process.env.NO_COLOR;
    delete process.env.OPENBOX_NO_COLOR;
    delete process.env.OPENBOX_NONINTERACTIVE;
    delete process.env.OPENBOX_ASSUME_YES;
    delete process.env.OPENBOX_QUIET;
    setArgvForTesting(['node', 'openbox']);
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
      writable: true,
    });

    expect(color.green('ok')).toBe('\x1b[32mok\x1b[0m');
    process.env.NO_COLOR = '1';
    expect(color.red('plain')).toBe('plain');
    expect(useColor()).toBe(false);

    delete process.env.NO_COLOR;
    process.env.OPENBOX_NO_COLOR = '1';
    expect(useColor()).toBe(false);

    delete process.env.OPENBOX_NO_COLOR;
    setArgvForTesting(['node', 'openbox', '--no-color', '--json', '--quiet', '-y']);
    expect(useColor()).toBe(false);
    expect(isJsonMode()).toBe(true);
    expect(isQuiet()).toBe(true);
    expect(assumeYes()).toBe(true);
    expect(isNonInteractive()).toBe(true);
    expect(isMachineMode()).toBe(true);

    setArgvForTesting(['node', 'openbox']);
    process.env.OPENBOX_NONINTERACTIVE = '1';
    expect(isNonInteractive()).toBe(true);
    delete process.env.OPENBOX_NONINTERACTIVE;
    process.env.CI = 'true';
    expect(isNonInteractive()).toBe(true);
    expect(useColor()).toBe(false);

    process.env.CI = '0';
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      configurable: true,
      writable: true,
    });
    expect(isMachineMode()).toBe(true);
    setArgvForTesting(null);
  });

  it('delegates Claude Code hook install wrappers to the shared spec installer', async () => {
    const installAdapter = vi.fn();
    const uninstallAdapter = vi.fn();
    vi.doMock('../../ts/src/install/from-spec.js', () => ({
      installAdapter,
      uninstallAdapter,
    }));
    vi.resetModules();

    const { installClaudeCode, uninstallClaudeCode } = await import(
      '../../ts/src/runtime/claude-code/install.ts'
    );

    installClaudeCode();
    uninstallClaudeCode({ cwd: '/repo', scope: 'project' });

    expect(installAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ style: 'claude-array' }),
      {},
    );
    expect(uninstallAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ style: 'claude-array' }),
      { cwd: '/repo', scope: 'project' },
    );
  });
});
