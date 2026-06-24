import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createOpenBoxAnthropicAgentHooks } from '../../ts/src/anthropic-agent-sdk/index.js';
import { createOpenBoxCopilotKitAdapter } from '../../ts/src/copilotkit/index.js';
import { OpenBoxCoreClient } from '../../ts/src/core-client/core-client.js';
import { govern, presets } from '../../ts/src/core-client/generated/govern.js';
import { checkGovernance } from '../../ts/src/governance/check.js';
import { createOpenBoxAgentsTool } from '../../ts/src/openai-agents-sdk/index.js';
import { installClaudeCodePlugin } from '../../ts/src/runtime/claude-code/index.js';
import { installCodexPlugin } from '../../ts/src/runtime/codex/index.js';
import { installCursorPlugin } from '../../ts/src/runtime/cursor/index.js';
import { emitN8nGovernanceCheck } from '../../ts/src/runtime/n8n/index.js';
import { requireOpenBoxCli } from '../helpers/openbox-cli.js';
import {
  LOCAL_GOVERNANCE_VERDICT_MATRIX,
  requireProviderDriver,
  type VerdictMatrixCase,
} from './fixtures/verdict-matrix.js';
import {
  ensureLocalGovernanceMatrix,
  ensureSignedLocalGovernanceMatrix,
  normalizeMatrixVerdict,
} from './helpers/local-governance-matrix.js';

const RUNTIME_KEY_PREFIX = /^obx_(?:test|live)_/;
const OPENBOX = requireOpenBoxCli();
const HOST_PROOF_TIMEOUT_MS = Number(process.env.OPENBOX_KMS_HOST_PROOF_TIMEOUT_MS ?? 180_000);

interface HookResult {
  status: number | null;
  stdout: string;
  stderr: string;
  parsed: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ExecutableTool {
  execute(input: unknown, context?: unknown, details?: unknown): Promise<unknown>;
}

class McpClient {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private buffer = '';
  private pending = new Map<number | string, (r: JsonRpcResponse) => void>();

  constructor(env: Record<string, string>) {
    this.proc = spawn(OPENBOX, ['mcp', 'serve'], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    this.proc.stdout.setEncoding('utf-8');
    this.proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let idx;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const resolver = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            resolver(msg);
          }
        } catch {
          // Ignore stderr-like log lines that may be written to stdout by dependencies.
        }
      }
    });
  }

  async call(method: string, params: Record<string, unknown> = {}): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const reply = new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(id, resolve);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP call ${method} timed out`));
        }
      }, 30_000);
    });
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return reply;
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  close(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

async function withoutAgentIdentityEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previousDid = process.env.OPENBOX_AGENT_DID;
  const previousPrivateKey = process.env.OPENBOX_AGENT_PRIVATE_KEY;
  delete process.env.OPENBOX_AGENT_DID;
  delete process.env.OPENBOX_AGENT_PRIVATE_KEY;
  try {
    return await fn();
  } finally {
    if (previousDid === undefined) delete process.env.OPENBOX_AGENT_DID;
    else process.env.OPENBOX_AGENT_DID = previousDid;
    if (previousPrivateKey === undefined) delete process.env.OPENBOX_AGENT_PRIVATE_KEY;
    else process.env.OPENBOX_AGENT_PRIVATE_KEY = previousPrivateKey;
  }
}

function runtimeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of [
    'OPENBOX_API_KEY',
    'OPENBOX_CORE_URL',
    'OPENBOX_AGENT_DID',
    'OPENBOX_AGENT_PRIVATE_KEY',
    'OPENBOX_HOME',
    'NODE_V8_COVERAGE',
    'VITEST',
    'VITEST_POOL_ID',
    'VITEST_WORKER_ID',
  ]) {
    delete env[key];
  }
  return { ...env, ...overrides };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredCase(id: string): VerdictMatrixCase {
  const entry = LOCAL_GOVERNANCE_VERDICT_MATRIX.find((candidate) => candidate.id === id);
  expect(entry, `missing local governance matrix case ${id}`).toBeDefined();
  return entry!;
}

function toolInputFor(entry: VerdictMatrixCase): Record<string, unknown> {
  const input = objectRecord(entry.activityInput);
  if (entry.spanType === 'mcp') return objectRecord(input.tool_input);
  return input;
}

function callHostHook(root: string, args: string[], envelope: Record<string, unknown>): HookResult {
  const result = spawnSync(OPENBOX, args, {
    cwd: root,
    encoding: 'utf-8',
    timeout: HOST_PROOF_TIMEOUT_MS,
    input: JSON.stringify(envelope),
    env: runtimeEnv(),
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const text = stdout.trim();
  return {
    status: result.status,
    stdout,
    stderr,
    parsed: text ? JSON.parse(text) : undefined,
  };
}

function expectHookSucceeded(result: HookResult, label: string): Record<string, unknown> {
  expect(result.status, `${label} stderr=${result.stderr}`).toBe(0);
  expect(result.stdout.trim(), `${label} hook did not emit stdout JSON`).toBeTruthy();
  return objectRecord(result.parsed);
}

async function proveClaudeCodeSignedHostPath(
  runtime: Awaited<ReturnType<typeof ensureSignedLocalGovernanceMatrix>>,
): Promise<void> {
  const entry = requiredCase('file-read-approval');
  const driver = requireProviderDriver(entry, 'claude-code', 'hook-stdin');
  const root = mkdtempSync(path.join(tmpdir(), 'openbox-kms-claude-'));
  try {
    installClaudeCodePlugin({
      cwd: root,
      runtime: {
        apiKey: runtime.runtimeKey,
        coreUrl: runtime.coreUrl,
        agentIdentity: runtime.agentIdentity,
        governanceTimeout: Math.ceil(HOST_PROOF_TIMEOUT_MS / 1_000),
        approvalMode: 'defer',
        hitlMaxWait: 5,
        hitlPollInterval: 1,
      },
    });
    const output = expectHookSucceeded(
      callHostHook(root, ['claude-code', 'hook'], {
        hook_event_name: driver.event,
        session_id: `kms-claude-${randomUUID()}`,
        tool_name: driver.tool,
        tool_input: entry.activityInput,
        cwd: root,
      }),
      'Claude Code signed path',
    );
    const hookOutput = objectRecord(output.hookSpecificOutput);
    expect(hookOutput.permissionDecision, entry.id).toBe('defer');
    expect(String(hookOutput.permissionDecisionReason ?? ''), entry.id).toContain(
      entry.expectedRule,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function proveCodexSignedHostPath(
  runtime: Awaited<ReturnType<typeof ensureSignedLocalGovernanceMatrix>>,
): Promise<void> {
  const entry = requiredCase('file-read-approval');
  const driver = requireProviderDriver(entry, 'codex', 'hook-stdin');
  const root = mkdtempSync(path.join(tmpdir(), 'openbox-kms-codex-'));
  try {
    installCodexPlugin({
      cwd: root,
      runtime: {
        apiKey: runtime.runtimeKey,
        coreUrl: runtime.coreUrl,
        agentIdentity: runtime.agentIdentity,
        governanceTimeout: Math.ceil(HOST_PROOF_TIMEOUT_MS / 1_000),
        approvalMode: 'inline',
        hitlMaxWait: 5,
        hitlPollInterval: 1,
      },
    });
    const output = expectHookSucceeded(
      callHostHook(root, ['codex', 'hook'], {
        hook_event_name: driver.event,
        session_id: `kms-codex-${randomUUID()}`,
        tool_name: driver.tool,
        tool_input: entry.activityInput,
      }),
      'Codex signed path',
    );
    const hookOutput = objectRecord(output.hookSpecificOutput);
    expect(hookOutput.permissionDecision, entry.id).toBe('ask');
    expect(String(hookOutput.permissionDecisionReason ?? ''), entry.id).toContain(
      entry.expectedRule,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function proveCursorSignedHostPath(
  runtime: Awaited<ReturnType<typeof ensureSignedLocalGovernanceMatrix>>,
): Promise<void> {
  const entry = requiredCase('file-read-approval');
  const driver = requireProviderDriver(entry, 'cursor', 'hook-stdin');
  const root = mkdtempSync(path.join(tmpdir(), 'openbox-kms-cursor-'));
  try {
    installCursorPlugin({
      cwd: root,
      runtime: {
        apiKey: runtime.runtimeKey,
        coreUrl: runtime.coreUrl,
        agentIdentity: runtime.agentIdentity,
        governanceTimeout: Math.ceil(HOST_PROOF_TIMEOUT_MS / 1_000),
        approvalMode: 'inline',
        hitlMaxWait: 5,
        hitlPollInterval: 1,
      },
    });
    const output = expectHookSucceeded(
      callHostHook(root, ['cursor', 'hook'], {
        hook_event_name: driver.event,
        conversation_id: `kms-cursor-${randomUUID()}`,
        generation_id: randomUUID(),
        file_path: String(objectRecord(entry.activityInput).file_path),
      }),
      'Cursor signed path',
    );
    expect(output.permission, entry.id).toBe('deny');
    expect(
      [output.user_message, output.agent_message].filter(Boolean).join('\n'),
      entry.id,
    ).toContain(entry.expectedRule);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function proveMcpSignedHostPath(
  runtime: Awaited<ReturnType<typeof ensureSignedLocalGovernanceMatrix>>,
): Promise<void> {
  const entry = requiredCase('mcp-tool-allow');
  const client = new McpClient({
    OPENBOX_API_KEY: runtime.runtimeKey,
    OPENBOX_API_URL: runtime.apiUrl,
    OPENBOX_CORE_URL: runtime.coreUrl,
    OPENBOX_BACKEND_API_KEY: runtime.backendKey,
    OPENBOX_AGENT_DID: runtime.agentIdentity!.did,
    OPENBOX_AGENT_PRIVATE_KEY: runtime.agentIdentity!.privateKey,
  });
  try {
    const init = await client.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'openbox-kms-signed-test', version: '0' },
    });
    expect(init.error, init.error?.message).toBeUndefined();
    client.notify('notifications/initialized');

    const response = await client.call('tools/call', {
      name: 'check_governance',
      arguments: {
        agent_id: runtime.agentId,
        span_type: entry.spanType,
        activity_input: entry.activityInput,
      },
    });
    expect(response.error, response.error?.message).toBeUndefined();
    const result = response.result as { content?: Array<{ text?: string }>; isError?: boolean };
    expect(result.isError, result.content?.[0]?.text).not.toBe(true);
    const body = JSON.parse(result.content?.[0]?.text ?? '{}') as Record<string, unknown>;
    expect(normalizeMatrixVerdict(body.verdict ?? body.action ?? body.outcome)).toBe('allow');
  } finally {
    client.close();
  }
}

async function proveOpenAiSignedHostPath(
  runtime: Awaited<ReturnType<typeof ensureSignedLocalGovernanceMatrix>>,
): Promise<void> {
  const entry = requiredCase('mcp-tool-allow');
  const driver = requireProviderDriver(entry, 'openai-agents-sdk', 'sdk-wrapper');
  const execute = async (input: unknown) => ({ ok: true, input });
  const wrapped = createOpenBoxAgentsTool(
    {
      name: driver.tool,
      description: entry.name,
      execute,
    },
    {
      apiKey: runtime.runtimeKey,
      coreUrl: runtime.coreUrl,
      agentIdentity: runtime.agentIdentity,
      approvalMode: 'error',
      sessionId: `kms-openai-${randomUUID()}`,
      toolFactory: (config) => config,
    },
  ) as ExecutableTool;
  const input = toolInputFor(entry);
  await expect(
    wrapped.execute(input, undefined, {
      toolCall: {
        callId: `kms-openai-call-${randomUUID()}`,
        name: driver.tool,
        arguments: JSON.stringify(input),
      },
    }),
  ).resolves.toMatchObject({ ok: true });
}

async function proveAnthropicSignedHostPath(
  runtime: Awaited<ReturnType<typeof ensureSignedLocalGovernanceMatrix>>,
): Promise<void> {
  const entry = requiredCase('mcp-tool-allow');
  const driver = requireProviderDriver(entry, 'anthropic-agent-sdk', 'sdk-wrapper');
  const hooks = createOpenBoxAnthropicAgentHooks({
    apiKey: runtime.runtimeKey,
    coreUrl: runtime.coreUrl,
    agentIdentity: runtime.agentIdentity,
    approvalMode: 'defer',
    hookTimeoutSeconds: Math.ceil(HOST_PROOF_TIMEOUT_MS / 1_000),
  });
  const matcher = hooks.PreToolUse?.[0];
  expect(matcher, 'missing Anthropic PreToolUse matcher').toBeDefined();
  const output = await matcher!.hooks[0](
    {
      hook_event_name: 'PreToolUse',
      session_id: `kms-anthropic-${randomUUID()}`,
      transcript_path: '/tmp/openbox-kms-anthropic-transcript.jsonl',
      cwd: '/tmp/openbox-kms-anthropic',
      tool_name: driver.tool,
      tool_input: toolInputFor(entry),
      tool_use_id: `kms-anthropic-tool-${randomUUID()}`,
    } as never,
    undefined,
    { signal: new AbortController().signal } as never,
  );
  expect(objectRecord(objectRecord(output).hookSpecificOutput).permissionDecision).toBe('allow');
}

async function proveCopilotKitSignedHostPath(
  runtime: Awaited<ReturnType<typeof ensureSignedLocalGovernanceMatrix>>,
): Promise<void> {
  const entry = requiredCase('mcp-tool-allow');
  const driver = requireProviderDriver(entry, 'copilotkit', 'runtime-adapter');
  const adapter = createOpenBoxCopilotKitAdapter({
    apiKey: runtime.runtimeKey,
    coreUrl: runtime.coreUrl,
    agentIdentity: runtime.agentIdentity,
    coreTimeoutMs: HOST_PROOF_TIMEOUT_MS,
  });
  const result = await adapter.governToolInput({
    payload: {
      name: driver.tool,
      args: toolInputFor(entry),
      description: entry.name,
    },
    sessionKey: `kms-copilotkit-${randomUUID()}`,
    activityType: driver.tool,
  });
  expect(result.verdict.arm).toBe('allow');
  expect(result.status).toBe('executed');
}

async function proveN8nSignedHostPath(
  runtime: Awaited<ReturnType<typeof ensureSignedLocalGovernanceMatrix>>,
): Promise<void> {
  const entry = requiredCase('mcp-tool-allow');
  const driver = requireProviderDriver(entry, 'n8n', 'runtime-helper');
  await govern(
    {
      preset: presets.n8n,
      core: new OpenBoxCoreClient({
        apiKey: runtime.runtimeKey,
        apiUrl: runtime.coreUrl,
        agentIdentity: runtime.agentIdentity,
        timeoutMs: HOST_PROOF_TIMEOUT_MS,
      }),
      registerExitHandlers: false,
      workflowId: `kms-n8n-${randomUUID()}`,
      runId: randomUUID(),
      workflowType: 'n8n-kms-signed-governance',
      taskQueue: 'n8n',
      inlineApproval: true,
    },
    async (session) => {
      const verdict = await emitN8nGovernanceCheck(session, {
        spanType: entry.spanType,
        activityInput: objectRecord(entry.activityInput),
        nodeName: driver.tool,
        sessionId: `kms-n8n-${randomUUID()}`,
      });
      expect(verdict.arm).toBe('allow');
    },
  );
}

describe('local KMS signing local-stack governance', () => {
  it('proves unsigned dev mode and signing_required compliance mode', async () => {
    const unsigned = await ensureLocalGovernanceMatrix();
    expect(unsigned.signingRequired).not.toBe(true);
    expect(unsigned.agentIdentity).toBeUndefined();
    expect(unsigned.runtimeKey).toMatch(RUNTIME_KEY_PREFIX);

    const signed = await ensureSignedLocalGovernanceMatrix();
    expect(signed.signingRequired).toBe(true);
    expect(signed.agentId).not.toBe(unsigned.agentId);
    expect(signed.runtimeKey).toMatch(RUNTIME_KEY_PREFIX);
    expect(signed.agentIdentity).toMatchObject({
      did: expect.stringMatching(/^did:/),
      privateKey: expect.any(String),
    });

    const sample = LOCAL_GOVERNANCE_VERDICT_MATRIX.find((entry) => entry.expectedVerdict === 'allow')
      ?? LOCAL_GOVERNANCE_VERDICT_MATRIX[0];
    await withoutAgentIdentityEnv(async () => {
      await expect(
        checkGovernance({
          agentId: signed.agentId,
          apiKey: signed.runtimeKey,
          coreUrl: signed.coreUrl,
          spanType: sample.spanType,
          activityInput: sample.activityInput,
        }),
      ).rejects.toThrow();
    });
  }, 180_000);

  it('passes signed agent identity through each official host runtime path', async () => {
    const signed = await ensureSignedLocalGovernanceMatrix();
    expect(signed.agentIdentity).toBeDefined();

    await proveClaudeCodeSignedHostPath(signed);
    await proveCodexSignedHostPath(signed);
    await proveCursorSignedHostPath(signed);
    await proveMcpSignedHostPath(signed);
    await proveOpenAiSignedHostPath(signed);
    await proveAnthropicSignedHostPath(signed);
    await proveCopilotKitSignedHostPath(signed);
    await proveN8nSignedHostPath(signed);
  }, 420_000);
});
