import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OpenBoxClient } from '../../ts/src/client/index.js';
import { createOpenBoxCopilotKitAdapter } from '../../ts/src/copilotkit/index.js';
import {
  COPILOTKIT_RUNTIME_VERDICT_MATRIX,
  LOCAL_GOVERNANCE_VERDICT_MATRIX,
  requireProviderDriver,
  shouldSeedRule,
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

function expectedStatus(entry: VerdictMatrixCase): string {
  if (entry.expectedVerdict === 'constrain') return 'constrained';
  if (entry.expectedVerdict === 'require_approval') return 'approval_required';
  if (entry.expectedVerdict === 'halt') return 'halted';
  if (entry.expectedVerdict === 'block') return 'blocked';
  return 'executed';
}

describe('CopilotKit local-stack governance', () => {
  it('drives generated runtime adapter governance cases through local Core', async () => {
    const runtime = await ensureLocalGovernanceMatrix();
    expect(COPILOTKIT_RUNTIME_VERDICT_MATRIX.map((entry) => entry.id).sort()).toEqual(
      LOCAL_GOVERNANCE_VERDICT_MATRIX
        .filter((entry) => entry.id !== 'llm-embedding-approval')
        .map((entry) => entry.id)
        .sort(),
    );

    const adapter = createOpenBoxCopilotKitAdapter({
      apiKey: runtime.runtimeKey,
      coreUrl: runtime.coreUrl,
      coreTimeoutMs: 120_000,
    });

    let promptProof: { workflowId: string; entry: VerdictMatrixCase } | undefined;
    let toolProof: { workflowId: string; entry: VerdictMatrixCase } | undefined;
    for (const entry of COPILOTKIT_RUNTIME_VERDICT_MATRIX) {
      const driver = requireProviderDriver(entry, 'copilotkit', 'runtime-adapter');
      if (driver.event === 'governPrompt') {
        const workflowId = await promptCase(adapter, entry);
        if (entry.id === 'llm-completion-approval') promptProof = { workflowId, entry };
      } else {
        const workflowId = await toolCase(adapter, entry, driver);
        if (entry.id === 'file-read-approval') toolProof = { workflowId, entry };
      }
    }

    expect(promptProof, 'missing CopilotKit prompt persisted proof case').toBeDefined();
    expect(toolProof, 'missing CopilotKit tool persisted proof case').toBeDefined();
    await expectCopilotKitSessionLog(runtime, promptProof!.workflowId, promptProof!.entry, {
      expectedContent: 'agent_goal',
    });
    await expectCopilotKitSessionLog(runtime, toolProof!.workflowId, toolProof!.entry);
  }, PROVIDER_LOCAL_STACK_TIMEOUT_MS);

  it('drives LangGraph TypeScript middleware gates through local Core', async () => {
    const runtime = await ensureLocalGovernanceMatrix();
    const adapter = createOpenBoxCopilotKitAdapter({
      apiKey: runtime.runtimeKey,
      coreUrl: runtime.coreUrl,
      coreTimeoutMs: 120_000,
    });
    const middleware = adapter.createLangChainMiddleware(createMiddlewareDeps()) as {
      wrapModelCall(request: unknown, handler: (request: unknown) => Promise<unknown>): Promise<unknown>;
      wrapToolCall(request: unknown, handler: (request: unknown) => Promise<unknown>): Promise<unknown>;
    };

    const promptEntry = requiredCase('llm-completion-approval');
    const promptInput = objectRecord(promptEntry.activityInput);
    const promptThread = `copilotkit-langgraph-prompt-${randomUUID()}`;
    const promptResult = parseOpenBoxResult(
      await middleware.wrapModelCall(
        {
          messages: [
            {
              type: 'human',
              content: String(promptInput.prompt ?? promptEntry.name),
            },
          ],
          configurable: { thread_id: promptThread },
          state: {},
          runtime: { configurable: { thread_id: promptThread } },
        },
        async () => {
          throw new Error('LangGraph model handler should not run for approval gates');
        },
      ),
    );
    expect(promptResult.verdict, promptEntry.id).toBe(promptEntry.expectedVerdict);
    expect(promptResult.status, promptEntry.id).toBe(expectedStatus(promptEntry));
    expect(String(promptResult.reason ?? ''), promptEntry.id).toContain(promptEntry.expectedRule);
    await expectCopilotKitSessionLog(runtime, String(promptResult.workflowId), promptEntry, {
      expectedContent: 'agent_goal',
    });

    const toolEntry = requiredCase('file-read-approval');
    const toolDriver = requireProviderDriver(toolEntry, 'copilotkit', 'runtime-adapter');
    const toolThread = `copilotkit-langgraph-tool-${randomUUID()}`;
    const toolResult = parseOpenBoxResult(
      await middleware.wrapToolCall(
        {
          toolCall: {
            name: toolDriver.tool,
            args: toolInputFor(toolEntry),
          },
          configurable: { thread_id: toolThread },
          state: {},
          runtime: { configurable: { thread_id: toolThread } },
        },
        async () => {
          throw new Error('LangGraph tool handler should not run for approval gates');
        },
      ),
    );
    expect(toolResult.verdict, toolEntry.id).toBe(toolEntry.expectedVerdict);
    expect(toolResult.status, toolEntry.id).toBe(expectedStatus(toolEntry));
    expect(String(toolResult.reason ?? ''), toolEntry.id).toContain(toolEntry.expectedRule);
    await expectCopilotKitSessionLog(runtime, String(toolResult.workflowId), toolEntry);
  }, PROVIDER_LOCAL_STACK_TIMEOUT_MS);
});

async function promptCase(
  adapter: ReturnType<typeof createOpenBoxCopilotKitAdapter>,
  entry: VerdictMatrixCase,
): Promise<string> {
  const input = objectRecord(entry.activityInput);
  const result = await adapter.governPrompt({
    payload: { prompt: String(input.prompt ?? entry.name) },
    sessionKey: `copilotkit-${entry.id}-${randomUUID()}`,
    activityType: 'on_chat_model_start',
  });

  expect(result.verdict.arm, entry.id).toBe(entry.expectedVerdict);
  expect(result.status, entry.id).toBe(expectedStatus(entry));
  if (shouldSeedRule(entry)) {
    expect(result.reason, entry.id).toContain(entry.expectedRule);
  }
  return result.workflowId;
}

async function toolCase(
  adapter: ReturnType<typeof createOpenBoxCopilotKitAdapter>,
  entry: VerdictMatrixCase,
  driver: ProviderDriver,
): Promise<string> {
  const input = toolInputFor(entry);
  const result = await adapter.governToolInput({
    payload: {
      name: driver.tool,
      args: input,
      description: entry.name,
    },
    sessionKey: `copilotkit-${entry.id}-${randomUUID()}`,
    activityType: driver.tool,
  });

  expect(result.verdict.arm, entry.id).toBe(entry.expectedVerdict);
  expect(result.status, entry.id).toBe(expectedStatus(entry));
  if (shouldSeedRule(entry)) {
    expect(result.reason, entry.id).toContain(entry.expectedRule);
  }
  return result.workflowId;
}

function requiredCase(id: string): VerdictMatrixCase {
  const entry = COPILOTKIT_RUNTIME_VERDICT_MATRIX.find((candidate) => candidate.id === id);
  expect(entry, `missing CopilotKit matrix case ${id}`).toBeDefined();
  return entry!;
}

function parseOpenBoxResult(value: unknown): Record<string, unknown> {
  const content = objectRecord(value).content ?? value;
  if (typeof content === 'string') {
    return objectRecord(JSON.parse(content));
  }
  return objectRecord(content);
}

function createMiddlewareDeps() {
  return {
    createMiddleware: (definition: unknown) => definition,
    AIMessage: class {
      content: unknown;
      tool_calls?: unknown;

      constructor(message: { content: unknown; tool_calls?: unknown }) {
        this.content = message.content;
        this.tool_calls = message.tool_calls;
      }
    },
  };
}

async function expectCopilotKitSessionLog(
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
    `missing persisted CopilotKit backend session for workflow ${workflowId}`,
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
        serialized.includes('copilotkit');
    });
    if (matched) break;
    await new Promise((resolve) => setTimeout(resolve, LOCAL_GOVERNANCE_EVIDENCE_RETRY_MS));
  }

  expect(matched, `missing persisted CopilotKit governance log for ${entry.id}`).toBeDefined();
  const serialized = JSON.stringify(logs);
  expect(serialized).toContain(entry.expectedRule);
  expect(serialized).toContain('copilotkit');
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
