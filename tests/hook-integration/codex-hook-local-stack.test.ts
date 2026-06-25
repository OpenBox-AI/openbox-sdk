import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOOK_SPEC } from '../../ts/src/core-client/generated/runtime/codex.js';
import {
  installCodexPlugin,
  verifyCodexPlugin,
} from '../../ts/src/runtime/codex/index.js';
import { requireOpenBoxCli } from '../helpers/openbox-cli.js';
import {
  CODEX_HOOK_STDIN_VERDICT_MATRIX,
  LOCAL_GOVERNANCE_VERDICT_MATRIX,
  requireProviderDriver,
  type VerdictMatrixCase,
  type ProviderDriver,
} from './fixtures/verdict-matrix.js';
import {
  LOCAL_GOVERNANCE_MATRIX_SETUP_TIMEOUT_MS,
  ensureLocalGovernanceMatrix,
} from './helpers/local-governance-matrix.js';

const OPENBOX = requireOpenBoxCli();
const LOCAL_GOVERNANCE_TIMEOUT_SEC = Number(
  process.env.OPENBOX_LOCAL_CODEX_HOOK_TIMEOUT_SEC ?? 150,
);

let projectRoot: string | undefined;

interface HookResult {
  status: number | null;
  stdout: string;
  stderr: string;
  parsed: unknown;
}

interface CodexHookOutput {
  hookSpecificOutput?: {
    hookEventName?: string;
    permissionDecision?: string;
    permissionDecisionReason?: string;
    additionalContext?: string;
  };
  decision?: string;
  reason?: string;
}

interface HookLogLine {
  event?: string;
  governance_event_id?: string;
  session_id?: string;
  tool_name?: string;
  verdict_kind?: string;
}

function runtimeEnv(): Record<string, string> {
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
  return env;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toolInputFor(c: VerdictMatrixCase, driver: ProviderDriver): Record<string, unknown> {
  const input = objectRecord(c.activityInput);
  if (driver.tool?.startsWith('mcp__')) {
    return Object.keys(objectRecord(input.tool_input)).length > 0
      ? objectRecord(input.tool_input)
      : input;
  }
  return input;
}

function envelopeFor(
  c: VerdictMatrixCase,
  driver: ProviderDriver,
  sessionId: string,
): Record<string, unknown> {
  const input = objectRecord(c.activityInput);
  if (driver.event === 'UserPromptSubmit') {
    return {
      hook_event_name: driver.event,
      session_id: sessionId,
      prompt: String(input.prompt ?? c.name),
      model: 'gpt-5.4',
    };
  }
  return {
    hook_event_name: driver.event,
    session_id: sessionId,
    tool_name: driver.tool,
    tool_input: toolInputFor(c, driver),
  };
}

function expectedPermissionDecision(c: VerdictMatrixCase): 'allow' | 'ask' | 'deny' {
  if (c.expectedVerdict === 'require_approval') return 'ask';
  if (c.expectedVerdict === 'block' || c.expectedVerdict === 'halt') return 'deny';
  return 'allow';
}

function expectCodexOutput(
  output: CodexHookOutput,
  entry: VerdictMatrixCase,
  driver: ProviderDriver,
): void {
  if (driver.event === 'UserPromptSubmit') {
    if (entry.expectedVerdict === 'allow' || entry.expectedVerdict === 'constrain') {
      expect(output.decision, entry.id).toBeUndefined();
      return;
    }
    expect(output.decision, entry.id).toBe('block');
    expect(output.reason, entry.id).toContain(entry.expectedRule);
    return;
  }

  expect(output.hookSpecificOutput?.hookEventName, entry.id).toBe(driver.event);
  expect(output.hookSpecificOutput?.permissionDecision, entry.id).toBe(
    expectedPermissionDecision(entry),
  );
  if (entry.expectedVerdict === 'constrain') {
    expect(output.hookSpecificOutput?.additionalContext, entry.id).toContain(
      entry.expectedRule,
    );
  }
  if (entry.expectedOutcome !== 'allow') {
    expect(output.hookSpecificOutput?.permissionDecisionReason, entry.id).toContain(
      entry.expectedRule,
    );
  }
}

function callCodexHook(envelope: Record<string, unknown>): HookResult {
  if (!projectRoot) throw new Error('project root was not initialized');
  const result = spawnSync(OPENBOX, ['codex', 'hook'], {
    cwd: projectRoot,
    encoding: 'utf-8',
    timeout: 180_000,
    input: JSON.stringify(envelope),
    env: runtimeEnv(),
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const text = stdout.trim();
  let parsed: unknown;
  if (text) {
    parsed = JSON.parse(text);
  }
  return { status: result.status, stdout, stderr, parsed };
}

function hookOutput(result: HookResult): CodexHookOutput {
  expect(result.status, `stderr=${result.stderr}`).toBe(0);
  expect(result.stdout.trim(), 'Codex hook did not emit stdout JSON').toBeTruthy();
  return result.parsed as CodexHookOutput;
}

function hookLogFile(root: string): string {
  return path.join(root, '.openbox', 'codex', 'log', 'codex-hook.jsonl');
}

function readHookLog(root: string): HookLogLine[] {
  const file = hookLogFile(root);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HookLogLine);
}

describe('codex hook local-stack governance', () => {
  beforeAll(async () => {
    const runtime = await ensureLocalGovernanceMatrix();
    projectRoot = mkdtempSync(path.join(tmpdir(), 'openbox-codex-local-stack-'));
    installCodexPlugin({
      cwd: projectRoot,
      runtime: {
        apiKey: runtime.runtimeKey,
        coreUrl: runtime.coreUrl,
        governanceTimeout: LOCAL_GOVERNANCE_TIMEOUT_SEC,
        approvalMode: 'inline',
        hitlMaxWait: 5,
        hitlPollInterval: 1,
      },
    });

    const checks = verifyCodexPlugin({ cwd: projectRoot, includeProjectSurfaces: true });
    expect(checks.filter((check) => check.status === 'fail')).toEqual([]);
  }, LOCAL_GOVERNANCE_MATRIX_SETUP_TIMEOUT_MS);

  afterAll(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('installs the TypeSpec-declared Codex hook command through the official plugin surface', () => {
    if (!projectRoot) throw new Error('project root was not initialized');
    expect(existsSync(path.join(projectRoot, HOOK_SPEC.file))).toBe(false);
    const hooksPath = path.join(projectRoot, '.agents', 'plugins', 'openbox', 'hooks', 'hooks.json');
    const hooksJson = JSON.parse(readFileSync(hooksPath, 'utf-8')) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string; type?: string }> }>>;
    };
    for (const event of HOOK_SPEC.events) {
      const hook = hooksJson.hooks?.[event.name]?.[0]?.hooks?.[0];
      expect(hook, event.name).toMatchObject({
        type: 'command',
        command: HOOK_SPEC.command,
      });
    }
  });

  it('drives generated Codex hook-stdin governance cases through local Core', () => {
    if (!projectRoot) throw new Error('project root was not initialized');
    const root = projectRoot;
    expect(CODEX_HOOK_STDIN_VERDICT_MATRIX.map((entry) => entry.id).sort()).toEqual(
      LOCAL_GOVERNANCE_VERDICT_MATRIX
        .filter((entry) => ![
          'llm-embedding-approval',
          'llm-tool-call-approval',
          'file-open-block',
        ].includes(entry.id))
        .map((entry) => entry.id)
        .sort(),
    );

    for (const entry of CODEX_HOOK_STDIN_VERDICT_MATRIX) {
      const driver = requireProviderDriver(entry, 'codex', 'hook-stdin');
      expect(driver.event, entry.id).toMatch(/^(UserPromptSubmit|PreToolUse)$/);
      const sessionId = `codex-${entry.id}-${randomUUID()}`;
      const beforeLogCount = readHookLog(root).length;
      const out = hookOutput(callCodexHook(envelopeFor(entry, driver, sessionId)));
      const afterLog = readHookLog(root);
      const logLine = afterLog.at(-1);

      expectCodexOutput(out, entry, driver);
      expect(afterLog.length, entry.id).toBeGreaterThan(beforeLogCount);
      expect(logLine, entry.id).toMatchObject({
        event: driver.event,
        governance_event_id: expect.any(String),
        session_id: sessionId,
        verdict_kind: 'permission',
      });
      if (driver.tool !== 'prompt') {
        expect(logLine?.tool_name, entry.id).toBe(driver.tool);
      }
    }
  }, 240_000);
});
