import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { OpenBoxCoreClient, type AgentIdentityConfig } from '../../ts/src/core-client/index.js';

const BACKEND_KEY_PREFIX = /^obx_key_/;
const RUNTIME_KEY_PREFIX = /^obx_(?:test|live)_/;
const POLICY_NAME = 'openbox-sdk-live-e2e-policy';
const POLICY_MARKER = 'openbox-sdk-live-e2e verdict matrix v1';

type SpanType = 'llm' | 'file_read' | 'file_write' | 'shell' | 'http' | 'db';
type ExpectedVerdict = 'allow' | 'require_approval' | 'block' | 'halt';

interface BackendEnvelope<T = any> {
  data?: T;
  message?: string;
}

interface PolicyRecord {
  id?: string;
  name?: string;
  rego_code?: string;
}

const MATRIX: Array<{
  name: string;
  spanType: SpanType;
  input: Record<string, unknown>;
  verdict: ExpectedVerdict;
  reason?: string;
}> = [
  { name: 'db', spanType: 'db', input: { query: 'SELECT 1' }, verdict: 'allow' },
  { name: 'llm', spanType: 'llm', input: { prompt: 'summarize this' }, verdict: 'require_approval', reason: 'e2e-approve-llm' },
  { name: 'file_read', spanType: 'file_read', input: { file_path: '/etc/hostname' }, verdict: 'require_approval', reason: 'e2e-approve-read' },
  { name: 'shell', spanType: 'shell', input: { command: 'echo hello' }, verdict: 'block', reason: 'e2e-deny-shell' },
  { name: 'file_write', spanType: 'file_write', input: { file_path: '/tmp/blocked.txt' }, verdict: 'block', reason: 'e2e-deny-write' },
  { name: 'http', spanType: 'http', input: { method: 'POST', url: 'https://example.com/blocked' }, verdict: 'halt', reason: 'e2e-halt-http' },
];

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
    case 'file_read':
      return 'FileRead';
    case 'file_write':
      return 'FileEdit';
    case 'shell':
      return 'ShellExecution';
    case 'http':
      return 'HTTPRequest';
    case 'db':
      return 'DatabaseQuery';
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
    status: { code: 'OK', description: null },
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
  return {
    ...base,
    name: 'llm.chat.completion',
    hook_type: 'function_call',
    semantic_type: 'llm_completion',
    attributes: { 'gen_ai.system': 'openai' },
  };
}

function governancePayload(spanType: SpanType, input: Record<string, unknown>): Record<string, unknown> {
  return {
    source: 'sdk',
    event_type: 'ActivityStarted',
    workflow_id: hex(16),
    run_id: hex(16),
    workflow_type: 'ExtensionE2E',
    task_queue: 'sdk',
    activity_id: hex(16),
    activity_type: activityType(spanType),
    activity_input: [input],
    timestamp: new Date().toISOString(),
    hook_trigger: true,
    spans: [span(spanType, input)],
    span_count: 1,
    attempt: 1,
  };
}

function e2eRego(policyPath: string): string {
  return `package ${policyPath.replaceAll('/', '.')}

# ${POLICY_MARKER}
default result := {"decision": "CONTINUE", "reason": "openbox-sdk-live-e2e default allow"}

result := {"decision": "REQUIRE_APPROVAL", "reason": "e2e-approve-llm"} if {
  input.activity_type == "PromptSubmission"
}

result := {"decision": "REQUIRE_APPROVAL", "reason": "e2e-approve-read"} if {
  input.activity_type == "FileRead"
}

result := {"decision": "BLOCK", "reason": "e2e-deny-shell"} if {
  input.activity_type == "ShellExecution"
}

result := {"decision": "BLOCK", "reason": "e2e-deny-write"} if {
  input.activity_type == "FileEdit"
}

result := {"decision": "HALT", "reason": "e2e-halt-http"} if {
  input.activity_type == "HTTPRequest"
}
`;
}

function bootstrapAgentIdentity(preferE2eIdentity = false): AgentIdentityConfig | undefined {
  const did = preferE2eIdentity
    ? process.env.OPENBOX_E2E_AGENT_DID ?? process.env.OPENBOX_AGENT_DID
    : process.env.OPENBOX_AGENT_DID ?? process.env.OPENBOX_E2E_AGENT_DID;
  const privateKey = preferE2eIdentity
    ? process.env.OPENBOX_E2E_AGENT_PRIVATE_KEY ?? process.env.OPENBOX_AGENT_PRIVATE_KEY
    : process.env.OPENBOX_AGENT_PRIVATE_KEY ?? process.env.OPENBOX_E2E_AGENT_PRIVATE_KEY;
  if (!did && !privateKey) return undefined;
  if (!did || !privateKey) {
    throw new Error(
      'signed live verdict verification requires both OPENBOX_AGENT_DID/OPENBOX_AGENT_PRIVATE_KEY or both OPENBOX_E2E_AGENT_DID/OPENBOX_E2E_AGENT_PRIVATE_KEY',
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

function inferSshHost(): string | undefined {
  if (process.env.OPENBOX_E2E_BOOTSTRAP_SSH_HOST) return process.env.OPENBOX_E2E_BOOTSTRAP_SSH_HOST;
  return undefined;
}

function seedViaDevHost(agentId: string): void {
  const sshHost = inferSshHost();
  const orgId = process.env.OPENBOX_ORG_ID;
  if (!sshHost || !orgId) {
    throw new Error('backend policy create failed and no dev-host bootstrap target is configured');
  }
  if (!/^[0-9a-f-]{36}$/i.test(agentId)) throw new Error('OPENBOX_E2E_AGENT_ID is not a UUID');
  const policyId = randomUUID();
  const orgPart = orgId.replace(/[^a-zA-Z0-9]/g, '_');
  const policyPath = `openbox_e2e/${orgPart}/policy_${policyId.replace(/-/g, '')}`;
  const rego = e2eRego(policyPath);
  const put = spawnSync(
    'ssh',
    [sshHost, `curl -sS -X PUT --data-binary @- http://127.0.0.1:8181/v1/policies/${policyPath}`],
    { input: rego, encoding: 'utf-8' },
  );
  if (put.status !== 0 || /invalid|error/i.test(put.stdout)) {
    throw new Error(`OPA dev-host policy install failed: ${put.stdout || put.stderr}`);
  }

  const sql = `
update policies
set is_active=false, is_current_version=false, updated_at=now()
where agent_id='${agentId}' and name like 'openbox-sdk-live-e2e%';
insert into policies (
  id, agent_id, name, description, rego_code, config, input,
  is_active, is_current_version, trust_impact, trust_threshold, created_at, updated_at
)
values (
  '${policyId}', '${agentId}', '${POLICY_NAME}',
  'Deterministic dev-only live E2E verdict matrix for openbox-sdk.',
  $rego$${rego}$rego$, '{"path":"${policyPath}"}'::jsonb, '{}'::jsonb,
  true, true, 'none', null, now(), now()
);
`;
  const db = spawnSync(
    'ssh',
    [sshHost, 'docker exec -i openbox-postgres psql -U postgres -d openbox -v ON_ERROR_STOP=1 -q'],
    { input: sql, encoding: 'utf-8' },
  );
  if (db.status !== 0) {
    throw new Error(`dev-host policy DB install failed: ${db.stderr}`);
  }
}

async function evaluate(spanType: SpanType, input: Record<string, unknown>): Promise<{ verdict?: string; reason?: string }> {
  const coreUrl = process.env.OPENBOX_CORE_URL;
  const e2eRuntimeKey = process.env.OPENBOX_E2E_RUNTIME_KEY;
  const key = e2eRuntimeKey ?? process.env.OPENBOX_API_KEY;
  if (!coreUrl || !key || !RUNTIME_KEY_PREFIX.test(key)) {
    throw new Error('OPENBOX_CORE_URL and an agent runtime key are required for live verdict verification');
  }
  const payload = governancePayload(spanType, input);
  const agentIdentity = bootstrapAgentIdentity(Boolean(e2eRuntimeKey));
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
  for (const c of MATRIX) {
    const result = await evaluate(c.spanType, c.input);
    if (result.verdict !== c.verdict) return false;
    if (c.reason && !result.reason?.includes(c.reason)) return false;
  }
  return true;
}

export async function ensureLiveVerdictMatrix(): Promise<void> {
  if (!isLiveTarget()) return;
  const agentId = process.env.OPENBOX_E2E_AGENT_ID;
  if (!agentId || !process.env.OPENBOX_E2E_RUNTIME_KEY) return;

  const current = process.env.OPENBOX_BACKEND_API_KEY ? await currentPolicy(agentId).catch(() => undefined) : undefined;
  if (current?.rego_code?.includes(POLICY_MARKER) && (await verifyMatrix().catch(() => false))) {
    return;
  }

  const policyId = randomUUID();
  const orgPart = (process.env.OPENBOX_ORG_ID ?? 'openbox_e2e').replace(/[^a-zA-Z0-9]/g, '_');
  const policyPath = `openbox_e2e/${orgPart}/policy_${policyId.replace(/-/g, '')}`;
  try {
    await createPolicyViaBackend(agentId, e2eRego(policyPath));
  } catch {
    seedViaDevHost(agentId);
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await verifyMatrix().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('live verdict matrix did not verify after bootstrap');
}
