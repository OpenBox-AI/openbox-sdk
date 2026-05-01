# OpenBox CLI: full command reference

The CLI surface is generated from `specs/typespec/cli/main.tsp`. This
file is a human-readable mirror. Per-language CLIs lower from the same
spec, so the command tree, flags, validators, and exit codes here are
protocol-level and apply across implementations.

Setup commands take their full request body via `--body <json>`. Read
commands and explicit output toggles use `--json` as a boolean that
emits machine-readable output. Both flags accept the same three input
modes for the `<json>` value: a raw JSON string, a file path prefixed
with `@`, or `-` to read from stdin.

Many subcommands are gated behind `--experimental`, also settable as
`OPENBOX_EXPERIMENTAL_LEVEL=experimental`. They do not appear in the
top-level `--help` until the flag is set.

Stable: `auth`, `config`, `agent`, `api-key`, `guardrail`, `policy`,
`behavior`, `session`, `trust`, `goal`, `approval`, `observe`,
`violation`, `org`, `team`, `audit`, `health`, `doctor`, `versions`.

Experimental: `aivss`, `member`, `core`, `mcp`, `skill`, `claude-code`,
`cursor`, `verify`, `webhook`, `sso`.

## Exit codes

| Exit | Meaning |
|------|---------|
| `0` | Success |
| `1` | Operational error: HTTP failure, network, auth issues at call time, or other non-input failures |
| `2` | User-input error. Input rejected by client-side validation before any HTTP call. Error messages include a `fix:` line and a `see:` pointer to the relevant skill reference |
| `3` | Permission denied by pre-flight check. The current role is missing a required permission for this env |
| `4` | Feature disabled in this env by the pre-flight feature gate |

Setup commands reject every input the OpenBox design says is broken
before touching the backend. `--stage both` exits 2. `--trigger
http_request` exits 2 because it is not a real enum value. `--verdict
2` without `--approval-timeout` exits 2. Rego containing `deny[msg]`
exits 2. Validators are declared in the spec via `@cli_validator`;
each language's emitter produces a registry of matching impls. The TS
implementation lives at `ts/src/validators/`. Failures always include
an actionable `fix:` hint.

## Table of contents

- [auth](#auth): X-API-Key store
- [agent](#agent): agent CRUD
- [api-key](#api-key): runtime key rotation
- [guardrail](#guardrail): guardrail management
- [policy](#policy): OPA policy management
- [behavior](#behavior): behavior rules
- [session](#session): session management
- [trust](#trust): trust scoring
- [aivss](#aivss): AIVSS risk assessment
- [goal](#goal): goal alignment
- [approval](#approval): approval workflows
- [observe](#observe): observability
- [violation](#violation): violations
- [org](#org): organization
- [team](#team): teams
- [member](#member): members
- [audit](#audit): audit logs
- [health](#health): health check
- [doctor](#doctor): local install diagnostic
- [verify](#verify): static lint
- [core](#core): core governance API
- [host integration](#host-integration-commands): claude-code, cursor, mcp, skill

---

## auth

The CLI authenticates to the backend with an org-level X-API-Key. Mint
keys in the dashboard FE under **Organization → API Keys**, then save
them locally with the commands below. Keys are persisted per env
(`production`, `staging`, `local`) in the on-disk token store.

### `openbox auth set-api-key`

Save an org-level X-API-Key for the active env. Without `--key`, the
command prompts on stderr.

| Option | Default | Description |
|--------|---------|-------------|
| `-k, --key <key>` | (prompt) | Pass the key directly instead of being prompted |

The CLI validates the key matches the org-key format
(`obx_key_<48 hex>`) before saving. Mismatched prefix exits with the
auth code.

### `openbox auth clear-api-key`

Remove the saved X-API-Key for the current env. No options.

### `openbox auth status`

Print whether an X-API-Key is saved for each env. No options. Output
is one line per env with the masked key prefix or `none`.

---

## agent

### `openbox agent list`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |
| `-s, --search <text>` | - | Search by name |
| `--status <n>` | - | Filter by status |
| `--team <id>` | - | Filter by team ID |
| `--tiers <tiers...>` | - | Filter by tiers |

> **The `token` field in this response is NOT the runtime API key.** It is an internal attestation token. The runtime API key has format `obx_live_*` or `obx_test_*` and only exists in the `agent create` response or after `api-key rotate`. Passing `agent.token` as `OPENBOX_API_KEY` makes core return 500: `invalid API key format. Expected format: obx_live_... or obx_test_...`.

### `openbox agent create`
| Option | Default | Description |
|--------|---------|-------------|
| `-n, --name <name>` | **required** | Agent name |
| `-d, --desc <text>` | - | Description |
| `-t, --team <ids...>` | - | Team IDs |
| `--type <type>` | `temporal` | Agent type |
| `--icon <icon>` | `robot` | Icon |
| `--body <json>` | - | Full JSON body (overrides other options) |

> **The response includes the runtime API key. Capture it now.** This is the only time the key is surfaced. `agent list` and `agent get` do not return it; the `token` field there is unrelated. To recover a lost key, run `openbox api-key rotate <agentId>`, which invalidates the previous one.

### `openbox agent get <agentId>`
Get agent details by ID.

### `openbox agent update <agentId>`
| Option | Description |
|--------|-------------|
| `-n, --name <name>` | Agent name |
| `-d, --desc <text>` | Description |
| `--type <type>` | Agent type |
| `--model <model>` | Model name |
| `--tags <tags...>` | Tags |
| `--team <ids...>` | Team IDs |
| `--body <json>` | Full JSON body |

### `openbox agent delete <agentId>`
Delete an agent by ID.

### `openbox agent audit <agentId>`

Cross-session health report. Pulls recent sessions plus configured
guardrails, policies, and behavior rules, then surfaces:

- Protocol pairing health: orphan Started or Completed events,
  sessions missing a terminal event, failed-activity counts.
- Verdict and `activity_type` distributions.
- Guardrail-to-event mismatches. A guardrail configured for an
  `activity_type` that never fires is a silent no-op.

| Option | Default | Description |
|--------|---------|-------------|
| `--sessions <n>` | `50` | Number of recent sessions to pull |
| `--max-events <n>` | `500` | Cap on events fetched per session |
| `--json` | `false` | Emit raw report as JSON |

Exits `2` on any protocol violation, mismatch, or dangling session, so
it works as a CI gate. Requires `read:agent`, `read:agent_session`,
`read:agent_guardrail`, `read:agent_policy`.

Pairs with `openbox session inspect <agentId> <sessionId>` for a
single-session deep dive and `openbox verify <path>` for static code
lint, completing the static, single, aggregate observability triad.

---

## api-key

### `openbox api-key rotate <agentId>`

Rotate the runtime API key for an agent. Returns a new `obx_live_*` or
`obx_test_*` key.

This is the only recovery path for a lost runtime API key. `agent get`
and `agent list` do not return it. Rotating invalidates the previous
key immediately, so any deployed client holding the old one breaks
until updated.

### `openbox api-key revoke <agentId>`
Revoke the runtime API key for an agent.

---

## guardrail

### `openbox guardrail list <agentId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |
| `--stage <stage>` | - | Filter by processing stage |

### `openbox guardrail create <agentId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-n, --name <name>` | **required** unless `--body` provides it | Guardrail name |
| `--type <type>` | **required** | Numeric ID `1`–`5` or the friendly name. `1`=PII, `2`=NSFW, `3`=Toxicity, `4`=BanList, `5`=Regex |
| `--stage <stage>` | `0` | Processing stage. `0`=input, `1`=output. Must be 0 or 1; never `both`. The validator service maps only those two values to a field prefix; anything else returns `None` and silently skips every event |
| `-d, --desc <text>` | - | Description |
| `--trust-impact <impact>` | - | `none\|low\|medium\|high` |
| `--trust-threshold <n>` | - | Trust threshold |
| `--body <json>` | - | Full JSON body |

**Required `--body` params per type:**

| Type | Params | Settings |
|------|--------|----------|
| PII, `1` | `params.entities: string[]`, optional. Example: `["EMAIL_ADDRESS","US_SSN"]` | `settings.on_fail: 1` to block, `0` to redact |
| NSFW, `2` | none | `settings.on_fail: 1` |
| Toxicity, `3` | none | `settings.on_fail: 1` |
| BanList, `4` | `params.banned_words: string[]` is required. The validator cannot instantiate without it | `settings.on_fail: 1` |
| Regex, `5` | `params.regex: string` is required. Single pattern; use `\|` for alternation. `params.match_type: "search"` is optional | `settings.on_fail: 1` |

All types require `settings.activities: [{ activity_type: string,
fields_to_check: string[] }]`. The `activity_type` must match what the
client emits exactly; no wildcards. Common values: `PromptSubmission`,
`LLMCompleted`, `ToolCompleted`, `FileRead`, `FileEdit`,
`ShellExecution`, `MCPToolCall`, `DefaultActivity`. `DefaultActivity`
is the SDK default; override per-binding via `config.activityType`.
The full canonical union is in `references/governance-flow.md` §
"Canonical `activity_type` Names". Custom strings work as long as
client emit and guardrail config agree.

**Examples:**
```bash
# Ban words.
openbox guardrail create <agentId> -n "Injection Words" --type ban_words --stage 0 \
  --body '{"params":{"banned_words":["ignore","bypass","jailbreak"]},"settings":{"on_fail":1,"log_violation":true,"activities":[{"activity_type":"DefaultActivity","fields_to_check":["input.*.text"]}]}}'

# Regex with alternation.
openbox guardrail create <agentId> -n "Injection Pattern" --type regex --stage 0 \
  --body '{"params":{"regex":"(ignore.*previous|reveal.*system.*prompt)","match_type":"search"},"settings":{"on_fail":1,"log_violation":true,"activities":[{"activity_type":"DefaultActivity","fields_to_check":["input.*.text"]}]}}'
```

### `openbox guardrail get <agentId> <guardrailId>`
### `openbox guardrail update <agentId> <guardrailId>`
| Option | Description |
|--------|-------------|
| `-n, --name <name>` | Guardrail name |
| `--active <bool>` | Active status |
| `--type <type>` | Guardrail type |
| `--stage <stage>` | Processing stage |
| `-d, --desc <text>` | Description |
| `--trust-impact <impact>` | `none\|low\|medium\|high` |
| `--trust-threshold <n>` | Trust threshold |
| `--body <json>` | Full JSON body |

### `openbox guardrail delete <agentId> <guardrailId>`
### `openbox guardrail reorder <agentId> <guardrailId> <order>`
Reorder guardrail to the given position.

### `openbox guardrail metrics <agentId>`
| Option | Description |
|--------|-------------|
| `--from <date>` | Start date (ISO 8601) |
| `--to <date>` | End date (ISO 8601) |

### `openbox guardrail violations <agentId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |
| `--from <date>` | - | Start date |
| `--to <date>` | - | End date |
| `--type <type>` | - | Guardrail type filter |

### `openbox guardrail test`
| Option | Description |
|--------|-------------|
| `--type <type>` | Guardrail type |
| `--body <json>` | Full test payload |

---

## policy

### `openbox policy list <agentId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |

### `openbox policy create <agentId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-n, --name <name>` | **required** | Policy name |
| `-d, --desc <text>` | - | Description |
| `--rego <code>` | - | Rego policy code |
| `--rego-file <path>` | - | Read rego from file |
| `--input <json>` | - | Input JSON |
| `--trust-impact <impact>` | - | `none\|low\|medium\|high` |
| `--trust-threshold <n>` | - | Trust threshold |
| `--body <json>` | - | Full JSON body |

**This is how you rotate rego.** Policies are immutable once created.
The backend's `createPolicy` transaction deactivates every prior
policy on the agent by setting `is_active=false` and
`is_current_version=false`, then inserts the new one with
`is_current_version=true`. Old versions remain as rollback targets.

### `openbox policy current <agentId>`
Get current active policies.

### `openbox policy get <agentId> <policyId>`
### `openbox policy update <agentId> <policyId>`
**Rollback or toggle only; not a rego editor.** The backend
`UpdatePolicyDto` accepts only `is_active`, `trust_impact`, and
`trust_threshold`. Any `rego_code` in the request body is silently
dropped by the DTO whitelist pipe. To change rego, use
`policy create`.

The `PUT` handler also flips `is_current_version=true` on the targeted
policy after zeroing every other policy on the agent. Calling
`policy update <agentId> <oldPolicyId> --active true` is therefore how
you **roll back** to a previous version.

**`--active` is required** by the backend. Omitting it returns 422
with `is_active must be a boolean value`. The CLI defaults the flag
to `false` when missing, which silently deactivates the policy. Pass
`--active true` explicitly when activating or rolling back.

| Option | Description |
|--------|-------------|
| `--active <bool>` | Active status. **Required by backend.** |
| `--trust-impact <impact>` | `none\|low\|medium\|high` |
| `--trust-threshold <n>` | Trust threshold |
| `--body <json>` | Full JSON body. Must include `is_active`. |

### `openbox policy evaluations <agentId> <policyId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |

### `openbox policy metrics <agentId>`
| Option | Description |
|--------|-------------|
| `--from <date>` | Start date |
| `--to <date>` | End date |

### `openbox policy evaluate`
| Option | Required | Description |
|--------|----------|-------------|
| `--rego <code>` | Yes | Rego policy code |
| `--input <json>` | Yes | Input JSON |

---

## behavior

### `openbox behavior types`
Get available semantic types. No arguments.

> Backend route is singular: `GET /agent/{id}/behavior-rule`, not
> `behavior-rules`. The response uses `rule_name`, not `name`.

### `openbox behavior list <agentId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |
| `--verdict <n>` | - | Filter by verdict. `0`=ALLOW, `1`=CONSTRAIN, `2`=REQUIRE_APPROVAL, `3`=BLOCK, `4`=HALT |
| `--active <bool>` | - | Filter by active status |
| `--trigger <trigger>` | - | Filter by trigger type |

### `openbox behavior current <agentId>`
Get current active behavior rules.

### `openbox behavior create <agentId>`

Valid `--trigger` and `--states` values; anything else returns 422:
`http_get`, `http_post`, `http_put`, `http_patch`, `http_delete`,
`http`, `llm_completion`, `llm_embedding`, `llm_tool_call`,
`database_select`, `database_insert`, `database_update`,
`database_delete`, `database_query`, `file_read`, `file_write`,
`file_open`, `file_delete`, `internal`. Shell commands map to
`internal`. There is no dedicated shell type.

| Option | Default | Description |
|--------|---------|-------------|
| `-n, --name <name>` | **required** | Rule name |
| `--trigger <trigger>` | **required** | Trigger type from the valid list above |
| `--states <states...>` | **required** | State triggers from the valid list above |
| `--window <n>` | **required** | Time window in seconds |
| `--verdict <n>` | **required** | `0`=ALLOW, `1`=CONSTRAIN, `2`=REQUIRE_APPROVAL, `3`=BLOCK, `4`=HALT |
| `--message <text>` | **required** | Reject message |
| `--priority <n>` | `1` | Priority |
| `-d, --desc <text>` | - | Description |
| `--trust-impact <impact>` | - | `none\|low\|medium\|high` |
| `--trust-threshold <n>` | - | Trust threshold |
| `--approval-timeout <n>` | - | Approval timeout in seconds |
| `--body <json>` | - | Full JSON body |

### `openbox behavior get <agentId> <ruleId>`
### `openbox behavior update <agentId> <ruleId>`
| Option | Required | Description |
|--------|----------|-------------|
| `--body <json>` | Yes | Full JSON body |

### `openbox behavior delete <agentId> <ruleId>`
### `openbox behavior restore <agentId> <ruleId>`
Restore a deleted behavior rule.

### `openbox behavior toggle <agentId> <ruleId>`
| Option | Required | Description |
|--------|----------|-------------|
| `--active <bool>` | Yes | Active status |

### `openbox behavior versions <agentId> <groupId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |

### `openbox behavior metrics <agentId>`
| Option | Description |
|--------|-------------|
| `--from <date>` | Start date |
| `--to <date>` | End date |

### `openbox behavior violations <agentId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |

---

## session

### `openbox session list <agentId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |
| `--status <status>` | - | `pending\|completed\|failed\|blocked\|halted` |
| `--from <date>` | - | Start date |
| `--to <date>` | - | End date |
| `--duration <dur>` | - | `<1min\|1-5mins\|5-15mins\|>15mins` |
| `-s, --search <text>` | - | Search |

### `openbox session active <agentId>`
### `openbox session get <agentId> <sessionId>`
### `openbox session logs <agentId> <sessionId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |
| `--event-type <type>` | - | Event type filter |

### `openbox session goal-stats <agentId> <sessionId>`
### `openbox session trace <agentId> <sessionId>`
### `openbox session terminate <agentId> <sessionId>`

### `openbox session inspect <agentId> <sessionIdOrWorkflowId>`

Validates the client-side workflow protocol against a real session.
Fetches the session's events with pagination, then checks:

- Exactly one `WorkflowStarted`.
- Every `ActivityStarted` paired with an `ActivityCompleted` carrying
  the same `activity_id`. Dangling or orphan completes are failures.
- A terminal `WorkflowCompleted` or `WorkflowFailed` is present.
- `workflow_id` and `run_id` are consistent across every event.

Accepts either a session UUID or a `workflow_id` string. The
`workflow_id` form resolves via `listSessions(search: ...)`. Exits 2
on protocol violations so CI can gate on it.

### `openbox session prune <agentId>`

Bulk-terminates dangling `PENDING` sessions older than the specified
threshold. Use this when a misbehaving integration has left hundreds
of open sessions. The common failure mode is putting the terminal
event in the happy path instead of a `finally` or `defer` block.

| Option | Default | Description |
|--------|---------|-------------|
| `--older-than <duration>` | - | **Required.** `30s`, `5m`, `2h`, `1d`, or bare seconds. No default; must be set explicitly to avoid accidentally terminating live sessions |
| `--dry-run` | `false` | List what would be terminated without calling terminate |
| `--limit <n>` | `1000` | Cap on number to terminate in one run |

Lists candidates, terminates via
`PATCH /agents/:agentId/sessions/:sessionId/terminate` one by one,
and reports progress. Exits 1 if any terminations fail. Requires
`read:agent_session` and `manage:agent_session`.

---

## trust

### `openbox trust histories <agentId>`
| Option | Default | Description |
|--------|---------|-------------|
| `--duration <dur>` | `7d` | `7d\|30d\|90d\|1y` |

### `openbox trust events <agentId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |
| `--from <date>` | - | Start date |
| `--to <date>` | - | End date |

### `openbox trust tier-changes <agentId>`
Same options as `trust events`.

### `openbox trust recovery <agentId>`
Get trust recovery status. No options.

---

## aivss

### `openbox aivss assessments <agentId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |
| `--from <date>` | - | Start date |
| `--to <date>` | - | End date |

### `openbox aivss update <agentId>`
| Option | Required | Description |
|--------|----------|-------------|
| `--body <json>` | Yes | AIVSS config JSON |
| `--reason <text>` | Yes | Reason for update |

### `openbox aivss recalculate <agentId>`
Recalculate AIVSS score. No options.

### `openbox aivss calculate`
| Option | Required | Description |
|--------|----------|-------------|
| `--body <json>` | Yes | AIVSS config JSON |

---

## goal

### `openbox goal update <agentId>`

All four config fields are required unless you pass `--body`. Omitting
any of them exits 2 locally with a list of the missing flags. The
backend `GoalAlignmentConfigDto` marks them all required, so a partial
update is always rejected.

| Option | Required | Description |
|--------|----------|-------------|
| `--threshold <n>` | Yes | Alignment threshold, integer 0-100. Validated locally |
| `--action <action>` | Yes | `alert_only`, `constrain`, or `terminate`. Validated locally |
| `--frequency <freq>` | Yes | `every_action`, `every_5_actions`, `every_10_actions`, or `session_end_only`. Validated locally |
| `--model <model>` | Yes | LlamaFirewall model name. Backend enforces the enum; CLI forwards whatever value you give |
| `--body <json>` | No | Full JSON body. Bypasses the four-flag requirement |

### `openbox goal trend <agentId>`
| Option | Description |
|--------|-------------|
| `--from <date>` | Start date |
| `--to <date>` | End date |

### `openbox goal drifts <agentId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-l, --limit <n>` | `10` | Number of drifts |

---

## approval

### `openbox approval metrics <agentId>`
| Option | Description |
|--------|-------------|
| `--from <date>` | Start date |
| `--to <date>` | End date |

### `openbox approval pending <agentId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |
| `-s, --search <text>` | - | Search |
| `--status <status>` | - | Status filter |
| `--tiers <tiers...>` | - | Tier filter |
| `--from <date>` | - | Start date |
| `--to <date>` | - | End date |

### `openbox approval history <agentId>`
Same options as `approval pending`.

### `openbox approval decide <agentId> <eventId> <action>`
Action must be `approve` or `reject`.

---

## observe

### `openbox observe data <agentId>`
| Option | Description |
|--------|-------------|
| `--from <date>` | Start date |
| `--to <date>` | End date |

### `openbox observe issues <agentId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |

### `openbox observe insights <agentId>`
| Option | Description |
|--------|-------------|
| `--from <date>` | Start date |
| `--to <date>` | End date |

### `openbox observe logs <agentId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |

### `openbox observe drift <agentId>`
Same options as `observe logs`.

### `openbox observe metrics`
Get global agent metrics. No arguments or options.

---

## violation

### `openbox violation list`
Get all violations. No arguments or options.

### `openbox violation agent <agentId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |
| `--pattern <pattern>` | - | Pattern filter |
| `--source-type <type>` | - | Source type filter |

### `openbox violation false-positive <agentId> <violationId> <sourceType>`
Mark a violation as false positive.

---

## org

### `openbox org get <orgId>`
### `openbox org settings <orgId>`
### `openbox org update-settings <orgId>`
| Option | Description |
|--------|-------------|
| `-n, --name <name>` | Organization name |
| `--domain <domain>` | Domain |
| `--timezone <tz>` | Timezone |
| `--body <json>` | Full JSON body |

### `openbox org dashboard <orgId>`
| Option | Description |
|--------|-------------|
| `--from <date>` | Start date |
| `--to <date>` | End date |

### `openbox org trends <orgId>`
### `openbox org sessions <orgId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |
| `--status <status>` | - | Status filter |
| `--from <date>` | - | Start date |
| `--to <date>` | - | End date |
| `-s, --search <text>` | - | Search |

### `openbox org approvals <orgId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |
| `-s, --search <text>` | - | Search |
| `--status <status>` | - | Status filter |
| `--from <date>` | - | Start date |
| `--to <date>` | - | End date |

### `openbox org approval-metrics <orgId>`
| Option | Description |
|--------|-------------|
| `--from <date>` | Start date |
| `--to <date>` | End date |

### `openbox org approval-sla <orgId>`
### `openbox org approval-history <orgId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |

---

## team

### `openbox team list <orgId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |

### `openbox team stats <orgId>`
### `openbox team get <orgId> <teamId>`
### `openbox team update <orgId> <teamId>`
| Option | Description |
|--------|-------------|
| `-n, --name <name>` | Team name |
| `-d, --desc <text>` | Description |
| `--icon <icon>` | Icon |
| `--body <json>` | Full JSON body |

### `openbox team members <orgId> <teamId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |

### `openbox team create <orgId>`
At least one of `--name` or `--icon` is required unless `--body` is
provided.

| Option | Description |
|--------|-------------|
| `-n, --name <name>` | Team name |
| `-d, --desc <text>` | Description |
| `--icon <icon>` | Icon URL |
| `--body <json>` | Full JSON body |

### `openbox team delete <orgId>`
| Option | Required | Description |
|--------|----------|-------------|
| `--ids <ids...>` | Yes | Team IDs to delete; one or more |

### `openbox team add-members <orgId> <teamId>`
| Option | Required | Description |
|--------|----------|-------------|
| `--user-ids <ids...>` | Yes | User IDs to add |

### `openbox team remove-members <orgId> <teamId>`
| Option | Required | Description |
|--------|----------|-------------|
| `--user-ids <ids...>` | Yes | User IDs to remove |

---

## member

### `openbox member list <orgId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |

### `openbox member create <orgId>`
| Option | Default | Description |
|--------|---------|-------------|
| `--username <name>` | **required** | Username |
| `--email <email>` | **required** | Email |
| `--first-name <name>` | `""` | First name |
| `--last-name <name>` | `""` | Last name |
| `--password <pass>` | - | Password |
| `--verified` | `false` | Email verified |
| `--body <json>` | - | Full JSON body |

### `openbox member update <orgId> <userId>`
| Option | Description |
|--------|-------------|
| `--role <role>` | Role |
| `--teams <ids...>` | Team IDs |
| `--body <json>` | Full JSON body |

### `openbox member assign-roles <orgId> <userId>`
| Option | Required | Description |
|--------|----------|-------------|
| `--roles <roles...>` | Yes | Role names |

### `openbox member remove-roles <orgId> <userId>`
| Option | Required | Description |
|--------|----------|-------------|
| `--roles <roles...>` | Yes | Role names |

### `openbox member remove <orgId>`
| Option | Required | Description |
|--------|----------|-------------|
| `--ids <ids...>` | Yes | Member IDs to remove |

### `openbox member invite <orgId>`
| Option | Required | Description |
|--------|----------|-------------|
| `--email <email>` | Yes | Email address |
| `--roles <roles...>` | Yes | Role names. The backend's `InviteUserDto.roles` is `@ArrayNotEmpty`, so passing zero roles exits 2 locally |

---

## audit

### `openbox audit list`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |
| `--event-type <type>` | - | Event type filter |
| `--actor <id>` | - | Actor ID |
| `--result <result>` | - | `success\|failed\|denied\|warning\|approved\|allowed` |
| `-s, --search <text>` | - | Search |
| `--from <date>` | - | Start date |
| `--to <date>` | - | End date |

### `openbox audit get <logId>`
### `openbox audit export`
| Option | Default | Description |
|--------|---------|-------------|
| `-n, --name <name>` | **required** | Export name |
| `--event-types <types...>` | - | Event types |
| `--actor <id>` | - | Actor ID |
| `--result <result>` | - | Result filter |
| `-s, --search <text>` | - | Search |
| `--from <date>` | - | Start date |
| `--to <date>` | - | End date |
| `--body <json>` | - | Full JSON body |

### `openbox audit preview`
| Option | Description |
|--------|-------------|
| `--event-types <types...>` | Event types |
| `--from <date>` | Start date |
| `--to <date>` | End date |
| `--body <json>` | Full JSON body |

### `openbox audit exports`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |
| `--status <status>` | - | `pending\|processing\|completed\|failed` |
| `--from <date>` | - | Start date |
| `--to <date>` | - | End date |

### `openbox audit download <exportId>`
### `openbox audit delete-export <exportId>`

---

## health

### `openbox health`
Check backend API health. No arguments or options.

---

## verify

### `openbox verify [path]`

Static lint. Scans integration code in TS, JS, Python, Go, Java,
Kotlin, and Rust for OpenBox protocol drift. 14 rules split across
two purposes:

- **Design enforcement**: the live CLI cannot catch these because they
  live in user code.
- **Protocol conformance**: what a live raw-HTTP integration must get
  right to actually work.

Any integration, SDK-based or raw HTTP, that passes `verify` clean
conforms to the OpenBox design.

| Rule | Severity | Catches |
|---|---|---|
| `activity_input-must-be-array` | error | `"activity_input": {` as an object instead of `[{}]`. The #1 cause of 422s |
| `invented-verdict` | error | `"deny"`, `"ask"`, or `"constrain"` in verdict comparison contexts |
| `stage-both-silent-noop` | error | `--stage both` or `processing_stage: "both"`. Silently ignored |
| `missing-x-openbox-client-header` | error | Calls to `api.openbox.ai` with no `X-Openbox-Client` header |
| `non-canonical-event-type` | error | `event_type` outside the six canonical values: `WorkflowStarted`, `SignalReceived`, `ActivityStarted`, `ActivityCompleted`, `WorkflowCompleted`, `WorkflowFailed` |
| `invented-activity-type` | warn | Non-canonical names like `LLMCompletion`, `LLMInvocation`, `ToolInvocation`, `FileReading`. Silently miss guardrail config |
| `raw-approval-response-verdict` | warn | Raw-HTTP callers reading `.verdict` from `/governance/approval`. The wire field is `.action` |
| `hardcoded-uuid` | warn | UUID literals assigned to `agentId`, `teamId`, or `orgId` variables |
| `span-missing-gate-attribute` | warn | HTTP, DB, or file spans constructed without the gate attribute the classifier needs: `http.method`, `db.system`, `file.path`. Behavior rules will not fire |
| `id-generated-per-event-not-reused` | warn | `workflow_id` or `run_id` generated inline per event instead of once per session and reused |
| `approval-poll-unbounded` | warn | Approval polling loop without a visible timeout, deadline, or `approval_expiration_time` check. Can hang forever |
| `require-approval-no-hitl-enabled` | warn | Code branches on `require_approval` but SDK config is missing `hitlEnabled: true`, or the raw-HTTP path has no polling loop |
| `missing-finally-workflow-complete` | info | `WorkflowStarted` emitted without a `finally`, `defer`, or `except` closer nearby |
| `activity-started-without-completed` | info | `ActivityStarted` without a paired `ActivityCompleted` in the same scope |

Defaults to scanning `cwd()`. Skips `node_modules`, `dist`, `build`,
`.git`, `__pycache__`. Comments are stripped before identifier-presence
rules run, so `// missing X-Openbox-Client` does not fool the check.

| Option | Default | Description |
|--------|---------|-------------|
| `[path]` | `.` | File or directory to scan |
| `--fail-on <severity>` | `error` | Exit non-zero on this severity or worse: `error`, `warn`, or `info` |
| `--json` | `false` | Emit findings as JSON instead of human-readable |

Exit codes: `0` if clean or findings stay below the `--fail-on`
threshold; `1` if findings reach or pass it.

Intended as a pre-commit or CI gate. Complements
`openbox session inspect`, the runtime protocol check against live
sessions: `verify` catches bugs in code before ship; `session inspect`
catches bugs in events after they fire.

---

## doctor

### `openbox doctor`

End-to-end local install diagnostic for the currently selected env.
Runs these checks and prints a one-line summary per check with a
`✓`, `!`, `✗`, or `-` marker:

1. Token store exists.
2. X-API-Key present for the env.
3. Backend URL reachable via `GET /health`.
4. Core URL reachable via `GET /health`. Skipped unless
   `OPENBOX_API_KEY` is set.
5. Core API key valid via `GET /auth/validate`. Skipped unless a
   runtime key is present.
6. Token file format. Warns when a legacy flat layout is detected;
   the codec auto-migrates on the next save.

Exits 1 if any check fails. Use in CI to gate deploys, or run manually
when auth is misbehaving. No flags.

---

## core

### `openbox core health`
Check core governance API health.

### `openbox core validate`
Validate the runtime API key against the core API.

### `openbox core evaluate`

Supports two modes: raw JSON or `--type` shorthand.

**Raw JSON mode:**

| Option | Description |
|--------|-------------|
| `--json <json>` | GovernanceEventPayload as JSON. Supports `@file` and `-` stdin |

**Type shorthand mode** builds the payload automatically. The flags
below apply only to the matching `--type` value.

| Option | Used with | Description |
|--------|-----------|-------------|
| `--type <type>` | always | Span type: `llm`, `file_read`, `file_write`, `shell`, `http`, `db`, `mcp` |
| `--activity-type <name>` | always | Override `activity_type`. Default depends on `--type` |
| `--prompt <text>` | `llm` | Prompt text, or `@file.txt` to read from file |
| `--model <model>` | `llm` | Model name |
| `--file-path <path>` | `file_read`, `file_write` | File path. Content auto-reads if `--content` is omitted |
| `--content <text>` | `file_read`, `file_write` | File content, or `@file.txt` |
| `--command <cmd>` | `shell` | Shell command, or `@script.sh` |
| `--cwd <dir>` | `shell` | Working directory |
| `--method <method>` | `http` | HTTP method |
| `--url <url>` | `http` | HTTP URL |
| `--db-system <system>` | `db` | Database system |
| `--db-operation <op>` | `db` | Database operation |
| `--db-statement <sql>` | `db` | SQL statement, or `@query.sql` |
| `--tool-name <name>` | `mcp` | MCP tool name |
| `--server <name>` | `mcp` | MCP server name |
| `--tool-input <input>` | `mcp` | MCP tool input, or `@input.json` |
| `--show-payload` | always | Print constructed payload without sending |

### `openbox core poll-approval`
| Option | Required | Description |
|--------|----------|-------------|
| `--workflow-id <id>` | Yes | Workflow ID |
| `--run-id <id>` | Yes | Run ID |
| `--activity-id <id>` | Yes | Activity ID |

---

## Host integration commands

Each LLM host has its own top-level subcommand: an install command
plus a per-event hook entry. Supported hosts are Claude Code, Cursor,
and MCP-compatible hosts.

### `openbox claude-code install [--uninstall]`

Writes the OpenBox hook block into `~/.claude/settings.json` and
points each Claude Code hook event at `openbox claude-code hook`.
`--uninstall` removes the block.

### `openbox cursor install [--uninstall]`

Writes the OpenBox hook block into `~/.cursor/hooks.json` and points
each Cursor hook event at `openbox cursor hook`. `--uninstall` removes
the block.

### `openbox mcp serve`

Long-running stdio MCP server. Configure your MCP host to spawn this
command:

```jsonc
// ~/.config/Claude/claude_desktop_config.json or equivalent
{ "mcpServers": { "openbox": { "command": "openbox", "args": ["mcp", "serve"] } } }
```

### `openbox skill install [--cursor] [--target <dir>]`

Copies `SKILL.md` and `references/` from the installed `openbox-sdk`
package into `~/.claude/skills/openbox/`. Pass `--cursor` to install
into `~/.cursor/skills/openbox/` instead. Re-run to update.
