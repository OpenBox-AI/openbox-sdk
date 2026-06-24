import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OpenBoxClient } from '../../ts/src/client/index.js';
import { createOpenBoxAnthropicAgentHooks } from '../../ts/src/anthropic-agent-sdk/index.js';
import {
  ANTHROPIC_AGENT_SDK_VERDICT_MATRIX,
  LOCAL_GOVERNANCE_VERDICT_MATRIX,
  requireProviderDriver,
  type ProviderDriver,
  type VerdictMatrixCase,
} from './fixtures/verdict-matrix.js';
import { ensureLocalGovernanceMatrix } from './helpers/local-governance-matrix.js';

type AnthropicHooks = ReturnType<typeof createOpenBoxAnthropicAgentHooks>;
type AnthropicHookEvent = keyof AnthropicHooks;

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

function sessionIdFor(entry: VerdictMatrixCase): string {
  return `anthropic-agent-sdk-${entry.id}-${randomUUID()}`;
}

function reasonText(output: unknown): string {
  const outputRecord = objectRecord(output);
  const hookOutput = objectRecord(outputRecord.hookSpecificOutput);
  const decision = objectRecord(hookOutput.decision);
  return [
    outputRecord.reason,
    outputRecord.stopReason,
    hookOutput.permissionDecisionReason,
    hookOutput.additionalContext,
    decision.message,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
}

async function runHook(
  hooks: AnthropicHooks,
  event: AnthropicHookEvent,
  input: Record<string, unknown>,
  toolUseId?: string,
): Promise<unknown> {
  const matcher = hooks[event]?.[0];
  expect(matcher, `missing Anthropic Agent SDK hook ${String(event)}`).toBeDefined();
  return matcher!.hooks[0](
    input as never,
    toolUseId,
    { signal: new AbortController().signal } as never,
  );
}

describe('Anthropic Agent SDK local-stack governance', () => {
  it('drives generated official SDK hook governance cases through local Core', async () => {
    const runtime = await ensureLocalGovernanceMatrix();
    expect(ANTHROPIC_AGENT_SDK_VERDICT_MATRIX.map((entry) => entry.id).sort()).toEqual(
      LOCAL_GOVERNANCE_VERDICT_MATRIX
        .filter((entry) => entry.id !== 'llm-embedding-approval')
        .map((entry) => entry.id)
        .sort(),
    );

    const hooks = createOpenBoxAnthropicAgentHooks({
      apiKey: runtime.runtimeKey,
      coreUrl: runtime.coreUrl,
      approvalMode: 'defer',
      hookTimeoutSeconds: 120,
    });

    let persistedProof: { sessionId: string; entry: VerdictMatrixCase } | undefined;
    for (const entry of ANTHROPIC_AGENT_SDK_VERDICT_MATRIX) {
      const driver = requireProviderDriver(entry, 'anthropic-agent-sdk', 'sdk-wrapper');
      if (driver.event === 'UserPromptSubmit') {
        await promptCase(hooks, entry);
      } else {
        const sessionId = await toolCase(hooks, entry, driver);
        if (entry.id === 'file-read-approval') {
          persistedProof = { sessionId, entry };
        }
      }
    }

    expect(persistedProof, 'missing Anthropic persisted proof case').toBeDefined();
    await expectAnthropicSessionLog(runtime, persistedProof!.sessionId, persistedProof!.entry);
  }, 300_000);
});

async function promptCase(
  hooks: AnthropicHooks,
  entry: VerdictMatrixCase,
): Promise<void> {
  const input = objectRecord(entry.activityInput);
  const output = await runHook(hooks, 'UserPromptSubmit', {
    hook_event_name: 'UserPromptSubmit',
    session_id: sessionIdFor(entry),
    transcript_path: '/tmp/openbox-anthropic-agent-sdk-transcript.jsonl',
    cwd: '/tmp/openbox-anthropic-agent-sdk',
    prompt: String(input.prompt ?? entry.name),
  });

  expect(objectRecord(output).decision, entry.id).toBe('block');
  expect(reasonText(output), entry.id).toContain(entry.expectedRule);
}

async function toolCase(
  hooks: AnthropicHooks,
  entry: VerdictMatrixCase,
  driver: ProviderDriver,
): Promise<string> {
  const toolInput = toolInputFor(entry);
  const sessionId = sessionIdFor(entry);
  const output = await runHook(
    hooks,
    'PreToolUse',
    {
      hook_event_name: 'PreToolUse',
      session_id: sessionId,
      transcript_path: '/tmp/openbox-anthropic-agent-sdk-transcript.jsonl',
      cwd: '/tmp/openbox-anthropic-agent-sdk',
      tool_name: driver.tool,
      tool_input: toolInput,
      tool_use_id: `tool-${entry.id}-${randomUUID()}`,
    },
  );

  const hookOutput = objectRecord(objectRecord(output).hookSpecificOutput);
  const permissionDecision = hookOutput.permissionDecision;
  if (entry.expectedOutcome === 'allow') {
    expect(permissionDecision, entry.id).toBe('allow');
    return sessionId;
  }
  if (entry.expectedOutcome === 'require_approval') {
    expect(permissionDecision, entry.id).toBe('defer');
    expect(reasonText(output), entry.id).toContain(entry.expectedRule);
    return sessionId;
  }
  expect(permissionDecision, entry.id).toBe('deny');
  expect(reasonText(output), entry.id).toContain(entry.expectedRule);
  return sessionId;
}

async function expectAnthropicSessionLog(
  runtime: Awaited<ReturnType<typeof ensureLocalGovernanceMatrix>>,
  sessionId: string,
  entry: VerdictMatrixCase,
): Promise<void> {
  const client = new OpenBoxClient({
    apiUrl: runtime.apiUrl,
    apiKey: runtime.backendKey,
  });
  const backendSessionId = await resolveBackendSessionId(client, runtime.agentId, sessionId);
  expect(
    backendSessionId,
    `missing persisted Anthropic backend session for workflow ${sessionId}`,
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
        serialized.includes('anthropic-agent-sdk');
    });
    if (matched) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  expect(matched, `missing persisted Anthropic governance log for ${entry.id}`).toBeDefined();
  const serialized = JSON.stringify(matched);
  expect(serialized).toContain(entry.expectedRule);
  expect(serialized).toContain('anthropic-agent-sdk');
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
