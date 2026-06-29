/**
 * Setup-time validators. Public sub-path:
 *   `import { validateUuid, validateIsoDate, ... } from '@openbox-ai/openbox-sdk/validators'`
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

export { parseJsonInput } from './input.js';

import { EXIT, exitCodeForStatus } from '../cli/exit-codes.js';
import { error as printError, warn } from '../cli/output.js';
import {
  CANONICAL_ACTIVITY_TYPES as GENERATED_CANONICAL_ACTIVITY_TYPES,
  CANONICAL_SPAN,
} from '../core-client/generated/govern.js';
export { EXIT, exitCodeForStatus, isRetryable, bailWith } from '../cli/exit-codes.js';
export type { ExitCode } from '../cli/exit-codes.js';

export class ValidationError extends Error {
  constructor(
    public rule: string,
    message: string,
    public fix?: string,
    public reference?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

// `warn` is imported above and re-exported so legacy callers
// (`import { warn } from '../validators'`) keep working. The
// implementation lives in `../cli/output.ts`.
export { warn };

/** Block with a hard error. Caller exits with code 2 (user-input error). */
export function block(rule: string, message: string, fix?: string, reference?: string): never {
  throw new ValidationError(rule, message, fix, reference);
}

export function reportAndExit(err: unknown): never {
  // Destructive-op gate. Surfaces a clean USAGE error rather than
  // dumping a stack trace from the runtime helper.
  if (err instanceof Error && err.name === 'DestructiveConfirmRequiredError') {
    printError(err.message);
    process.exit(EXIT.USAGE);
  }

  if (err instanceof ValidationError) {
    printError(err.message, {
      help: err.fix,
      see: err.reference,
    });
    process.exit(EXIT.USAGE);
  }

  // OpenBoxApiError (from @openbox-ai/openbox-sdk/client) and CoreApiError (from
  // @openbox-ai/openbox-sdk/core-client); surface status + body so users don't see
  // a bare "Request failed: 500 Internal Server Error" with no context.
  // Both share the same { name, status, body } shape; check by name.
  const apiErr = err as { name?: string; message?: string; status?: number; body?: unknown; code?: string };
  if (
    apiErr &&
    (apiErr.name === 'OpenBoxApiError' || apiErr.name === 'CoreApiError') &&
    typeof apiErr.status === 'number'
  ) {
    const detail = extractApiErrorDetail(apiErr.body);
    // Detail-aware hint takes precedence over the generic status hint;
    // surfaces specific known failure modes (deployed-environment bugs,
    // fail-closed responses) that the user can act on directly.
    const hint = hintForDetail(detail) ?? hintForStatus(apiErr.status);
    printError(apiErr.message ?? 'request failed', {
      detail: detail ?? undefined,
      hint: hint ?? undefined,
    });
    process.exit(exitCodeForStatus(apiErr.status));
  }

  // Node fetch / undici network errors; ECONNREFUSED, DNS, timeout.
  // Surface as EXIT.NETWORK so retry loops can branch on it.
  const code = (err as { code?: string }).code;
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  ) {
    printError(`network: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(EXIT.NETWORK);
  }

  printError(err instanceof Error ? err.message : String(err));
  process.exit(EXIT.GENERIC);
}

function extractApiErrorDetail(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  // NestJS errors often shape as { message, error, statusCode } or with nested data.
  if (typeof b.message === 'string') return b.message;
  if (Array.isArray(b.message)) return (b.message as string[]).join('; ');
  const data = b.data as Record<string, unknown> | undefined;
  if (data && typeof data === 'object') {
    if (typeof data.message === 'string') return data.message;
    if (Array.isArray(data.message)) return (data.message as string[]).join('; ');
  }
  return null;
}

/** Detail-message-aware hints for known core/backend failure modes.
 *  Returns a focused troubleshooting pointer for patterns we've seen
 *  in the wild; otherwise null and the caller falls back to the
 *  generic per-status hint. */
function hintForDetail(detail: string | null): string | null {
  if (!detail) return null;
  // Core can return this when the governance workflow fails to start
  // before the gateway deadline. It is usually a deployment or workflow
  // health issue, not a caller-side payload validation error.
  if (detail.includes('failed to start workflow: context deadline exceeded')) {
    return (
      "Core's GovernanceWorkflow did not start before the gateway deadline. " +
      'Retry once with the same agent and a fresh workflow_id; if it repeats, ' +
      'check core and Temporal health for the target deployment before treating ' +
      'the verdict as a policy outcome.'
    );
  }
  // HTTP/2 stream reset between core and a downstream workflow service.
  if (detail.includes('stream terminated by RST_STREAM')) {
    return (
      'Workflow service RST_STREAM; likely downstream degradation rather than a policy result. ' +
      'Retry with backoff; if it persists, check the target deployment with the agent_id + governance_event_id.'
    );
  }
  // Core's fail-closed when OPA service is unreachable; the policy
  // result auto-converts to BLOCK with a governance-checks-incomplete marker. Useful
  // to call out so users don't think their policy "decided" to block.
  if (detail.includes('OPA unavailable')) {
    return (
      'OPA service was unreachable from core; the fail-closed security ' +
      "policy converted the verdict to BLOCK. The user's actual policy " +
      'never ran; fix the OPA service and retry.'
    );
  }
  return null;
}

function hintForStatus(status: number): string | null {
  switch (status) {
    case 401:
      return 'Auth failed; X-API-Key missing or revoked. Run `openbox auth set-api-key` (mint a key in the dashboard: Organization → API Keys) or `openbox doctor` to diagnose.';
    case 403:
      return 'Denied by the backend. Either the resource ID doesn\'t belong to your org/team, or your role lacks the required permission. Check `openbox auth permissions` and `openbox auth profile`.';
    case 404:
      return 'Resource not found. Check the ID (agent, team, org, etc.); list resources with the dashboard or `openbox api backend AgentController_getAgents`.';
    case 422:
      return 'Validation failed server-side. Inspect the detail field above for the exact field(s) the backend rejected.';
    case 500:
      return 'Backend error. If the detail message is opaque, check logs or escalate; this often indicates a bug or downstream service outage.';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Primitive validators
// ---------------------------------------------------------------------------

/** Canonical UUID body. Anchored via `UUID_RE` for "is this string a
 *  UUID" checks, unanchored via `UUID_RE_BODY` for "find a UUID inside
 *  a line of source" scans. Single source so both regex shapes track
 *  the same character class. */
export const UUID_PATTERN_BODY = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID_PATTERN_BODY}$`, 'i');

export function validateUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    block('invalid-uuid', `${label} must be a valid UUID. Got: ${JSON.stringify(value)}`, `Resolve from \`openbox auth profile\`, \`openbox api backend AgentController_getAgents\`, or the dashboard.`);
  }
  return value as string;
}

/** Same as validateUuid but for a `string[]` flag value; every entry
 *  must be a UUID. Used by spec-driven flags that take variadic UUIDs,
 *  such as `agent create --team t1 t2`. */
export function validateUuidList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    block('invalid-uuid', `${label} must be a list of UUIDs. Got: ${JSON.stringify(value)}`);
  }
  (value as unknown[]).forEach((v, i) => validateUuid(v, `${label}[${i}]`));
  return value as string[];
}

export function validateInt(
  value: unknown,
  label: string,
  opts: { min?: number; max?: number } = {},
): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    block('invalid-int', `${label} must be an integer. Got: ${JSON.stringify(value)}`);
  }
  if (opts.min != null && n < opts.min) {
    block('out-of-range', `${label} must be >= ${opts.min}. Got: ${n}`);
  }
  if (opts.max != null && n > opts.max) {
    block('out-of-range', `${label} must be <= ${opts.max}. Got: ${n}`);
  }
  return n;
}

export function validateEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    block(
      'invalid-enum',
      `${label} must be one of: ${allowed.join(', ')}. Got: ${JSON.stringify(value)}`,
      `Use one of the valid values listed above.`,
    );
  }
  return value as T;
}

// Catches obviously-bad --from/--to values locally instead of letting the
// backend silently return empty results for unparseable strings. Accepts ISO
// 8601 timestamps (YYYY-MM-DD, YYYY-MM-DDTHH:MM:SSZ, offsets, etc.); anything
// Date.parse can parse to a finite number.
export function validateIsoDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    block('invalid-date', `${label} must be an ISO 8601 date string. Got: ${JSON.stringify(value)}`);
  }
  const ms = Date.parse(value as string);
  if (!Number.isFinite(ms)) {
    block(
      'invalid-date',
      `${label} is not a valid ISO 8601 date. Got: ${JSON.stringify(value)}`,
      `Use formats like 2026-04-24, 2026-04-24T15:30:00Z, or 2026-04-24T15:30:00-07:00.`,
    );
  }
  return value as string;
}

// Pagination is threaded through every list command; this helper centralizes
// the parseInt+range check so a user passing `--page abc` gets a clean local
// error instead of leaking NaN into the backend query string. Commander's
// numeric defaults ('0'/'10') mean the opts fields are always strings when
// unset; `validateInt` accepts strings and converts.
//
// page: backend uses @Min(0) zero-indexed pagination.
// perPage: backend has no @Max; don't impose a client-side ceiling that
// silently rejects calls the server would accept.
export function parsePagination(opts: { page?: unknown; limit?: unknown }): {
  page: number;
  perPage: number;
} {
  return {
    page: validateInt(opts.page ?? '0', '--page', { min: 0 }),
    perPage: validateInt(opts.limit ?? '10', '--limit', { min: 1 }),
  };
}

// ---------------------------------------------------------------------------
// Guardrail validators
// ---------------------------------------------------------------------------

/** Numeric IDs match the live guardrails service registry. CLI aliases below. */
export const GUARDRAIL_TYPE_ALIASES: Record<string, string> = {
  '1': '1', pii: '1', pii_detection: '1',
  '2': '2', nsfw: '2', nsfw_detection: '2', content_safety: '2',
  '3': '3', toxicity: '3', toxicity_detection: '3',
  '4': '4', ban_list: '4', ban_words: '4',
  '5': '5', regex: '5', regex_match: '5',
};

export function validateGuardrailType(value: unknown): string {
  if (typeof value !== 'string') {
    block('invalid-guardrail-type', `--type must be a string. Got: ${JSON.stringify(value)}`);
  }
  const v = value.toLowerCase();
  const id = GUARDRAIL_TYPE_ALIASES[v];
  if (!id) {
    block(
      'invalid-guardrail-type',
      `Unknown guardrail type: "${value}". Valid: 1|pii, 2|nsfw, 3|toxicity, 4|ban_words, 5|regex.`,
      `Use a numeric ID (1-5) or one of the friendly aliases.`,
      'references/guardrails.md § "Numeric Type IDs"',
    );
  }
  return id;
}

export function validateStage(value: unknown): '0' | '1' {
  if (value !== '0' && value !== '1') {
    block(
      'invalid-stage',
      `--stage must be "0" (input / ActivityStarted) or "1" (output / ActivityCompleted). Got: ${JSON.stringify(value)}`,
      `"both" is silently ignored by the guardrails service; the guardrail will NEVER fire. Create two separate guardrails for input+output coverage.`,
      'references/guardrails.md § "Stage Gating + Event Pairing"',
    );
  }
  return value;
}

export function validateGuardrailParams(typeId: string, params: unknown): void {
  const p = (params ?? {}) as Record<string, unknown>;
  if (typeId === '4') {
    // ban_list; needs banned_words array
    const words = p.banned_words;
    if (!Array.isArray(words) || words.length === 0) {
      block(
        'ban-list-missing-banned-words',
        `Ban-list guardrail (type 4) requires a non-empty params.banned_words array.`,
        `Example: --json '{"params":{"banned_words":["password","secret"]}}'`,
        'references/guardrails.md § "Required Params Per Type"',
      );
    }
    if (!words.every((w) => typeof w === 'string' && w.length > 0)) {
      block('ban-list-bad-words', `params.banned_words must contain non-empty strings.`);
    }
  }
  if (typeId === '5') {
    // regex; needs regex: string
    const rx = p.regex;
    if (typeof rx !== 'string' || rx.length === 0) {
      block(
        'regex-missing-pattern',
        `Regex guardrail (type 5) requires params.regex as a non-empty string.`,
        `Example: --json '{"params":{"regex":"(drop|truncate)\\\\s+table","match_type":"search"}}'. Use alternation (|) for multiple patterns in one regex.`,
        'references/guardrails.md § "Required Params Per Type"',
      );
    }
    // Confirm it actually compiles as a JS RE; rough proxy for "will the Python service parse it."
    try { new RegExp(rx); } catch (e: any) {
      block('regex-invalid', `params.regex is not a valid regular expression: ${e.message}`);
    }
  }
}

/** Canonical activity_type strings emitted or recommended by the SDK. */
export const CANONICAL_ACTIVITY_TYPES = [...GENERATED_CANONICAL_ACTIVITY_TYPES] as readonly string[];

export function validateActivitiesConfig(_activities: unknown, _stage: '0' | '1'): void {
  // Compatibility no-op: backend/Core now apply guardrails by processing stage
  // and no longer use legacy settings.activities activity_type/fields_to_check
  // filters. Keep accepting the field so older configs and SDK callers do not
  // break while new guardrails omit it.
}

// ---------------------------------------------------------------------------
// Behavior rule validators
// ---------------------------------------------------------------------------

/** Every permission string the backend's `Permission` enum accepts;
 *  mirrors the spec's `Permission` union. Static-asserted below: if the
 *  generated `Permission` union ever drops/renames a value, the type
 *  check at the bottom of this block fires at `tsc --noEmit`. Bootstrap
 *  / installer / e2e tooling read this instead of hand-typing the list. */
export const ALL_PERMISSIONS = [
  'write:org', 'read:org',
  'create:user', 'read:user', 'update:user', 'delete:user',
  'create:agent', 'read:agent', 'update:agent', 'delete:agent',
  'create:team', 'read:team', 'update:team', 'delete:team',
  'create:webhook', 'read:webhook', 'update:webhook', 'delete:webhook',
  'create:api_key', 'read:api_key', 'update:api_key', 'delete:api_key',
  'manage:sso',
  'read:agent_session', 'manage:agent_session', 'read:agent_log',
  'create:agent_guardrail', 'read:agent_guardrail',
  'update:agent_guardrail', 'delete:agent_guardrail',
  'create:agent_policy', 'read:agent_policy',
  'update:agent_policy', 'delete:agent_policy',
  'create:agent_behavior_rule', 'read:agent_behavior_rule',
  'update:agent_behavior_rule', 'delete:agent_behavior_rule',
] as const;

// Compile-time check: every member of ALL_PERMISSIONS is in the
// generated `Permission` union. If the spec drops a value, the next
// line errors at typecheck.
type _Permission = NonNullable<
  import('../types/generated/backend.js').components['schemas']['CreateApiKeyDto']['permissions']
>[number];
const _permissionDriftCheck: readonly _Permission[] = ALL_PERMISSIONS;
void _permissionDriftCheck;

/** Permissions an org X-API-Key may hold. Backend's API-key creation
 *  excludes api_key CRUD + manage:sso to prevent self-escalation
 *  (api-key.constants.ts: API_KEY_EXCLUDED_PERMISSIONS). The spec
 *  doesn't currently express this narrower constraint - the
 *  CreateApiKeyDto.permissions field is typed as the FULL Permission
 *  union, but the runtime IsIn validator rejects the excluded set.
 *  Bootstrap + installer tooling mints keys against this list. */
const API_KEY_EXCLUDED_PERMISSIONS = new Set<string>([
  'create:api_key',
  'read:api_key',
  'update:api_key',
  'delete:api_key',
  'manage:sso',
]);
export const API_KEY_GRANTABLE_PERMISSIONS = ALL_PERMISSIONS.filter(
  (p) => !API_KEY_EXCLUDED_PERMISSIONS.has(p),
);

/** Behavior-rule trigger vocabulary — spec-driven (CANONICAL_SPAN.behaviorTriggers,
 *  from @spanContract); mirrors the live `BehaviorRuleTrigger` enum. */
export const BEHAVIOR_TRIGGER_ENUM = CANONICAL_SPAN.behaviorTriggers;

export function validateBehaviorTrigger(value: unknown): string {
  return validateEnum(value, BEHAVIOR_TRIGGER_ENUM, '--trigger');
}

export function validateBehaviorStates(value: unknown): string[] {
  let arr: unknown[];
  if (Array.isArray(value)) arr = value;
  else if (typeof value === 'string') arr = value.split(',').map((s) => s.trim()).filter(Boolean);
  else block('invalid-states', `--states must be a comma-separated list or array. Got: ${JSON.stringify(value)}`);
  if (arr.length === 0) block('empty-states', `--states must list at least one value.`);
  return arr.map((v) => validateEnum(v, BEHAVIOR_TRIGGER_ENUM, `--states entry`));
}

/** Verdict numeric: 0=ALLOW, 1=CONSTRAIN, 2=REQUIRE_APPROVAL, 3=BLOCK, 4=HALT. */
export function validateVerdict(value: unknown): number {
  const n = validateInt(value, '--verdict', { min: 0, max: 4 });
  return n;
}

export function validateApprovalTimeout(verdict: number, timeout: unknown): void {
  if (verdict === 2) {
    if (timeout == null || timeout === '') {
      block(
        'approval-timeout-required',
        `--verdict 2 (REQUIRE_APPROVAL) requires --approval-timeout <seconds>. Without it the backend returns 422.`,
        `Add --approval-timeout 300 (or another positive integer).`,
        'references/behaviors.md § "--verdict 2 Requires --approval-timeout"',
      );
    }
    validateInt(timeout, '--approval-timeout', { min: 1 });
  }
}

// ---------------------------------------------------------------------------
// Rego / policy validators
// ---------------------------------------------------------------------------

/**
 * Heuristic check that the rego source follows OpenBox's expected shape.
 * Core reads `result.decision` + `result.reason`; anything else silently allows.
 * We don't parse full Rego; we check for the result pattern and flag deny[msg] as a common bug.
 */
export function validateRegoSource(rego: string): void {
  if (typeof rego !== 'string' || rego.trim().length === 0) {
    block('rego-empty', `Rego source is empty. Provide --rego <code> or --rego-file <path>.`);
  }

  const src = rego;

  // Must have a package declaration (will be rewritten server-side but required for parsing).
  if (!/^\s*package\s+\S+/m.test(src)) {
    block(
      'rego-no-package',
      `Rego source must start with a "package …" declaration.`,
      `Add: package org.openbox_ai.my_policy  (the name is rewritten server-side; any valid identifier works).`,
      'references/rego-reference.md § "Policy Format"',
    );
  }

  // Must define result (default + at least one rule). Core's opa.go reads
  // result.decision / result.reason only; `deny[msg]` rules and any other
  // shape are ignored and the policy silently ALLOWs.
  const hasResult = /\bresult\s*(:=|=)\s*\{/.test(src);
  const hasDenyPattern = /\bdeny\s*\[/.test(src);
  if (!hasResult) {
    const denyHint = hasDenyPattern
      ? ` Looks like your policy uses the \`deny[msg]\` pattern; that's not what core reads. Rewrite as \`result := {"decision": "BLOCK", "reason": "<msg>"} if { <conditions> }\`.`
      : '';
    block(
      'rego-no-result',
      `Rego source must define \`result := {"decision": ..., "reason": ...}\`. Core reads only result.decision / result.reason; other shapes silently fall through to ALLOW.${denyHint}`,
      `Use the template in references/rego-reference.md § "Template".`,
      'references/rego-reference.md § "Policy Format"',
    );
  }

  // Decision values: core lowercases the string before switching, and accepts
  // several aliases:
  //   allow | continue          → ALLOW
  //   block                     → BLOCK
  //   halt | stop               → HALT
  //   require_approval | require-approval → REQUIRE_APPROVAL
  //   anything else → falls through to ALLOW silently
  // We accept the case-insensitive set and flag anything outside it.
  const acceptedDecisions = /^(allow|continue|block|stop|halt|require[_-]approval)$/i;
  const decisionMatches = [...src.matchAll(/"decision"\s*:\s*"([^"]+)"/g)];
  for (const m of decisionMatches) {
    const val = m[1];
    if (!acceptedDecisions.test(val)) {
      block(
        'rego-invalid-decision',
        `Rego rule uses unrecognized decision "${val}". Accepted values, case-insensitive: allow, continue, block, stop, halt, require_approval, require-approval. Convention is uppercase: ALLOW, BLOCK, HALT, REQUIRE_APPROVAL.`,
        `Unknown values such as "DENY", "REJECT", or "CONSTRAIN" silently fall through to ALLOW, so the policy does nothing.`,
        'references/rego-reference.md § "Policy Format"',
      );
    }
  }

  // Warn if the package name is specific enough that the user might think it matters.
  const pkgMatch = src.match(/^\s*package\s+(\S+)/m);
  if (pkgMatch) {
    const pkg = pkgMatch[1];
    if (!/^org\.openbox_ai\./.test(pkg) && !/^org\.[0-9a-z_]+\.policy_/.test(pkg)) {
      warn(
        `Package "${pkg}" will be rewritten server-side to \`org.<orgId>.policy_<policyId>\` by formatRegoCode(). The declared name is decorative; this is fine, just noting it so you don't expect the name to persist.`,
        'references/rego-reference.md § "Policy Format" (Package name is rewritten)',
      );
    }
  }
}
