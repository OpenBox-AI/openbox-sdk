var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};

// ts/src/cli/non-interactive.ts
function argv() {
  return argvOverride ?? process.argv;
}
function useColor() {
  if (process.env.NO_COLOR && process.env.NO_COLOR !== "") return false;
  if (process.env.OPENBOX_NO_COLOR && process.env.OPENBOX_NO_COLOR !== "0") return false;
  const a = argv();
  if (a.includes("--no-color")) return false;
  if (process.env.CI && process.env.CI !== "0" && process.env.CI !== "false") return false;
  return process.stdout.isTTY === true;
}
function isJsonMode() {
  const a = argv();
  return a.includes("--json");
}
function isMachineMode() {
  if (isJsonMode()) return true;
  return !process.stdout.isTTY;
}
var argvOverride;
var init_non_interactive = __esm({
  "ts/src/cli/non-interactive.ts"() {
    "use strict";
    argvOverride = null;
  }
});

// ts/src/cli/colors.ts
function wrap(code, s) {
  if (!useColor()) return s;
  return `\x1B[${code}m${s}\x1B[0m`;
}
var CODES, color;
var init_colors = __esm({
  "ts/src/cli/colors.ts"() {
    "use strict";
    init_non_interactive();
    CODES = {
      red: "31",
      green: "32",
      yellow: "33",
      blue: "34",
      magenta: "35",
      cyan: "36",
      bold: "1",
      dim: "2"
    };
    color = {
      red: (s) => wrap(CODES.red, s),
      green: (s) => wrap(CODES.green, s),
      yellow: (s) => wrap(CODES.yellow, s),
      blue: (s) => wrap(CODES.blue, s),
      magenta: (s) => wrap(CODES.magenta, s),
      cyan: (s) => wrap(CODES.cyan, s),
      bold: (s) => wrap(CODES.bold, s),
      dim: (s) => wrap(CODES.dim, s)
    };
  }
});

// ts/src/cli/output.ts
function emitTrailer(label, value) {
  const lines = value.split("\n");
  const head = `${label}: ${lines[0]}`;
  console.error(head);
  for (let i = 1; i < lines.length; i++) {
    console.error(`${TRAILER_INDENT}${lines[i]}`);
  }
}
function error(message, opts = {}) {
  const msg = message.replace(/\.\s*$/, "");
  if (isMachineMode()) {
    const payload = { message: msg };
    if (opts.detail) payload.detail = opts.detail;
    if (opts.help) payload.help = opts.help;
    if (opts.hint) payload.hint = opts.hint;
    if (opts.see) payload.see = opts.see;
    console.error(JSON.stringify({ error: payload }));
    return;
  }
  console.error(`${color.red("error:")} ${msg}`);
  if (opts.detail || opts.help || opts.hint || opts.see) {
    console.error("");
  }
  if (opts.detail) emitTrailer("detail", opts.detail);
  if (opts.help) emitTrailer("help", opts.help);
  if (opts.hint) emitTrailer("hint", opts.hint);
  if (opts.see) emitTrailer("see", opts.see);
}
function warn(message, reference) {
  if (isMachineMode()) return;
  const msg = message.replace(/\.\s*$/, "");
  console.error(`${color.yellow("warn:")} ${msg}`);
  if (reference) console.error(`see: ${reference}`);
}
var TRAILER_INDENT, STATUS_COLORS;
var init_output = __esm({
  "ts/src/cli/output.ts"() {
    "use strict";
    init_colors();
    init_non_interactive();
    TRAILER_INDENT = "      ";
    STATUS_COLORS = {
      ok: color.green,
      installed: color.green,
      skipped: color.yellow,
      failed: color.red,
      "would-install": color.cyan,
      "would-remove": color.cyan,
      unchanged: color.dim,
      pass: color.green,
      warn: color.yellow,
      fail: color.red,
      removed: color.green
    };
  }
});

// ts/src/validators/input.ts
import { readFileSync } from "fs";
function parseJsonInput(value) {
  if (value === "-") {
    const chunks = [];
    const fd = __require("fs").openSync("/dev/stdin", "r");
    const buf = Buffer.alloc(4096);
    let n;
    while ((n = __require("fs").readSync(fd, buf)) > 0) {
      chunks.push(buf.subarray(0, n));
    }
    __require("fs").closeSync(fd);
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  }
  if (value.startsWith("@")) {
    const filePath = value.slice(1);
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  }
  return JSON.parse(value);
}

// ts/src/cli/exit-codes.ts
var EXIT = {
  /** Success. */
  OK: 0,
  /** Generic / uncategorized failure. Last resort. */
  GENERIC: 1,
  /** Usage / argv validation error. Commander's default for missing
   *  required option, unknown flag, etc. We follow that convention. */
  USAGE: 2,
  /** Auth failure; 401, 403, missing tokens, expired session. */
  AUTH: 3,
  /** Required feature flag disabled for the active env. */
  FEATURE_DISABLED: 4,
  /** Resource not found; 404. */
  NOT_FOUND: 5,
  /** Conflict; 409 (already-exists, version mismatch, etc.). */
  CONFLICT: 6,
  /** Rate-limited; 429. Caller MAY retry with backoff. */
  RATE_LIMIT: 7,
  /** Server-side failure; 5xx. Caller MAY retry. */
  SERVER: 8,
  /** Network / transport failure (DNS, ECONNREFUSED, timeout). Retryable. */
  NETWORK: 9
};
function exitCodeForStatus(status) {
  if (status === 401) return EXIT.AUTH;
  if (status === 403) return EXIT.AUTH;
  if (status === 404) return EXIT.NOT_FOUND;
  if (status === 409) return EXIT.CONFLICT;
  if (status === 429) return EXIT.RATE_LIMIT;
  if (status >= 500) return EXIT.SERVER;
  return EXIT.GENERIC;
}
function isRetryable(code) {
  return code === EXIT.RATE_LIMIT || code === EXIT.SERVER || code === EXIT.NETWORK;
}
function bailWith(code) {
  process.exit(code);
}

// ts/src/validators/index.ts
init_output();
var ValidationError = class extends Error {
  constructor(rule, message, fix, reference) {
    super(message);
    this.rule = rule;
    this.fix = fix;
    this.reference = reference;
    this.name = "ValidationError";
  }
  rule;
  fix;
  reference;
};
function block(rule, message, fix, reference) {
  throw new ValidationError(rule, message, fix, reference);
}
function reportAndExit(err) {
  if (err instanceof Error && err.name === "DestructiveConfirmRequiredError") {
    error(err.message);
    process.exit(EXIT.USAGE);
  }
  if (err instanceof ValidationError) {
    error(err.message, {
      help: err.fix,
      see: err.reference
    });
    process.exit(EXIT.USAGE);
  }
  const apiErr = err;
  if (apiErr && (apiErr.name === "OpenBoxApiError" || apiErr.name === "CoreApiError") && typeof apiErr.status === "number") {
    const detail = extractApiErrorDetail(apiErr.body);
    const hint = hintForDetail(detail) ?? hintForStatus(apiErr.status);
    error(apiErr.message ?? "request failed", {
      detail: detail ?? void 0,
      hint: hint ?? void 0
    });
    process.exit(exitCodeForStatus(apiErr.status));
  }
  const code = err.code;
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT" || code === "ECONNRESET" || code === "UND_ERR_SOCKET" || code === "UND_ERR_CONNECT_TIMEOUT") {
    error(`network: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(EXIT.NETWORK);
  }
  error(err instanceof Error ? err.message : String(err));
  process.exit(EXIT.GENERIC);
}
function extractApiErrorDetail(body) {
  if (!body || typeof body !== "object") return null;
  const b = body;
  if (typeof b.message === "string") return b.message;
  if (Array.isArray(b.message)) return b.message.join("; ");
  const data = b.data;
  if (data && typeof data === "object") {
    if (typeof data.message === "string") return data.message;
    if (Array.isArray(data.message)) return data.message.join("; ");
  }
  return null;
}
function hintForDetail(detail) {
  if (!detail) return null;
  if (detail.includes("failed to start workflow: context deadline exceeded")) {
    return "Core's GovernanceWorkflow is hanging on the post-OPA non-ALLOW path (staging-only bug, image 591f66f+). To confirm vs random Temporal flake, send an `evaluateGovernance` payload against the same agent; if the ALLOW path returns <1s but shell/file-write (or any path that triggers a non-ALLOW verdict) hangs 30s, this is the cccff05 cancellation deadlock. Pivot to prod for end-to-end approval testing until the staging fix lands.";
  }
  if (detail.includes("stream terminated by RST_STREAM")) {
    return "Temporal frontend RST_STREAM; cluster degradation rather than a workflow bug. Retry with backoff; if it persists, escalate to staging-infra with the agent_id + governance_event_id.";
  }
  if (detail.includes("OPA unavailable")) {
    return "OPA service was unreachable from core; the fail-closed security policy converted the verdict to BLOCK. The user's actual policy never ran; fix the OPA service and retry.";
  }
  return null;
}
function hintForStatus(status) {
  switch (status) {
    case 401:
      return "Auth failed; X-API-Key missing or revoked. Run `openbox auth set-api-key` (mint a key in the dashboard: Organization \u2192 API Keys) or `openbox doctor` to diagnose.";
    case 403:
      return "Denied by the backend. Either the resource ID doesn't belong to your org/team, or your role lacks the required permission. Check `openbox auth permissions` and `openbox auth profile`.";
    case 404:
      return "Resource not found. Check the ID (agent, team, org, etc.); list resources with the dashboard or `openbox api backend AgentController_getAgents`.";
    case 422:
      return "Validation failed server-side. Inspect the detail field above for the exact field(s) the backend rejected.";
    case 500:
      return "Backend error. If the detail message is opaque, check logs or escalate; this often indicates a bug or downstream service outage.";
    default:
      return null;
  }
}
var UUID_PATTERN_BODY = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
var UUID_RE = new RegExp(`^${UUID_PATTERN_BODY}$`, "i");
function validateUuid(value, label) {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    block("invalid-uuid", `${label} must be a valid UUID. Got: ${JSON.stringify(value)}`, `Resolve from \`openbox auth profile\`, \`openbox api backend AgentController_getAgents\`, or the dashboard.`);
  }
  return value;
}
function validateUuidList(value, label) {
  if (!Array.isArray(value)) {
    block("invalid-uuid", `${label} must be a list of UUIDs. Got: ${JSON.stringify(value)}`);
  }
  value.forEach((v, i) => validateUuid(v, `${label}[${i}]`));
  return value;
}
function validateInt(value, label, opts = {}) {
  const n = typeof value === "string" ? parseInt(value, 10) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    block("invalid-int", `${label} must be an integer. Got: ${JSON.stringify(value)}`);
  }
  if (opts.min != null && n < opts.min) {
    block("out-of-range", `${label} must be >= ${opts.min}. Got: ${n}`);
  }
  if (opts.max != null && n > opts.max) {
    block("out-of-range", `${label} must be <= ${opts.max}. Got: ${n}`);
  }
  return n;
}
function validateEnum(value, allowed, label) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    block(
      "invalid-enum",
      `${label} must be one of: ${allowed.join(", ")}. Got: ${JSON.stringify(value)}`,
      `Use one of the valid values listed above.`
    );
  }
  return value;
}
function validateIsoDate(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    block("invalid-date", `${label} must be an ISO 8601 date string. Got: ${JSON.stringify(value)}`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    block(
      "invalid-date",
      `${label} is not a valid ISO 8601 date. Got: ${JSON.stringify(value)}`,
      `Use formats like 2026-04-24, 2026-04-24T15:30:00Z, or 2026-04-24T15:30:00-07:00.`
    );
  }
  return value;
}
function parsePagination(opts) {
  return {
    page: validateInt(opts.page ?? "0", "--page", { min: 0 }),
    perPage: validateInt(opts.limit ?? "10", "--limit", { min: 1 })
  };
}
var GUARDRAIL_TYPE_ALIASES = {
  "1": "1",
  pii: "1",
  pii_detection: "1",
  "2": "2",
  nsfw: "2",
  nsfw_detection: "2",
  content_safety: "2",
  "3": "3",
  toxicity: "3",
  toxicity_detection: "3",
  "4": "4",
  ban_list: "4",
  ban_words: "4",
  "5": "5",
  regex: "5",
  regex_match: "5"
};
function validateGuardrailType(value) {
  if (typeof value !== "string") {
    block("invalid-guardrail-type", `--type must be a string. Got: ${JSON.stringify(value)}`);
  }
  const v = value.toLowerCase();
  const id = GUARDRAIL_TYPE_ALIASES[v];
  if (!id) {
    block(
      "invalid-guardrail-type",
      `Unknown guardrail type: "${value}". Valid: 1|pii, 2|nsfw, 3|toxicity, 4|ban_words, 5|regex.`,
      `Use a numeric ID (1-5) or one of the friendly aliases.`,
      'references/guardrails.md \xA7 "Numeric Type IDs"'
    );
  }
  return id;
}
function validateStage(value) {
  if (value !== "0" && value !== "1") {
    block(
      "invalid-stage",
      `--stage must be "0" (input / ActivityStarted) or "1" (output / ActivityCompleted). Got: ${JSON.stringify(value)}`,
      `"both" is silently ignored by the guardrails service; the guardrail will NEVER fire. Create two separate guardrails for input+output coverage.`,
      'references/guardrails.md \xA7 "Stage Gating + Event Pairing"'
    );
  }
  return value;
}
function validateGuardrailParams(typeId, params) {
  const p = params ?? {};
  if (typeId === "4") {
    const words = p.banned_words;
    if (!Array.isArray(words) || words.length === 0) {
      block(
        "ban-list-missing-banned-words",
        `Ban-list guardrail (type 4) requires a non-empty params.banned_words array.`,
        `Example: --json '{"params":{"banned_words":["password","secret"]}}'`,
        'references/guardrails.md \xA7 "Required Params Per Type"'
      );
    }
    if (!words.every((w) => typeof w === "string" && w.length > 0)) {
      block("ban-list-bad-words", `params.banned_words must contain non-empty strings.`);
    }
  }
  if (typeId === "5") {
    const rx = p.regex;
    if (typeof rx !== "string" || rx.length === 0) {
      block(
        "regex-missing-pattern",
        `Regex guardrail (type 5) requires params.regex as a non-empty string.`,
        `Example: --json '{"params":{"regex":"(drop|truncate)\\\\s+table","match_type":"search"}}'. Use alternation (|) for multiple patterns in one regex.`,
        'references/guardrails.md \xA7 "Required Params Per Type"'
      );
    }
    try {
      new RegExp(rx);
    } catch (e) {
      block("regex-invalid", `params.regex is not a valid regular expression: ${e.message}`);
    }
  }
}
var CANONICAL_ACTIVITY_TYPES = [
  "PromptSubmission",
  "LLMCompleted",
  "ToolCompleted",
  "FileRead",
  "FileEdit",
  "FileDelete",
  "ShellExecution",
  "HTTPRequest",
  "MCPToolCall",
  "MCPToolResponse",
  // runtime/cursor
  "AgentResponse",
  // runtime/cursor
  "AgentThinking",
  // runtime/cursor
  "ShellOutput",
  // runtime/cursor
  "AgentSpawn",
  // runtime/claude-code
  "ClaudeCodeSession",
  // runtime/claude-code session marker
  "CursorSession",
  // runtime/cursor session marker
  "DefaultActivity"
  // openbox-sdk default; will not match specific-type guardrails. Override via config.activityType.
];
function validateActivitiesConfig(activities, stage) {
  if (!Array.isArray(activities) || activities.length === 0) {
    block(
      "activities-empty",
      `settings.activities[] must be a non-empty array. Each entry binds the guardrail to a specific activity_type.`,
      `Example: '{"settings":{"activities":[{"activity_type":"PromptSubmission","fields_to_check":["input.*.prompt"]}]}}'`,
      'references/guardrails.md \xA7 "settings Shape"'
    );
  }
  const expectedPrefix = stage === "0" ? "input" : "output";
  for (let i = 0; i < activities.length; i++) {
    const a = activities[i];
    if (!a.activity_type || typeof a.activity_type !== "string") {
      block("activity-missing-type", `settings.activities[${i}].activity_type is required (string).`);
    }
    if (!CANONICAL_ACTIVITY_TYPES.includes(a.activity_type)) {
      warn(
        `settings.activities[${i}].activity_type "${a.activity_type}" is non-canonical. First-party SDKs use past-tense PascalCase (${CANONICAL_ACTIVITY_TYPES.slice(0, 4).join(", ")}, ...). If your client sends a different string, this is fine; but inventions like "LLMCompletion" won't match actual SDK events.`,
        'references/guardrails.md \xA7 "activity_type Matching"'
      );
    }
    if (!Array.isArray(a.fields_to_check) || a.fields_to_check.length === 0) {
      block("activity-missing-fields", `settings.activities[${i}].fields_to_check is required (non-empty string array).`);
    }
    for (const path of a.fields_to_check) {
      if (typeof path !== "string" || path.length === 0) {
        block("fields-to-check-bad", `settings.activities[${i}].fields_to_check entries must be non-empty strings.`);
      }
      if (!path.startsWith(expectedPrefix + ".") && path !== expectedPrefix) {
        block(
          "fields-to-check-wrong-prefix",
          `fields_to_check path "${path}" doesn't match the stage. Stage ${stage} requires paths starting with "${expectedPrefix}."; the guardrails service silently drops paths without the correct prefix.`,
          `Rename to "${expectedPrefix}.<field>" or switch stage. Stage 0 fires on ActivityStarted (input), stage 1 on ActivityCompleted (output).`,
          'references/guardrails.md \xA7 "Field Path Prefixes"'
        );
      }
    }
  }
}
var ALL_PERMISSIONS = [
  "write:org",
  "read:org",
  "create:user",
  "read:user",
  "update:user",
  "delete:user",
  "create:agent",
  "read:agent",
  "update:agent",
  "delete:agent",
  "create:team",
  "read:team",
  "update:team",
  "delete:team",
  "create:webhook",
  "read:webhook",
  "update:webhook",
  "delete:webhook",
  "create:api_key",
  "read:api_key",
  "update:api_key",
  "delete:api_key",
  "manage:sso",
  "read:agent_session",
  "manage:agent_session",
  "read:agent_log",
  "create:agent_guardrail",
  "read:agent_guardrail",
  "update:agent_guardrail",
  "delete:agent_guardrail",
  "create:agent_policy",
  "read:agent_policy",
  "update:agent_policy",
  "delete:agent_policy",
  "create:agent_behavior_rule",
  "read:agent_behavior_rule",
  "update:agent_behavior_rule",
  "delete:agent_behavior_rule"
];
var API_KEY_EXCLUDED_PERMISSIONS = /* @__PURE__ */ new Set([
  "create:api_key",
  "read:api_key",
  "update:api_key",
  "delete:api_key",
  "manage:sso"
]);
var API_KEY_GRANTABLE_PERMISSIONS = ALL_PERMISSIONS.filter(
  (p) => !API_KEY_EXCLUDED_PERMISSIONS.has(p)
);
var BEHAVIOR_TRIGGER_ENUM = [
  "http_get",
  "http_post",
  "http_put",
  "http_patch",
  "http_delete",
  "http",
  "llm_completion",
  "llm_embedding",
  "llm_tool_call",
  "database_select",
  "database_insert",
  "database_update",
  "database_delete",
  "database_query",
  "file_read",
  "file_write",
  "file_open",
  "file_delete",
  "internal"
];
function validateBehaviorTrigger(value) {
  return validateEnum(value, BEHAVIOR_TRIGGER_ENUM, "--trigger");
}
function validateBehaviorStates(value) {
  let arr;
  if (Array.isArray(value)) arr = value;
  else if (typeof value === "string") arr = value.split(",").map((s) => s.trim()).filter(Boolean);
  else block("invalid-states", `--states must be a comma-separated list or array. Got: ${JSON.stringify(value)}`);
  if (arr.length === 0) block("empty-states", `--states must list at least one value.`);
  return arr.map((v) => validateEnum(v, BEHAVIOR_TRIGGER_ENUM, `--states entry`));
}
function validateVerdict(value) {
  const n = validateInt(value, "--verdict", { min: 0, max: 4 });
  return n;
}
function validateApprovalTimeout(verdict, timeout) {
  if (verdict === 2) {
    if (timeout == null || timeout === "") {
      block(
        "approval-timeout-required",
        `--verdict 2 (REQUIRE_APPROVAL) requires --approval-timeout <seconds>. Without it the backend returns 422.`,
        `Add --approval-timeout 300 (or another positive integer).`,
        'references/behaviors.md \xA7 "--verdict 2 Requires --approval-timeout"'
      );
    }
    validateInt(timeout, "--approval-timeout", { min: 1 });
  }
}
function validateRegoSource(rego) {
  if (typeof rego !== "string" || rego.trim().length === 0) {
    block("rego-empty", `Rego source is empty. Provide --rego <code> or --rego-file <path>.`);
  }
  const src = rego;
  if (!/^\s*package\s+\S+/m.test(src)) {
    block(
      "rego-no-package",
      `Rego source must start with a "package \u2026" declaration.`,
      `Add: package org.openbox_ai.my_policy  (the name is rewritten server-side; any valid identifier works).`,
      'references/rego-reference.md \xA7 "Policy Format"'
    );
  }
  const hasResult = /\bresult\s*(:=|=)\s*\{/.test(src);
  const hasDenyPattern = /\bdeny\s*\[/.test(src);
  if (!hasResult) {
    const denyHint = hasDenyPattern ? ` Looks like your policy uses the \`deny[msg]\` pattern; that's not what core reads. Rewrite as \`result := {"decision": "BLOCK", "reason": "<msg>"} if { <conditions> }\`.` : "";
    block(
      "rego-no-result",
      `Rego source must define \`result := {"decision": ..., "reason": ...}\`. Core reads only result.decision / result.reason; other shapes silently fall through to ALLOW.${denyHint}`,
      `Use the template in references/rego-reference.md \xA7 "Template".`,
      'references/rego-reference.md \xA7 "Policy Format"'
    );
  }
  const acceptedDecisions = /^(allow|continue|block|stop|halt|require[_-]approval)$/i;
  const decisionMatches = [...src.matchAll(/"decision"\s*:\s*"([^"]+)"/g)];
  for (const m of decisionMatches) {
    const val = m[1];
    if (!acceptedDecisions.test(val)) {
      block(
        "rego-invalid-decision",
        `Rego rule uses unrecognized decision "${val}". Accepted values, case-insensitive: allow, continue, block, stop, halt, require_approval, require-approval. Convention is uppercase: ALLOW, BLOCK, HALT, REQUIRE_APPROVAL.`,
        `Unknown values such as "DENY", "REJECT", or "CONSTRAIN" silently fall through to ALLOW, so the policy does nothing.`,
        'references/rego-reference.md \xA7 "Policy Format"'
      );
    }
  }
  const pkgMatch = src.match(/^\s*package\s+(\S+)/m);
  if (pkgMatch) {
    const pkg = pkgMatch[1];
    if (!/^org\.openbox_ai\./.test(pkg) && !/^org\.[0-9a-z_]+\.policy_/.test(pkg)) {
      warn(
        `Package "${pkg}" will be rewritten server-side to \`org.<orgId>.policy_<policyId>\` by formatRegoCode(). The declared name is decorative; this is fine, just noting it so you don't expect the name to persist.`,
        'references/rego-reference.md \xA7 "Policy Format" (Package name is rewritten)'
      );
    }
  }
}
export {
  ALL_PERMISSIONS,
  API_KEY_GRANTABLE_PERMISSIONS,
  BEHAVIOR_TRIGGER_ENUM,
  CANONICAL_ACTIVITY_TYPES,
  EXIT,
  GUARDRAIL_TYPE_ALIASES,
  UUID_PATTERN_BODY,
  ValidationError,
  bailWith,
  block,
  exitCodeForStatus,
  isRetryable,
  parseJsonInput,
  parsePagination,
  reportAndExit,
  validateActivitiesConfig,
  validateApprovalTimeout,
  validateBehaviorStates,
  validateBehaviorTrigger,
  validateEnum,
  validateGuardrailParams,
  validateGuardrailType,
  validateInt,
  validateIsoDate,
  validateRegoSource,
  validateStage,
  validateUuid,
  validateUuidList,
  validateVerdict,
  warn
};
