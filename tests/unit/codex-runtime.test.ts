import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { Command } from 'commander';
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
  handlePermissionRequest,
  handlePostToolUse,
  handlePreToolUse,
} from '../../ts/src/runtime/codex/mappers/tool.js';
import { handleUserPromptSubmit } from '../../ts/src/runtime/codex/mappers/prompt.js';
import { handleStop } from '../../ts/src/runtime/codex/mappers/session.js';
import { resolveSession } from '../../ts/src/runtime/codex/session-resolver.js';
import { sideEffects } from '../../ts/src/runtime/codex/side-effects.js';
import { parseApprovalExpirationMs } from '../../ts/src/core-client/approval-time.js';
import { registerCodexCommands } from '../../ts/src/cli/commands/codex.js';
import { registerMcpCommands } from '../../ts/src/cli/commands/mcp.js';

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

const originalCwd = process.cwd();
const originalOpenboxHome = process.env.OPENBOX_HOME;
const originalStdoutWrite = process.stdout.write;
const originalStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
const originalExit = process.exit;
const originalExitCode = process.exitCode;
const originalConsoleError = console.error;

afterEach(() => {
  process.chdir(originalCwd);
  if (originalOpenboxHome === undefined) delete process.env.OPENBOX_HOME;
  else process.env.OPENBOX_HOME = originalOpenboxHome;
  if (originalStdinDescriptor) Object.defineProperty(process, 'stdin', originalStdinDescriptor);
  Object.defineProperty(process.stdout, 'write', {
    value: originalStdoutWrite,
    configurable: true,
    writable: true,
  });
  process.exit = originalExit;
  process.exitCode = originalExitCode;
  console.error = originalConsoleError;
  vi.restoreAllMocks();
  vi.resetModules();
});

function programWith(register: (program: Command) => void): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined,
  });
  register(program);
  return program;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
}

function readDotenv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = JSON.parse(trimmed.slice(eq + 1)) as string;
  }
  return out;
}

function writeEnv(file: string, values: Record<string, string>): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n') + '\n',
  );
}

async function run(program: Command, args: string[]): Promise<void> {
  await program.parseAsync(args, { from: 'user' });
}

function stubHookProcess(stdin: string): string[] {
  const stdout: string[] = [];
  Object.defineProperty(process, 'stdin', {
    value: Readable.from([Buffer.from(stdin)]),
    configurable: true,
  });
  Object.defineProperty(process.stdout, 'write', {
    value: (chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    },
    configurable: true,
    writable: true,
  });
  process.exit = ((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  }) as never;
  console.error = vi.fn();
  return stdout;
}

async function runCodexHookWithConfig(
  config: Record<string, unknown>,
  stdin: string,
): Promise<string[]> {
  const root = mkdtempSync(join(tmpdir(), 'openbox-codex-hook-'));
  const oldApiKey = process.env.OPENBOX_API_KEY;
  const oldCoreUrl = process.env.OPENBOX_CORE_URL;
  const oldAgentDid = process.env.OPENBOX_AGENT_DID;
  const oldAgentPrivateKey = process.env.OPENBOX_AGENT_PRIVATE_KEY;
  const runtimeKeys = new Set([
    'OPENBOX_API_KEY',
    'OPENBOX_CORE_URL',
    'OPENBOX_AGENT_DID',
    'OPENBOX_AGENT_PRIVATE_KEY',
  ]);
  const runtimeEnv: Record<string, string> = {};
  const configJson: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (runtimeKeys.has(key)) runtimeEnv[key] = String(value);
    else configJson[key] = value;
  }
  mkdirSync(join(root, '.openbox', 'codex'), { recursive: true });
  writeFileSync(join(root, '.openbox', 'codex', 'config.json'), JSON.stringify(configJson));
  if (Object.keys(runtimeEnv).length > 0) {
    writeEnv(join(root, '.openbox', 'codex', '.env'), runtimeEnv);
  }
  process.chdir(root);
  delete process.env.OPENBOX_HOME;
  delete process.env.OPENBOX_API_KEY;
  delete process.env.OPENBOX_CORE_URL;
  delete process.env.OPENBOX_AGENT_DID;
  delete process.env.OPENBOX_AGENT_PRIVATE_KEY;
  vi.resetModules();
  const stdout = stubHookProcess(stdin);
  try {
    const { runCodexHook } = await import('../../ts/src/runtime/codex/hook-handler.js');
    await expect(runCodexHook()).rejects.toThrow('exit:0');
    return stdout;
  } finally {
    if (oldApiKey === undefined) delete process.env.OPENBOX_API_KEY;
    else process.env.OPENBOX_API_KEY = oldApiKey;
    if (oldCoreUrl === undefined) delete process.env.OPENBOX_CORE_URL;
    else process.env.OPENBOX_CORE_URL = oldCoreUrl;
    if (oldAgentDid === undefined) delete process.env.OPENBOX_AGENT_DID;
    else process.env.OPENBOX_AGENT_DID = oldAgentDid;
    if (oldAgentPrivateKey === undefined) delete process.env.OPENBOX_AGENT_PRIVATE_KEY;
    else process.env.OPENBOX_AGENT_PRIVATE_KEY = oldAgentPrivateKey;
    rmSync(root, { recursive: true, force: true });
  }
}

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

  it('maps approval-required PreToolUse verdicts to Codex permission ask', async () => {
    const stdout: string[] = [];
    const env: CodexEnvelope = {
      hook_event_name: 'PreToolUse',
      session_id: 'codex-session',
      tool_name: 'Shell',
      tool_input: { command: 'deploy production' },
    };
    await createCodexAdapter({
      core: {} as never,
      resolveSession: async () => ({ workflowId: 'w', runId: 'r' }),
      handlers: {
        preToolUse: async () => ({
          arm: 'require_approval',
          reason: 'review deployment',
          riskScore: 0.9,
        }),
      },
      ...adapterIO(stdout, JSON.stringify(env)),
    }).run();

    const out = JSON.parse(stdout[0]);
    expect(out.hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
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

  it('opens the workflow once when Codex starts from a prompt hook', async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), 'openbox-codex-started-'));
    try {
      const mock = createMockCore(() => ({ verdict: 'allow', action: 'allow' }));
      const { presets } = await import('../../ts/src/core-client/index.js');
      const runtimeCfg = { sessionDir } as never;
      const env: CodexEnvelope = {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'codex-prompt-first',
        prompt: 'Summarize the telemetry behavior.',
      };

      const ids = await resolveSession(env, runtimeCfg);
      const firstSession = new presets.codex({
        core: mock.core,
        workflowId: ids.workflowId,
        runId: ids.runId,
        registerExitHandlers: false,
        attached: true,
      });
      await handleUserPromptSubmit(env, firstSession, runtimeCfg);

      expect(mock.events.map((event) => event.event_type)).toEqual([
        'WorkflowStarted',
        'SignalReceived',
        'ActivityStarted',
        'ActivityStarted',
        'ActivityCompleted',
      ]);
      const promptHookEvent = mock.events.find((event) => event.hook_trigger === true);
      expect(promptHookEvent?.activity_type).toBe('PromptSubmission');
      expect(promptHookEvent?.spans?.[0]).toMatchObject({
        name: 'POST',
        module: 'codex',
        attributes: expect.objectContaining({
          'gen_ai.system': 'codex',
          'http.method': 'POST',
        }),
      });

      const idsAgain = await resolveSession(env, runtimeCfg);
      expect(idsAgain).toEqual(ids);
      const secondSession = new presets.codex({
        core: mock.core,
        workflowId: idsAgain.workflowId,
        runId: idsAgain.runId,
        registerExitHandlers: false,
        attached: true,
      });
      await handleUserPromptSubmit(
        { ...env, prompt: 'Summarize the telemetry behavior again.' },
        secondSession,
        runtimeCfg,
      );

      expect(mock.events.filter((event) => event.event_type === 'WorkflowStarted')).toHaveLength(1);
      expect(mock.events.slice(5).map((event) => event.event_type)).toEqual([
        'SignalReceived',
        'ActivityStarted',
        'ActivityStarted',
        'ActivityCompleted',
      ]);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
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
    });
    expect(completedHook?.spans?.[0]).not.toHaveProperty('semantic_type');
    expect(completedHook?.spans?.[0]?.attributes).not.toHaveProperty(
      'openbox.semantic_type',
    );
  });

  it('routes Codex tool mapper branches for files, HTTP, MCP, database, and halt verdicts', async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), 'openbox-codex-tool-routes-'));
    try {
      const runtimeCfg = { sessionDir } as never;
      const mock = createMockCore((payload) =>
        payload.tool_name === 'Delete'
          ? { verdict: 'halt', action: 'halt', reason: 'stop requested' }
          : { verdict: 'allow', action: 'allow' },
      );
      const { presets } = await import('../../ts/src/core-client/index.js');
      const session = new presets.codex({
        core: mock.core,
        workflowId: 'codex-route-workflow',
        runId: 'codex-route-run',
        registerExitHandlers: false,
        attached: true,
      });

      await handlePreToolUse(
        {
          hook_event_name: 'PreToolUse',
          session_id: 'codex-route-read',
          tool_use_id: 'read-1',
          tool_name: 'Read',
          tool_input: { file_path: 'README.md' },
        },
        session,
        runtimeCfg,
      );
      await handlePreToolUse(
        {
          hook_event_name: 'PreToolUse',
          session_id: 'codex-route-write',
          tool_use_id: 'write-1',
          tool_name: 'Write',
          tool_input: { path: 'out.txt' },
        },
        session,
        runtimeCfg,
      );
      await handlePreToolUse(
        {
          hook_event_name: 'PreToolUse',
          session_id: 'codex-route-mcp',
          tool_use_id: 'mcp-1',
          tool_name: 'mcp__filesystem__read',
          tool_input: { path: '/tmp/a.txt' },
        },
        session,
        runtimeCfg,
      );
      await handlePermissionRequest(
        {
          hook_event_name: 'PermissionRequest',
          session_id: 'codex-route-db',
          tool_name: 'mcp__postgres__query_database',
          tool_input: { sql: 'select 1', db_system: 'postgresql' },
        },
        session,
        runtimeCfg,
      );
      await handlePreToolUse(
        {
          hook_event_name: 'PreToolUse',
          session_id: 'codex-route-mcp-http',
          tool_use_id: 'mcp-http-1',
          tool_name: 'mcp__web__request',
          tool_input: { url: 'https://example.com/mcp', method: 'patch' },
        },
        session,
        runtimeCfg,
      );
      await handlePostToolUse(
        {
          hook_event_name: 'PostToolUse',
          session_id: 'codex-route-http',
          tool_use_id: 'http-1',
          tool_name: 'WebFetch',
          tool_input: { url: 'https://example.com/a', method: 'post' },
          response: 'ok',
          duration_ms: 25,
        },
        session,
        runtimeCfg,
      );
      await handlePostToolUse(
        {
          hook_event_name: 'PostToolUse',
          session_id: 'codex-route-custom',
          tool_use_id: 'custom-1',
          tool_name: 'CustomTool',
          tool_input: {},
          tool_output: { ok: true },
          duration_ms: Number.NaN,
        },
        session,
        runtimeCfg,
      );

      const haltEnv: CodexEnvelope = {
        hook_event_name: 'PreToolUse',
        session_id: 'codex-route-halt',
        tool_use_id: 'delete-1',
        tool_name: 'Delete',
        tool_input: { path: 'out.txt' },
      };
      const idsBeforeHalt = await resolveSession(haltEnv, runtimeCfg);
      const haltVerdict = await handlePreToolUse(haltEnv, session, runtimeCfg);
      expect(haltVerdict?.arm).toBe('halt');
      expect(await resolveSession(haltEnv, runtimeCfg)).not.toEqual(idsBeforeHalt);

      const nonHookEvents = mock.events.filter((event) => event.hook_trigger !== true);
      expect(nonHookEvents.map((event) => event.activity_type)).toEqual(
        expect.arrayContaining([
          'FileRead',
          'FileEdit',
          'MCPToolCall',
          'DatabaseQuery',
          'HTTPRequest',
          'AgentAction',
          'FileDelete',
        ]),
      );
      expect(
        nonHookEvents.map((event) => ({
          activityType: event.activity_type,
          toolName: event.tool_name,
          toolType: event.tool_type,
        })),
      ).toEqual(
        expect.arrayContaining([
          { activityType: 'FileRead', toolName: 'Read', toolType: 'file_read' },
          { activityType: 'FileEdit', toolName: 'Write', toolType: 'file_write' },
          { activityType: 'MCPToolCall', toolName: 'mcp__filesystem__read', toolType: 'mcp' },
          { activityType: 'DatabaseQuery', toolName: 'mcp__postgres__query_database', toolType: 'db' },
          { activityType: 'HTTPRequest', toolName: 'mcp__web__request', toolType: 'http' },
          { activityType: 'HTTPRequest', toolName: 'WebFetch', toolType: 'http' },
          { activityType: 'AgentAction', toolName: 'CustomTool', toolType: undefined },
          { activityType: 'FileDelete', toolName: 'Delete', toolType: 'file_delete' },
        ]),
      );
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it('emits Codex assistant-output spans when Stop carries assistant text', async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), 'openbox-codex-stop-span-'));
    try {
      const mock = createMockCore(() => ({ verdict: 'allow', action: 'allow' }));
      const { presets } = await import('../../ts/src/core-client/index.js');
      const session = new presets.codex({
        core: mock.core,
        workflowId: 'codex-stop-workflow',
        runId: 'codex-stop-run',
        registerExitHandlers: false,
        attached: true,
      });

      await handleStop(
        {
          hook_event_name: 'Stop',
          session_id: 'codex-stop-session',
          content: 'The governed task is complete.',
          model: 'gpt-5.4',
        },
        session,
        { sessionDir } as never,
      );

      const completed = mock.events.find(
        (event) => event.event_type === 'ActivityCompleted' && event.hook_trigger !== true,
      );
      expect(completed).toMatchObject({
        event_type: 'ActivityCompleted',
        activity_type: 'CodexSession',
        completion: 'The governed task is complete.',
        llm_model: 'gpt-5.4',
      });
      const hookEvent = mock.events.find(
        (event) => event.hook_trigger === true && event.spans?.[0]?.name === 'openbox.codex.assistant_output',
      );
      expect(hookEvent?.spans?.[0]).toMatchObject({
        name: 'openbox.codex.assistant_output',
        module: 'codex',
        stage: 'completed',
        attributes: {
          'gen_ai.system': 'codex',
          'openbox.codex.event': 'Stop',
        },
      });
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it('resolves Codex runtime config upward and uses the start directory by default', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openbox-codex-config-'));
    const defaultRoot = mkdtempSync(join(tmpdir(), 'openbox-codex-config-default-'));
    try {
      const nested = join(root, 'a', 'b');
      mkdirSync(join(root, '.openbox', 'codex'), { recursive: true });
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(root, '.openbox', 'codex', 'config.json'), '{}');

      vi.resetModules();
      const { resolveConfigDir } = await import('../../ts/src/runtime/codex/config.js');
      expect(resolveConfigDir(nested)).toBe(join(root, '.openbox', 'codex'));
      expect(resolveConfigDir(defaultRoot)).toBe(join(defaultRoot, '.openbox', 'codex'));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(defaultRoot, { recursive: true, force: true });
    }
  });

  it('loads Codex config from file, env file, and runtime environment with normalized settings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openbox-codex-config-load-'));
    const oldKey = process.env.OPENBOX_API_KEY;
    const oldCore = process.env.OPENBOX_CORE_URL;
    try {
      mkdirSync(join(root, '.openbox', 'codex'), { recursive: true });
      writeFileSync(
        join(root, '.openbox', 'codex', 'config.json'),
        JSON.stringify({
          governanceTimeout: '0',
          sessionDir: 'sessions-file',
          logFile: '',
          verbose: '1',
          hitlEnabled: 'false',
          hitlPollInterval: '0',
          hitlMaxWait: '0',
          approvalMode: 'inline',
          sendStartEvent: 'false',
          sendActivityStartEvent: 'false',
          maxBodySize: '1234',
        }),
      );
      writeFileSync(
        join(root, '.openbox', 'codex', '.env'),
        [
          `OPENBOX_API_KEY=${JSON.stringify('obx_file_' + 'a'.repeat(48))}`,
          'OPENBOX_CORE_URL="https://file-core.example"',
          'taskQueue=codex-env',
          'approvalMode=defer',
        ].join('\n'),
      );
      process.chdir(root);
      process.env.OPENBOX_API_KEY = 'obx_env_' + 'b'.repeat(48);
      process.env.OPENBOX_CORE_URL = 'https://env-core.example';
      vi.resetModules();

      const { loadConfig } = await import('../../ts/src/runtime/codex/config.js');
      const loaded = loadConfig();

      expect(loaded).toMatchObject({
        openboxApiKey: 'obx_env_' + 'b'.repeat(48),
        openboxEndpoint: 'https://env-core.example',
        governancePolicy: 'fail_closed',
        governanceTimeout: 15,
        sessionDir: 'sessions-file',
        logFile: null,
        verbose: true,
        hitlEnabled: false,
        hitlPollInterval: 5,
        hitlMaxWait: 300,
        approvalMode: 'inline',
        taskQueue: 'codex-env',
        sendStartEvent: false,
        sendActivityStartEvent: false,
        maxBodySize: 1234,
      });
      expect(loaded.agentIdentity).toBeUndefined();
    } finally {
      if (oldKey === undefined) delete process.env.OPENBOX_API_KEY;
      else process.env.OPENBOX_API_KEY = oldKey;
      if (oldCore === undefined) delete process.env.OPENBOX_CORE_URL;
      else process.env.OPENBOX_CORE_URL = oldCore;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails Codex hook decisions closed when runtime configuration is missing', async () => {
    const env: CodexEnvelope = {
      hook_event_name: 'PreToolUse',
      session_id: 'codex-missing-config',
      tool_name: 'Shell',
      tool_input: { command: 'rm -rf /tmp/x' },
    };

    const missingKey = await runCodexHookWithConfig(
      { OPENBOX_CORE_URL: 'https://core.example', verbose: 'true' },
      JSON.stringify(env),
    );
    expect(JSON.parse(missingKey.join(''))).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: '[OpenBox] missing OPENBOX_API_KEY',
      },
    });

    const missingCore = await runCodexHookWithConfig(
      { OPENBOX_API_KEY: 'obx_live_' + 'c'.repeat(48), verbose: 'true' },
      JSON.stringify({ ...env, hook_event_name: 'PermissionRequest' }),
    );
    expect(JSON.parse(missingCore.join(''))).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'deny',
          message: '[OpenBox] missing OPENBOX_CORE_URL',
        },
      },
    });

    const missingStableSession = await runCodexHookWithConfig(
      {
        OPENBOX_API_KEY: 'obx_live_' + 'd'.repeat(48),
        OPENBOX_CORE_URL: 'https://core.example',
        verbose: 'true',
      },
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Shell',
        tool_input: { command: 'pwd' },
      }),
    );
    expect(JSON.parse(missingStableSession.join(''))).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: '[OpenBox] missing Codex session identifier',
      },
    });

    const invalidJson = await runCodexHookWithConfig(
      { OPENBOX_CORE_URL: 'https://core.example' },
      '{not-json',
    );
    expect(invalidJson).toEqual([]);
  });

  it('reads Codex side-effect file content with redaction and default empty content', () => {
    const root = mkdtempSync(join(tmpdir(), 'openbox-codex-side-effects-'));
    try {
      const file = join(root, 'plain.txt');
      const secret = join(root, '.env');
      writeFileSync(file, 'hello');
      writeFileSync(secret, 'TOKEN=secret');

      expect(sideEffects.readFile?.(undefined)).toBe('');
      expect(sideEffects.readFile?.('')).toBe('');
      expect(sideEffects.readFile?.(file)).toBe('hello');
      expect(sideEffects.readFile?.(secret)).toBe('[OpenBox redacted file content]');
      expect(sideEffects.readFile?.(join(root, 'missing.txt'))).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('parses approval expiration timestamps defensively', () => {
    expect(parseApprovalExpirationMs(undefined)).toBeUndefined();
    expect(parseApprovalExpirationMs(null)).toBeUndefined();
    expect(parseApprovalExpirationMs('   ')).toBeUndefined();
    expect(parseApprovalExpirationMs('not-a-date')).toBeUndefined();
    expect(parseApprovalExpirationMs('2026-06-20 12:00:00')).toBe(Date.parse('2026-06-20T12:00:00Z'));
    expect(parseApprovalExpirationMs('2026-06-20T12:00:00+07:00')).toBe(Date.parse('2026-06-20T12:00:00+07:00'));
  });

  it('covers Codex and MCP command validation branches', async () => {
    const codex = programWith(registerCodexCommands);
    const mcp = programWith(registerMcpCommands);
    const runtimeKey = `obx_test_${'c'.repeat(48)}`;
    const coreUrl = 'http://127.0.0.1:8086';
    const identity = {
      did: 'did:aip:550e8400-e29b-41d4-a716-446655440002',
      privateKey: Buffer.alloc(32, 3).toString('base64'),
    };
    const exported = mkdtempSync(join(tmpdir(), 'openbox-codex-export-parent-'));
    const project = mkdtempSync(join(tmpdir(), 'openbox-codex-project-'));
    try {
      await expect(
        run(codex, ['codex', 'plugin', 'export', '--out', join(exported, 'bad'), '--matcher', 'missing-equals']),
      ).rejects.toThrow();

      await run(codex, [
        'codex',
        'plugin',
        'export',
        '--out',
        join(exported, 'plugin'),
        '--matcher',
        'PreToolUse=.*',
      ]);
      await run(codex, [
        'codex',
        'plugin',
        'install',
        '--cwd',
        project,
        '--target',
        join(project, '.agents', 'plugins', 'openbox'),
        '--skip-repo-skill',
        '--skip-marketplace',
        '--runtime-api-key',
        runtimeKey,
        '--core-url',
        coreUrl,
        '--agent-did',
        identity.did,
        '--agent-private-key',
        identity.privateKey,
        '--approval-mode',
        'inline',
        '--governance-timeout',
        '18',
        '--hitl-max-wait',
        '90',
        '--hitl-poll-interval',
        '4',
      ]);
      await run(codex, [
        'codex',
        'install',
        '--cwd',
        project,
        '--runtime-api-key',
        runtimeKey,
        '--core-url',
        coreUrl,
        '--agent-did',
        identity.did,
        '--agent-private-key',
        identity.privateKey,
        '--approval-mode',
        'defer',
        '--governance-timeout',
        '18',
        '--hitl-max-wait',
        '90',
        '--hitl-poll-interval',
        '4',
      ]);
      const runtimeEnv = readDotenv(join(project, '.openbox', 'codex', '.env'));
      expect(runtimeEnv.OPENBOX_API_KEY).toBe(runtimeKey);
      expect(runtimeEnv.OPENBOX_CORE_URL).toBe(coreUrl);
      expect(runtimeEnv.OPENBOX_AGENT_DID).toBe(identity.did);
      expect(runtimeEnv.OPENBOX_AGENT_PRIVATE_KEY).toBe(identity.privateKey);
      const runtimeConfig = readJson(join(project, '.openbox', 'codex', 'config.json'));
      expect(runtimeConfig.approvalMode).toBe('defer');
      expect(runtimeConfig.governanceTimeout).toBe('18');
      expect(runtimeConfig.hitlMaxWait).toBe(90);
      expect(runtimeConfig.hitlPollInterval).toBe(4);
      expect(runtimeConfig.OPENBOX_API_KEY).toBeUndefined();
      expect(runtimeConfig.OPENBOX_CORE_URL).toBeUndefined();
      await run(codex, ['codex', 'doctor', '--cwd', project, '--surface-only', '--json']);
      await run(codex, [
        'codex',
        'plugin',
        'uninstall',
        '--cwd',
        project,
        '--remove-repo-skill',
        '--remove-marketplace-entry',
      ]);

      await run(mcp, ['mcp', 'serve', '--transport', 'bad']);
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
      await run(mcp, ['mcp', 'serve', '--transport', 'http', '--port', '0']);
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(exported, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    }
  });
});
