# Behavior rules reference

Configuration and debugging notes for behavior rules: the per-span
rate-limiting and pattern-detection layer that runs alongside OPA and
guardrails during `core evaluate`.

> **Important.** Behavior rules require the platform's behavior-eval
> service to be deployed. If it isn't reachable in your target
> environment, behavior-rule rows persist but never match, so rules
> silently never fire. If your rules aren't producing the expected
> verdicts, verify the platform supports behavior-rule evaluation in
> that env.

## Contents

- [Trigger and states enum](#trigger-and-states-enum)
- [Verdict enum](#verdict-enum)
- [`time_window`](#time_window)
- [Shell commands classify as `internal`](#shell-commands-classify-as-internal)
- [Behavior-rule endpoint is singular](#behavior-rule-endpoint-is-singular)
- [`--verdict 2` requires `--approval-timeout`](#--verdict-2-requires---approval-timeout)
- [Priority and active toggle](#priority-and-active-toggle)

## Trigger and states enum

Behavior rules match spans by semantic type. The singular `trigger`
and the `states[]` list draw from the same flat enum. There is no
two-tier taxonomy: each enum value is its own trigger.

Valid values, 19 total:

| Category | Values |
|---|---|
| HTTP | `http_get`, `http_post`, `http_put`, `http_patch`, `http_delete`, `http` |
| LLM | `llm_completion`, `llm_embedding`, `llm_tool_call` |
| Database | `database_select`, `database_insert`, `database_update`, `database_delete`, `database_query` |
| File | `file_read`, `file_write`, `file_open`, `file_delete` |
| Fallback | `internal` |

Use `trigger` for the rule's semantic class, `states[]` for the
specific subtypes to match. Typically `trigger == states[0]` when
watching one subtype, or use a broader `trigger` with a wide
`states[]`:

```bash
# Block all HTTP POSTs.
openbox behavior create $AGENT_ID -n "POST block" \
  --trigger http_post --states http_post \
  --verdict 3 --window 60 --message "POSTs not allowed"

# Require approval for destructive DB ops.
# --states is a space-separated variadic in commander, not comma-separated.
openbox behavior create $AGENT_ID -n "DB destroy needs approval" \
  --trigger database_delete --states database_delete database_update \
  --verdict 2 --approval-timeout 300 --window 60 --message "destructive DB needs approval"

# Allow any HTTP verb with observation.
openbox behavior create $AGENT_ID -n "HTTP observe" \
  --trigger http --states http_get http_post http_put http_patch http_delete http \
  --verdict 0 --window 60 --message "observing HTTP traffic"
```

Trigger values outside the 19-entry enum return 422. Common invalid
guesses: `shell_execution`, `shell`, `tool`, `http_request`,
`db_query`, `file_operation`, `llm_call`.

## Verdict enum

`--verdict` is an integer 0–4:

| `--verdict` | Name |
|---|---|
| `0` | ALLOW |
| `1` | CONSTRAIN |
| `2` | REQUIRE_APPROVAL |
| `3` | BLOCK |
| `4` | HALT |

`CONSTRAIN` value `1` is a defined enum, but the live server does not
emit it. Document it as selectable, but expect only `allow`,
`require_approval`, `block`, or `halt` in practice.

## `time_window`

Integer seconds. Minimum is `1`. `time_window: 0` returns 422 via the
backend's `@Min(1)`. The field is required on every rule. There is no
CLI-configurable per-rule trigger count or threshold; rules fire on
every matching span. For rate-limiting across many events, use
multiple rules or rely on trust-score decay downstream.

Typical values: `60` for per-minute scope, `3600` for per-hour,
`86400` for per-day.

## Shell commands classify as `internal`

Shell spans don't have a dedicated semantic type. They fall through
to `internal`. To rate-limit shell:

```bash
openbox behavior create $AGENT_ID \
  -n "Block rm shells" \
  --trigger internal \
  --states internal \
  --verdict 3 \
  --window 60 \
  --message "Shell commands not allowed"
```

`--trigger shell_execution` or `--trigger shell` returns 422 because
neither is in the trigger enum.

## Behavior-rule endpoint is singular

The backend endpoint is `GET /agent/{id}/behavior-rule`. The plural
`behavior-rules` returns 404.

Response shape: entries use `rule_name`, not `name`. When building a
dashboard or listing UI against the raw backend API, read `rule_name`.

## `--verdict 2` requires `--approval-timeout`

Creating a `REQUIRE_APPROVAL` behavior rule without
`--approval-timeout <seconds>` returns 422 with
`approval_timeout required when verdict is 2`:

```bash
openbox behavior create $AGENT_ID \
  -n "HTTP POST needs approval" \
  --trigger http_post \
  --states http_post \
  --verdict 2 \
  --approval-timeout 300 \
  --window 60 \
  --message "Approval required for outbound POSTs"
```

This is the only place in the spec where you can set the approval
window. OPA policies have no `approval_timeout` field on
`CreatePolicyDto`, and the Rego `result` shape can't return one. When
an OPA policy returns `REQUIRE_APPROVAL`, core injects a server-side
default. If a user cares about the timeout value, route them to a
behavior_rule, not a policy. See
`references/rego-reference.md § Approval timeout`.

## Priority and active toggle

- `--priority <n>` is DTO-required with `@IsNotEmpty`, `@Min(1)`, and
  `@Max(100)`. The CLI defaults to `1` when omitted; values outside
  1-100 return 422. Higher priority wins when multiple rules match a
  single span.
- `openbox behavior toggle <agentId> <ruleId>` flips `is_active`.
  Inactive rules do not evaluate.
- `rule_name` is unique per agent. Creating a rule whose name already
  exists on the agent returns 400. Unlike policies, there is no
  auto-deactivate-on-duplicate behavior. To rotate a rule, delete or
  toggle the old one first, then create the replacement.
  `openbox behavior versions <agentId> <ruleId>` shows the version
  history within a single `base_rule_id`, populated by explicit
  update flows.

## Related references

- `references/governance-flow.md`: evaluation pipeline. When behavior
  rules run relative to OPA and guardrails.
- `references/span-reference.md`: gate attributes and semantic-type
  detection. What feeds the trigger matcher.
- `references/commands.md` § behavior: CLI option list.
