/**
 * Setup-time validators. Job: reject any input that the OpenBox design says is broken,
 * before it hits the backend (where behavior is often silent or the error is opaque).
 *
 * Two levels:
 *   - block(...)  → throws ValidationError with actionable fix suggestion. Caller exits 2.
 *   - warn(...)   → prints to stderr and continues. For non-fatal drift (e.g., non-canonical
 *                   activity_type names that technically work but mismatch guardrail bindings).
 *
 * Every validator cites the source of truth (enum location, dto path, skill reference) in
 * its error message so operators know where to look.
 */

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

/** Print a warning to stderr. Non-fatal. */
export function warn(message: string, reference?: string): void {
  const ref = reference ? `  See ${reference}.` : '';
  console.error(`\x1b[33mwarn:\x1b[0m ${message}${ref}`);
}

/** Block with a hard error. Caller exits with code 2 (user-input error). */
export function block(rule: string, message: string, fix?: string, reference?: string): never {
  throw new ValidationError(rule, message, fix, reference);
}

export function reportAndExit(err: unknown): never {
  if (err instanceof ValidationError) {
    console.error(`\x1b[31merror:\x1b[0m ${err.message}`);
    if (err.fix) console.error(`  fix: ${err.fix}`);
    if (err.reference) console.error(`  see: ${err.reference}`);
    process.exit(2);
  }
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Primitive validators
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    block('invalid-uuid', `${label} must be a valid UUID. Got: ${JSON.stringify(value)}`, `Resolve from \`openbox auth profile\` or \`openbox agent list\`.`);
  }
  return value as string;
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

// ---------------------------------------------------------------------------
// Guardrail validators
// ---------------------------------------------------------------------------

/** Source of truth: openbox-guardrails/src/guardrails/__init__.py GUARDRAILS_MAP + CLI alias table. */
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
      `"both" is silently ignored by the guardrails service - the guardrail will NEVER fire. Create two separate guardrails for input+output coverage.`,
      'references/guardrails.md § "Stage Gating + Event Pairing"',
    );
  }
  return value;
}

export function validateGuardrailParams(typeId: string, params: unknown): void {
  const p = (params ?? {}) as Record<string, unknown>;
  if (typeId === '4') {
    // ban_list - needs banned_words array
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
    // regex - needs regex: string
    const rx = p.regex;
    if (typeof rx !== 'string' || rx.length === 0) {
      block(
        'regex-missing-pattern',
        `Regex guardrail (type 5) requires params.regex as a non-empty string.`,
        `Example: --json '{"params":{"regex":"(drop|truncate)\\\\s+table","match_type":"search"}}'. Use alternation (|) for multiple patterns in one regex.`,
        'references/guardrails.md § "Required Params Per Type"',
      );
    }
    // Confirm it actually compiles as a JS RE - rough proxy for "will the Python service parse it."
    try { new RegExp(rx); } catch (e: any) {
      block('regex-invalid', `params.regex is not a valid regular expression: ${e.message}`);
    }
  }
}

/** Canonical `activity_type` strings used by first-party SDKs. Non-canonical names won't match guardrail bindings. */
export const CANONICAL_ACTIVITY_TYPES = [
  'PromptSubmission',
  'LLMCompleted',
  'ToolCompleted',
  'FileRead',
  'FileEdit',
  'FileDelete',
  'ShellExecution',
  'HTTPRequest',
  'MCPToolCall',
  'AgentSpawn',
  'ActivityCompleted',
  'DefaultActivity',  // SDK default
] as const;

export function validateActivitiesConfig(activities: unknown, stage: '0' | '1'): void {
  if (!Array.isArray(activities) || activities.length === 0) {
    block(
      'activities-empty',
      `settings.activities[] must be a non-empty array. Each entry binds the guardrail to a specific activity_type.`,
      `Example: '{"settings":{"activities":[{"activity_type":"PromptSubmission","fields_to_check":["input.*.prompt"]}]}}'`,
      'references/guardrails.md § "settings Shape"',
    );
  }
  const expectedPrefix = stage === '0' ? 'input' : 'output';
  for (let i = 0; i < activities.length; i++) {
    const a = activities[i] as Record<string, unknown>;
    if (!a.activity_type || typeof a.activity_type !== 'string') {
      block('activity-missing-type', `settings.activities[${i}].activity_type is required (string).`);
    }
    if (!(CANONICAL_ACTIVITY_TYPES as readonly string[]).includes(a.activity_type)) {
      warn(
        `settings.activities[${i}].activity_type "${a.activity_type}" is non-canonical. First-party SDKs use past-tense PascalCase (${CANONICAL_ACTIVITY_TYPES.slice(0, 4).join(', ')}, ...). If your client sends a different string, this is fine - but inventions like "LLMCompletion" won't match actual SDK events.`,
        'references/guardrails.md § "activity_type Matching"',
      );
    }
    if (!Array.isArray(a.fields_to_check) || a.fields_to_check.length === 0) {
      block('activity-missing-fields', `settings.activities[${i}].fields_to_check is required (non-empty string array).`);
    }
    for (const path of a.fields_to_check as string[]) {
      if (typeof path !== 'string' || path.length === 0) {
        block('fields-to-check-bad', `settings.activities[${i}].fields_to_check entries must be non-empty strings.`);
      }
      if (!path.startsWith(expectedPrefix + '.') && path !== expectedPrefix) {
        block(
          'fields-to-check-wrong-prefix',
          `fields_to_check path "${path}" doesn't match the stage. Stage ${stage} requires paths starting with "${expectedPrefix}." - the guardrails service silently drops paths without the correct prefix.`,
          `Rename to "${expectedPrefix}.<field>" or switch stage. Stage 0 fires on ActivityStarted (input), stage 1 on ActivityCompleted (output).`,
          'references/guardrails.md § "Field Path Prefixes"',
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Behavior rule validators
// ---------------------------------------------------------------------------

/** Source of truth: openbox-backend/src/modules/agent/entities/agent-behavior-rule.entity.ts enum BehaviorRuleTrigger. */
export const BEHAVIOR_TRIGGER_ENUM = [
  'http_get', 'http_post', 'http_put', 'http_patch', 'http_delete', 'http',
  'llm_completion', 'llm_embedding', 'llm_tool_call',
  'database_select', 'database_insert', 'database_update', 'database_delete', 'database_query',
  'file_read', 'file_write', 'file_open', 'file_delete',
  'internal',
] as const;

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
 * Core reads `result.decision` + `result.reason` - anything else silently allows.
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
      `Add: package org.openbox_ai.my_policy  (the name is rewritten server-side - any valid identifier works).`,
      'references/rego-reference.md § "Policy Format"',
    );
  }

  // Should define result (default + at least one rule).
  const hasResult = /\bresult\s*(:=|=)\s*\{/.test(src);
  const hasDenyPattern = /\bdeny\s*\[/.test(src);
  if (!hasResult) {
    block(
      'rego-no-result',
      `Rego source must define \`result := {"decision": ..., "reason": ...}\`. Core reads result.decision / result.reason; other shapes silently ALLOW.`,
      `Use the template in references/rego-reference.md § "Template".`,
      'references/rego-reference.md § "Policy Format"',
    );
  }
  if (hasDenyPattern && !hasResult) {
    block(
      'rego-uses-deny-msg',
      `Your Rego uses \`deny[msg]\` pattern. OpenBox's OPA evaluator reads result.decision + result.reason only - \`deny[msg]\` rules are ignored and the policy silently ALLOWs.`,
      `Rewrite as \`result := {"decision": "BLOCK", "reason": "<msg>"} if { <conditions> }\`.`,
      'references/rego-reference.md § "Policy Format"',
    );
  }

  // decision values must be uppercase ALLOW/REQUIRE_APPROVAL/BLOCK/HALT.
  const decisionMatches = [...src.matchAll(/"decision"\s*:\s*"([^"]+)"/g)];
  for (const m of decisionMatches) {
    const val = m[1];
    if (!/^(ALLOW|REQUIRE_APPROVAL|BLOCK|HALT)$/.test(val)) {
      block(
        'rego-invalid-decision',
        `Rego rule uses invalid decision "${val}". Valid decisions: ALLOW | REQUIRE_APPROVAL | BLOCK | HALT (uppercase, exact).`,
        `Lowercase variants or invented names (DENY, REJECT, CONSTRAIN, etc.) are not recognized and silently fall through to ALLOW.`,
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
        `Package "${pkg}" will be rewritten server-side to \`org.<orgId>.policy_<policyId>\` by formatRegoCode(). The declared name is decorative - this is fine, just noting it so you don't expect the name to persist.`,
        'references/rego-reference.md § "Policy Format" (Package name is rewritten)',
      );
    }
  }
}
