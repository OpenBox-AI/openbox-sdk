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
   * store. After this completes, every other openbox command picks
   * up the same credentials.
   */
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

  /**
   * Clear the local token store. Does not invalidate the upstream
   * session - call this before destroying the machine.
   */
  logout(): void;

  /**
   * Print the resolved profile of the currently authenticated user.
   * Useful as a smoke test ("am I logged into the right environment").
   * Output is human-readable by default and structured when --json
   * is set; the structured shape is `AuthProfileOutput`.
   */
  profile(): AuthProfileOutput;

  /** Refresh access tokens against the upstream session. */
  @cli_maturity("stable")
  refresh(): void;

  /** List the resolved permission set for the active credential. */
  @cli_maturity("experimental")
  permissions(): void;

  /** List enabled feature flags for the active credential. */
  @cli_maturity("experimental")
  features(): void;

  /** Change the local user's password against the upstream IdP. */
  @cli_maturity("experimental")
  changePassword(): void;

  /** List the roles the active user holds in the current org. */
  @cli_maturity("experimental")
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
  list(): void;
  create(): void;
  get(agentId: string): void;
  update(agentId: string): void;
  delete(agentId: string): void;
  audit(agentId: string): void;
}

@cli_command("aivss", "Agent AIVSS scoring.")
interface Aivss {
  calculate(): void;
}

@cli_command("api-key", "Agent + org-level API key management.")
@cli_maturity("stable")
interface ApiKey {
  // Org-level (programmatic API keys) - not yet e2e-tested, gated experimental.
  list(): void;
  create(): void;
  get(id: string): void;
  update(id: string): void;
  delete(id: string): void;
  // Agent-level (runtime obx_live_ keys) - e2e-tested, stable.
  @cli_maturity("stable")
  rotate(agentId: string): void;
  @cli_maturity("stable")
  revoke(agentId: string): void;
}

@cli_command("webhook", "Webhook management (admin).")
interface Webhook {
  list(): void;
  create(): void;
  get(id: string): void;
  update(id: string): void;
  delete(id: string): void;
  test(id: string): void;
  regenerateSecret(id: string): void;
  deliveries(id: string): void;
}

@cli_command("sso", "SSO configuration (admin).")
interface Sso {
  status(): void;
  config(): void;
  // `metadata` is a TypeSpec reserved keyword; the kebab-case
  // command name on the CLI is `metadata` regardless.
  getMetadata(): void;
  configureOidc(): void;
  configureSaml(): void;
  enforce(): void;
  delete(): void;
  verify(): void;
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

  // Custom: 3 positional args + body { action } - hybrid shape.
  @cli_output_kind("custom")
  decide(agentId: string, eventId: string, action: string): void;
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
  health(): void;
  validate(): void;
  evaluate(): void;
  pollApproval(): void;
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
  list(orgId: string): void;
  create(orgId: string): void;
  update(orgId: string, userId: string): void;
  assignRoles(orgId: string, userId: string): void;
  removeRoles(orgId: string, userId: string): void;
  remove(orgId: string): void;
  invite(orgId: string): void;
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
  get(orgId: string): void;
  settings(orgId: string): void;
  dashboard(orgId: string): void;
  sessions(orgId: string): void;
  approvals(orgId: string): void;
  // The remaining org views aren't yet e2e-tested.
  @cli_maturity("experimental")
  updateSettings(orgId: string): void;
  @cli_maturity("experimental")
  trends(orgId: string): void;
  @cli_maturity("experimental")
  approvalMetrics(orgId: string): void;
  @cli_maturity("experimental")
  approvalSla(orgId: string): void;
  @cli_maturity("experimental")
  approvalHistory(orgId: string): void;
  @cli_maturity("experimental")
  governanceFeed(orgId: string): void;
  @cli_maturity("experimental")
  trustDriftLanes(orgId: string): void;
  @cli_maturity("experimental")
  governanceSlo(orgId: string): void;
  @cli_maturity("experimental")
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
  list(orgId: string): void;
  stats(orgId: string): void;
  get(orgId: string, teamId: string): void;
  update(orgId: string, teamId: string): void;
  members(orgId: string, teamId: string): void;
  create(orgId: string): void;
  delete(orgId: string): void;
  addMembers(orgId: string, teamId: string): void;
  removeMembers(orgId: string, teamId: string): void;
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
  @cli_output_kind("custom")
  falsePositive(agentId: string, violationId: string, sourceType: string): void;
}
