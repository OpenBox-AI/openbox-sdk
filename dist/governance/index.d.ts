import { h as GovernanceVerdictResponse } from '../core-types-Dxgkbox0.js';

type SpanType$1 = 'llm' | 'file_read' | 'file_write' | 'shell' | 'http' | 'db' | 'mcp';
interface CheckGovernanceOptions {
    /** Agent ID; used to resolve the runtime key from the agent-keys
     *  cache when `apiKey` and OPENBOX_API_KEY are both absent. */
    agentId?: string;
    /** Span/activity type. Drives `ACTIVITY_TYPE_MAP` and `buildSpan`. */
    spanType: SpanType$1;
    /** Action input. Examples: `{prompt}`, `{file_path,content}`, `{command}`. */
    activityInput: Record<string, unknown>;
    /** Override the runtime API key. Skips env + cache lookup. */
    apiKey?: string;
    /** Override the core base URL. Defaults to OPENBOX_CORE_URL or OPENBOX_STACK_URL-derived core URL. */
    coreUrl?: string;
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
declare function checkGovernance(opts: CheckGovernanceOptions): Promise<GovernanceVerdictResponse>;

type SpanType = 'llm' | 'file_read' | 'file_write' | 'file_delete' | 'shell' | 'mcp' | 'http';
interface SpanInput {
    prompt?: string;
    response?: string;
    file_path?: string;
    command?: string;
    cwd?: string;
    tool_name?: string;
    tool_input?: unknown;
    tool_output?: unknown;
    url?: string;
    method?: string;
}
/**
 * Build a single span for the given event. The `semantic_type` and
 * gate attributes drive the classifier's behavior-trigger decision
 * (`file_read`, `internal`, `llm_completion`, `http_*`, ...). The
 * span is appended to the evaluate payload's `spans` array;
 * without it, behavior rules never match.
 *
 * `host` is the adapter name (for example `'cursor'` or
 * `'claude-code'`). It stamps the `module` field and `gen_ai.system`
 * so dashboards and behavior rules keyed on `gen_ai.system` can
 * distinguish traffic by origin.
 */
declare function buildSpan(host: string, type: SpanType, input: SpanInput): Record<string, unknown>;

declare const EVENT: {
    readonly START: "ActivityStarted";
    readonly COMPLETE: "ActivityCompleted";
    readonly SIGNAL: "SignalReceived";
};

declare const SKIP_PATTERNS: readonly RegExp[];
declare function isSkipped(filePath: string): boolean;
/**
 * True when `filePath` lives inside any of the IDE's open
 * workspace folders. Used by the cursor runtime to decide whether
 * a file action is "in-project" (skip governance; most reads of
 * source files, configs, or `package.json` are routine) versus
 * "external" (the agent reaching for `/etc/passwd`,
 * `/home/.../.aws/credentials`, and the like).
 *
 * Empty or missing roots return `false`. Without scope
 * information, treat every path as external. The result gates more
 * activity rather than less, which is the safer default.
 */
declare function isInsideAnyRoot(filePath: string | undefined, roots: string[] | undefined, cwd?: string): boolean;

type RuleTrigger = 'always' | 'globMatch' | 'agentRequested' | 'manual';
type RuleSeverity = 'block' | 'warn' | 'info';
interface ProjectedRule {
    id: string;
    source: 'guardrail' | 'policy';
    description: string;
    body: string;
    trigger: RuleTrigger;
    severity: RuleSeverity;
    globs?: string[];
    rendererHints?: Record<string, unknown>;
}
interface RulesProjection {
    agentId: string;
    fetchedAt: string;
    version: number;
    rules: ProjectedRule[];
}
interface FetchProjectionOpts {
    agentId: string;
    tokensPath?: string;
}
declare function fetchRulesProjection(opts: FetchProjectionOpts): Promise<RulesProjection>;

declare const HOOK_EVENT_LABELS: Record<string, string>;
/**
 * Returns a human-readable label for a hook event name. Falls back
 * to the original identifier when the event is unknown, and to
 * `'Action'` when the input is empty.
 */
declare function hookEventLabel(hookEvent: string | undefined | null): string;

export { type CheckGovernanceOptions, EVENT, type FetchProjectionOpts, HOOK_EVENT_LABELS, type ProjectedRule, type RuleSeverity, type RuleTrigger, type RulesProjection, SKIP_PATTERNS, type SpanInput, type SpanType$1 as SpanType, buildSpan, checkGovernance, fetchRulesProjection, hookEventLabel, isInsideAnyRoot, isSkipped };
