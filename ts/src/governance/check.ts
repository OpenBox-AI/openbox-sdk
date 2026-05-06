// Public governance evaluator. Same wire as the MCP `check_governance`
// tool, callable in-process so the Cursor/VS Code extension and other
// SDK consumers don't need to spawn `openbox mcp serve` for every
// would-be file write or AI insert.
//
// Key resolution mirrors `runtime/mcp` exactly:
//   1. explicit `apiKey` argument (highest priority; useful for tests)
//   2. process.env.OPENBOX_API_KEY (CI / hook-handler convention)
//   3. ~/.openbox/agent-keys cache via recallAgentKey(agentId)
//
// All three accept only the agent runtime-key shape (`obx_live_*` or
// `obx_test_*`); the org-level X-API-Key (`obx_key_*`) is rejected
// because core's evaluator runs OPA against the agent's policies, not
// the org's.

import { OpenBoxCoreClient, type GovernanceVerdictResponse } from '../core-client/index.js';
import { recallAgentKey } from '../runtime/_shared/agent-keys-store.js';
import { ENVIRONMENTS, type EnvName } from '../env/index.js';

export type SpanType = 'llm' | 'file_read' | 'file_write' | 'shell' | 'http' | 'db' | 'mcp';

export interface CheckGovernanceOptions {
  /** Agent ID; used to resolve the runtime key from the agent-keys
   *  cache when `apiKey` and OPENBOX_API_KEY are both absent. */
  agentId?: string;
  /** Span/activity type. Drives `ACTIVITY_TYPE_MAP` and `buildSpan`. */
  spanType: SpanType;
  /** Action input. Examples: `{prompt}`, `{file_path,content}`, `{command}`. */
  activityInput: Record<string, unknown>;
  /** Override the runtime API key. Skips env + cache lookup. */
  apiKey?: string;
  /** Override the env (production / staging / local). Defaults to OPENBOX_ENV. */
  envName?: EnvName;
  /** Override the core base URL. Defaults to env's coreUrl. */
  coreUrl?: string;
}

const ACTIVITY_TYPE_MAP: Record<SpanType, string> = {
  llm: 'PromptSubmission',
  file_read: 'FileRead',
  file_write: 'FileEdit',
  shell: 'ShellExecution',
  http: 'HTTPRequest',
  db: 'DatabaseQuery',
  mcp: 'MCPToolCall',
};

function hex(len: number): string {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function buildSpan(spanType: SpanType, input: Record<string, unknown>): Record<string, unknown> {
  const base = {
    span_id: hex(16),
    trace_id: hex(32),
    parent_span_id: null,
    kind: 'CLIENT',
    stage: 'started',
    start_time: Date.now() * 1_000_000,
    end_time: null,
    duration_ns: null,
    status: { code: 'OK', description: null },
    events: [],
    error: null,
  };
  switch (spanType) {
    case 'llm':
      return {
        ...base,
        name: 'llm.chat.completion',
        hook_type: 'function_call',
        semantic_type: 'llm_completion',
        attributes: {
          'gen_ai.system': 'openai',
          'http.method': 'POST',
          'http.url': 'https://api.openai.com/v1/chat/completions',
        },
        function: 'LLMCall',
        module: 'activity',
        args: input,
        result: null,
      };
    case 'file_read':
      return {
        ...base,
        name: 'file.read',
        kind: 'INTERNAL',
        hook_type: 'file_operation',
        semantic_type: 'file_read',
        attributes: { 'file.path': input.file_path || '', 'file.operation': 'read' },
        file_path: input.file_path || '',
        file_mode: 'r',
        file_operation: 'read',
      };
    case 'file_write':
      return {
        ...base,
        name: 'file.write',
        kind: 'INTERNAL',
        hook_type: 'file_operation',
        semantic_type: 'file_write',
        attributes: { 'file.path': input.file_path || '', 'file.operation': 'write' },
        file_path: input.file_path || '',
        file_mode: 'w',
        file_operation: 'write',
      };
    case 'shell':
      return {
        ...base,
        name: 'ShellExecution',
        kind: 'INTERNAL',
        hook_type: 'function_call',
        semantic_type: 'internal',
        attributes: { 'shell.command': input.command || '', 'shell.cwd': input.cwd || '' },
        function: 'ShellExecution',
        module: 'activity',
        args: input,
        result: null,
      };
    case 'http': {
      const method = ((input.method as string) || 'POST').toUpperCase();
      const url = (input.url as string) || 'https://api.example.com';
      return {
        ...base,
        name: `${method} ${url}`,
        hook_type: 'http_request',
        attributes: { 'http.method': method, 'http.url': url },
        http_method: method,
        http_url: url,
        request_body: null,
        response_body: null,
      };
    }
    case 'db': {
      const dbOp = ((input.operation as string) || 'SELECT').toUpperCase();
      return {
        ...base,
        name: dbOp,
        hook_type: 'db_query',
        attributes: { 'db.system': input.system || 'postgresql', 'db.operation': dbOp },
        db_system: input.system || 'postgresql',
        db_operation: dbOp,
        db_statement: input.statement || '',
      };
    }
    case 'mcp':
      return {
        ...base,
        name: 'MCPToolCall',
        kind: 'INTERNAL',
        hook_type: 'function_call',
        semantic_type: 'internal',
        attributes: { 'mcp.tool': input.tool || '' },
        function: 'MCPToolCall',
        module: 'activity',
        args: input,
        result: null,
      };
  }
}

function resolveApiKey(opts: CheckGovernanceOptions): string {
  let key: string | undefined =
    opts.apiKey ?? process.env.OPENBOX_API_KEY ?? recallAgentKey(opts.agentId ?? '')?.runtimeKey;
  if (!key) {
    throw new Error(
      `No agent runtime key for ${opts.agentId ?? '(unset)'}. ` +
        'Set OPENBOX_API_KEY, pass apiKey, or run `openbox api-key recall <agentId>` ' +
        'to surface a cached key.',
    );
  }
  if (!key.startsWith('obx_live_') && !key.startsWith('obx_test_')) {
    throw new Error(
      `Resolved key for agent ${opts.agentId ?? ''} doesn't look like a runtime key. ` +
        'Expected `obx_live_*` or `obx_test_*`.',
    );
  }
  return key;
}

function resolveCoreUrl(envName?: EnvName, coreUrlOverride?: string): string {
  if (coreUrlOverride) return coreUrlOverride;
  if (process.env.OPENBOX_CORE_URL) return process.env.OPENBOX_CORE_URL;
  const env = (envName || (process.env.OPENBOX_ENV as EnvName) || 'production') as EnvName;
  return ENVIRONMENTS[env]?.coreUrl ?? ENVIRONMENTS.production.coreUrl;
}

/**
 * Evaluate an action against an agent's governance rules.
 *
 * Returns the core verdict envelope: `{verdict, reason?, approval_id?,
 * ...}`. `verdict === 0` means allow; any non-zero value means the
 * caller should treat the action as gated. `approval_id` is set when
 * the verdict materializes an approval row server-side.
 *
 * Throws if the runtime key can't be resolved or doesn't look like an
 * agent runtime key (`obx_live_*`/`obx_test_*`). The org-level
 * X-API-Key (`obx_key_*`) is rejected because core's evaluator runs
 * OPA against the agent's policies, which the org key doesn't carry.
 */
export async function checkGovernance(
  opts: CheckGovernanceOptions,
): Promise<GovernanceVerdictResponse> {
  const apiKey = resolveApiKey(opts);
  const coreUrl = resolveCoreUrl(opts.envName, opts.coreUrl);
  const span = buildSpan(opts.spanType, opts.activityInput);
  const payload = {
    source: 'sdk',
    event_type: 'ActivityStarted',
    workflow_id: hex(32),
    run_id: hex(32),
    workflow_type: 'SdkCheck',
    task_queue: 'sdk',
    activity_id: hex(32),
    activity_type: ACTIVITY_TYPE_MAP[opts.spanType] || opts.spanType,
    activity_input: [opts.activityInput],
    timestamp: new Date().toISOString(),
    hook_trigger: true,
    spans: [span],
    span_count: 1,
    attempt: 1,
  };
  const client = new OpenBoxCoreClient({ apiUrl: coreUrl, apiKey });
  return client.evaluate(payload as unknown as Parameters<typeof client.evaluate>[0]);
}
