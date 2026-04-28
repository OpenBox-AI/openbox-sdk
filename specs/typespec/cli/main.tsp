// specs/typespec/cli/main.tsp - language-agnostic protocol of the
// `openbox` binary. The TS implementation today (ts/cli/src/) is
// hand-written via commander; this file documents the contract it
// satisfies and is what every language's CLI emitter (commander /
// clap / cobra / click) lowers from.
//
// One @cli_command per top-level verb, with sub-commands mounted
// either as nested interfaces or methods on the same interface.
// The surface-area sketch is here - not every existing
// command is wired yet. The vertical slice that proves the pipeline
// is `auth` (login / logout / profile) because it exercises every
// decorator: env-var-backed input, token-format validation, an OS
// path for the on-disk store, and a structured @cli_output.

// Note: programming-model spec, not an HTTP API - see govern/main.tsp
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

@cli_output
model AuthProfileOutput {
  /** Authenticated user identity. */
  user: {
    id: string;
    email: string;
    fullName: string;
  };

  /** Currently selected organization. */
  org: {
    id: string;
    realm: string;
    name?: string;
  };

  /** Active environment when the profile was queried. */
  env: EnvFlag;
}

// ---------------------------------------------------------------------------
// `openbox auth` command group - vertical slice.
// ---------------------------------------------------------------------------

@cli_command(
  "auth",
  "Authenticate against the OpenBox backend; manage local credentials."
)
@cli_maturity("stable")
interface Auth {
  /**
   * Interactive login. Opens the browser-based auth flow, captures
   * the resulting tokens, and persists them to the per-OS token
   * store. Custom: OAuth redirect captured via expo-web-browser.
   */
  @cli_output_kind("custom")
  login(
    @cli_flag(
      "Override the default environment.",
      "e",
      "OPENBOX_ENV"
    )
    env?: EnvFlag,

    @cli_flag(
      "Skip browser launch and print the auth URL instead.",
      "n"
    )
    noBrowser?: boolean,
  ): void;

  /** Clear the local token store. Custom: branches on hasTokens(env). */
  @cli_output_kind("custom")
  logout(): void;

  /** Print the resolved profile. Custom: renders persisted token store. */
  @cli_output_kind("custom")
  profile(): AuthProfileOutput;

  /** Refresh access tokens against the upstream session. */
  @cli_maturity("stable")
  @cli_output_kind("custom")
  refresh(): void;

  /** List the resolved permission set for the active credential. */
  @cli_maturity("experimental")
  @cli_output_kind("custom")
  permissions(): void;

  /** List enabled feature flags for the active credential. */
  @cli_maturity("experimental")
  @cli_output_kind("custom")
  features(): void;

  /** Change the local user's password against the upstream IdP. */
  @cli_maturity("experimental")
  @cli_output_kind("custom")
  changePassword(): void;

  /** List the roles the active user holds in the current org. */
  @cli_maturity("experimental")
  @cli_output_kind("custom")
  roles(): void;
}

// ---------------------------------------------------------------------------
// Persisted-credentials shape - used by `auth login` / `auth profile`
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
// Remaining command groups - surface-only spec for now. Each method
// lists the positional arguments declared in `commands/<x>.ts`. The
// `@cli_flag` decorators on flags will land in follow-up passes; the
// coverage test in tests/unit/cli-coverage.test.ts asserts every method
// here has a matching `.command(...)` registration in the impl.
// ---------------------------------------------------------------------------

@cli_command("agent", "Agent management.")
@cli_maturity("stable")
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

  /** Delete an agent. */
  @cli_calls("deleteAgent", "positional")
  @cli_output_kind("kv")
  delete(agentId: string): void;

  // Custom: preflight team/name validation + AIVSS defaults + runtime
  // key one-time stderr highlight.
  @cli_output_kind("custom")
  create(): void;

  // Custom: --json + flag merge over multiple optional fields.
  @cli_output_kind("custom")
  update(agentId: string): void;

  // Custom: cross-session protocol-conformance audit (renderAuditReport).
  @cli_output_kind("custom")
  audit(agentId: string): void;
}

@cli_command("aivss", "Agent AIVSS scoring.")
interface Aivss {
  // Custom: complex DTO + recalculate-with-reason logic.
  @cli_output_kind("custom")
  calculate(): void;
}

@cli_command("api-key", "Agent + org-level API key management.")
@cli_maturity("stable")
interface ApiKey {
  /** List org-level API keys. */
  @cli_calls("listApiKeys")
  @cli_pagination
  @cli_output_kind("list", "api keys")
  list(): void;

  // Custom: --json body required, no other shape.
  @cli_output_kind("custom")
  create(): void;

  /** Get an org-level API key by id. */
  @cli_calls("getApiKey", "positional")
  @cli_output_kind("kv")
  get(id: string): void;

  // Custom: --json body required.
  @cli_output_kind("custom")
  update(id: string): void;

  /** Delete an org-level API key. */
  @cli_calls("deleteApiKey", "positional")
  @cli_output_kind("kv")
  delete(id: string): void;

  /** Rotate API key for an agent. The runtime key is highlighted to
   *  stderr (one-time display) via the post callback. */
  @cli_maturity("stable")
  @cli_calls("rotateApiKey", "positional")
  @cli_output_kind("kv")
  @cli_output_post("highlightRuntimeKey")
  rotate(agentId: string): void;

  /** Revoke API key for an agent. */
  @cli_maturity("stable")
  @cli_calls("revokeApiKey", "positional")
  @cli_output_kind("kv")
  revoke(agentId: string): void;
}

@cli_command("webhook", "Webhook management (admin).")
interface Webhook {
  @cli_output_kind("custom") list(): void;
  @cli_output_kind("custom") create(): void;
  @cli_output_kind("custom") get(id: string): void;
  @cli_output_kind("custom") update(id: string): void;
  @cli_output_kind("custom") delete(id: string): void;
  @cli_output_kind("custom") test(id: string): void;
  @cli_output_kind("custom") regenerateSecret(id: string): void;
  @cli_output_kind("custom") deliveries(id: string): void;
}

@cli_command("sso", "SSO configuration (admin).")
interface Sso {
  @cli_output_kind("custom") status(): void;
  @cli_output_kind("custom") config(): void;
  @cli_output_kind("custom") getMetadata(): void;
  @cli_output_kind("custom") configureOidc(): void;
  @cli_output_kind("custom") configureSaml(): void;
  @cli_output_kind("custom") enforce(): void;
  @cli_output_kind("custom") delete(): void;
  @cli_output_kind("custom") verify(): void;
}

@cli_command("approval", "Approval queue management.")
@cli_maturity("stable")
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
@cli_maturity("stable")
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

  // Custom: required-field merge with --json fallback.
  @cli_output_kind("custom")
  export(): void;

  // Custom: --json body fallback.
  @cli_output_kind("custom")
  preview(): void;

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

  // Custom: returns binary file payload.
  @cli_output_kind("custom")
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
@cli_maturity("stable")
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
  @cli_output_kind("kv")
  delete(agentId: string, ruleId: string): void;

  // Custom: create / update / toggle take complex DTOs.
  @cli_output_kind("custom")
  create(agentId: string): void;
  @cli_output_kind("custom")
  update(agentId: string, ruleId: string): void;
  @cli_output_kind("custom")
  toggle(agentId: string, ruleId: string): void;

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
  @cli_output_kind("custom") health(): void;
  @cli_output_kind("custom") validate(): void;
  @cli_output_kind("custom") evaluate(): void;
  @cli_output_kind("custom") pollApproval(): void;
}

@cli_command("doctor", "Pre-flight checks for the local environment.")
@cli_maturity("stable")
interface Doctor {}

@cli_command("goal", "Goal alignment configuration.")
@cli_maturity("stable")
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

  // Custom: required-field merge with --json fallback + enum/range
  // validation that doesn't yet have a spec mapping (cross-field gating).
  @cli_maturity("experimental")
  @cli_output_kind("custom")
  update(agentId: string): void;
}

@cli_command("guardrail", "Guardrail management + testing.")
@cli_maturity("stable")
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
  @cli_output_kind("kv")
  delete(agentId: string, guardrailId: string): void;

  // Create / update / reorder / metrics / violations / test not e2e-tested.
  @cli_maturity("experimental")
  @cli_output_kind("custom")
  create(agentId: string): void;

  @cli_maturity("experimental")
  @cli_output_kind("custom")
  update(agentId: string, guardrailId: string): void;

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
  @cli_output_kind("custom") list(orgId: string): void;
  @cli_output_kind("custom") create(orgId: string): void;
  @cli_output_kind("custom") update(orgId: string, userId: string): void;
  @cli_output_kind("custom") assignRoles(orgId: string, userId: string): void;
  @cli_output_kind("custom") removeRoles(orgId: string, userId: string): void;
  @cli_output_kind("custom") remove(orgId: string): void;
  @cli_output_kind("custom") invite(orgId: string): void;
}

@cli_command("observe", "Observability dashboards + metrics.")
@cli_maturity("stable")
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
@cli_maturity("stable")
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

  // Custom: --json + name/domain/timezone merge.
  @cli_maturity("experimental")
  @cli_output_kind("custom")
  updateSettings(orgId: string): void;

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

  // The remaining org views still need their backend-method names + body shapes
  // pinned down before they can be spec-driven.
  @cli_maturity("experimental")
  @cli_output_kind("custom")
  governanceFeed(orgId: string): void;

  @cli_maturity("experimental")
  @cli_output_kind("custom")
  trustDriftLanes(orgId: string): void;

  @cli_maturity("experimental")
  @cli_output_kind("custom")
  governanceSlo(orgId: string): void;

  @cli_maturity("experimental")
  @cli_output_kind("custom")
  violationHeatcal(orgId: string): void;
}

@cli_command("policy", "Policy management.")
@cli_maturity("stable")
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

  // Custom: rego/dsl payload doesn't fit body-map.
  @cli_output_kind("custom")
  create(agentId: string): void;

  @cli_maturity("experimental")
  @cli_output_kind("custom")
  update(agentId: string, policyId: string): void;

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
@cli_maturity("stable")
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
  @cli_output_kind("custom")
  prune(agentId: string): void;
}

// `openbox setup` was removed - its `skill` / `mcp` subcommands are
// superseded by the dedicated top-level commands `skill install`,
// `mcp serve`, `claude-code install`, and `cursor install` (each has
// its own @cli_command interface above).

@cli_command("team", "Team management.")
@cli_maturity("stable")
interface Team {
  /** List teams. */
  @cli_calls("listTeams")
  @cli_pagination
  @cli_output_kind("list", "teams")
  list(orgId: string): void;

  /** Get team stats. */
  @cli_calls("getTeamStats", "positional")
  @cli_output_kind("kv")
  stats(orgId: string): void;

  /** Get team details. */
  @cli_calls("getTeam", "positional")
  @cli_output_kind("kv")
  get(orgId: string, teamId: string): void;

  /** Get team members. */
  @cli_calls("getTeamMembers")
  @cli_pagination
  @cli_output_kind("list", "members")
  members(orgId: string, teamId: string): void;

  // Custom: --json + name/desc/icon merge with at-least-one validation.
  @cli_output_kind("custom")
  create(orgId: string): void;

  // Custom: --json + name/desc/icon merge.
  @cli_output_kind("custom")
  update(orgId: string, teamId: string): void;

  /** Delete one or more teams. */
  @cli_calls("deleteTeams")
  @cli_output_kind("kv")
  delete(
    orgId: string,
    @cli_flag("Team IDs to delete")
    @cli_variadic
    @cli_required
    ids?: string[],
  ): void;

  /** Add users to a team. */
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
  @cli_calls("removeTeamMembers")
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
@cli_maturity("stable")
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
@cli_maturity("stable")
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
  @cli_maturity("experimental")
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
