// specs/typespec/cli/main.tsp; language-agnostic protocol of the
// `openbox` binary. The TS implementation today (ts/cli/src/) is
// hand-written via commander; this file documents the contract it
// satisfies and is what every language's CLI emitter (commander /
// clap / cobra / click) lowers from.
//
// One @cli_command per top-level verb, with sub-commands mounted
// either as nested interfaces or methods on the same interface.
// The surface-area sketch is here; not every existing
// command is wired yet. The vertical slice that proves the pipeline
// is `auth` (login / logout / profile) because it exercises every
// decorator: env-var-backed input, token-format validation, and an
// OS path for the on-disk store.

// Note: programming-model spec, not an HTTP API; see govern/main.tsp
// for the rationale behind not using `@service` here.

import "typespec-cli";
import "typespec-env";

using OpenBox.Cli;
using OpenBox.Env;

namespace OpenboxCli;

// ---------------------------------------------------------------------------
// Shared models
// ---------------------------------------------------------------------------

enum EnvFlag {
  production: "production",
  staging: "staging",
  local: "local",
}

// ---------------------------------------------------------------------------
// `openbox auth` command group; manages an org-level X-API-Key on disk.
// JWT/Keycloak login lives in the dashboard FE; CLI consumes a key minted
// there. The SDK still supports Bearer JWT for non-CLI consumers (mobile,
// SSO flows); the contract here is CLI-specific.
// ---------------------------------------------------------------------------

@cli_command(
  "auth",
  "Manage the local X-API-Key store for backend auth."
)
@cli_maturity("stable")
interface Auth {
  /**
   * Persist an org-level X-API-Key (`obx_key_<48hex>`) for the active
   * env. CLI uses this key on every backend request via the X-API-Key
   * header; mint keys via the dashboard FE (Organization → API Keys).
   */
  @cli_local_only
  @cli_output_kind("custom")
  setApiKey(): void;

  /** Drop the saved X-API-Key for the current env. */
  @cli_local_only
  @cli_destructive
  @cli_output_kind("custom")
  clearApiKey(): void;

  /** Print the active auth state (api-key present / none) per env. */
  @cli_local_only
  @cli_output_kind("custom")
  status(): void;

  /** Fetch /auth/profile for the active env. Returns the authenticated
   *  principal: orgId, sub, permissions, and (for X-API-Key auth)
   *  isApiKeyAuth=true with the api-key id encoded in `sub`. */
  @cli_output_kind("custom")
  profile(): void;

  /** Print the authenticated principal's permission set. Equivalent to
   *  `auth profile | jq .permissions`; convenience for permission
   *  pre-flight checks in scripts. */
  @cli_output_kind("custom")
  permissions(): void;
}

@cli_command(
  "config",
  "Persistent CLI config (URL overrides, default flags). Two scopes: per-env (default; keyed off the active --env) and global (--global, applies across all envs). Layered into process.env at startup; explicit shell exports always win. File: <data-root>/config (mode 0o600)."
)
@cli_maturity("experimental")
interface Config {
  /**
   * Persist a config value. Defaults to per-env scope (keyed off
   * the active --env / OPENBOX_ENV). Pass `--global` for keys that
   * apply across every env. Some keys auto-promote to global because
   * per-env scoping is incoherent for them: `OPENBOX_ENV` (selects
   * the active env; circular), `OPENBOX_HOME` (the dir per-env files
   * live in), `OPENBOX_CLIENT_VARIANT` (telemetry tag),
   * `OPENBOX_EXPERIMENTAL_LEVEL`. Conventionally an OPENBOX_*
   * upper-snake var name (the same names process.env reads). The CLI
   * does not validate against a known set; power users can stage
   * arbitrary keys without a release. Values are layered into
   * process.env on every command run **only if the env var is
   * currently unset**; explicit shell exports always win.
   */
  @cli_local_only
  @cli_output_kind("custom")
  set(key: string, value: string): void;

  /** Look up a previously-persisted value. Resolves global-only
   *  keys globally; everything else from the active --env scope.
   *  Exits 5 (NOT_FOUND) if absent. */
  @cli_local_only
  @cli_output_kind("custom")
  get(key: string): void;

  /** Remove a config value. No-op if it wasn't set. */
  @cli_local_only
  @cli_output_kind("custom")
  unset(key: string): void;

  /** Print persisted values. Default: active env's per-env values.
   *  `--global`: global-scope only. `--all`: both sections. */
  @cli_local_only
  @cli_output_kind("custom")
  list(): void;
}

// ---------------------------------------------------------------------------
// Persisted-credentials shape; used by `auth login` / `auth profile`
// and read by every other command on startup.
// ---------------------------------------------------------------------------

model PersistedCredentials {
  /**
   * On-disk location of the token store. Resolved per-OS via the
   * runtime's user-data directory helper.
   */
  @os_path
  storePath: string;

  /**
   * The agent / SDK API key. Format-validated on every read; the
   * regex matches the `obx_live_<48hex>` / `obx_test_<48hex>` shape
   * the backend issues. Mismatched values are rejected before any
   * outbound request, so a 401 from the wire always means the key
   * is wrong, not malformed.
   */
  @env_var("OPENBOX_API_KEY")
  @token_format("^obx_(?:live|test)_[0-9a-f]{48}$")
  @cli_validator("validateApiKeyFormat")
  apiKey: string;

  /** Selected environment when the store was written. */
  env: EnvFlag;
}

// ---------------------------------------------------------------------------
// Remaining command groups; surface-only spec for now. Each method
// lists the positional arguments declared in `commands/<x>.ts`. The
// `@cli_flag` decorators on flags will land in follow-up passes; the
// coverage test in tests/unit/cli-coverage.test.ts asserts every method
// here has a matching `.command(...)` registration in the impl.
// ---------------------------------------------------------------------------

@cli_command("agent", "Agent management.")
@cli_maturity("experimental")
interface Agent {
  /** List all agents. */
  @cli_calls("listAgents")
  @cli_pagination
  @cli_output_kind("list", "agents")
  list(
    @cli_flag("Search by name", "s")
    search?: string,
    @cli_flag("Filter by status") @cli_parse("int")
    status?: string,
    @cli_flag("Filter by team ID") @cli_body_key("team_id")
    team?: string,
    @cli_flag("Filter by tiers") @cli_variadic
    tiers?: string[],
  ): void;

  /** Get agent details. */
  @cli_calls("getAgent", "positional")
  @cli_output_kind("kv")
  get(agentId: string): void;

  /** Full governance state for an agent in ONE call: agent metadata,
   *  every guardrail, the current behavior-rule set, the current
   *  policy set, and the current goal-alignment trend. The recipe
   *  fans out and assembles the result into a single JSON envelope so
   *  callers (humans, LLM agents, CI scripts) skip the N×M tier-1
   *  walks they'd otherwise need. */
  @cli_recipe(#[
    #{ call: "getAgent",                args: #["agentId"], into: "agent" },
    #{ call: "listGuardrails",          args: #["agentId"], into: "guardrails", paginate: true },
    #{ call: "getCurrentBehaviorRules", args: #["agentId"], into: "behaviors" },
    #{ call: "getCurrentPolicies",      args: #["agentId"], into: "policies" },
    #{ call: "getGoalAlignmentTrend",   args: #["agentId"], into: "goal", optional: true },
  ])
  @cli_output_kind("json")
  describe(agentId: string): void;

  /** Delete an agent. */
  @cli_calls("deleteAgent", "positional")
  @cli_destructive
  @cli_output_kind("kv")
  delete(agentId: string): void;

  /** Create a new agent. --body bypasses flag merge; otherwise
   *  --name + --team are required, AIVSS defaults fill in, and the
   *  preflight verifies team existence + flags name collisions. The
   *  runtime API key is highlighted to stderr (one-time display) on
   *  success. */
  @cli_calls("createAgent")
  @cli_output_kind("kv")
  @cli_json_merge("replace")
  @cli_dto_defaults(#{
    aivss_config: #{
      base_security: #{
        attack_vector: 2,
        attack_complexity: 1,
        privileges_required: 2,
        user_interaction: 1,
        scope: 1,
      },
      ai_specific: #{
        model_robustness: 3,
        data_sensitivity: 2,
        ethical_impact: 2,
        decision_criticality: 2,
        adaptability: 3,
      },
      impact: #{
        confidentiality_impact: 2,
        integrity_impact: 2,
        availability_impact: 2,
        safety_impact: 1,
      },
    },
  })
  @cli_preflight("agentCreatePreflight")
  @cli_output_post("highlightRuntimeKey")
  create(
    @cli_flag("Agent name", "n") @cli_required @cli_body_key("agent_name")
    name?: string,
    @cli_flag("Description", "d") @cli_body_key("description")
    desc?: string,
    @cli_flag("Team IDs (UUIDs)", "t") @cli_required @cli_variadic
    @cli_validator("validateUuidList") @cli_body_key("team_ids")
    team?: string[],
    @cli_flag("Agent type") @cli_body_key("agent_type") @cli_default("temporal")
    type?: string,
    @cli_flag("Icon") @cli_default("robot")
    icon?: string,
    @cli_flag("Skip preflight team-existence + name-collision GETs")
    skipPreflight?: boolean,
  ): void;

  /** Update an agent. --body replaces flag-built body. */
  @cli_calls("updateAgent")
  @cli_output_kind("kv")
  @cli_json_merge("replace")
  update(
    agentId: string,
    @cli_flag("Agent name", "n") @cli_body_key("agent_name")
    name?: string,
    @cli_flag("Description", "d") @cli_body_key("description")
    desc?: string,
    @cli_flag("Agent type") @cli_body_key("agent_type")
    type?: string,
    @cli_flag("Model name") @cli_body_key("model_name")
    `model`?: string,
    @cli_flag("Tags") @cli_variadic
    tags?: string[],
    @cli_flag("Team IDs") @cli_variadic @cli_body_key("team_ids")
    team?: string[],
  ): void;

  // Custom: cross-session protocol-conformance audit (renderAuditReport).
  @cli_maturity("experimental")
  @cli_output_kind("custom")
  audit(agentId: string): void;
}

@cli_command("aivss", "Agent AIVSS scoring.")
interface Aivss {
  /** Get AIVSS assessments. */
  @cli_calls("getAssessments")
  @cli_pagination
  @cli_output_kind("list", "assessments")
  assessments(
    agentId: string,
    @cli_flag("Start date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("fromTime")
    from?: string,
    @cli_flag("End date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("toTime")
    to?: string,
  ): void;

  /** Update AIVSS config. */
  @cli_calls("updateAivssConfig")
  @cli_output_kind("kv")
  update(
    agentId: string,
    @cli_flag("AIVSS config JSON (aivss_config object)")
    @cli_required @cli_parse("json") @cli_body_key("aivss_config")
    json?: string,
    @cli_flag("Reason for update")
    @cli_required
    reason?: string,
  ): void;

  /** Recalculate AIVSS score. */
  @cli_calls("recalculateAivss", "positional")
  @cli_output_kind("kv")
  recalculate(agentId: string): void;

  /** Calculate AIVSS score from config. */
  @cli_calls("calculateAivss")
  @cli_output_kind("kv")
  @cli_json_merge("only")
  calculate(): void;
}

@cli_command("api-key", "Agent + org-level API key management.")
@cli_maturity("experimental")
interface ApiKey {
  /** List org-level API keys. */
  @cli_maturity("experimental")
  @cli_calls("listApiKeys")
  @cli_pagination
  @cli_output_kind("list", "api keys")
  list(): void;

  // Custom: --body body required, no other shape.
  @cli_maturity("experimental")
  @cli_output_kind("custom")
  create(): void;

  /** Get an org-level API key by id. */
  @cli_maturity("experimental")
  @cli_calls("getApiKey", "positional")
  @cli_output_kind("kv")
  get(id: string): void;

  // Custom: --body body required.
  @cli_maturity("experimental")
  @cli_output_kind("custom")
  update(id: string): void;

  /** Delete an org-level API key. */
  @cli_maturity("experimental")
  @cli_calls("deleteApiKey", "positional")
  @cli_destructive
  @cli_output_kind("kv")
  delete(id: string): void;

  /** Rotate API key for an agent. The runtime key is highlighted to
   *  stderr (one-time display) via the post callback, AND cached to
   *  the per-OS agent-keys store (mode 0o600) so `recall` can
   *  retrieve it without another rotation. */
  @cli_maturity("stable")
  @cli_calls("rotateApiKey", "positional")
  @cli_destructive
  @cli_output_kind("kv")
  @cli_output_post("highlightRuntimeKey")
  rotate(agentId: string): void;

  /** Revoke API key for an agent. */
  @cli_maturity("stable")
  @cli_calls("revokeApiKey", "positional")
  @cli_destructive
  @cli_output_kind("kv")
  revoke(agentId: string): void;

  /** Print the cached runtime key for an agent (no network call).
   *  Populated by `agent create` and `api-key rotate` post-callbacks
   *  into `~/.openbox/agent-keys` (mode 0o600). Non-destructive
   *  alternative to `rotate` when the key has been forgotten. */
  @cli_maturity("stable")
  @cli_local_only
  @cli_output_kind("custom")
  recall(agentId: string): void;
}

@cli_command("webhook", "Webhook management (admin).")
interface Webhook {
  /** List webhooks for the current org. */
  @cli_calls("listWebhooks")
  @cli_pagination
  @cli_output_kind("list", "webhooks")
  list(): void;

  /** Create a webhook. */
  @cli_calls("createWebhook")
  @cli_output_kind("kv")
  @cli_json_merge("replace")
  create(): void;

  /** Get a webhook by id. */
  @cli_calls("getWebhook", "positional")
  @cli_output_kind("kv")
  get(id: string): void;

  /** Update a webhook. */
  @cli_calls("updateWebhook")
  @cli_output_kind("kv")
  @cli_json_merge("replace")
  update(id: string): void;

  /** Delete a webhook. */
  @cli_calls("deleteWebhook", "positional")
  @cli_destructive
  @cli_output_kind("kv")
  delete(id: string): void;

  /** Send a test event to the webhook. */
  @cli_calls("testWebhook", "positional")
  @cli_output_kind("kv")
  test(id: string): void;

  /** Rotate the signing secret. The new secret is highlighted to
   *  stderr (one-time display) via the post callback. */
  @cli_calls("regenerateWebhookSecret", "positional")
  @cli_output_kind("kv")
  @cli_output_post("highlightWebhookSecret")
  regenerateSecret(id: string): void;

  /** List deliveries for a webhook. */
  @cli_calls("getWebhookDeliveries")
  @cli_pagination
  @cli_output_kind("list", "webhook deliveries")
  deliveries(id: string): void;
}

@cli_command("sso", "SSO configuration (admin).")
interface Sso {
  /** Get SSO status (enabled / method / enforced). */
  @cli_calls("getSsoStatus", "positional")
  @cli_output_kind("kv")
  status(): void;

  /** Get the active SSO configuration. */
  @cli_calls("getSsoConfig", "positional")
  @cli_output_kind("kv")
  config(): void;

  /** Get SAML SP metadata (XML or JSON depending on backend). */
  @cli_calls("getSsoMetadata", "positional")
  @cli_output_kind("kv")
  getMetadata(): void;

  /** Configure OIDC SSO. */
  @cli_calls("configureSsoOidc")
  @cli_output_kind("kv")
  @cli_json_merge("replace")
  configureOidc(): void;

  /** Configure SAML SSO. */
  @cli_calls("configureSsoSaml")
  @cli_output_kind("kv")
  @cli_json_merge("replace")
  configureSaml(): void;

  /** Toggle SSO enforcement. */
  @cli_calls("enforceSso")
  @cli_output_kind("kv")
  @cli_json_merge("replace")
  enforce(): void;

  /** Delete the current SSO configuration. */
  @cli_calls("deleteSsoConfig", "positional")
  @cli_destructive
  @cli_output_kind("kv")
  delete(): void;

  /** Verify the current SSO configuration end-to-end. */
  @cli_calls("verifySsoConfig", "positional")
  @cli_output_kind("kv")
  verify(): void;
}

@cli_command("approval", "Approval queue management.")
@cli_maturity("experimental")
interface Approval {
  /** Get approval metrics. */
  @cli_calls("getApprovalMetrics")
  @cli_output_kind("kv")
  metrics(
    agentId: string,
    @cli_flag("Start date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("fromTime")
    from?: string,
    @cli_flag("End date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("toTime")
    to?: string,
  ): void;

  /** Get pending approvals. */
  @cli_calls("getPendingApprovals")
  @cli_pagination
  @cli_output_kind("list", "pending approvals")
  pending(
    agentId: string,
    @cli_flag("Search", "s")
    search?: string,
    @cli_flag("Status filter")
    @cli_choice(#["pending", "approved", "rejected", "expired"])
    status?: string,
    @cli_flag("Tier filter")
    @cli_variadic
    tiers?: string[],
    @cli_flag("Start date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("fromTime")
    from?: string,
    @cli_flag("End date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("toTime")
    to?: string,
  ): void;

  /** Get approval history. */
  @cli_calls("getApprovalHistory")
  @cli_pagination
  @cli_output_kind("list", "approval history")
  history(
    agentId: string,
    @cli_flag("Search", "s")
    search?: string,
    @cli_flag("Status filter")
    @cli_choice(#["pending", "approved", "rejected", "expired"])
    status?: string,
    @cli_flag("Tier filter")
    @cli_variadic
    tiers?: string[],
    @cli_flag("Start date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("fromTime")
    from?: string,
    @cli_flag("End date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("toTime")
    to?: string,
  ): void;

  /** Decide on an approval (approve|reject). */
  @cli_calls("decideApproval")
  @cli_output_kind("kv")
  decide(
    agentId: string,
    eventId: string,
    @cli_choice(#["approve", "reject"])
    @cli_body_key("action")
    action: string,
  ): void;
}

@cli_command("audit", "Audit log queries + exports.")
@cli_maturity("experimental")
interface Audit {
  /** List audit logs. */
  @cli_calls("getAuditLogs")
  @cli_pagination
  @cli_output_kind("list", "audit logs")
  list(
    @cli_flag("Event type filter") @cli_body_key("eventType")
    eventType?: string,
    @cli_flag("Actor ID filter") @cli_body_key("actorId")
    actor?: string,
    @cli_flag("Result filter")
    @cli_choice(#["success", "failed", "denied", "warning", "approved", "allowed"])
    result?: string,
    @cli_flag("Search", "s")
    search?: string,
    @cli_flag("Start date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("startDate")
    from?: string,
    @cli_flag("End date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("endDate")
    to?: string,
  ): void;

  /** Export audit logs. --body provides a full ExportAuditLogsDto;
   *  individual flags fill missing fields. exportName is required in
   *  the merged body (either via --name or via --body). */
  @cli_calls("exportAuditLogs")
  @cli_output_kind("kv")
  @cli_json_merge
  export(
    @cli_flag("Export name (required; if --body omits exportName, this fills it)", "n")
    @cli_required @cli_body_key("exportName")
    name?: string,
    @cli_flag("Event types") @cli_variadic
    @cli_choice(#["policy_change", "guardrail_change", "agent_session", "agent_risk_configuration_change", "agent_goal_alignment_configuration_change", "role_change", "security_event", "settings_update", "team_management", "member_management", "invitation"])
    @cli_body_key("eventTypes")
    eventTypes?: string[],
    @cli_flag("Actor ID") @cli_body_key("actorId")
    actor?: string,
    @cli_flag("Result filter")
    @cli_choice(#["success", "failed", "denied", "warning", "approved", "allowed"])
    result?: string,
    @cli_flag("Search", "s")
    search?: string,
    @cli_flag("Start date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("startDate")
    from?: string,
    @cli_flag("End date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("endDate")
    to?: string,
  ): void;

  /** Preview audit log export. --body replaces flag-built body when
   *  present. */
  @cli_calls("previewAuditExport")
  @cli_output_kind("kv")
  @cli_json_merge("replace")
  preview(
    @cli_flag("Event types") @cli_variadic
    @cli_choice(#["policy_change", "guardrail_change", "agent_session", "agent_risk_configuration_change", "agent_goal_alignment_configuration_change", "role_change", "security_event", "settings_update", "team_management", "member_management", "invitation"])
    @cli_body_key("eventTypes")
    eventTypes?: string[],
    @cli_flag("Start date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("startDate")
    from?: string,
    @cli_flag("End date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("endDate")
    to?: string,
  ): void;

  /** List export history. */
  @cli_calls("getExportHistory")
  @cli_pagination
  @cli_output_kind("list", "exports")
  exports(
    @cli_flag("Status filter")
    @cli_choice(#["pending", "processing", "completed", "failed"])
    status?: string,
    @cli_flag("Start date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("startDate")
    from?: string,
    @cli_flag("End date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("endDate")
    to?: string,
  ): void;

  /** Download an export; returns a binary payload, written verbatim
   *  to stdout. */
  @cli_maturity("experimental")
  @cli_calls("downloadExport", "positional")
  @cli_output_kind("binary")
  download(exportId: string): void;

  /** Delete an export. */
  @cli_calls("deleteExport", "positional")
  @cli_output_kind("kv")
  deleteExport(exportId: string): void;

  /** Get audit log details. */
  @cli_maturity("experimental")
  @cli_calls("getAuditLog", "positional")
  @cli_output_kind("kv")
  get(logId: string): void;
}

@cli_command("behavior", "Behavior rule management.")
@cli_maturity("experimental")
interface Behavior {
  /** List supported behavior-rule semantic types. */
  @cli_calls("getSemanticTypes", "positional")
  @cli_output_kind("list", "behavior types")
  types(): void;

  /** List behavior rules for an agent. */
  @cli_calls("listBehaviorRules")
  @cli_pagination
  @cli_output_kind("list", "rules")
  list(agentId: string): void;

  /** Get the current active rule set. */
  @cli_calls("getCurrentBehaviorRules", "positional")
  @cli_output_kind("kv")
  current(agentId: string): void;

  /** Get a single behavior rule. */
  @cli_calls("getBehaviorRule", "positional")
  @cli_output_kind("kv")
  get(agentId: string, ruleId: string): void;

  /** Delete a behavior rule. */
  @cli_calls("deleteBehaviorRule", "positional")
  @cli_destructive
  @cli_output_kind("kv")
  delete(agentId: string, ruleId: string): void;

  /** Create a behavior rule and attach it to the agent.
   *
   *  Behavior rules and OPA policies are the two approval-trigger
   *  surfaces. Use a behavior_rule (not a policy) when you need to
   *  control the approval timeout; pass --verdict 2 with
   *  --approval-timeout SECONDS to produce an approval row that
   *  expires exactly that many seconds after creation. OPA policies
   *  have no equivalent; they always use the core server default
   *  (~30m). Both surfaces coexist on the same agent; both run
   *  during `core evaluate` and the strictest verdict wins.
   *
   *  See `references/behaviors.md` for the full trigger/states enum
   *  and `references/rego-reference.md § Approval timeout` for the
   *  policy-vs-behavior_rule decision tree. */
  @cli_calls("createBehaviorRule")
  @cli_output_kind("kv")
  @cli_json_merge
  @cli_post_validate("behaviorRuleCrossField")
  create(
    agentId: string,
    @cli_flag("Rule name", "n") @cli_required @cli_body_key("rule_name")
    name?: string,
    @cli_flag("Trigger type") @cli_required
    trigger?: string,
    @cli_flag("State triggers") @cli_required @cli_variadic
    states?: string[],
    @cli_flag("Time window (seconds)") @cli_required @cli_parse("int") @cli_body_key("time_window")
    window?: string,
    @cli_flag("Verdict (0=ALLOW, 1=CONSTRAIN, 2=REQUIRE_APPROVAL, 3=BLOCK, 4=HALT)")
    @cli_required @cli_parse("int")
    verdict?: string,
    @cli_flag("Reject message") @cli_required @cli_body_key("reject_message")
    message?: string,
    @cli_flag("Priority") @cli_parse("int") @cli_default("1")
    priority?: string,
    @cli_flag("Description", "d") @cli_body_key("description")
    desc?: string,
    @cli_flag("Trust impact (none|low|medium|high)") @cli_body_key("trust_impact")
    @cli_choice(#["none", "low", "medium", "high"])
    trustImpact?: string,
    @cli_flag("Trust threshold") @cli_parse("int") @cli_body_key("trust_threshold")
    trustThreshold?: string,
    @cli_flag("Approval timeout (seconds)") @cli_parse("int") @cli_body_key("approval_timeout")
    approvalTimeout?: string,
  ): void;

  /** Update a behavior rule; change_log is required by the backend. */
  @cli_maturity("experimental")
  @cli_calls("updateBehaviorRule")
  @cli_output_kind("kv")
  @cli_json_merge
  update(
    agentId: string,
    ruleId: string,
    @cli_flag("Human-readable change reason") @cli_required @cli_body_key("change_log")
    changeLog?: string,
  ): void;
  /** Toggle behavior rule active status. The boolean is wrapped as
   *  `{ is_active: <bool> }` on the wire. */
  @cli_calls("toggleBehaviorRuleStatus")
  @cli_output_kind("kv")
  toggle(
    agentId: string,
    ruleId: string,
    @cli_flag("Active status (true|false)")
    @cli_required @cli_choice(#["true", "false"])
    @cli_parse("bool")
    @cli_body_key("is_active")
    active?: string,
  ): void;

  // Restore / versions / metrics / violations not e2e-covered.
  @cli_maturity("experimental")
  @cli_calls("restoreBehaviorRule", "positional")
  @cli_output_kind("kv")
  restore(agentId: string, ruleId: string): void;

  @cli_maturity("experimental")
  @cli_calls("getBehaviorRuleVersions")
  @cli_pagination
  @cli_output_kind("list", "versions")
  versions(agentId: string, groupId: string): void;

  @cli_maturity("experimental")
  @cli_calls("getBehaviorMetrics", "positional")
  @cli_output_kind("kv")
  metrics(agentId: string): void;

  @cli_maturity("experimental")
  @cli_calls("getBehaviorViolations")
  @cli_pagination
  @cli_output_kind("list", "violations")
  violations(agentId: string): void;
}

@cli_command("core", "Direct access to the core governance API.")
interface Core {
  /** Check core API health. */
  @cli_calls("health", "positional")
  @cli_output_kind("kv")
  health(): void;

  /** Validate API key. */
  @cli_calls("validateApiKey", "positional")
  @cli_output_kind("kv")
  validate(): void;

  /** Poll approval status. */
  @cli_calls("pollApproval")
  @cli_output_kind("kv")
  pollApproval(
    @cli_flag("Workflow ID") @cli_required @cli_body_key("workflow_id")
    workflowId?: string,
    @cli_flag("Run ID") @cli_required @cli_body_key("run_id")
    runId?: string,
    @cli_flag("Activity ID") @cli_required @cli_body_key("activity_id")
    activityId?: string,
  ): void;

  // Custom: --type shorthand drives buildTestPayload, --show-payload
  // skips the call entirely.
  //
  // This is THE approval-trigger surface. Whenever the response carries
  // verdict=require_approval, an approval row is materialized in the
  // backend. Triggers fire when the agent has either an OPA policy or
  // a behavior_rule attached that returns REQUIRE_APPROVAL for the
  // event's activity_type. To test against a known-working agent in
  // your org, run `openbox --experimental org approvals <orgId> --json`
  // and pick an agent_id that already has approval history; its
  // policy/rule is wired. Recover its runtime key with
  // `openbox api-key recall <agentId>` (cached automatically by
  // create + rotate; 0o600).
  @cli_output_kind("custom")
  evaluate(): void;
}

// Local-only; never makes a backend call. The action is parent-level
// (no subcommands), wired hand-coded in commands/doctor.ts. The
// import-allowlist drift test guarantees no backend imports leak.
@cli_command("doctor", "Pre-flight checks for the local environment.")
@cli_maturity("stable")
interface Doctor {}

@cli_command("goal", "Goal alignment configuration.")
@cli_maturity("experimental")
interface Goal {
  /** Get goal alignment trend. */
  @cli_calls("getGoalAlignmentTrend")
  @cli_output_kind("kv")
  trend(
    agentId: string,
    @cli_flag("Start date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("fromTime")
    from?: string,
    @cli_flag("End date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("toTime")
    to?: string,
  ): void;

  /** Get recent goal alignment drifts. */
  @cli_calls("getGoalAlignmentRecentDrifts")
  @cli_output_kind("list", "drifts")
  drifts(
    agentId: string,
    @cli_flag("Number of drifts", "l")
    @cli_parse("int")
    @cli_default("10")
    limit?: string,
  ): void;

  /** Update goal alignment config. All four fields required together
   *  (or --body with the full body). */
  @cli_calls("updateGoalAlignment")
  @cli_output_kind("kv")
  @cli_json_merge("replace")
  @cli_required_together(#["threshold", "action", "frequency", "model"])
  update(
    agentId: string,
    @cli_flag("Alignment threshold (0-100)")
    @cli_parse("int") @cli_body_key("alignment_threshold")
    threshold?: string,
    @cli_flag("Drift detection action")
    @cli_choice(#["alert_only", "constrain", "terminate"])
    @cli_body_key("drift_detection_action")
    action?: string,
    @cli_flag("Evaluation frequency")
    @cli_choice(#["every_action", "every_5_actions", "every_10_actions", "session_end_only"])
    @cli_body_key("evaluation_frequency")
    frequency?: string,
    @cli_flag("LlamaFirewall model")
    @cli_body_key("llama_firewall_model")
    `model`?: string,
  ): void;
}

@cli_command("guardrail", "Guardrail management + testing.")
@cli_maturity("experimental")
interface Guardrail {
  /** List guardrails for an agent. */
  @cli_calls("listGuardrails")
  @cli_pagination
  @cli_output_kind("list", "guardrails")
  list(agentId: string): void;

  /** Get a single guardrail. */
  @cli_calls("getGuardrail", "positional")
  @cli_output_kind("kv")
  get(agentId: string, guardrailId: string): void;

  /** Delete a guardrail. */
  @cli_calls("deleteGuardrail", "positional")
  @cli_destructive
  @cli_output_kind("kv")
  delete(agentId: string, guardrailId: string): void;

  /** Create a guardrail. */
  @cli_calls("createGuardrail")
  @cli_output_kind("kv")
  @cli_json_merge
  @cli_post_validate("guardrailCrossField")
  create(
    agentId: string,
    @cli_flag("Guardrail name", "n") @cli_required
    name?: string,
    @cli_flag("Guardrail type (1=PII, 2=NSFW, 3=Toxicity, 4=BanList, 5=Regex, or name)")
    @cli_required @cli_body_key("guardrail_type")
    type?: string,
    @cli_flag("Processing stage (0=input, 1=output)") @cli_default("0")
    @cli_body_key("processing_stage")
    stage?: string,
    @cli_flag("Description", "d") @cli_body_key("description")
    desc?: string,
    @cli_flag("Trust impact (none|low|medium|high)") @cli_body_key("trust_impact")
    @cli_choice(#["none", "low", "medium", "high"])
    trustImpact?: string,
    @cli_flag("Trust threshold") @cli_parse("int") @cli_body_key("trust_threshold")
    trustThreshold?: string,
  ): void;

  /** Update a guardrail. */
  @cli_calls("updateGuardrail")
  @cli_output_kind("kv")
  @cli_json_merge
  @cli_post_validate("guardrailCrossField")
  update(
    agentId: string,
    guardrailId: string,
    @cli_flag("Guardrail name", "n")
    name?: string,
    @cli_flag("Active status (true|false)") @cli_parse("bool") @cli_body_key("is_active")
    @cli_choice(#["true", "false"])
    active?: string,
    @cli_flag("Guardrail type") @cli_body_key("guardrail_type")
    type?: string,
    @cli_flag("Processing stage (0|1)") @cli_body_key("processing_stage")
    stage?: string,
    @cli_flag("Description", "d") @cli_body_key("description")
    desc?: string,
    @cli_flag("Trust impact") @cli_body_key("trust_impact")
    @cli_choice(#["none", "low", "medium", "high"])
    trustImpact?: string,
    @cli_flag("Trust threshold") @cli_parse("int") @cli_body_key("trust_threshold")
    trustThreshold?: string,
  ): void;

  @cli_maturity("experimental")
  @cli_output_kind("custom")
  reorder(agentId: string, guardrailId: string, order: string): void;

  @cli_maturity("experimental")
  @cli_calls("getGuardrailMetrics")
  @cli_output_kind("kv")
  metrics(
    agentId: string,
    @cli_flag("Start date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("fromTime")
    from?: string,
    @cli_flag("End date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("toTime")
    to?: string,
  ): void;

  @cli_maturity("experimental")
  @cli_calls("getGuardrailViolationLogs")
  @cli_pagination
  @cli_output_kind("list", "violations")
  violations(agentId: string): void;

  @cli_maturity("experimental")
  @cli_output_kind("custom")
  test(): void;
}

@cli_command("health", "Backend health check.")
@cli_maturity("stable")
interface Health {}

@cli_command("member", "Org member management.")
interface Member {
  /** List members of an org. */
  @cli_calls("listMembers")
  @cli_pagination
  @cli_output_kind("list", "members")
  list(orgId: string): void;

  /** Create a member directly (Keycloak admin path). */
  @cli_calls("createUser")
  @cli_output_kind("kv")
  @cli_json_merge
  create(
    orgId: string,
    @cli_flag("Username")
    @cli_required
    username?: string,
    @cli_flag("Email")
    @cli_required
    email?: string,
    @cli_flag("Password (leave unset for invite flow)")
    password?: string,
    @cli_flag("First name") @cli_body_key("firstName")
    firstName?: string,
    @cli_flag("Last name") @cli_body_key("lastName")
    lastName?: string,
    @cli_flag("Mark email as verified") @cli_body_key("emailVerified")
    verified?: boolean,
    @cli_flag("Roles to assign") @cli_variadic
    roles?: string[],
  ): void;

  /** Update a member. */
  @cli_calls("updateMember")
  @cli_output_kind("kv")
  @cli_json_merge
  update(
    orgId: string,
    userId: string,
    @cli_flag("Role")
    role?: string,
    @cli_flag("Team IDs (UUIDs); replaces existing membership") @cli_variadic
    @cli_body_key("team_ids")
    teams?: string[],
  ): void;

  /** Assign roles to a member. Wire: assignRoles(orgId, userId, rolesArray). */
  @cli_calls("assignRoles", "positional")
  @cli_output_kind("kv")
  assignRoles(
    orgId: string,
    userId: string,
    @cli_flag("Roles to assign") @cli_variadic @cli_required
    roles?: string[],
  ): void;

  /** Remove roles from a member. Wire: removeRoles(orgId, userId, rolesArray). */
  @cli_calls("removeRoles", "positional")
  @cli_output_kind("kv")
  removeRoles(
    orgId: string,
    userId: string,
    @cli_flag("Roles to remove") @cli_variadic @cli_required
    roles?: string[],
  ): void;

  /** Remove members from an org. Wire: removeMembers(orgId, idArray). */
  @cli_calls("removeMembers", "positional")
  @cli_destructive
  @cli_output_kind("kv")
  remove(
    orgId: string,
    @cli_flag("User IDs to remove") @cli_variadic @cli_required
    ids?: string[],
  ): void;

  /** Invite a user to the org. */
  @cli_calls("inviteUser")
  @cli_output_kind("kv")
  invite(
    orgId: string,
    @cli_flag("Email")
    @cli_required
    email?: string,
    @cli_flag("Roles to invite with") @cli_variadic @cli_required
    roles?: string[],
  ): void;
}

@cli_command("observe", "Observability dashboards + metrics.")
@cli_maturity("experimental")
interface Observe {
  /** Get observability data. */
  @cli_calls("getObservability")
  @cli_output_kind("kv")
  data(
    agentId: string,
    @cli_flag("Start date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("fromTime")
    from?: string,
    @cli_flag("End date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("toTime")
    to?: string,
  ): void;

  /** Get agent issues. */
  @cli_calls("getIssues")
  @cli_pagination
  @cli_output_kind("list", "issues")
  issues(agentId: string): void;

  /** Get insights metrics. */
  @cli_calls("getInsightsMetrics")
  @cli_output_kind("kv")
  insights(
    agentId: string,
    @cli_flag("Start date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("fromTime")
    from?: string,
    @cli_flag("End date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("toTime")
    to?: string,
  ): void;

  /** Get agent logs. */
  @cli_calls("getAgentLogs")
  @cli_pagination
  @cli_output_kind("list", "logs")
  logs(agentId: string): void;

  /** Get drift logs. */
  @cli_maturity("experimental")
  @cli_calls("getDriftLogs")
  @cli_pagination
  @cli_output_kind("list", "drift logs")
  drift(agentId: string): void;

  /** Get agent metrics (global). */
  @cli_calls("getAgentMetrics", "positional")
  @cli_output_kind("kv")
  metrics(): void;
}

@cli_command("org", "Organization management.")
@cli_maturity("experimental")
interface Org {
  /** Get organization details. */
  @cli_calls("getOrganization", "positional")
  @cli_output_kind("kv")
  get(orgId: string): void;

  /** Get organization settings. */
  @cli_calls("getOrgSettings", "positional")
  @cli_output_kind("kv")
  settings(orgId: string): void;

  /** Get organization dashboard. */
  @cli_calls("getDashboard")
  @cli_output_kind("kv")
  dashboard(
    orgId: string,
    @cli_flag("Start date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("fromTime")
    from?: string,
    @cli_flag("End date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("toTime")
    to?: string,
  ): void;

  /** List org sessions. */
  @cli_calls("getOrgSessions")
  @cli_pagination
  @cli_output_kind("list", "sessions")
  sessions(
    orgId: string,
    @cli_flag("Filter by status")
    @cli_choice(#["pending", "completed", "failed", "blocked", "halted"])
    status?: string,
  ): void;

  /** Get org approvals. Wire returns
   *  `{ approvals: { data: [...] }, metrics: {...} }`; render the
   *  approvals list and surface metrics to stderr. */
  @cli_calls("getOrgApprovals")
  @cli_pagination
  @cli_output_kind("list", "approvals")
  @cli_output_pluck("approvals")
  @cli_output_post("logApprovalMetrics")
  approvals(
    orgId: string,
    @cli_flag("Filter by status")
    @cli_choice(#["pending", "approved", "rejected", "expired"])
    status?: string,
  ): void;

  /** Update organization settings. --body replaces flag-built body. */
  @cli_maturity("experimental")
  @cli_calls("updateOrgSettings")
  @cli_output_kind("kv")
  @cli_json_merge("replace")
  updateSettings(
    orgId: string,
    @cli_flag("Organization name", "n")
    name?: string,
    @cli_flag("Domain")
    domain?: string,
    @cli_flag("Timezone")
    timezone?: string,
  ): void;

  @cli_maturity("experimental")
  @cli_calls("getDashboardTierTrends", "positional")
  @cli_output_kind("kv")
  trends(orgId: string): void;

  @cli_maturity("experimental")
  @cli_calls("getOrgApprovalMetrics")
  @cli_output_kind("kv")
  approvalMetrics(
    orgId: string,
    @cli_flag("Start date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("fromTime")
    from?: string,
    @cli_flag("End date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("toTime")
    to?: string,
  ): void;

  @cli_maturity("experimental")
  @cli_calls("getOrgApprovalSla", "positional")
  @cli_output_kind("kv")
  approvalSla(orgId: string): void;

  @cli_maturity("experimental")
  @cli_calls("getOrgApprovalHistory")
  @cli_pagination
  @cli_output_kind("list", "approval history")
  approvalHistory(orgId: string): void;

  /** Latest governance events for the dashboard activity feed. */
  @cli_maturity("experimental")
  @cli_calls("getGovernanceFeed")
  @cli_output_kind("list", "governance feed")
  governanceFeed(
    orgId: string,
    @cli_flag("Number of events to return", "l")
    @cli_parse("int") @cli_default("20")
    limit?: string,
  ): void;

  /** Per-agent 30-day trust score trajectory. */
  @cli_maturity("experimental")
  @cli_calls("getTrustDriftLanes")
  @cli_output_kind("kv")
  trustDriftLanes(
    orgId: string,
    @cli_flag("Number of agent lanes to return", "l")
    @cli_parse("int") @cli_default("8")
    limit?: string,
  ): void;

  /** Allowed/blocked/halted rates vs targets. */
  @cli_maturity("experimental")
  @cli_calls("getGovernanceSlo")
  @cli_output_kind("kv")
  governanceSlo(
    orgId: string,
    @cli_flag("Aggregation window")
    @cli_choice(#["7d", "30d", "90d"])
    @cli_default("30d")
    window?: string,
  ): void;

  /** 7×24 day-of-week × hour-of-day violation density matrix. */
  @cli_maturity("experimental")
  @cli_calls("getViolationHeatcal")
  @cli_output_kind("kv")
  violationHeatcal(
    orgId: string,
    @cli_flag("Aggregation window")
    @cli_choice(#["7d", "30d", "90d"])
    @cli_default("30d")
    window?: string,
  ): void;

  /** Provision a new organization (public endpoint, throttled). */
  @cli_maturity("experimental")
  @cli_calls("registerOrganization")
  @cli_output_kind("kv")
  @cli_json_merge("only")
  register(): void;

  /** Poll demo-agent setup status (used by FE during onboarding). */
  @cli_maturity("experimental")
  @cli_calls("getDemoSetupStatus", "positional")
  @cli_output_kind("kv")
  demoStatus(): void;
}

@cli_command("policy", "Policy management.")
@cli_maturity("experimental")
interface Policy {
  /** List policies for an agent. */
  @cli_calls("listPolicies")
  @cli_pagination
  @cli_output_kind("list", "policies")
  list(agentId: string): void;

  /** Get the current active policy set. */
  @cli_calls("getCurrentPolicies", "positional")
  @cli_output_kind("kv")
  current(agentId: string): void;

  /** Get a single policy. */
  @cli_calls("getPolicy", "positional")
  @cli_output_kind("kv")
  get(agentId: string, policyId: string): void;

  /** Create an OPA policy and attach it to the agent.
   *
   *  This is one of the two surfaces for wiring an approval trigger
   *  (the other is `behavior create`). A policy that returns
   *  `result := { decision: "REQUIRE_APPROVAL", ... }` for a given
   *  input shape produces an approval row whenever `core evaluate`
   *  ingests a matching event for the agent. See
   *  `references/rego-reference.md` for the supported `decision` set
   *  (case-insensitive `allow|block|halt|require_approval`) and the
   *  input fields available to the policy.
   *
   *  IMPORTANT; approval_timeout is NOT settable here. OPA policies
   *  cannot configure the approval expiration window: the DTO has no
   *  `approval_timeout` field and the Rego return shape is
   *  `{decision, reason}` only. When this policy fires
   *  REQUIRE_APPROVAL, core injects a server-side default
   *  (~30m observed). To control the timeout, use `behavior create`
   *  with `--verdict 2 --approval-timeout <seconds>` instead; both
   *  surfaces coexist on the same agent and the strictest verdict
   *  wins.
   *
   *  Note: this calls the agent-scoped `POST /agent/{id}/policies`
   *  backend route which requires the `create:agent_policy`
   *  Keycloak permission. If your role is missing it (the prod
   *  default `Admin` realm role lacks it on openbox.ai as of
   *  2026-04), the backend returns 403; at which point use
   *  an existing canary agent's runtime key + `core evaluate`
   *  instead of creating a new policy. */
  @cli_calls("createPolicy")
  @cli_output_kind("kv")
  @cli_json_merge
  @cli_post_validate("policyCrossField")
  create(
    agentId: string,
    @cli_flag("Policy name", "n") @cli_required
    name?: string,
    @cli_flag("Description", "d") @cli_body_key("description")
    desc?: string,
    @cli_flag("Rego policy code") @cli_required @cli_body_key("rego_code")
    rego?: string,
    @cli_flag("Input JSON for policy") @cli_parse("json")
    input?: string,
    @cli_flag("Trust impact (none|low|medium|high)") @cli_body_key("trust_impact")
    @cli_choice(#["none", "low", "medium", "high"])
    trustImpact?: string,
    @cli_flag("Trust threshold") @cli_parse("int") @cli_body_key("trust_threshold")
    trustThreshold?: string,
  ): void;

  /** Toggle active / roll back a policy version. Rego is immutable. */
  @cli_calls("updatePolicy")
  @cli_output_kind("kv")
  @cli_json_merge
  update(
    agentId: string,
    policyId: string,
    @cli_flag("Active status (true|false)") @cli_required @cli_parse("bool")
    @cli_choice(#["true", "false"]) @cli_body_key("is_active")
    active?: string,
    @cli_flag("Trust impact") @cli_body_key("trust_impact")
    @cli_choice(#["none", "low", "medium", "high"])
    trustImpact?: string,
    @cli_flag("Trust threshold") @cli_parse("int") @cli_body_key("trust_threshold")
    trustThreshold?: string,
  ): void;

  @cli_maturity("experimental")
  @cli_calls("getPolicyEvaluations")
  @cli_pagination
  @cli_output_kind("list", "evaluations")
  evaluations(agentId: string, policyId: string): void;

  @cli_maturity("experimental")
  @cli_calls("getPolicyMetrics", "positional")
  @cli_output_kind("kv")
  metrics(agentId: string): void;

  @cli_maturity("experimental")
  @cli_output_kind("custom")
  evaluate(): void;
}

@cli_command("session", "Session inspection + cleanup.")
@cli_maturity("experimental")
interface Session {
  /** List sessions for an agent. */
  @cli_calls("listSessions")
  @cli_pagination
  @cli_output_kind("list", "sessions")
  list(
    agentId: string,
    @cli_flag("Filter by status")
    @cli_choice(#["pending", "completed", "failed", "blocked", "halted"])
    status?: string,
    @cli_flag("Start date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("fromTime")
    from?: string,
    @cli_flag("End date (ISO)") @cli_validator("validateIsoDate") @cli_body_key("toTime")
    to?: string,
    @cli_flag("Duration filter")
    @cli_choice(#["<1min", "1-5mins", "5-15mins", ">15mins"])
    duration?: string,
    @cli_flag("Search", "s")
    search?: string,
  ): void;

  /** Get active sessions for an agent. */
  @cli_calls("getActiveSessions", "positional")
  @cli_output_kind("kv")
  active(agentId: string): void;

  /** Get session details. */
  @cli_calls("getSession", "positional")
  @cli_output_kind("kv")
  get(agentId: string, sessionId: string): void;

  /** Get session logs. */
  @cli_calls("getSessionLogs")
  @cli_pagination
  @cli_output_kind("list", "logs")
  logs(
    agentId: string,
    sessionId: string,
    @cli_flag("Filter by event type") @cli_body_key("event_type")
    eventType?: string,
  ): void;

  /** Get session goal alignment stats. */
  @cli_calls("getSessionGoalAlignmentStats", "positional")
  @cli_output_kind("kv")
  goalStats(agentId: string, sessionId: string): void;

  /** Terminate a session. */
  @cli_calls("terminateSession", "positional")
  @cli_destructive
  @cli_output_kind("kv")
  terminate(agentId: string, sessionId: string): void;

  /** Get session reasoning trace. */
  @cli_maturity("experimental")
  @cli_calls("getSessionReasoningTrace", "positional")
  @cli_output_kind("kv")
  trace(agentId: string, sessionId: string): void;

  // Custom: protocol-validates a session against the canonical event_type
  // contract. The body is a multi-page paginate + ad-hoc renderer.
  @cli_maturity("experimental")
  @cli_output_kind("custom")
  inspect(agentId: string, sessionIdOrWorkflowId: string): void;

  // Custom: bulk-terminate dangling sessions with progress reporting.
  @cli_maturity("experimental")
  @cli_destructive
  @cli_output_kind("custom")
  prune(agentId: string): void;
}

// `openbox setup` was removed; its `skill` / `mcp` subcommands are
// superseded by the dedicated top-level commands `skill install`,
// `mcp serve`, `claude-code install`, and `cursor install` (each has
// its own @cli_command interface above).

@cli_command("team", "Team management.")
@cli_maturity("experimental")
interface Team {
  /** List teams. */
  @cli_calls("listTeams")
  @cli_pagination
  @cli_output_kind("list", "teams")
  list(orgId: string): void;

  /** Get team stats. */
  @cli_maturity("experimental")
  @cli_calls("getTeamStats", "positional")
  @cli_output_kind("kv")
  stats(orgId: string): void;

  /** Get team details. */
  @cli_calls("getTeam", "positional")
  @cli_output_kind("kv")
  get(orgId: string, teamId: string): void;

  /** Get team members. */
  @cli_maturity("experimental")
  @cli_calls("getTeamMembers")
  @cli_pagination
  @cli_output_kind("list", "members")
  members(orgId: string, teamId: string): void;

  /** Create a team. --name OR --icon is required (cross-field rule);
   *  --body provides full body and bypasses the cross-field check. */
  @cli_calls("createTeam")
  @cli_output_kind("kv")
  @cli_json_merge("replace")
  @cli_at_least_one(#["name", "icon"])
  create(
    orgId: string,
    @cli_flag("Team name", "n")
    name?: string,
    @cli_flag("Description", "d") @cli_body_key("description")
    desc?: string,
    @cli_flag("Icon URL")
    icon?: string,
  ): void;

  /** Update a team. */
  @cli_maturity("experimental")
  @cli_calls("updateTeam")
  @cli_output_kind("kv")
  @cli_json_merge("replace")
  update(
    orgId: string,
    teamId: string,
    @cli_flag("Team name", "n")
    name?: string,
    @cli_flag("Description", "d") @cli_body_key("description")
    desc?: string,
    @cli_flag("Icon")
    icon?: string,
  ): void;

  /** Delete one or more teams. */
  @cli_calls("deleteTeams")
  @cli_destructive
  @cli_output_kind("kv")
  delete(
    orgId: string,
    @cli_flag("Team IDs to delete")
    @cli_variadic
    @cli_required
    ids?: string[],
  ): void;

  /** Add users to a team. */
  @cli_maturity("experimental")
  @cli_calls("addTeamMembers")
  @cli_output_kind("kv")
  addMembers(
    orgId: string,
    teamId: string,
    @cli_flag("User IDs to add")
    @cli_variadic
    @cli_required
    @cli_body_key("user_ids")
    userIds?: string[],
  ): void;

  /** Remove users from a team. */
  @cli_maturity("experimental")
  @cli_calls("removeTeamMembers")
  @cli_destructive
  @cli_output_kind("kv")
  removeMembers(
    orgId: string,
    teamId: string,
    @cli_flag("User IDs to remove")
    @cli_variadic
    @cli_required
    @cli_body_key("user_ids")
    userIds?: string[],
  ): void;
}

@cli_command("trust", "Agent trust history.")
@cli_maturity("experimental")
interface Trust {
  /** Get trust score histories. */
  @cli_calls("getTrustHistories", "positional")
  @cli_output_kind("kv")
  histories(
    agentId: string,
    @cli_flag("Duration window")
    @cli_choice(#["7d", "30d", "90d", "1y"])
    @cli_default("7d")
    duration?: string,
  ): void;

  /** Get trust events. */
  @cli_calls("getTrustEvents")
  @cli_pagination
  @cli_output_kind("list", "trust events")
  events(
    agentId: string,
    @cli_flag("Start date (ISO)")
    @cli_validator("validateIsoDate")
    @cli_body_key("fromTime")
    from?: string,
    @cli_flag("End date (ISO)")
    @cli_validator("validateIsoDate")
    @cli_body_key("toTime")
    to?: string,
  ): void;

  /** Get trust tier changes. */
  @cli_calls("getTrustTierChanges")
  @cli_pagination
  @cli_output_kind("list", "tier changes")
  tierChanges(
    agentId: string,
    @cli_flag("Start date (ISO)")
    @cli_validator("validateIsoDate")
    @cli_body_key("fromTime")
    from?: string,
    @cli_flag("End date (ISO)")
    @cli_validator("validateIsoDate")
    @cli_body_key("toTime")
    to?: string,
  ): void;

  /** Get trust recovery status. */
  @cli_maturity("experimental")
  @cli_calls("getTrustRecoveryStatus", "positional")
  @cli_output_kind("kv")
  recovery(agentId: string): void;
}

@cli_command("verify", "Lint an integration source file for governance bugs.")
interface Verify {}

@cli_command("versions", "Show deployed commit/tag for each service per env.")
@cli_maturity("stable")
interface Versions {}

@cli_command("violation", "Guardrail/policy/behavior violation queries.")
@cli_maturity("experimental")
interface Violation {
  /** Get all violations. */
  @cli_calls("getAllViolations", "positional")
  @cli_output_kind("list", "violations")
  list(): void;

  /** Get violations for an agent. */
  @cli_calls("getAgentViolations")
  @cli_pagination
  @cli_output_kind("list", "violations")
  agent(
    agentId: string,
    @cli_flag("Pattern filter")
    pattern?: string,
    @cli_flag("Source type filter")
    @cli_choice(#["behavior", "guardrail", "policy"])
    sourceType?: string,
  ): void;

  /** Mark a violation as false positive. sourceType must be one of: behavior, guardrail, policy. */
  @cli_calls("markFalsePositive")
  @cli_output_kind("kv")
  falsePositive(
    agentId: string,
    violationId: string,
    @cli_choice(#["behavior", "guardrail", "policy"])
    @cli_body_key("sourceType")
    sourceType: string,
  ): void;
}
