# OpenBox CLI - Full Command Reference

All `--json` options support three input modes: raw JSON string, `@file.json` (file path), or `-` (stdin).

## Exit Codes

The CLI uses distinct exit codes so CI and scripts can branch on failure type:

| Exit | Meaning |
|------|---------|
| `0` | Success |
| `1` | Operational error (HTTP failure, network, auth-token issues at call time, or non-user-input command failures) |
| `2` | **User-input error** - input rejected by client-side validation before any HTTP call. Fix the command and retry. Error messages include a `fix:` line and a `see:` pointer to the relevant skill reference. |
| `3` | Permission denied by pre-flight check (your role is missing a required permission for this env) |
| `4` | Feature disabled in this env (pre-flight feature gate) |

Setup commands (`guardrail create`, `behavior create`, `policy create`, `agent create`) validate every input the OpenBox design says is broken **before** touching the backend. Examples: `--stage both` → exit 2; `--trigger http_request` → exit 2 (not a real enum value); `--verdict 2` without `--approval-timeout` → exit 2; rego containing `deny[msg]` → exit 2. The validator list is at `packages/cli/src/validators/index.ts` in the openbox-sdk repo; failures always include an actionable `fix:` hint.

## Table of Contents

- [auth](#auth) - Authentication
- [agent](#agent) - Agent CRUD
- [api-key](#api-key) - API key management
- [guardrail](#guardrail) - Guardrail management
- [policy](#policy) - OPA policy management
- [behavior](#behavior) - Behavior rules
- [session](#session) - Session management
- [trust](#trust) - Trust scoring
- [aivss](#aivss) - AIVSS risk assessment
- [goal](#goal) - Goal alignment
- [approval](#approval) - Approval workflows
- [observe](#observe) - Observability
- [violation](#violation) - Violations
- [org](#org) - Organization
- [team](#team) - Teams
- [member](#member) - Members
- [audit](#audit) - Audit logs
- [health](#health) - Health check
- [doctor](#doctor) - Local install diagnostic
- [verify](#verify) - Static lint of integration code
- [core](#core) - Core governance API

---

## auth

### `openbox auth profile`
Get current user profile. No arguments or options.

### `openbox auth login`
Launch the browser-based login flow. Spawns a local callback server and opens the platform URL for the selected env. Saves the resulting tokens (and permissions + feature flags) to the env-namespaced token file.

| Option | Default | Description |
|--------|---------|-------------|
| `--browser <name>` | system default | Force a specific browser (chrome, safari, firefox, …) |
| `--url <url>` | env's platform URL | Override the login page (for local dev) |
| `--verbose` | `false` | Log callback server events to stderr |

### `openbox auth set-token <token> [refreshToken]`
Save access token (and optional refresh token) to local token file.

### `openbox auth permissions` (alias: `perms`)
Inspect the granular Keycloak permissions attached to the current access token for the selected env.

| Option | Default | Description |
|--------|---------|-------------|
| `--all` | `false` | Show permissions for both production and staging side-by-side |
| `--compare` | `false` | Highlight permissions present in one env but missing in the other |
| `--refresh` | `false` | Force a fresh fetch instead of reading from the cached `.PERMISSIONS` line |

### `openbox auth features`
Inspect the org feature flags (`api_keys`, `webhooks`, `sso`, …) the current env exposes. Used by the pre-flight feature gate on commands wrapped by `@RequireFeature` decorators on the backend.

| Option | Default | Description |
|--------|---------|-------------|
| `--all` | `false` | Show features for both envs side-by-side |
| `--refresh` | `false` | Force a fresh fetch instead of reading from the cached `.FEATURES` line |

### `openbox auth refresh`
Refresh the access token using the stored refresh token.

**Currently disabled** in the TS CLI (`REFRESH_ENABLED = false`) - backend `POST /auth/refresh` has two unfixed upstream bugs described in `references/backend-api.md` § "`POST /auth/refresh` Caveats". The CLI stays inside the backend boundary and does NOT work around this by hitting the identity provider directly. Recovery paths: `openbox auth login` (browser) or `openbox auth set-token <token>` (paste). Both go through the normal backend flow.

### `openbox auth change-password`
| Option | Required | Description |
|--------|----------|-------------|
| `--current <password>` | Yes | Current password |
| `--new <password>` | Yes | New password |
| `--org-id <orgId>` | Yes | Organization ID |

### `openbox auth roles`
Get current user's roles. No arguments or options.

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

> **The `token` field in this response is NOT the runtime API key.** It's an internal attestation token. The runtime API key (`obx_live_*` / `obx_test_*`) only exists in the `agent create` response or after `api-key rotate`. Do not pass `agent.token` as `OPENBOX_API_KEY` - core will reject it with 500 ("invalid API key format. Expected format: obx_live_... or obx_test_...").

### `openbox agent create`
| Option | Default | Description |
|--------|---------|-------------|
| `-n, --name <name>` | **required** | Agent name |
| `-d, --desc <text>` | - | Description |
| `-t, --team <ids...>` | - | Team IDs |
| `--type <type>` | `temporal` | Agent type |
| `--icon <icon>` | `robot` | Icon |
| `--json <json>` | - | Full JSON body (overrides other options) |

> **The response includes the runtime API key (`obx_live_*` / `obx_test_*`) - capture it now.** This is the *only* time it's surfaced. `agent list`/`get` won't return it later (the `token` field there is unrelated). To recover a lost key: `openbox api-key rotate <agentId>` (which invalidates the previous one).

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
| `--json <json>` | Full JSON body |

### `openbox agent delete <agentId>`
Delete an agent by ID.

### `openbox agent audit <agentId>`
Cross-session health report. Pulls recent sessions + configured guardrails/policies/behavior rules, surfaces protocol pairing health (orphan Started/Completed events, sessions missing terminal, failed-activity count), verdict + activity_type distributions, and guardrail↔event mismatches (guardrails configured for activity_types never seen in events = silent no-ops).

| Option | Default | Description |
|--------|---------|-------------|
| `--sessions <n>` | `50` | Number of recent sessions to pull |
| `--max-events <n>` | `500` | Cap events fetched per session |
| `--json` | `false` | Emit raw report as JSON |

Exit `2` on any protocol violation, mismatch, or dangling session - CI-gate friendly. Requires `read:agent`, `read:agent_session`, `read:agent_guardrail`, `read:agent_policy` permissions.

Pairs with `openbox session inspect <agentId> <sessionId>` (single session deep-dive) and `openbox verify <path>` (static code lint) for the "static + single + aggregate" observability triad.

---

## api-key

### `openbox api-key rotate <agentId>`
Rotate API key for an agent. Returns new `obx_live_*` / `obx_test_*` key.

This is the **only** recovery path for a lost runtime API key - `agent get`/`list` do not return it. Note that rotating **invalidates the previous key** immediately, so any deployed clients holding the old one will break until updated.

### `openbox api-key revoke <agentId>`
Revoke API key for an agent.

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
| `-n, --name <name>` | **required** | Guardrail name (unless `--json` provides it) |
| `--type <type>` | **required** | Guardrail type: `1`=PII, `2`=NSFW, `3`=Toxicity, `4`=BanList, `5`=Regex (or name) |
| `--stage <stage>` | `0` | Processing stage: `0`=input, `1`=output. Must be 0 or 1 - never use `both` (the guardrails service only maps those two to a field prefix; everything else returns `None` from `_get_field_check_prefix` and silently skips every event). CLI defaults to `0` if omitted. |
| `-d, --desc <text>` | - | Description |
| `--trust-impact <impact>` | - | `none\|low\|medium\|high` |
| `--trust-threshold <n>` | - | Trust threshold |
| `--json <json>` | - | Full JSON body |

**Required `--json` params per type:**

| Type | Params | Settings |
|------|--------|----------|
| PII (`1`) | `params.entities: string[]` (optional, e.g. `["EMAIL_ADDRESS","US_SSN"]`) | `settings.on_fail: 1` (block) or `0` (redact) |
| NSFW (`2`) | none | `settings.on_fail: 1` |
| Toxicity (`3`) | none | `settings.on_fail: 1` |
| BanList (`4`) | **`params.banned_words: string[]`** (REQUIRED - crashes without it) | `settings.on_fail: 1` |
| Regex (`5`) | **`params.regex: string`** (REQUIRED - single pattern, use `\|` for alternation), `params.match_type: "search"` | `settings.on_fail: 1` |

All types require `settings.activities: [{ activity_type: string, fields_to_check: string[] }]`. The `activity_type` must be an **exact string match** against what the client emits - no wildcards. Common values: `PromptSubmission`, `LLMCompleted`, `ToolCompleted`, `FileRead`, `FileEdit`, `ShellExecution`, `MCPToolCall`, `DefaultActivity` (openbox-sdk default - override via `config.activityType` for specific bindings). Full canonical union in `references/governance-flow.md` § "Canonical `activity_type` Names". Custom strings work but must match across both client emit and guardrail config.

**Examples:**
```bash
# Ban words
openbox guardrail create <agentId> -n "Injection Words" --type ban_words --stage 0 \
  --json '{"params":{"banned_words":["ignore","bypass","jailbreak"]},"settings":{"on_fail":1,"log_violation":true,"activities":[{"activity_type":"DefaultActivity","fields_to_check":["input.*.text"]}]}}'

# Regex (single pattern with alternation)
openbox guardrail create <agentId> -n "Injection Pattern" --type regex --stage 0 \
  --json '{"params":{"regex":"(ignore.*previous|reveal.*system.*prompt)","match_type":"search"},"settings":{"on_fail":1,"log_violation":true,"activities":[{"activity_type":"DefaultActivity","fields_to_check":["input.*.text"]}]}}'
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
| `--json <json>` | Full JSON body |

### `openbox guardrail delete <agentId> <guardrailId>`
### `openbox guardrail reorder <agentId> <guardrailId> <order>`
Reorder guardrail to given position.

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
| `--json <json>` | Full test payload |

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
| `--json <json>` | - | Full JSON body |

**This is how you rotate rego.** Policies are immutable once created; the backend's
`createPolicy` transaction deactivates every prior policy on the agent
(`is_active=false, is_current_version=false`) and inserts the new one as
`is_current_version=true`. Old versions remain as rollback targets.

### `openbox policy current <agentId>`
Get current active policies.

### `openbox policy get <agentId> <policyId>`
### `openbox policy update <agentId> <policyId>`
**Rollback / toggle only - not a rego editor.** The backend `UpdatePolicyDto`
accepts only `is_active`, `trust_impact`, and `trust_threshold`. Any `rego_code`
in the request body is silently dropped by the DTO whitelist pipe. To change
rego, use `policy create` (see above).

The `PUT` handler also flips `is_current_version=true` on the targeted policy
after zeroing every other policy on the agent - so calling `policy update
<agentId> <oldPolicyId> --active true` is how you **roll back** to a previous
version.

**`--active` is required** by the backend. Omitting it returns 422
`is_active must be a boolean value`. The current TS CLI defaults the flag to
`false` when missing, which silently deactivates the policy - pass
`--active true` explicitly when activating/rolling-back.

| Option | Description |
|--------|-------------|
| `--active <bool>` | Active status. **Required by backend.** |
| `--trust-impact <impact>` | `none\|low\|medium\|high` |
| `--trust-threshold <n>` | Trust threshold |
| `--json <json>` | Full JSON body. Must include `is_active`. |

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

**Backend API note:** The behavior rules endpoint is `GET /agent/{id}/behavior-rule` (singular, NOT `behavior-rules`). The response uses `rule_name` (not `name`).

### `openbox behavior list <agentId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |
| `--verdict <n>` | - | Filter by verdict (0-4: ALLOW / CONSTRAIN / REQUIRE_APPROVAL / BLOCK / HALT) |
| `--active <bool>` | - | Filter by active status |
| `--trigger <trigger>` | - | Filter by trigger type |

### `openbox behavior current <agentId>`
Get current active behavior rules.

### `openbox behavior create <agentId>`

**Valid `--trigger` and `--states` values** (anything else returns 422):
`http_get`, `http_post`, `http_put`, `http_patch`, `http_delete`, `http`, `llm_completion`, `llm_embedding`, `llm_tool_call`, `database_select`, `database_insert`, `database_update`, `database_delete`, `database_query`, `file_read`, `file_write`, `file_open`, `file_delete`, `internal`. Shell commands = `internal` (no dedicated shell type).

| Option | Default | Description |
|--------|---------|-------------|
| `-n, --name <name>` | **required** | Rule name |
| `--trigger <trigger>` | **required** | Trigger type (see valid values above) |
| `--states <states...>` | **required** | State triggers (see valid values above) |
| `--window <n>` | **required** | Time window (seconds) |
| `--verdict <n>` | **required** | 0=ALLOW, 1=CONSTRAIN, 2=REQUIRE_APPROVAL, 3=BLOCK, 4=HALT |
| `--message <text>` | **required** | Reject message |
| `--priority <n>` | `1` | Priority |
| `-d, --desc <text>` | - | Description |
| `--trust-impact <impact>` | - | `none\|low\|medium\|high` |
| `--trust-threshold <n>` | - | Trust threshold |
| `--approval-timeout <n>` | - | Approval timeout (seconds) |
| `--json <json>` | - | Full JSON body |

### `openbox behavior get <agentId> <ruleId>`
### `openbox behavior update <agentId> <ruleId>`
| Option | Required | Description |
|--------|----------|-------------|
| `--json <json>` | Yes | Full JSON body |

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
Validates the client-side workflow protocol against a real session. Fetches the session's events (paginated), then checks:
- Exactly one `WorkflowStarted`
- Every `ActivityStarted` paired with `ActivityCompleted` (same `activity_id`) - dangling or orphan completes are failures
- A terminal `WorkflowCompleted` or `WorkflowFailed` is present
- `workflow_id` and `run_id` are consistent across every event

Accepts either a session UUID or a `workflow_id` string (resolved via `listSessions(search: ...)`). Exits 2 on protocol violations so CI can gate on it.

### `openbox session prune <agentId>`
Bulk-terminates dangling `PENDING` sessions older than the specified threshold. Use this when a misbehaving integration has left hundreds of open sessions - common failure mode when the terminal event lives in the happy path instead of a `finally`/`defer` block.

| Option | Default | Description |
|--------|---------|-------------|
| `--older-than <duration>` | - | **Required.** `30s`, `5m`, `2h`, `1d`, or bare seconds. No default - must be set explicitly to avoid accidentally terminating live sessions. |
| `--dry-run` | `false` | List what would be terminated without calling terminate. |
| `--limit <n>` | `1000` | Cap on number to terminate in one run. |

Lists candidates, terminates via `PATCH /agents/:agentId/sessions/:sessionId/terminate` one-by-one, and reports progress. Exits 1 if any terminations fail. Requires `read:agent_session` and `manage:agent_session` permissions.

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
| `--json <json>` | Yes | AIVSS config JSON |
| `--reason <text>` | Yes | Reason for update |

### `openbox aivss recalculate <agentId>`
Recalculate AIVSS score. No options.

### `openbox aivss calculate`
| Option | Required | Description |
|--------|----------|-------------|
| `--json <json>` | Yes | AIVSS config JSON |

---

## goal

### `openbox goal update <agentId>`

All four config fields are required unless you pass `--json`. Omitting any of them exits 2 locally with a list of the missing flags - the backend `GoalAlignmentConfigDto` marks them all required, so a partial update is always rejected.

| Option | Required | Description |
|--------|----------|-------------|
| `--threshold <n>` | Yes (0-100) | Alignment threshold, validated locally as an integer |
| `--action <action>` | Yes | One of `alert_only\|constrain\|terminate` (validated locally) |
| `--frequency <freq>` | Yes | One of `every_action\|every_5_actions\|every_10_actions\|session_end_only` (validated locally) |
| `--model <model>` | Yes | LlamaFirewall model name. Backend enforces the enum - CLI forwards whatever value you give. |
| `--json <json>` | No | Full JSON body (bypasses the four-flag requirement) |

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
| `--json <json>` | Full JSON body |

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
| `--json <json>` | Full JSON body |

### `openbox team members <orgId> <teamId>`
| Option | Default | Description |
|--------|---------|-------------|
| `-p, --page <n>` | `0` | Page number |
| `-l, --limit <n>` | `10` | Items per page |

### `openbox team create <orgId>`
At least one of `--name` / `--icon` is required unless `--json` is provided.
| Option | Description |
|--------|-------------|
| `-n, --name <name>` | Team name |
| `-d, --desc <text>` | Description |
| `--icon <icon>` | Icon URL |
| `--json <json>` | Full JSON body |

### `openbox team delete <orgId>`
| Option | Required | Description |
|--------|----------|-------------|
| `--ids <ids...>` | Yes | Team IDs to delete (one or more) |

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
| `--json <json>` | - | Full JSON body |

### `openbox member update <orgId> <userId>`
| Option | Description |
|--------|-------------|
| `--role <role>` | Role |
| `--teams <ids...>` | Team IDs |
| `--json <json>` | Full JSON body |

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
| `--roles <roles...>` | Yes | Role names - backend `InviteUserDto.roles` is `@ArrayNotEmpty`, so passing zero roles exits 2 locally |

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
| `--json <json>` | - | Full JSON body |

### `openbox audit preview`
| Option | Description |
|--------|-------------|
| `--event-types <types...>` | Event types |
| `--from <date>` | Start date |
| `--to <date>` | End date |
| `--json <json>` | Full JSON body |

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
Static lint. Scans integration code (TS/JS/Python/Go/Java/Kotlin/Rust) for OpenBox protocol drift. 14 rules split across "design enforcement" (the CLI can't catch these because they're in user code) and "protocol conformance" (what a live raw-HTTP integration has to get right to actually work). Purpose: any integration - SDK-based or raw HTTP - that passes `verify` clean conforms to the OpenBox design:

| Rule | Severity | Catches |
|---|---|---|
| `activity_input-must-be-array` | error | `"activity_input": {` (object) instead of `[{}]` - #1 cause of 422s |
| `invented-verdict` | error | `"deny"`, `"ask"`, `"constrain"` in verdict comparison contexts |
| `stage-both-silent-noop` | error | `--stage both` (or `processing_stage: "both"`) - silently ignored |
| `missing-x-openbox-client-header` | error | Calls to `api.openbox.ai` with no `X-Openbox-Client` header |
| `non-canonical-event-type` | error | `event_type` outside the six canonical values (`WorkflowStarted`, `SignalReceived`, `ActivityStarted`, `ActivityCompleted`, `WorkflowCompleted`, `WorkflowFailed`) |
| `invented-activity-type` | warn | `LLMCompletion`, `LLMInvocation`, `ToolInvocation`, `FileReading`, etc. - non-canonical names silently miss guardrail config |
| `raw-approval-response-verdict` | warn | Raw-HTTP callers reading `.verdict` from `/governance/approval` response (wire field is `.action`) |
| `hardcoded-uuid` | warn | UUID literals assigned to `agentId`/`teamId`/`orgId` variables |
| `span-missing-gate-attribute` | warn | HTTP/DB/file spans constructed without the gate attribute the classifier needs (`http.method`, `db.system`, `file.path`) - behavior rules won't fire |
| `id-generated-per-event-not-reused` | warn | `workflow_id` / `run_id` generated inline per event (e.g. `workflow_id: crypto.randomUUID()`) instead of once per session then reused |
| `approval-poll-unbounded` | warn | Approval polling loop without a visible timeout/deadline/`approval_expiration_time` check - can hang forever |
| `require-approval-no-hitl-enabled` | warn | Code branches on `require_approval` but SDK config is missing `hitlEnabled: true` (SDK throws `ApprovalDisabledError`), or raw-HTTP path has no polling loop |
| `missing-finally-workflow-complete` | info | `WorkflowStarted` emitted without a `finally`/`defer`/`except` closer nearby |
| `activity-started-without-completed` | info | `ActivityStarted` without a paired `ActivityCompleted` in the same scope |

Defaults to scanning `cwd()`. Skips `node_modules`, `dist`, `build`, `.git`, `__pycache__`, etc. Comments are stripped before identifier-presence rules run (so `// missing X-Openbox-Client` doesn't fool the check).

| Option | Default | Description |
|--------|---------|-------------|
| `[path]` | `.` | File or directory to scan |
| `--fail-on <severity>` | `error` | Exit non-zero on this severity or worse: `error` / `warn` / `info` |
| `--json` | `false` | Emit findings as JSON instead of human-readable |

Exit codes: `0` clean or findings below `--fail-on` threshold, `1` findings at/above threshold.

Intended as a pre-commit / CI gate. Complements `openbox session inspect` (runtime protocol check against live sessions): `verify` catches bugs in code before you ship, `session inspect` catches bugs in events after they fire.

---

## doctor

### `openbox doctor`
End-to-end local install diagnostic for the currently-selected environment. Runs these checks and prints a one-line summary per check with a `✓`, `!`, `✗`, or `-` marker:

1. Token file exists (`.tokens` or `~/.openbox/tokens`)
2. Access token present for env
3. JWT expiry (warns when < 5 minutes left, fails when expired)
4. Backend URL reachable (`GET /health`)
5. JWT validated by backend (`GET /auth/profile`)
6. Core URL reachable (`GET /health`) - only if `OPENBOX_API_KEY` is set
7. Core API key valid (`GET /auth/validate`) - only if key present
8. Token file format (warns if legacy flat format detected - will auto-migrate on next save)

Exits 1 if any check fails. Use in CI to gate deploys, or run manually when auth is misbehaving. No flags.

---

## core

### `openbox core health`
Check core governance API health.

### `openbox core validate`
Validate API key against the core API.

### `openbox core evaluate`

Supports two modes: raw JSON or `--type` shorthand.

**Raw JSON mode:**

| Option | Description |
|--------|-------------|
| `--json <json>` | GovernanceEventPayload as JSON (supports `@file` and `-` stdin) |

**Type shorthand mode** (builds the payload automatically):

| Option | Description |
|--------|-------------|
| `--type <type>` | Span type: `llm`, `file_read`, `file_write`, `shell`, `http`, `db`, `mcp` |
| `--activity-type <name>` | Override activity_type (default depends on --type) |
| `--prompt <text>` | Prompt text, or `@file.txt` to read from file (for `--type llm`) |
| `--model <model>` | Model name (for `--type llm`) |
| `--file-path <path>` | File path (for `--type file_read`/`file_write`). Content auto-read if `--content` omitted. |
| `--content <text>` | File content, or `@file.txt` (for `--type file_read`/`file_write`) |
| `--command <cmd>` | Shell command, or `@script.sh` (for `--type shell`) |
| `--cwd <dir>` | Working directory (for `--type shell`) |
| `--method <method>` | HTTP method (for `--type http`) |
| `--url <url>` | HTTP URL (for `--type http`) |
| `--db-system <system>` | Database system (for `--type db`) |
| `--db-operation <op>` | Database operation (for `--type db`) |
| `--db-statement <sql>` | SQL statement, or `@query.sql` (for `--type db`) |
| `--tool-name <name>` | MCP tool name (for `--type mcp`) |
| `--server <name>` | MCP server name (for `--type mcp`) |
| `--tool-input <input>` | MCP tool input, or `@input.json` (for `--type mcp`) |
| `--show-payload` | Print constructed payload without sending |

### `openbox core poll-approval`
| Option | Required | Description |
|--------|----------|-------------|
| `--workflow-id <id>` | Yes | Workflow ID |
| `--run-id <id>` | Yes | Run ID |
| `--activity-id <id>` | Yes | Activity ID |


## Host integration commands

Each LLM host (Claude Code, Cursor, MCP-compatible) has its own
top-level subcommand for install + per-event hook entry. They replace
the legacy `openbox setup` (now removed). See `references/existing-sdks.md`
for the full picture.

### `openbox claude-code install [--uninstall]`

Writes the OpenBox hook block into `~/.claude/settings.json` and points
each Claude Code hook event (PreToolUse, PostToolUse, …) at
`openbox claude-code hook`. `--uninstall` removes the block.

### `openbox cursor install [--uninstall]`

Writes the OpenBox hook block into `~/.cursor/hooks.json`, points each
Cursor hook event at `openbox cursor hook`. `--uninstall` removes.

### `openbox mcp serve`

Long-running stdio MCP server. Configure your MCP-compatible host
(Claude Desktop, etc.) to spawn this command:
```jsonc
// ~/.config/Claude/claude_desktop_config.json or similar
{ "mcpServers": { "openbox": { "command": "openbox", "args": ["mcp", "serve"] } } }
```

### `openbox skill install [--cursor] [--target <dir>]`

Copies `SKILL.md` + `references/` from the installed `openbox-sdk` into
`~/.claude/skills/openbox/` (default) or `~/.cursor/skills/openbox/`
with `--cursor`. Re-run to update.
