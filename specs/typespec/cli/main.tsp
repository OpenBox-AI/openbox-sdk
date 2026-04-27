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

import "@openbox/typespec-cli";
import "@openbox/typespec-env";

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
