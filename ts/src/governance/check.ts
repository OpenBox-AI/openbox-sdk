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

import { randomUUID } from 'node:crypto';
import { stampSource } from '../approvals/source.js';
import {
  DefaultSession,
  OpenBoxCoreClient,
  type AgentIdentityConfig,
  type GovernanceVerdictResponse,
  type WorkflowVerdict,
} from '../core-client/index.js';
import { PRESET_ACTIVITY_TYPES } from '../core-client/generated/govern.js';
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
  /** Span/activity type. Drives generated default activity mapping and `buildSpan`. */
  spanType: SpanType;
  /** Action input. Examples: `{prompt}`, `{file_path,content}`, `{command}`. */
  activityInput: Record<string, unknown>;
  /** Override the runtime API key. Skips env + cache lookup. */
  apiKey?: string;
  /** Override the core base URL. Defaults to explicit OPENBOX_CORE_URL. */
  coreUrl?: string;
  /** Runtime/source label stamped on emitted spans. Defaults to `sdk`. */
  source?: string;
  /** Existing host/OpenBox session identifier for goal-bound checks. */
  sessionId?: string;
  /** User/session/workflow goal used by AGE before the governed action. */
  goal?: string;
  /** Strict mode: reject governed actions when no goal can be resolved. */
  requireGoalContext?: boolean;
  /** Explicit signed agent identity for signing_required compliance proof. */
  agentIdentity?: AgentIdentityConfig;
}

const defaultActivity = PRESET_ACTIVITY_TYPES.default;
const llamaIndexActivity = PRESET_ACTIVITY_TYPES.llamaindex;
const autogenActivity = PRESET_ACTIVITY_TYPES.autogen;

const ACTIVITY_TYPE_MAP: Record<SpanType, string> = {
  llm: defaultActivity.prompt,
  llm_embedding: llamaIndexActivity.embedding,
  llm_tool_call: autogenActivity.toolCallRequestEvent,
  file_read: defaultActivity.read,
  file_open: defaultActivity.read,
  file_write: defaultActivity.write,
  file_delete: defaultActivity.fileDelete,
  shell: defaultActivity.shell,
  http: defaultActivity.httpRequest,
  db: defaultActivity.databaseQuery,
  mcp: defaultActivity.mcpToolCall,
};

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

function verdictResponse(verdict: WorkflowVerdict): GovernanceVerdictResponse {
  return {
    verdict: verdict.arm,
    action: verdict.arm,
    reason: verdict.reason,
    risk_score: verdict.riskScore,
    approval_id: verdict.approvalId,
    governance_event_id: verdict.governanceEventId,
    approval_expiration_time: verdict.approvalExpiresAt,
    policy_id: verdict.policyId,
    behavioral_violations: verdict.behavioralViolations,
    constraints: verdict.constraints,
    metadata: verdict.metadata,
    governance_checks_incomplete: verdict.governanceChecksIncomplete,
    guardrails_result: verdict.guardrailsResult as never,
    age_result: verdict.ageResult,
  } as GovernanceVerdictResponse;
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
  const source = opts.source?.trim() || 'sdk';
  const goal = opts.goal?.trim();
  if (opts.requireGoalContext && !goal) {
    throw new Error(
      'OpenBox goal context is required for AGE alignment; pass goal or bind to a session with a seeded goal.',
    );
  }
  const activityId = randomUUID();
  const sessionId = opts.sessionId?.trim() || randomUUID();
  const span = withSpanActivityId(
    buildSpan(source, opts.spanType, opts.activityInput as SpanInput),
    activityId,
  );
  const agentIdentity = opts.agentIdentity ?? resolveAgentIdentity();
  const client = new OpenBoxCoreClient({
    apiUrl: coreUrl,
    apiKey,
    ...(agentIdentity ? { agentIdentity } : {}),
  });
  const session = new DefaultSession({
    core: client,
    workflowType: 'SdkCheck',
    taskQueue: source,
    inlineApproval: true,
    registerExitHandlers: false,
    attached: true,
  });
  await session.workflowStarted();
  if (goal) {
    await session.activity(
      'SignalReceived',
      defaultActivity.goalSignal,
      {
        sessionId,
        input: [stampSource({ prompt: goal, event_category: 'agent_goal' }, source)],
        signalName: defaultActivity.goalSignal,
        signalArgs: goal,
        prompt: goal,
      },
    );
  }
  const verdict = await session.observeActivity(
    'ActivityStarted',
    ACTIVITY_TYPE_MAP[opts.spanType] || opts.spanType,
    {
      activityId,
      sessionId,
      input: [stampSource(opts.activityInput, source)],
      spans: [span],
    },
  );
  return verdictResponse(verdict);
}
