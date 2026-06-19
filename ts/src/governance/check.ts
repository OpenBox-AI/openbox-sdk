// Public governance evaluator. Same wire as the MCP `check_governance`
// tool, callable in-process so the Cursor/VS Code extension and other
// SDK consumers don't need to spawn `openbox mcp serve` for every
// would-be file write or AI insert.
//
// Key resolution mirrors `runtime/mcp` exactly:
//   1. explicit `apiKey` argument (highest priority; useful for tests)
//   2. process.env.OPENBOX_API_KEY (CI / hook-handler convention)
//   3. project-local agent-keys cache via recallAgentKey(agentId)
//
// All three accept only the agent runtime-key shape (`obx_live_*` or
// `obx_test_*`); the org-level X-API-Key (`obx_key_*`) is rejected
// because core's evaluator runs OPA against the agent's policies, not
// the org's.

import { OpenBoxCoreClient, type GovernanceVerdictResponse } from '../core-client/index.js';
import { recallAgentKey } from '../file-tokens/agent-keys.js';
import { resolveAgentIdentity, resolveConnection } from '../env/index.js';
import {
  buildSpan,
  withSpanActivityId,
  type SpanInput,
  type SpanType,
} from './spans.js';

export type { SpanType } from './spans.js';

export interface CheckGovernanceOptions {
  /** Agent ID for resolving a cached runtime key. */
  agentId?: string;
  /** Span/activity type. Drives `ACTIVITY_TYPE_MAP` and `buildSpan`. */
  spanType: SpanType;
  /** Action input. Examples: `{prompt}`, `{file_path,content}`, `{command}`. */
  activityInput: Record<string, unknown>;
  /** Override the runtime API key. Skips env + cache lookup. */
  apiKey?: string;
  /** Override the core base URL. Defaults to explicit OPENBOX_CORE_URL. */
  coreUrl?: string;
}

const ACTIVITY_TYPE_MAP: Record<SpanType, string> = {
  llm: 'PromptSubmission',
  file_read: 'FileRead',
  file_write: 'FileEdit',
  file_delete: 'FileDelete',
  shell: 'ShellExecution',
  http: 'HTTPRequest',
  db: 'DatabaseQuery',
  mcp: 'MCPToolCall',
};

function hex(len: number): string {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function isRuntimeKey(k: string | undefined): k is string {
  return !!k && (k.startsWith('obx_live_') || k.startsWith('obx_test_'));
}

function resolveApiKey(opts: CheckGovernanceOptions): string {
  // Each source supplies a candidate; the first that's actually a
  // runtime key (obx_live_/obx_test_) wins. OPENBOX_API_KEY frequently
  // holds the org-level X-API-Key (obx_key_*) for backend auth in
  // shells that bootstrap both surfaces; that's not what governance
  // needs, so we skip it and fall through to the agent-keys cache.
  const candidates = [
    opts.apiKey,
    process.env.OPENBOX_API_KEY,
    recallAgentKey(opts.agentId ?? '')?.runtimeKey,
  ];
  const key = candidates.find(isRuntimeKey);
  if (!key) {
    throw new Error(
      `No agent runtime key for ${opts.agentId ?? '(unset)'}. ` +
        'Pass apiKey, set OPENBOX_API_KEY to obx_live_*/obx_test_*, ' +
        'or mint/recover a runtime key from the dashboard/backend API. ' +
        '(OPENBOX_API_KEY=obx_key_* is the org X-API-Key and is ignored here.)',
    );
  }
  return key;
}

function resolveCoreUrl(coreUrlOverride?: string): string {
  if (coreUrlOverride) return coreUrlOverride;
  return resolveConnection().coreUrl;
}

function isAllowishVerdict(response: GovernanceVerdictResponse): boolean {
  const arm: unknown = response.verdict ?? response.action;
  const normalized =
    typeof arm === 'string' ? arm.trim().toLowerCase().replace(/-/g, '_') : arm;
  return (
    normalized === 'allow' ||
    normalized === 'continue' ||
    normalized === 'constrain' ||
    normalized === 0 ||
    normalized === 1
  );
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
  const coreUrl = resolveCoreUrl(opts.coreUrl);
  const activityId = hex(32);
  const span = withSpanActivityId(
    buildSpan('sdk', opts.spanType, opts.activityInput as SpanInput),
    activityId,
  );
  const payload = {
    source: 'workflow-telemetry',
    event_type: 'ActivityStarted',
    workflow_id: hex(32),
    run_id: hex(32),
    workflow_type: 'SdkCheck',
    task_queue: 'sdk',
    activity_id: activityId,
    activity_type: ACTIVITY_TYPE_MAP[opts.spanType] || opts.spanType,
    activity_input: [opts.activityInput],
    timestamp: new Date().toISOString(),
    hook_trigger: true,
    spans: [span],
    span_count: 1,
    attempt: 1,
  };
  const client = new OpenBoxCoreClient({
    apiUrl: coreUrl,
    apiKey,
    agentIdentity: resolveAgentIdentity(),
  });
  const {
    spans: _parentSpans,
    span_count: _parentSpanCount,
    hook_trigger: _parentHookTrigger,
    ...parentFields
  } = payload;
  const parentPayload = {
    ...parentFields,
    hook_trigger: false,
  };
  const parentVerdict = await client.evaluate(
    parentPayload as unknown as Parameters<typeof client.evaluate>[0],
  );
  const hookVerdict = await client.evaluate(
    payload as unknown as Parameters<typeof client.evaluate>[0],
  );
  return isAllowishVerdict(parentVerdict) ? hookVerdict : parentVerdict;
}
