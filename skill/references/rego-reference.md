# Rego Policy Reference for OpenBox

## Contents

- [Policy Format](#openbox-policy-format)
- [Input Fields Available to Rego](#available-input-fields)
- [Rego Syntax Quick Reference](#rego-syntax-quick-reference)
- [Example Policies](#openbox-policy-examples)
- [Policy Lifecycle Gotchas](#policy-lifecycle-gotchas)
- [Testing](#testing-policies)

## OpenBox Policy Format

OpenBox uses OPA (Open Policy Agent) with a specific Rego format. Policies must return `result` with `decision` and `reason` - **do not use `deny[msg]`**. Core evaluates by reading `result.decision` and `result.reason` (`opa.go:236-249`); a `deny[msg]` rule simply leaves `result` undefined and core falls back to `ALLOW` - so your policy silently does nothing, which is arguably worse than a 500.

### Template

```rego
package org.openbox_ai.<policy_name>   # decorative - see below

default result := {"decision": "ALLOW", "reason": null}

result := {"decision": "BLOCK", "reason": "explanation"} if {
    # conditions
}

result := {"decision": "REQUIRE_APPROVAL", "reason": "explanation"} if {
    # conditions
}
```

Decisions are matched **case-insensitively** by core (`opa.go:236-249`). Accepted values:

| Value(s) | Maps to verdict |
|---|---|
| `allow`, `continue` | ALLOW |
| `block`, `stop` | BLOCK |
| `halt` | HALT |
| `require_approval`, `require-approval` | REQUIRE_APPROVAL |
| anything else (e.g. `DENY`, `REJECT`, `CONSTRAIN`) | **silently falls through to ALLOW** |

Convention is uppercase (`ALLOW`, `BLOCK`, `HALT`, `REQUIRE_APPROVAL`) for readability - both forms work.

**Package name is rewritten server-side.** The backend's `formatRegoCode()` (`openbox-backend/src/common/utils/format-rego-code.ts`) strips whatever `package …` line you write and replaces it with `package org.<sanitized_orgId>.policy_<policyIdNoDashes>`, and core queries that rewritten path (`opa.go:210`). Write `package org.openbox_ai.anything` - it works, but the name is purely decorative. Put all your rules in one package; don't try to split across packages.

**`default` assignment** uses `:=` (not `=`) in Rego v1. Older `default result = {...}` (single `=`) still parses but is deprecated; use `:=` everywhere for forward-compat.

**Workflow events bypass OPA.** `WorkflowStarted`, `WorkflowCompleted`, and `WorkflowFailed` auto-allow in core (`opa.go:184-191`) - policies targeting those event types never run. OPA only evaluates on `ActivityStarted` / `ActivityCompleted` / `SignalReceived`.

### Available Input Fields

Core's `buildOPAInput()` (`opa.go:316-497`) populates a rich `input` object. The table below lists what's guaranteed to be at root; anything not listed stays nested inside `input.activity_input[0].*`.

```rego
# Always at root
input.event_type                      # WorkflowStarted, ActivityStarted, ActivityCompleted, ...
input.workflow_id                     # session ID
input.run_id                          # run ID
input.activity_id                     # per-action (on Activity* events)
input.activity_type                   # free-form; SDK convention: PromptSubmission, LLMCompleted, ToolCompleted, FileRead, ShellExecution, MCPToolCall
input.agent_id                        # agent UUID
input.workflow_type                   # framework identifier
input.task_queue                      # open string
input.source                          # usually "workflow-telemetry"
input.timestamp                       # ISO 8601

# Trust-score fields
input.trust_score                     # current score (0-100)
input.trust_tier                      # 1-4, also exposed as input.risk_tier (duplicate)

# Extracted from activity_input[0] to root - the ONLY fields that get hoisted
input.prompt                          # from activity_input[0].prompt
input.messages                        # from activity_input[0].messages
input.message_contents                # string[] extracted from messages[].content

# Everything else stays nested
input.activity_input[0].command       # shell command (ShellExecution)
input.activity_input[0].file_path     # file path (FileRead)
input.activity_input[0].tool_name     # MCP tool name (MCPToolCall)
input.activity_input[0].<any_field>   # every custom field

# On ActivityCompleted events
input.activity_output                 # any shape - inspect with input.activity_output.<field>
input.status                          # "completed" | "failed" | "cancelled" | "terminated"
input.error                           # { type, message } on failure
input.duration_ms                     # activity wall-clock

# Spans (span-shaped objects with attributes)
input.spans                           # array; each has .name, .attributes, .kind, .status
input.span_count                      # len(spans)

# Signal events
input.signal_name
input.signal_args
```

**`activity_input` can be an array OR an object.** The core tolerates both shapes via `getActivityInputAsMap` (`opa.go:473-486`). Policies that hardcode `input.activity_input[0]` will throw on object-shape inputs - defensive policies should check the type, or target only the downstream-extracted `input.prompt` / `input.messages` root fields.

**Rego v1 compatibility.** If you hit `"undefined identifier: if"` or similar, your OPA runtime is pre-v1. Add `import rego.v1` at the top to force v1 semantics - `if`, `in`, and `contains` become keywords rather than bare identifiers. OpenBox's backend ships a modern OPA, so the import isn't required there today, but portable policies should include it.

## Rego Syntax Quick Reference

### Strings

```rego
contains(input.prompt, "drop")            # substring check
startswith(input.prompt, "DELETE")         # prefix
endswith(input.prompt, ";")               # suffix
lower(input.prompt)                       # lowercase
upper(input.prompt)                       # uppercase
replace(input.prompt, "old", "new")       # replace
sprintf("user %s", [name])               # format
regex.match(`rm\s+-rf`, cmd)              # regex
split(input.prompt, " ")                  # split
trim_space(input.prompt)                  # trim whitespace
```

### Comparison

```rego
x == 100                # equal
x != 100                # not equal
x < 100                 # less than
x > 100                 # greater than
```

### Logic

```rego
# AND - multiple conditions in one rule body (all must be true)
result := {"decision": "BLOCK", "reason": "msg"} if {
    condition_a
    condition_b
}

# OR - separate rules with same result
result := {"decision": "BLOCK", "reason": "reason A"} if { condition_a }
result := {"decision": "BLOCK", "reason": "reason B"} if { condition_b }

# NOT
not some_condition

# Negation with helper
result := {"decision": "BLOCK", "reason": "msg"} if {
    not is_safe_command(input.activity_input[0].command)
}
is_safe_command(cmd) if { contains(cmd, "ls") }
```

### Iteration

```rego
# Iterate over array
some item in input.activity_input
contains(item.prompt, "dangerous")

# Iterate with index
some i, item in my_array

# Check if any element matches
some word in dangerous_words
contains(lower(input.prompt), word)
```

### Sets and Arrays

```rego
dangerous := ["rm -rf", "DROP TABLE", "DELETE FROM", "mkfs"]
some d in dangerous
contains(cmd, d)

# Array comprehension
filtered := [x | some x in items; x.active == true]

# Set comprehension
unique := {x | some x in items}
```

## OpenBox Policy Examples

### Block destructive SQL

```rego
package org.openbox_ai.block_ddl

default result := {"decision": "ALLOW", "reason": null}

result := {"decision": "BLOCK", "reason": "DROP operation denied"} if {
    contains(lower(input.prompt), "drop table")
}

result := {"decision": "BLOCK", "reason": "TRUNCATE operation denied"} if {
    contains(lower(input.prompt), "truncate ")
}
```

### Require approval for admin operations

```rego
package org.openbox_ai.admin_approval

default result := {"decision": "ALLOW", "reason": null}

result := {"decision": "REQUIRE_APPROVAL", "reason": "Admin operation requires approval"} if {
    input.activity_type == "PromptSubmission"
    prompt := lower(input.prompt)
    admin_keywords := ["admin", "superuser", "full access", "full privileges", "role=admin"]
    some kw in admin_keywords
    contains(prompt, kw)
}
```

### Block dangerous shell commands

```rego
package org.openbox_ai.shell_safety

default result := {"decision": "ALLOW", "reason": null}

result := {"decision": "BLOCK", "reason": "Dangerous shell command blocked"} if {
    input.activity_type == "ShellExecution"
    cmd := input.activity_input[0].command
    dangerous := ["rm -rf", "mkfs", "dd if=", "> /dev/"]
    some d in dangerous
    contains(cmd, d)
}

result := {"decision": "BLOCK", "reason": "External network access blocked"} if {
    input.activity_type == "ShellExecution"
    cmd := input.activity_input[0].command
    contains(cmd, "curl")
    not contains(cmd, "localhost")
    not contains(cmd, "127.0.0.1")
}
```

### Block by trust tier

```rego
package org.openbox_ai.trust_gated

default result := {"decision": "ALLOW", "reason": null}

result := {"decision": "BLOCK", "reason": "Agent trust too low for this action"} if {
    input.trust_tier >= 3
    input.activity_type == "ShellExecution"
}

result := {"decision": "REQUIRE_APPROVAL", "reason": "Low-trust agent needs approval"} if {
    input.trust_tier >= 3
    input.activity_type == "PromptSubmission"
    contains(lower(input.prompt), "delete")
}
```

### Combined policy (multiple rules in one file)

Only one policy can be active per agent. Combine rules into a single file:

```rego
package org.openbox_ai.combined

default result := {"decision": "ALLOW", "reason": null}

# HALT - duplicate user
result := {"decision": "HALT", "reason": "Duplicate user detected"} if {
    input.activity_type == "PromptSubmission"
    known_users := ["John Smith", "Sarah Connor"]
    some user in known_users
    contains(input.prompt, user)
}

# BLOCK - destructive DDL
result := {"decision": "BLOCK", "reason": "Destructive DDL denied"} if {
    prompt := lower(input.prompt)
    destructive := ["drop table", "drop database", "truncate"]
    some d in destructive
    contains(prompt, d)
}

# REQUIRE_APPROVAL - inserts
result := {"decision": "REQUIRE_APPROVAL", "reason": "Insert requires approval"} if {
    input.activity_type == "PromptSubmission"
    contains(lower(input.prompt), "insert")
}

# BLOCK - dangerous shell
result := {"decision": "BLOCK", "reason": "Dangerous command blocked"} if {
    input.activity_type == "ShellExecution"
    cmd := input.activity_input[0].command
    dangerous := ["rm -rf", "DROP TABLE", "DELETE FROM"]
    some d in dangerous
    contains(cmd, d)
}
```

## Policy Lifecycle Gotchas

### Only one policy active per agent
Creating a new policy automatically deactivates any existing one (core enforces "current version" semantics). To combine multiple rule sets on one agent, merge them into a single `.rego` file with separate `result := …` rules.

### Approval timeout - OPA policies CANNOT set it
A REQUIRE_APPROVAL verdict produced by an OPA policy uses a **server-side default** (`approval_expiration_time = now + ~30m` as observed; the exact value lives in core, not in the policy record). The `CreatePolicyDto` has no `approval_timeout` field - neither the create form, nor the stored record, nor the Rego return shape `{decision, reason}` carries one. Any expectation that you can pass `--approval-timeout` to `policy create` is wrong; the flag does not exist on that command.

**To control the timeout, use a behavior_rule instead.** `CreateBehaviorRuleDto` has `approval_timeout: numeric` (required when `verdict=2`). Behavior rules and OPA policies coexist on the same agent - both run during `core evaluate`; whichever returns the strictest verdict wins. So if you need a 5-minute window, attach a behavior_rule with `--verdict 2 --approval-timeout 300` matching the same trigger; don't try to express the timeout inside Rego.

**Don't conflate the two paths.** When asked "create an approval that expires in N minutes":
- If N matters → behavior_rule path. `openbox behavior create <agent> --verdict 2 --approval-timeout <seconds> ...`
- If N doesn't matter and any timeout is fine → OPA policy path. `openbox policy create <agent> --rego ...` (you'll get the server default).

### Policies are immutable - `policy update` is a rollback/toggle, not an editor
The backend `UpdatePolicyDto` only defines `is_active`, `trust_impact`, and `trust_threshold`. A `rego_code` in the PUT body is silently dropped by NestJS's whitelist pipe - the endpoint returns 200 but the stored rego is unchanged.

The frontend confirms this explicitly: clicking "Edit Policy" in the dashboard calls `agentApi.createPolicy(...)` ("When editing, create a new policy instead of updating") rather than `updatePolicy`.

> **Bundle redeploy is conditional.** `policy create` always triggers an OPA bundle rebuild + S3 upload (`policy.service.ts:104`). `policy update` only redeploys when `is_active` is being set to true (`policy.service.ts:138`). `policy delete` does NOT trigger a rebuild at all (the redeploy call is commented out at `policy.service.ts:167,201`). To change rego code, always use `policy create`.

Behavior of `PUT /agent/{id}/policies/{policyId}`:
1. Transaction begins.
2. Sets `is_active=false`, `is_current_version=false` on every policy on the agent.
3. On the targeted policy, sets `is_active = body.is_active` and `is_current_version = true`, plus any provided `trust_impact` / `trust_threshold`.
4. Redeploys if active.

So to "update" a policy: POST a new one with the changed rego. To "roll back": PUT `{is_active: true}` on the older version's ID. To "toggle off": PUT `{is_active: false}`.

Also: `is_active` is `@IsBoolean()` with no `@IsOptional()`. Omitting it on the PUT body returns 422 (`is_active must be a boolean value`). Always pass it explicitly.

### Input extraction - only `prompt` and `messages` land at root
Core's `buildOPAInput()` (in `opa.go:314-333`) constructs the OPA input by extracting two fields from `activity_input[0]` to the root level:
- `prompt` → `input.prompt`
- `messages` → `input.messages`

Every other field stays nested under `input.activity_input[0].*`. For shell commands, file paths, MCP tool inputs, etc., policies must access them through the array:

```rego
# CORRECT
cmd := input.activity_input[0].command

# WRONG - command is NOT at root
cmd := input.command
```

This is why prompt policies can do `input.prompt` directly but tool-call policies must go through `activity_input[0]`.

## Testing Policies

`openbox policy evaluate` takes the rego source as an inline string - it does NOT expand `@file` syntax on this subcommand (that's only on `policy create --rego-file`). Shell-inline a file via `$(cat …)`:

```bash
# Preferred: read from file via shell
openbox policy evaluate \
  --rego "$(cat policy.rego)" \
  --input '{"prompt": "drop table users", "activity_type": "PromptSubmission"}'

# Or inline the rego directly
openbox policy evaluate \
  --rego 'package test
default result := {"decision":"ALLOW","reason":null}
result := {"decision":"BLOCK","reason":"no drops"} if { contains(lower(input.prompt), "drop") }' \
  --input '{"prompt":"DROP TABLE users"}'
```

To create a policy on an agent (after testing locally):

```bash
openbox policy create <agentId> --rego-file policy.rego -n "Block DDL"
# or
openbox policy create <agentId> --rego "$(cat policy.rego)" -n "Block DDL"
```

Always test with a realistic payload shape (wrap inputs in `activity_input[0]` just like the wire format) so your policy exercises the real access paths, not root-level shortcuts that only work for prompt/messages.
