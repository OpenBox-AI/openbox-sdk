import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { OpenBoxClient } from '../../ts/src/client/index.js';
import { requireOpenBoxCli } from '../helpers/openbox-cli.js';
import {
  CLAUDE_CODE_HOOK_STDIN_VERDICT_MATRIX,
  requireProviderDriver,
  type VerdictMatrixCase,
} from './fixtures/verdict-matrix.js';
import { ensureLocalGovernanceMatrix } from './helpers/local-governance-matrix.js';

const OPENBOX = requireOpenBoxCli();
const LOCAL_GOVERNANCE_TIMEOUT_SEC = Number(
  process.env.OPENBOX_LOCAL_CLAUDE_HOOK_TIMEOUT_SEC ?? 150,
);

let projectRoot: string | undefined;

interface HookResult {
  status: number | null;
  stdout: string;
  stderr: string;
  parsed: unknown;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function listItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = objectRecord(value);
  if (Array.isArray(record.data)) return record.data;
  const nested = objectRecord(record.data);
  return Array.isArray(nested.data) ? nested.data : [];
}

function stringField(value: unknown, field: string): string | undefined {
  const candidate = objectRecord(value)[field];
  return typeof candidate === 'string' && candidate.trim() ? candidate : undefined;
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

function configureProject(runtime: Awaited<ReturnType<typeof ensureLocalGovernanceMatrix>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'openbox-claude-stdin-local-stack-'));
  const configDir = path.join(root, '.openbox', 'claude-code');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({
      governanceTimeout: LOCAL_GOVERNANCE_TIMEOUT_SEC,
      approvalMode: 'defer',
      hitlEnabled: true,
      hitlMaxWait: 5,
      hitlPollInterval: 1,
      taskQueue: 'claude-code',
    }, null, 2),
  );
  const settingsLocal = path.join(root, '.claude', 'settings.local.json');
  mkdirSync(path.dirname(settingsLocal), { recursive: true });
  writeFileSync(
    settingsLocal,
    JSON.stringify({
      env: {
        OPENBOX_API_KEY: runtime.runtimeKey,
        OPENBOX_CORE_URL: runtime.coreUrl,
      },
    }, null, 2),
  );
  return root;
}

function callHook(envelope: Record<string, unknown>): HookResult {
  if (!projectRoot) throw new Error('project root was not initialized');
  const result = spawnSync(OPENBOX, ['claude-code', 'hook'], {
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
  if (text) parsed = JSON.parse(text);
  return { status: result.status, stdout, stderr, parsed };
}

function expectedPermissionDecision(entry: VerdictMatrixCase): 'allow' | 'deny' | 'defer' {
  if (entry.expectedVerdict === 'require_approval') return 'defer';
  if (entry.expectedVerdict === 'block' || entry.expectedVerdict === 'halt') return 'deny';
  return 'allow';
}

describe('claude-code hook stdin local-stack governance', () => {
  afterAll(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('drives generated Claude hook-stdin cases through local Core and persisted logs', async () => {
    expect(CLAUDE_CODE_HOOK_STDIN_VERDICT_MATRIX.map((entry) => entry.id)).toEqual([
      'file-read-approval',
      'db-insert-block',
      'db-update-approval',
      'db-delete-halt',
      'db-generic-block',
      'file-delete-halt',
    ]);

    const runtime = await ensureLocalGovernanceMatrix(CLAUDE_CODE_HOOK_STDIN_VERDICT_MATRIX);
    projectRoot = configureProject(runtime);

    for (const entry of CLAUDE_CODE_HOOK_STDIN_VERDICT_MATRIX) {
      const driver = requireProviderDriver(entry, 'claude-code', 'hook-stdin');
      const sessionId = `claude-hook-stdin-${entry.id}-${randomUUID()}`;
      const result = callHook({
        hook_event_name: driver.event,
        session_id: sessionId,
        tool_name: driver.tool,
        tool_input: entry.activityInput,
        cwd: projectRoot,
      });
      expect(result.status, `stderr=${result.stderr}`).toBe(0);
      expect(result.stdout.trim(), 'Claude hook did not emit stdout JSON').toBeTruthy();

      const output = objectRecord(result.parsed);
      const hookOutput = objectRecord(output.hookSpecificOutput);
      expect(hookOutput.hookEventName, entry.id).toBe(driver.event);
      expect(hookOutput.permissionDecision, entry.id).toBe(
        expectedPermissionDecision(entry),
      );
      expect(String(hookOutput.permissionDecisionReason ?? ''), entry.id).toContain(
        entry.expectedRule,
      );

      await expectClaudeSessionLog(runtime, sessionId, entry);
    }
  }, 240_000);
});

async function expectClaudeSessionLog(
  runtime: Awaited<ReturnType<typeof ensureLocalGovernanceMatrix>>,
  workflowId: string,
  entry: VerdictMatrixCase,
): Promise<void> {
  const resolved = readRuntimeSessionMapping(workflowId);
  const client = new OpenBoxClient({
    apiUrl: runtime.apiUrl,
    apiKey: runtime.backendKey,
  });
  const backendSessionId = await resolveBackendSessionId(
    client,
    runtime.agentId,
    resolved?.workflowId ?? workflowId,
  );
  expect(
    backendSessionId,
    `missing persisted Claude backend session for workflow ${workflowId}`,
  ).toBeDefined();

  let matched: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await client.getSessionLogs(runtime.agentId, backendSessionId!, {
      page: 0,
      perPage: 100,
    });
    matched = listItems(response).find((item) => {
      const serialized = JSON.stringify(item);
      return serialized.includes(entry.expectedRule) &&
        serialized.includes('claude-code');
    });
    if (matched) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  expect(matched, `missing persisted Claude governance log for ${entry.id}`).toBeDefined();
  const serialized = JSON.stringify(matched);
  expect(serialized).toContain(entry.expectedRule);
  expect(serialized).toContain('claude-code');
  expect(serialized).not.toContain('"governance_checks_incomplete":true');
  expect(serialized).not.toContain('"age_governance_checks_incomplete":true');
}

async function resolveBackendSessionId(
  client: OpenBoxClient,
  agentId: string,
  workflowId: string,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await client.listSessions(agentId, { page: 0, perPage: 100 });
    const session = listItems(response).find((item) => {
      const record = objectRecord(item);
      return record.workflow_id === workflowId || record.run_id === workflowId;
    });
    const sessionId = stringField(session, 'id');
    if (sessionId) return sessionId;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return undefined;
}

function readRuntimeSessionMapping(hostSessionId: string): { workflowId?: string; runId?: string } | undefined {
  if (!projectRoot) throw new Error('project root was not initialized');
  const safeSessionId = hostSessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const sessionFile = path.join(projectRoot, '.openbox', 'claude-code', 'sessions', `${safeSessionId}.json`);
  if (!existsSync(sessionFile)) return undefined;
  const record = objectRecord(JSON.parse(readFileSync(sessionFile, 'utf-8')));
  return {
    workflowId: stringField(record, 'workflowId'),
    runId: stringField(record, 'runId'),
  };
}
