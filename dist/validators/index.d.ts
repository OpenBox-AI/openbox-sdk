/**
 * Parse a JSON input value that can be:
 * - A raw JSON string: '{"key": "value"}'
 * - A file path prefixed with @: @payload.json
 * - A dash for stdin: -
 */
declare function parseJsonInput<T = unknown>(value: string): T;

/** Non-fatal cautionary message. TTY: `warn:` line on stderr.
 *  Machine: silent; warnings are advisory, and the contract is "stderr
 *  is empty on success". A future enhancement could route to a separate
 *  warning channel; today, silenced is honest. */
declare function warn(message: string, reference?: string): void;

declare const EXIT: {
    /** Success. */
    readonly OK: 0;
    /** Generic / uncategorized failure. Last resort. */
    readonly GENERIC: 1;
    /** Usage / argv validation error. Commander's default for missing
     *  required option, unknown flag, etc. We follow that convention. */
    readonly USAGE: 2;
    /** Auth failure; 401, 403, missing tokens, expired session. */
    readonly AUTH: 3;
    /** Required feature flag disabled for the active env. */
    readonly FEATURE_DISABLED: 4;
    /** Resource not found; 404. */
    readonly NOT_FOUND: 5;
    /** Conflict; 409 (already-exists, version mismatch, etc.). */
    readonly CONFLICT: 6;
    /** Rate-limited; 429. Caller MAY retry with backoff. */
    readonly RATE_LIMIT: 7;
    /** Server-side failure; 5xx. Caller MAY retry. */
    readonly SERVER: 8;
    /** Network / transport failure (DNS, ECONNREFUSED, timeout). Retryable. */
    readonly NETWORK: 9;
};
type ExitCode = (typeof EXIT)[keyof typeof EXIT];
/** Map an HTTP status to an exit code. Used by reportAndExit when the
 *  underlying error is an OpenBoxApiError / CoreApiError. */
declare function exitCodeForStatus(status: number): ExitCode;
/** Whether the exit code represents a transient condition the caller may retry. */
declare function isRetryable(code: ExitCode): boolean;
/** Clean (non-error) exit with a specific code. Use for "this command
 *  intentionally exits non-zero to signal X" cases:
 *    - feature flag disabled (EXIT.FEATURE_DISABLED)
 *    - verify rule severity above threshold (EXIT.GENERIC by convention,
 *      but the caller picks)
 *    - missing required input under --non-interactive (EXIT.USAGE)
 *
 *  Print any user-facing message via the helpers in `output.ts`
 *  (`error(...)`, `warn(...)`, etc.) BEFORE calling this, so the format
 *  is consistent across the CLI. `bailWith` is a pure exit primitive. */
declare function bailWith(code: ExitCode): never;

/**
 * Setup-time validators. Public sub-path:
 *   `import { validateUuid, validateIsoDate, ... } from 'openbox-sdk/validators'`
 *
 * Job: reject any input that the OpenBox design says is broken before
 * it hits the backend (where behavior is often silent or the error is
 * opaque). The CLI consumes these for argv validation; UI / IDE-extension
 * / hand-rolled SDK consumers can use the same validators to keep their
 * own input layers consistent without re-implementing UUID + ISO-date
 * + behavior-trigger + rego-source checks.
 *
 * Two error levels:
 *   - block(...)  → throws ValidationError with actionable fix
 *                   suggestion. CLI uses reportAndExit to convert to
 *                   exit code 2; library consumers catch and surface
 *                   their own way.
 *   - warn(...)   → prints to stderr and continues. For non-fatal
 *                   drift, such as non-canonical activity_type names
 *                   that technically work but mismatch guardrail
 *                   bindings.
 *
 * Every validator cites the source of truth (enum location, dto path,
 * skill reference) in its error message so operators know where to
 * look.
 */

declare class ValidationError extends Error {
    rule: string;
    fix?: string | undefined;
    reference?: string | undefined;
    constructor(rule: string, message: string, fix?: string | undefined, reference?: string | undefined);
}

/** Block with a hard error. Caller exits with code 2 (user-input error). */
declare function block(rule: string, message: string, fix?: string, reference?: string): never;
declare function reportAndExit(err: unknown): never;
/** Canonical UUID body. Anchored via `UUID_RE` for "is this string a
 *  UUID" checks, unanchored via `UUID_RE_BODY` for "find a UUID inside
 *  a line of source" scans. Single source so both regex shapes track
 *  the same character class. */
declare const UUID_PATTERN_BODY = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
declare function validateUuid(value: unknown, label: string): string;
/** Same as validateUuid but for a `string[]` flag value; every entry
 *  must be a UUID. Used by spec-driven flags that take variadic UUIDs,
 *  such as `agent create --team t1 t2`. */
declare function validateUuidList(value: unknown, label: string): string[];
declare function validateInt(value: unknown, label: string, opts?: {
    min?: number;
    max?: number;
}): number;
declare function validateEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T;
declare function validateIsoDate(value: unknown, label: string): string;
declare function parsePagination(opts: {
    page?: unknown;
    limit?: unknown;
}): {
    page: number;
    perPage: number;
};
/** Numeric IDs match the live guardrails service registry. CLI aliases below. */
declare const GUARDRAIL_TYPE_ALIASES: Record<string, string>;
declare function validateGuardrailType(value: unknown): string;
declare function validateStage(value: unknown): '0' | '1';
declare function validateGuardrailParams(typeId: string, params: unknown): void;
/**
 * Canonical `activity_type` strings. Union of what first-party SDKs emit
 * (runtime/claude-code + runtime/cursor activity_type tables) plus the
 * SDK-default `DefaultActivity` and the aspirational names the skill
 * recommends for hand-rolled integrations. Non-canonical names still work
 * server-side (activity_type is free-string) but won't match guardrails
 * configured against this canonical set.
 *
 * Note: `ActivityCompleted` is an event_type, not an activity_type .
 * deliberately excluded here even though the skill used to include it.
 */
declare const CANONICAL_ACTIVITY_TYPES: readonly ["PromptSubmission", "LLMCompleted", "ToolCompleted", "FileRead", "FileEdit", "FileDelete", "ShellExecution", "HTTPRequest", "MCPToolCall", "MCPToolResponse", "AgentResponse", "AgentThinking", "ShellOutput", "AgentSpawn", "ClaudeCodeSession", "CursorSession", "DefaultActivity"];
declare function validateActivitiesConfig(activities: unknown, stage: '0' | '1'): void;
/** Every permission string the backend's `Permission` enum accepts;
 *  mirrors the spec's `Permission` union. Static-asserted below: if the
 *  generated `Permission` union ever drops/renames a value, the type
 *  check at the bottom of this block fires at `tsc --noEmit`. Bootstrap
 *  / installer / e2e tooling read this instead of hand-typing the list. */
declare const ALL_PERMISSIONS: readonly ["write:org", "read:org", "create:user", "read:user", "update:user", "delete:user", "create:agent", "read:agent", "update:agent", "delete:agent", "create:team", "read:team", "update:team", "delete:team", "create:webhook", "read:webhook", "update:webhook", "delete:webhook", "create:api_key", "read:api_key", "update:api_key", "delete:api_key", "manage:sso", "read:agent_session", "manage:agent_session", "read:agent_log", "create:agent_guardrail", "read:agent_guardrail", "update:agent_guardrail", "delete:agent_guardrail", "create:agent_policy", "read:agent_policy", "update:agent_policy", "delete:agent_policy", "create:agent_behavior_rule", "read:agent_behavior_rule", "update:agent_behavior_rule", "delete:agent_behavior_rule"];
declare const API_KEY_GRANTABLE_PERMISSIONS: ("write:org" | "read:org" | "create:user" | "read:user" | "update:user" | "delete:user" | "create:agent" | "read:agent" | "update:agent" | "delete:agent" | "create:team" | "read:team" | "update:team" | "delete:team" | "create:webhook" | "read:webhook" | "update:webhook" | "delete:webhook" | "create:api_key" | "read:api_key" | "update:api_key" | "delete:api_key" | "manage:sso" | "read:agent_session" | "manage:agent_session" | "read:agent_log" | "create:agent_guardrail" | "read:agent_guardrail" | "update:agent_guardrail" | "delete:agent_guardrail" | "create:agent_policy" | "read:agent_policy" | "update:agent_policy" | "delete:agent_policy" | "create:agent_behavior_rule" | "read:agent_behavior_rule" | "update:agent_behavior_rule" | "delete:agent_behavior_rule")[];
/** Mirrors the live `BehaviorRuleTrigger` enum the backend persists. */
declare const BEHAVIOR_TRIGGER_ENUM: readonly ["http_get", "http_post", "http_put", "http_patch", "http_delete", "http", "llm_completion", "llm_embedding", "llm_tool_call", "database_select", "database_insert", "database_update", "database_delete", "database_query", "file_read", "file_write", "file_open", "file_delete", "internal"];
declare function validateBehaviorTrigger(value: unknown): string;
declare function validateBehaviorStates(value: unknown): string[];
/** Verdict numeric: 0=ALLOW, 1=CONSTRAIN, 2=REQUIRE_APPROVAL, 3=BLOCK, 4=HALT. */
declare function validateVerdict(value: unknown): number;
declare function validateApprovalTimeout(verdict: number, timeout: unknown): void;
/**
 * Heuristic check that the rego source follows OpenBox's expected shape.
 * Core reads `result.decision` + `result.reason`; anything else silently allows.
 * We don't parse full Rego; we check for the result pattern and flag deny[msg] as a common bug.
 */
declare function validateRegoSource(rego: string): void;

export { ALL_PERMISSIONS, API_KEY_GRANTABLE_PERMISSIONS, BEHAVIOR_TRIGGER_ENUM, CANONICAL_ACTIVITY_TYPES, EXIT, type ExitCode, GUARDRAIL_TYPE_ALIASES, UUID_PATTERN_BODY, ValidationError, bailWith, block, exitCodeForStatus, isRetryable, parseJsonInput, parsePagination, reportAndExit, validateActivitiesConfig, validateApprovalTimeout, validateBehaviorStates, validateBehaviorTrigger, validateEnum, validateGuardrailParams, validateGuardrailType, validateInt, validateIsoDate, validateRegoSource, validateStage, validateUuid, validateUuidList, validateVerdict, warn };
