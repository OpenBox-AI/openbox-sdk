import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  OpenBoxAgentsSDKError,
  createOpenBoxAgentsTool,
  runWithOpenBox,
} from '../../ts/src/openai-agents-sdk/index.js';
import { OpenBoxClient } from '../../ts/src/client/index.js';
import {
  LOCAL_GOVERNANCE_VERDICT_MATRIX,
  OPENAI_AGENTS_SDK_VERDICT_MATRIX,
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

const PROVIDER_LOCAL_STACK_TIMEOUT_MS = Number(
  process.env.OPENBOX_E2E_PROVIDER_TEST_TIMEOUT_MS
    ?? LOCAL_GOVERNANCE_MATRIX_SETUP_TIMEOUT_MS + 300_000,
);

interface ExecutableTool {
  execute(input: unknown, context?: unknown, details?: unknown): Promise<unknown>;
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

function toolInputFor(entry: VerdictMatrixCase): Record<string, unknown> {
  const input = objectRecord(entry.activityInput);
  if (entry.spanType === 'mcp') return objectRecord(input.tool_input);
  return input;
}

function expectedError(entry: VerdictMatrixCase): boolean {
  return entry.expectedOutcome !== 'allow';
}

async function expectOpenBoxRejection(
  action: Promise<unknown>,
  entry: VerdictMatrixCase,
): Promise<void> {
  await expect(action, entry.id).rejects.toBeInstanceOf(OpenBoxAgentsSDKError);
  await expect(action, entry.id).rejects.toMatchObject({
    message: expect.stringContaining(entry.expectedRule),
  });
}

describe('OpenAI Agents SDK local-stack governance', () => {
  it('drives generated official SDK wrapper governance cases through local Core', async () => {
    const runtime = await ensureLocalGovernanceMatrix();
    expect(OPENAI_AGENTS_SDK_VERDICT_MATRIX.map((entry) => entry.id).sort()).toEqual(
      LOCAL_GOVERNANCE_VERDICT_MATRIX
        .filter((entry) => entry.id !== 'llm-embedding-approval')
        .map((entry) => entry.id)
        .sort(),
    );

    let runProof: { sessionId: string; entry: VerdictMatrixCase } | undefined;
    let toolProof: { sessionId: string; entry: VerdictMatrixCase } | undefined;
    for (const entry of OPENAI_AGENTS_SDK_VERDICT_MATRIX) {
      const driver = requireProviderDriver(entry, 'openai-agents-sdk', 'sdk-wrapper');
      if (driver.tool === 'runWithOpenBox') {
        const sessionId = await runCase(runtime, entry);
        if (entry.id === 'llm-completion-approval') runProof = { sessionId, entry };
      } else {
        const sessionId = await toolCase(runtime, entry, driver);
        if (entry.id === 'file-read-approval') toolProof = { sessionId, entry };
      }
    }

    expect(runProof, 'missing OpenAI run persisted proof case').toBeDefined();
    expect(toolProof, 'missing OpenAI tool persisted proof case').toBeDefined();
    await expectOpenAISessionLog(runtime, runProof!.sessionId, runProof!.entry, {
      expectedContent: 'agent_goal',
    });
    await expectOpenAISessionLog(runtime, toolProof!.sessionId, toolProof!.entry);
  }, PROVIDER_LOCAL_STACK_TIMEOUT_MS);
});

async function runCase(
  runtime: Awaited<ReturnType<typeof ensureLocalGovernanceMatrix>>,
  entry: VerdictMatrixCase,
): Promise<string> {
  const input = objectRecord(entry.activityInput);
  const sessionId = `openai-agents-sdk-${entry.id}-${randomUUID()}`;
  const runFunction = vi.fn(async (_agent, governedInput) => ({
    output: 'ok',
    input: governedInput,
    rawResponses: [
      {
        providerData: { model: 'openbox-local-governance' },
        output: [{ type: 'message', text: 'ok' }],
        finishReason: 'stop',
      },
    ],
  }));
  const action = runWithOpenBox(
    { name: 'openbox-local-governance-agent' },
    String(input.prompt ?? entry.name),
    {
      apiKey: runtime.runtimeKey,
      coreUrl: runtime.coreUrl,
      approvalMode: 'error',
      sessionId,
      runFunction,
    },
  );

  if (expectedError(entry)) {
    await expectOpenBoxRejection(action, entry);
    expect(runFunction, entry.id).not.toHaveBeenCalled();
    return sessionId;
  }

  await expect(action, entry.id).resolves.toMatchObject({ output: 'ok' });
  expect(runFunction, entry.id).toHaveBeenCalledTimes(1);
  return sessionId;
}

async function toolCase(
  runtime: Awaited<ReturnType<typeof ensureLocalGovernanceMatrix>>,
  entry: VerdictMatrixCase,
  driver: ProviderDriver,
): Promise<string> {
  const execute = vi.fn(async (input) => ({ ok: true, input }));
  const sessionId = `openai-agents-sdk-${entry.id}-${randomUUID()}`;
  const wrapped = createOpenBoxAgentsTool(
    {
      name: driver.tool,
      description: entry.name,
      execute,
    },
    {
      apiKey: runtime.runtimeKey,
      coreUrl: runtime.coreUrl,
      approvalMode: 'error',
      sessionId,
      toolFactory: (config) => config,
    },
  ) as ExecutableTool;

  const input = toolInputFor(entry);
  const action = wrapped.execute(input, undefined, {
    toolCall: {
      callId: `call-${entry.id}-${randomUUID()}`,
      name: driver.tool,
      namespace: 'openbox-local-governance',
      arguments: JSON.stringify(input),
    },
  });

  if (expectedError(entry)) {
    await expectOpenBoxRejection(action, entry);
    expect(execute, entry.id).not.toHaveBeenCalled();
    return sessionId;
  }

  await expect(action, entry.id).resolves.toMatchObject({ ok: true });
  expect(execute, entry.id).toHaveBeenCalledTimes(1);
  return sessionId;
}

async function expectOpenAISessionLog(
  runtime: Awaited<ReturnType<typeof ensureLocalGovernanceMatrix>>,
  workflowId: string,
  entry: VerdictMatrixCase,
  options: { expectedContent?: string } = {},
): Promise<void> {
  const client = new OpenBoxClient({
    apiUrl: runtime.apiUrl,
    apiKey: runtime.backendKey,
  });
  const backendSessionId = await resolveBackendSessionId(client, runtime.agentId, workflowId);
  expect(
    backendSessionId,
    `missing persisted OpenAI backend session for workflow ${workflowId}`,
  ).toBeDefined();

  let logs: unknown[] = [];
  let matched: unknown;
  for (let attempt = 0; attempt < LOCAL_GOVERNANCE_EVIDENCE_MAX_ATTEMPTS; attempt += 1) {
    const response = await client.getSessionLogs(runtime.agentId, backendSessionId!, {
      page: 0,
      perPage: 100,
    });
    logs = listItems(response);
    matched = logs.find((item) => {
      const serialized = JSON.stringify(item);
      return serialized.includes(entry.expectedRule) &&
        serialized.includes('openai-agents-sdk');
    });
    if (matched) break;
    await new Promise((resolve) => setTimeout(resolve, LOCAL_GOVERNANCE_EVIDENCE_RETRY_MS));
  }

  expect(matched, `missing persisted OpenAI governance log for ${entry.id}`).toBeDefined();
  const serialized = JSON.stringify(logs);
  expect(serialized).toContain(entry.expectedRule);
  expect(serialized).toContain('openai-agents-sdk');
  if (options.expectedContent) expect(serialized).toContain(options.expectedContent);
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
