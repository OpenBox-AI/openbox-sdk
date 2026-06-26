import { randomBytes, randomUUID } from 'node:crypto';
import { OpenBoxCoreClient, type AgentIdentityConfig } from '../../ts/src/core-client/index.js';
import { withSpanActivityId } from '../../ts/src/governance/spans.js';
import {
  VERDICT_MATRIX,
  type SpanType,
  type VerdictMatrixCase,
} from '../hook-integration/fixtures/verdict-matrix.js';

const BACKEND_KEY_PREFIX = /^obx_key_/;
const RUNTIME_KEY_PREFIX = /^obx_(?:test|live)_/;
const POLICY_NAME = 'openbox-sdk-live-e2e-policy';
const POLICY_MARKER = 'openbox-sdk-live-e2e verdict matrix v1';

type ExpectedBackendVerdict = 'allow' | 'require_approval' | 'block' | 'halt';
type LiveVerdictMatrixCase = VerdictMatrixCase & {
  expectedBackendVerdict: ExpectedBackendVerdict;
  expectedReason?: string;
};

interface BackendEnvelope<T = any> {
  data?: T;
  message?: string;
}

interface PolicyRecord {
  id?: string;
  name?: string;
  rego_code?: string;
}

const LIVE_VERDICT_MATRIX: readonly LiveVerdictMatrixCase[] = VERDICT_MATRIX.map((entry) => ({
  ...entry,
  expectedBackendVerdict:
    entry.expectedVerdict === 'constrain'
      ? 'allow'
      : entry.expectedVerdict,
  expectedReason: entry.expectedVerdict === 'constrain' ? undefined : entry.expectedRule,
}));

function isLocalUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function isLiveTarget(): boolean {
  return !isLocalUrl(process.env.OPENBOX_API_URL) || !isLocalUrl(process.env.OPENBOX_CORE_URL);
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

function activityType(spanType: SpanType): string {
  switch (spanType) {
    case 'llm':
      return 'PromptSubmission';
    case 'llm_embedding':
      return 'EMBEDDING';
    case 'llm_tool_call':
      return 'ToolCallRequestEvent';
    case 'file_read':
      return 'FileRead';
    case 'file_open':
      return 'FileRead';
    case 'file_write':
      return 'FileEdit';
    case 'file_delete':
      return 'FileDelete';
    case 'shell':
      return 'ShellExecution';
    case 'http':
      return 'HTTPRequest';
    case 'db':
      return 'DatabaseQuery';
    case 'mcp':
      return 'MCPToolCall';
  }
}

function span(spanType: SpanType, input: Record<string, unknown>): Record<string, unknown> {
  const base = {
    span_id: hex(8),
    trace_id: hex(16),
    parent_span_id: null,
    kind: 'INTERNAL',
    stage: 'started',
    start_time: Date.now() * 1_000_000,
    end_time: null,
    duration_ns: null,
    status: { code: 'UNSET', description: null },
    events: [],
    error: null,
  };
  if (spanType === 'file_read') {
    return {
      ...base,
      name: 'file.read',
      hook_type: 'file_operation',
      semantic_type: 'file_read',
      file_path: input.file_path,
      attributes: { 'file.path': input.file_path, 'file.operation': 'read' },
    };
  }
  if (spanType === 'file_open') {
    return {
      ...base,
      name: 'file.open',
      hook_type: 'file_operation',
      semantic_type: 'file_open',
      file_path: input.file_path,
      attributes: { 'file.path': input.file_path, 'file.operation': 'open' },
    };
  }
  if (spanType === 'file_write') {
    return {
      ...base,
      name: 'file.write',
      hook_type: 'file_operation',
      semantic_type: 'file_write',
      file_path: input.file_path,
      attributes: { 'file.path': input.file_path, 'file.operation': 'write' },
    };
  }
  if (spanType === 'file_delete') {
    return {
      ...base,
      name: 'file.delete',
      hook_type: 'file_operation',
      semantic_type: 'file_delete',
      file_path: input.file_path,
      attributes: { 'file.path': input.file_path, 'file.operation': 'delete' },
    };
  }
  if (spanType === 'shell') {
    return {
      ...base,
      name: 'ShellExecution',
      hook_type: 'function_call',
      semantic_type: 'internal',
      attributes: { 'shell.command': input.command ?? '' },
    };
  }
  if (spanType === 'http') {
    return {
      ...base,
      name: `${input.method ?? 'POST'} ${input.url ?? ''}`,
      hook_type: 'http_request',
      http_method: input.method ?? 'POST',
      http_url: input.url ?? '',
      attributes: { 'http.method': input.method ?? 'POST', 'http.url': input.url ?? '' },
    };
  }
  if (spanType === 'db') {
    return {
      ...base,
      name: 'SELECT',
      hook_type: 'db_query',
      db_system: 'postgresql',
      db_operation: 'SELECT',
      db_statement: input.query ?? '',
      attributes: { 'db.system': 'postgresql', 'db.operation': 'SELECT' },
    };
  }
  if (spanType === 'mcp') {
    return {
      ...base,
      name: String(input.tool ?? 'mcp.tool'),
      hook_type: 'function_call',
      semantic_type: 'mcp_tool_call',
      attributes: { 'mcp.tool': input.tool ?? '' },
    };
  }
  if (spanType === 'llm_embedding') {
    return {
      ...base,
      name: 'openai.EMBEDDING.create',
      hook_type: 'function_call',
      semantic_type: 'llm_embedding',
      attributes: {
        'http.method': 'POST',
        'http.url': 'https://api.openai.com/v1/embeddings',
      },
    };
  }
  if (spanType === 'llm_tool_call') {
    return {
      ...base,
      name: 'openai.TOOL.call',
      hook_type: 'function_call',
      semantic_type: 'llm_tool_call',
      attributes: {
        'http.method': 'POST',
        'http.url': 'https://api.openai.com/v1/chat/completions',
      },
    };
  }
  return {
    ...base,
    name: 'llm.chat.completion',
    hook_type: 'function_call',
    semantic_type: 'llm_completion',
    attributes: { 'gen_ai.system': 'openai' },
  };
}

function governancePayload(spanType: SpanType, input: Record<string, unknown>): Record<string, unknown> {
  const activityId = hex(16);
  return {
    source: 'sdk',
    event_type: 'ActivityStarted',
    workflow_id: hex(16),
    run_id: hex(16),
    workflow_type: 'ExtensionE2E',
    task_queue: 'sdk',
    activity_id: activityId,
    activity_type: activityType(spanType),
    activity_input: [input],
    timestamp: new Date().toISOString(),
    hook_trigger: true,
    spans: [withSpanActivityId(span(spanType, input), activityId)],
    span_count: 1,
    attempt: 1,
  };
}

function e2eRego(policyPath: string): string {
  const rules = LIVE_VERDICT_MATRIX
    .filter((entry) => entry.expectedVerdict !== 'constrain')
    .map((entry) => [
      `result := {"decision": "${regoDecision(entry.expectedBackendVerdict)}", "reason": ${JSON.stringify(entry.expectedRule)}} if {`,
      `  input.activity_type == ${JSON.stringify(activityType(entry.spanType))}`,
      '}',
    ].join('\n'));

  return [
    `package ${policyPath.replaceAll('/', '.')}`,
    '',
    `# ${POLICY_MARKER}`,
    'default result := {"decision": "ALLOW", "reason": "openbox-sdk-live-e2e default allow"}',
    '',
    ...rules,
    '',
  ].join('\n\n');
}

function regoDecision(verdict: ExpectedBackendVerdict): string {
  return verdict.toUpperCase();
}

function bootstrapAgentIdentity(): AgentIdentityConfig | undefined {
  const did = process.env.OPENBOX_AGENT_DID;
  const privateKey = process.env.OPENBOX_AGENT_PRIVATE_KEY;
  if (!did && !privateKey) return undefined;
  if (!did || !privateKey) {
    throw new Error(
      'signed live verdict verification requires both OPENBOX_AGENT_DID and OPENBOX_AGENT_PRIVATE_KEY',
    );
  }
  return { did, privateKey };
}

async function backend<T = any>(path: string, init: RequestInit = {}): Promise<BackendEnvelope<T>> {
  const apiUrl = process.env.OPENBOX_API_URL;
  const key = process.env.OPENBOX_BACKEND_API_KEY;
  if (!apiUrl || !key || !BACKEND_KEY_PREFIX.test(key)) {
    throw new Error('OPENBOX_API_URL and OPENBOX_BACKEND_API_KEY are required for live bootstrap');
  }
  const res = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': key,
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as BackendEnvelope<T>;
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} failed with ${res.status}: ${body.message ?? 'no message'}`);
  }
  return body;
}

async function currentPolicy(agentId: string): Promise<PolicyRecord | undefined> {
  const res = await backend<PolicyRecord>(`/agent/${agentId}/policies/current`);
  const policy = (res.data ?? res) as PolicyRecord;
  return policy?.id ? policy : undefined;
}

async function createPolicyViaBackend(agentId: string, rego: string): Promise<void> {
  await backend(`/agent/${agentId}/policies`, {
    method: 'POST',
    body: JSON.stringify({
      name: POLICY_NAME,
      description: 'Deterministic dev-only live E2E verdict matrix for openbox-sdk.',
      rego_code: rego,
      input: {},
      config: {},
    }),
  });
}

async function evaluate(spanType: SpanType, input: Record<string, unknown>): Promise<{ verdict?: string; reason?: string }> {
  const coreUrl = process.env.OPENBOX_CORE_URL;
  const key = process.env.OPENBOX_API_KEY;
  if (!coreUrl || !key || !RUNTIME_KEY_PREFIX.test(key)) {
    throw new Error('OPENBOX_CORE_URL and an agent runtime key are required for live verdict verification');
  }
  const payload = governancePayload(spanType, input);
  const agentIdentity = bootstrapAgentIdentity();
  if (agentIdentity) {
    const client = new OpenBoxCoreClient({
      apiUrl: coreUrl,
      apiKey: key,
      agentIdentity,
    });
    const body = await client.evaluate(payload as Parameters<typeof client.evaluate>[0]);
    return { verdict: String(body.verdict ?? body.action ?? ''), reason: body.reason };
  }

  const res = await fetch(`${coreUrl}/api/v1/governance/evaluate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as { verdict?: string; action?: string; reason?: string };
  if (!res.ok) {
    throw new Error(`core governance evaluate failed with ${res.status}`);
  }
  return { verdict: String(body.verdict ?? body.action ?? ''), reason: body.reason };
}

async function verifyMatrix(): Promise<boolean> {
  for (const c of LIVE_VERDICT_MATRIX) {
    const result = await evaluate(c.spanType, c.activityInput);
    if (result.verdict !== c.expectedBackendVerdict) return false;
    if (c.expectedReason && !result.reason?.includes(c.expectedReason)) return false;
  }
  return true;
}

export async function ensureLiveVerdictMatrix(): Promise<void> {
  if (!isLiveTarget()) return;
  const agentId = process.env.OPENBOX_AGENT_ID;
  if (!agentId || !process.env.OPENBOX_API_KEY) return;

  const current = process.env.OPENBOX_BACKEND_API_KEY ? await currentPolicy(agentId).catch(() => undefined) : undefined;
  if (current?.rego_code?.includes(POLICY_MARKER) && (await verifyMatrix().catch(() => false))) {
    return;
  }

  const policyId = randomUUID();
  const agentPart = agentId.replace(/[^a-zA-Z0-9]/g, '_');
  const policyPath = `openbox_e2e/${agentPart}/policy_${policyId.replace(/-/g, '')}`;
  await createPolicyViaBackend(agentId, e2eRego(policyPath));

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await verifyMatrix().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('live verdict matrix did not verify after bootstrap');
}
