# Behavior Rules Reference

Everything specific to configuring and debugging behavior rules - the per-span rate-limiting + pattern-detection layer evaluated by the **agent-governance-engine (AGE)** service.

> **Important:** behavior rules are evaluated by the AGE service. AGE is a separate service from openbox-core, and its deployment is environment-dependent. **If AGE is not deployed in your target environment, behavior rules are dead data** - the rows persist in the `agent_behavior_rules` table, but nothing reads them for matching, so rules silently never fire. If your rules aren't producing the expected verdicts, first verify AGE is deployed and reachable in that environment.

## Contents

- [Trigger / States Enum](#trigger--states-enum)
- [Verdict Enum](#verdict-enum)
- [`time_window` Minimum](#time_window-minimum)
- [Shell Commands Classify as `internal`](#shell-commands-classify-as-internal)
- [AGE SemanticType vs BehaviorRule Trigger Enum](#age-semantictype-vs-behaviorrule-trigger-enum)
- [`--verdict 2` Requires `--approval-timeout`](#--verdict-2-requires---approval-timeout)
- [Behavior-Rule Endpoint Is SINGULAR](#behavior-rule-endpoint-is-singular)
- [Priority + Active Toggle](#priority--active-toggle)

## Trigger / States Enum

Behavior rules match spans by semantic type. Both `trigger` (singular) and `states[]` (list) draw from the **same flat enum** `BehaviorRuleTrigger` (`openbox-backend/src/modules/agent/entities/agent-behavior-rule.entity.ts:15-40`). There is no two-tier taxonomy - each enum value is its own trigger.

**Valid enum values (all 19):**

| Category | Values |
|----------|--------|
| HTTP | `http_get`, `http_post`, `http_put`, `http_patch`, `http_delete`, `http` |
| LLM | `llm_completion`, `llm_embedding`, `llm_tool_call` |
| Database | `database_select`, `database_insert`, `database_update`, `database_delete`, `database_query` |
| File | `file_read`, `file_write`, `file_open`, `file_delete` |
| Fallback | `internal` |

**Usage pattern:** `trigger` identifies the rule's semantic class; `states[]` lists the specific subtypes to match. Typically `trigger == states[0]` when watching a single subtype, or you use a broader trigger with a wide `states[]` array:

```bash
# Block all HTTP POSTs
openbox behavior create $AGENT_ID -n "POST block" \
  --trigger http_post --states http_post \
  --verdict 3 --window 60 --message "POSTs not allowed"

# Require approval for destructive DB ops
# --states takes a SPACE-separated variadic (commander), NOT comma-separated.
openbox behavior create $AGENT_ID -n "DB destroy needs approval" \
  --trigger database_delete --states database_delete database_update \
  --verdict 2 --approval-timeout 300 --window 60 --message "destructive DB needs approval"

# Allow any HTTP verb with observation
openbox behavior create $AGENT_ID -n "HTTP observe" \
  --trigger http --states http_get http_post http_put http_patch http_delete http \
  --verdict 0 --window 60 --message "observing HTTP traffic"
```

Any trigger value outside the 19-entry enum returns 422 - including `shell_execution`, `shell`, `tool`, `http_request`, `db_query`, `file_operation`, `llm_call` (common guesses, all invalid).

## Verdict Enum

`--verdict` is an integer 0-4:

| `--verdict` | Name |
|---|---|
| `0` | ALLOW |
| `1` | CONSTRAIN |
| `2` | REQUIRE_APPROVAL |
| `3` | BLOCK |
| `4` | HALT |

`CONSTRAIN` (1) is a real enum value used in core's priority-ordering logic (`services/governance_workflow.go`), but aggregation logic doesn't yet emit it on the wire ("sandbox enforcement future" per `content/governance.go:26` comment). Document it as selectable but expect `allow`/`require_approval`/`block`/`halt` in practice.

## `time_window`

Integer seconds. Minimum is **1** (`time_window: 0` returns 422 via `@Min(1)` on the DTO). The field is required on every rule and stored on the `agent_behavior_rules` table. Semantics beyond "window applied by the AGE service when evaluating the rule" live in core - there is **no CLI-configurable per-rule trigger count / threshold**; rules fire on every matching span. If you need rate-limiting across many events, use multiple rules or rely on trust-score decay downstream.

Typical values: `60` (per-minute scope), `3600` (hour), `86400` (day).

## Shell Commands Classify as `internal`

Core has no dedicated shell semantic type - shell spans fall through to `internal` (`content/session.go:261`). To rate-limit shell:

```bash
openbox behavior create $AGENT_ID \
  -n "Block rm shells" \
  --trigger internal \
  --states internal \
  --verdict 3 \
  --window 60 \
  --message "Shell commands not allowed"
```

Using `--trigger shell_execution` or `--trigger shell` returns 422 - neither is in `BehaviorRuleTrigger`.

## AGE SemanticType vs BehaviorRule Trigger Enum

There are TWO distinct enums covering overlapping territory:

- **SemanticType** (core's `session.go`) - how spans are classified at evaluation time. Internal to core's classifier.
- **BehaviorRule trigger** - what users configure when creating a behavior rule. The API's public surface.

They mostly agree but are not identical strings. The backend's `create-behavior-rule.dto.ts` allowlist is what matters; semantic types inside core are implementation detail. If you're reading core source and see a classifier that looks like it should be a valid trigger, check the DTO first.

## `--verdict 2` Requires `--approval-timeout`

Creating a REQUIRE_APPROVAL behavior rule without `--approval-timeout <seconds>` returns 422: `"approval_timeout required when verdict is 2"`.

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

**This is the ONLY place in the spec where you can set the approval window.** OPA policies have no `approval_timeout` field on `CreatePolicyDto`, nor any way to return one through the Rego `result` shape - when an OPA policy returns `REQUIRE_APPROVAL`, core injects a server-side default (~30m). So if the user cares about the timeout value, route them to a behavior_rule, not a policy. See `references/rego-reference.md § Approval timeout` for the full breakdown.

## Behavior-Rule Endpoint Is SINGULAR

Backend endpoint is `GET /agent/{id}/behavior-rule` - singular. `GET /agent/{id}/behavior-rules` (plural) returns 404.

Response shape: entries use `rule_name` (not `name`). If you're building a dashboard/listing UI against raw backend API, read `rule_name`.

## Priority + Active Toggle

- `--priority <n>` is required at the DTO layer (`@IsNotEmpty`, `@Min(1)`, `@Max(100)`). The CLI supplies a default of `1` when the flag is omitted; values outside 1-100 return 422. Higher priority wins when multiple rules match a single span.
- `openbox behavior toggle <agentId> <ruleId>` flips `is_active`. Inactive rules don't evaluate.
- `rule_name` is **unique per agent** - creating a rule with a name that already exists on the agent returns 400 "already exists" (`agent.service.ts:1243-1249`). Unlike policies, there's no auto-deactivate-on-duplicate behavior. To rotate a rule, delete or toggle the old one first, then create the replacement. `openbox behavior versions <agentId> <ruleId>` shows the version history for a given base rule (versions within a single `base_rule_id`, created via explicit update flows).

## Related references

- `references/governance-flow.md` - evaluation pipeline, when behavior rules run relative to OPA/guardrails
- `references/span-reference.md` - gate attributes + semantic type detection (what feeds the trigger matcher)
- `references/commands.md` § behavior - CLI option list
