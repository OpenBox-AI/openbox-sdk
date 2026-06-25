import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpenBoxClient } from '../../ts/src/client/index.js';
import {
  HOOK_SPEC,
  type CursorEnvelope,
} from '../../ts/src/core-client/generated/runtime/cursor.js';
import {
  cursorPluginTargetDir,
  installCursorPlugin,
  verifyCursorPlugin,
} from '../../ts/src/runtime/cursor/index.js';
import { requireOpenBoxCli } from '../helpers/openbox-cli.js';
import {
  CURSOR_HOOK_STDIN_VERDICT_MATRIX,
  LOCAL_GOVERNANCE_VERDICT_MATRIX,
  requireProviderDriver,
  type ProviderDriver,
  type VerdictMatrixCase,
} from './fixtures/verdict-matrix.js';
import {
  LOCAL_GOVERNANCE_EVIDENCE_MAX_ATTEMPTS,
  LOCAL_GOVERNANCE_EVIDENCE_RETRY_MS,
  LOCAL_GOVERNANCE_EVIDENCE_SESSION_PAGES,
  LOCAL_GOVERNANCE_MATRIX_SETUP_TIMEOUT_MS,
  ensureLocalGovernanceMatrix,
} from './helpers/local-governance-matrix.js';

const OPENBOX = requireOpenBoxCli();
const LOCAL_GOVERNANCE_TIMEOUT_SEC = Number(
  process.env.OPENBOX_LOCAL_CURSOR_HOOK_TIMEOUT_SEC ?? 150,
);

let projectRoot: string | undefined;
let runtime:
  | Awaited<ReturnType<typeof ensureLocalGovernanceMatrix>>
  | undefined;

interface HookResult {
  status: number | null;
  stdout: string;
  stderr: string;
  parsed: unknown;
}

interface CursorPermissionOutput {
  permission?: 'allow' | 'deny';
  user_message?: string;
  agent_message?: string;
}

interface CursorContinueOutput {
  continue?: boolean;
  user_message?: string;
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

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function filePathFor(c: VerdictMatrixCase): string {
  const input = objectRecord(c.activityInput);
  return String(input.file_path ?? input.filePath ?? 'fixtures/openbox-cursor.txt');
}

function commandFor(c: VerdictMatrixCase): string {
  const input = objectRecord(c.activityInput);
  const command = input.command;
  if (typeof command === 'string' && command.trim()) return command;
  if (c.spanType === 'file_delete') return `rm ${filePathFor(c)}`;
  return '';
}

function envelopeFor(c: VerdictMatrixCase, driver: ProviderDriver): CursorEnvelope {
  if (!projectRoot) throw new Error('project root was not initialized');
  const activityInput = objectRecord(c.activityInput);
  const base = {
    hook_event_name: driver.event,
    conversation_id: `cursor-${c.id}-${randomUUID()}`,
    generation_id: randomUUID(),
  } satisfies Partial<CursorEnvelope>;

  switch (driver.event) {
    case 'beforeMCPExecution':
      return {
        ...base,
        hook_event_name: driver.event,
        tool_name: driver.tool,
        tool_input: Object.keys(objectRecord(activityInput.tool_input)).length > 0
          ? objectRecord(activityInput.tool_input)
          : activityInput,
      } as CursorEnvelope;
    case 'beforeReadFile':
      return {
        ...base,
        hook_event_name: driver.event,
        file_path: filePathFor(c),
      } as CursorEnvelope;
    case 'beforeTabFileRead':
      return {
        ...base,
        hook_event_name: driver.event,
        file_path: filePathFor(c),
      } as CursorEnvelope;
    case 'beforeShellExecution':
      return {
        ...base,
        hook_event_name: driver.event,
        command: commandFor(c),
        cwd: projectRoot,
      } as CursorEnvelope;
    case 'preToolUse':
      return {
        ...base,
        hook_event_name: driver.event,
        tool_name: driver.tool,
        tool_input: {
          ...activityInput,
          file_path: filePathFor(c),
          command: commandFor(c) || undefined,
        },
        cwd: projectRoot,
      } as CursorEnvelope;
    case 'beforeSubmitPrompt':
      return {
        ...base,
        hook_event_name: driver.event,
        prompt: String(activityInput.prompt ?? c.name),
      } as CursorEnvelope;
    default:
      throw new Error(`Unsupported Cursor hook-stdin event ${driver.event} for ${c.id}`);
  }
}

function expectedPermission(c: VerdictMatrixCase): 'allow' | 'deny' {
  return c.expectedVerdict === 'allow' || c.expectedVerdict === 'constrain'
    ? 'allow'
    : 'deny';
}

function expectedContinue(c: VerdictMatrixCase): boolean {
  return c.expectedVerdict === 'allow' || c.expectedVerdict === 'constrain';
}

function callCursorHook(envelope: CursorEnvelope): HookResult {
  if (!projectRoot) throw new Error('project root was not initialized');
  const result = spawnSync(OPENBOX, ['cursor', 'hook'], {
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

function hookOutput(result: HookResult): CursorPermissionOutput | CursorContinueOutput {
  expect(result.status, `stderr=${result.stderr}`).toBe(0);
  expect(result.stdout.trim(), 'Cursor hook did not emit stdout JSON').toBeTruthy();
  return result.parsed as CursorPermissionOutput | CursorContinueOutput;
}

describe('cursor hook local-stack governance', () => {
  beforeAll(async () => {
    runtime = await ensureLocalGovernanceMatrix();
    projectRoot = mkdtempSync(path.join(tmpdir(), 'openbox-cursor-local-stack-'));
    installCursorPlugin({
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

    const checks = verifyCursorPlugin({ cwd: projectRoot });
    expect(checks.filter((check) => check.status === 'fail')).toEqual([]);
  }, LOCAL_GOVERNANCE_MATRIX_SETUP_TIMEOUT_MS);

  afterAll(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('installs the TypeSpec-declared Cursor plugin hook command in project scope', () => {
    if (!projectRoot) throw new Error('project root was not initialized');
    const hooksPath = path.join(cursorPluginTargetDir(projectRoot), 'hooks', 'hooks.json');
    const hooksJson = JSON.parse(readFileSync(hooksPath, 'utf-8')) as {
      [key: string]: Record<string, Array<{ command?: string; timeout?: number }>>;
    };
    const hooks = hooksJson[HOOK_SPEC.key] ?? {};
    for (const event of HOOK_SPEC.events) {
      const hook = hooks[event.name]?.[0];
      expect(hook, event.name).toMatchObject({ command: HOOK_SPEC.command });
      if (event.timeout !== undefined) {
        expect(hook?.timeout, event.name).toBe(event.timeout);
      }
    }
  });

  it('drives generated Cursor hook-stdin governance cases through local Core and persists backend evidence', async () => {
    expect(CURSOR_HOOK_STDIN_VERDICT_MATRIX.map((entry) => entry.id).sort()).toEqual(
      LOCAL_GOVERNANCE_VERDICT_MATRIX
        .filter((entry) => !['llm-embedding-approval', 'llm-tool-call-approval'].includes(entry.id))
        .map((entry) => entry.id)
        .sort(),
    );

    let persistedProof: { workflowId: string; entry: VerdictMatrixCase } | undefined;
    for (const entry of CURSOR_HOOK_STDIN_VERDICT_MATRIX) {
      const driver = requireProviderDriver(entry, 'cursor', 'hook-stdin');
      const envelope = envelopeFor(entry, driver);
      const output = hookOutput(callCursorHook(envelope));

      if (driver.event === 'beforeSubmitPrompt') {
        expect((output as CursorContinueOutput).continue, entry.id).toBe(
          expectedContinue(entry),
        );
      } else {
        expect((output as CursorPermissionOutput).permission, entry.id).toBe(
          expectedPermission(entry),
        );
      }
      if (entry.expectedOutcome !== 'allow') {
        const message = [
          (output as CursorPermissionOutput).user_message,
          (output as CursorPermissionOutput).agent_message,
          (output as CursorContinueOutput).user_message,
        ].filter(Boolean).join('\n');
        expect(message, entry.id).toContain(entry.expectedRule);
      }

      if (entry.id === 'file-read-approval') {
        persistedProof = {
          workflowId: workflowIdForConversation(envelope.conversation_id),
          entry,
        };
      }
    }

    expect(persistedProof, 'missing Cursor persisted proof case').toBeDefined();
    await expectCursorSessionLog(
      runtime!,
      persistedProof!.workflowId,
      persistedProof!.entry,
    );
  }, 240_000);
});

function workflowIdForConversation(conversationId: string): string {
  if (!projectRoot) throw new Error('project root was not initialized');
  const safe = conversationId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const sessionFile = path.join(projectRoot, '.openbox', 'cursor', 'sessions', `${safe}.json`);
  expect(existsSync(sessionFile), `missing Cursor session store file for ${conversationId}`).toBe(true);
  const session = JSON.parse(readFileSync(sessionFile, 'utf-8')) as {
    workflowId?: unknown;
  };
  expect(typeof session.workflowId, `missing workflowId in ${sessionFile}`).toBe('string');
  return String(session.workflowId);
}

async function expectCursorSessionLog(
  localRuntime: Awaited<ReturnType<typeof ensureLocalGovernanceMatrix>>,
  workflowId: string,
  entry: VerdictMatrixCase,
): Promise<void> {
  const client = new OpenBoxClient({
    apiUrl: localRuntime.apiUrl,
    apiKey: localRuntime.backendKey,
  });
  const backendSessionId = await resolveBackendSessionId(client, localRuntime.agentId, workflowId);
  expect(
    backendSessionId,
    `missing persisted Cursor backend session for workflow ${workflowId}`,
  ).toBeDefined();

  let matched: unknown;
  for (let attempt = 0; attempt < LOCAL_GOVERNANCE_EVIDENCE_MAX_ATTEMPTS; attempt += 1) {
    const response = await client.getSessionLogs(localRuntime.agentId, backendSessionId!, {
      page: 0,
      perPage: 100,
    });
    matched = listItems(response).find((item) => {
      const serialized = JSON.stringify(item);
      return serialized.includes(entry.expectedRule) && serialized.includes('cursor');
    });
    if (matched) break;
    await new Promise((resolve) => setTimeout(resolve, LOCAL_GOVERNANCE_EVIDENCE_RETRY_MS));
  }

  expect(matched, `missing persisted Cursor governance log for ${entry.id}`).toBeDefined();
  const serialized = JSON.stringify(matched);
  expect(serialized).toContain(entry.expectedRule);
  expect(serialized).toContain('cursor');
  expect(serialized).not.toContain('"governance_checks_incomplete":true');
  expect(serialized).not.toContain('"age_governance_checks_incomplete":true');
}

async function resolveBackendSessionId(
  client: OpenBoxClient,
  agentId: string,
  workflowId: string,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < LOCAL_GOVERNANCE_EVIDENCE_MAX_ATTEMPTS; attempt += 1) {
    for (let page = 0; page < LOCAL_GOVERNANCE_EVIDENCE_SESSION_PAGES; page += 1) {
      const response = await client.listSessions(agentId, { page, perPage: 100 });
      const items = listItems(response);
      const session = items.find((item) => {
        const record = objectRecord(item);
        return record.workflow_id === workflowId || record.run_id === workflowId;
      });
      const sessionId = stringField(session, 'id');
      if (sessionId) return sessionId;
      if (items.length < 100) break;
    }
    await new Promise((resolve) => setTimeout(resolve, LOCAL_GOVERNANCE_EVIDENCE_RETRY_MS));
  }
  return undefined;
}
