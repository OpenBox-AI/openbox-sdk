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

import "openbox-sdk/typespec-cli";
import "openbox-sdk/typespec-env";

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

@cli_command("auth-extras")
interface AuthExtras {
  permissions(): void;
  features(): void;
  refresh(): void;
  // hyphenated subcommands - generated long form is `change-password`.
  changePassword(): void;
  roles(): void;
}

@cli_command("agent", "Agent management.")
interface Agent {
  list(): void;
  create(): void;
}

@cli_command("aivss", "Agent AIVSS scoring.")
interface Aivss {
  calculate(): void;
}

@cli_command("api-key", "Agent API key rotation/revocation.")
interface ApiKey {
  rotate(agentId: string): void;
  revoke(agentId: string): void;
}

@cli_command("approval", "Approval queue management.")
interface Approval {
  metrics(agentId: string): void;
  pending(agentId: string): void;
  history(agentId: string): void;
  decide(agentId: string, eventId: string, action: string): void;
}

@cli_command("audit", "Audit log queries + exports.")
interface Audit {
  list(): void;
  export(): void;
  preview(): void;
  exports(): void;
}

@cli_command("behavior", "Behavior rule management.")
interface Behavior {
  types(): void;
}

@cli_command("core", "Direct access to the core governance API.")
interface Core {
  health(): void;
  validate(): void;
  evaluate(): void;
  pollApproval(): void;
}

@cli_command("doctor", "Pre-flight checks for the local environment.")
interface Doctor {}

@cli_command("goal", "Goal alignment configuration.")
interface Goal {}

@cli_command("guardrail", "Guardrail management + testing.")
interface Guardrail {
  test(): void;
}

@cli_command("health", "Backend health check.")
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
interface Observe {
  data(agentId: string): void;
  issues(agentId: string): void;
  insights(agentId: string): void;
  logs(agentId: string): void;
  drift(agentId: string): void;
  metrics(): void;
}

@cli_command("org", "Organization management.")
interface Org {
  get(orgId: string): void;
  settings(orgId: string): void;
  updateSettings(orgId: string): void;
  dashboard(orgId: string): void;
  trends(orgId: string): void;
  sessions(orgId: string): void;
  approvals(orgId: string): void;
  approvalMetrics(orgId: string): void;
  approvalSla(orgId: string): void;
  approvalHistory(orgId: string): void;
}

@cli_command("policy", "Policy management.")
interface Policy {
  list(agentId: string): void;
  create(agentId: string): void;
  current(agentId: string): void;
  get(agentId: string, policyId: string): void;
  update(agentId: string, policyId: string): void;
  evaluations(agentId: string, policyId: string): void;
  metrics(agentId: string): void;
  evaluate(): void;
}

@cli_command("session", "Session inspection + cleanup.")
interface Session {
  list(agentId: string): void;
  active(agentId: string): void;
  get(agentId: string, sessionId: string): void;
  logs(agentId: string, sessionId: string): void;
  goalStats(agentId: string, sessionId: string): void;
  trace(agentId: string, sessionId: string): void;
  terminate(agentId: string, sessionId: string): void;
  inspect(agentId: string, sessionIdOrWorkflowId: string): void;
  prune(agentId: string): void;
}

@cli_command("setup", "First-run helpers (skill / mcp / all).")
interface Setup {
  skill(): void;
  mcp(): void;
  all(): void;
}

@cli_command("team", "Team management.")
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
interface Trust {
  histories(agentId: string): void;
  events(agentId: string): void;
  tierChanges(agentId: string): void;
  recovery(agentId: string): void;
}

@cli_command("verify", "Lint an integration source file for governance bugs.")
interface Verify {}

@cli_command("versions", "Show deployed commit/tag for each service per env.")
interface Versions {}

@cli_command("violation", "Guardrail/policy/behavior violation queries.")
interface Violation {
  list(): void;
  agent(agentId: string): void;
  falsePositive(agentId: string, violationId: string, sourceType: string): void;
}
