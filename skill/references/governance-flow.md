# Governance implementation flow

Deterministic protocol. Implement it as fixed code structure, not
LLM-decided logic. The sequence never varies. First-party SDKs
(`openbox-sdk` and the framework-specific SDKs that lower from it)
exist specifically to enforce this contract; custom clients must
replicate it.

## Contents

- [Required event sequence](#required-event-sequence)
- [ID propagation rules](#id-propagation-rules)
- [Canonical event types](#canonical-event-types)
- [Canonical `activity_type` names](#canonical-activity_type-names)
- [Stage gating](#stage-gating)
- [Verdict handling](#verdict-handling)
- [Approval polling (HITL)](#approval-polling-hitl)
- [Span construction](#span-construction)
- [Protocol self-check](#protocol-self-check)
- [Testing governance](#testing-governance)
- [Wire format and response shape](#wire-format-and-response-shape)
- [Spec vs implementation mismatches](#spec-vs-implementation-mismatches)
- [Common bugs](#common-bugs)

## Required event sequence

```
WorkflowStarted(workflow_id, run_id, workflow_type, goal?)                            ← once, at session start
  [SignalReceived(signal_name, signal_args)]                                          ← optional, mid-workflow signals
  FOR EACH governed action:
    ActivityStarted(activity_id, activity_type, activity_input)                       ← input-stage guardrails fire here
    ActivityCompleted(activity_id, activity_output, status)                           ← output-stage guardrails fire here
WorkflowCompleted(duration_ms, status="completed") | WorkflowFailed(status, error)    ← always fires from a finally block, not the happy path
```

### Nothing dangles

Every `Started` event must be paired with a `Completed`, including
on failure, exception, block, or timeout. A started-but-never-completed
activity or workflow leaves an orphan: trust scoring never finalizes,
output-stage guardrails skip, and dashboard state stays "in progress".

The `status` field on `ActivityCompleted` and `WorkflowCompleted`
carries the outcome:

| `status` | When to use |
|---|---|
| `completed` | Normal success |
| `failed` | Exception raised, `block` verdict, or infrastructure error. Include the `error` object with `type` and `message`. |
| `cancelled` | Caller cancelled before execution finished |
| `terminated` | External kill signal |

Implementation pattern:

```python
workflow_started()
try:
    for action in actions:
        activity_started(activity_id, activity_type, input)
        try:
            result = run(action)
            activity_completed(activity_id, output=result, status="completed")
        except Exception as e:
            activity_completed(
                activity_id,
                status="failed",
                error={"type": type(e).__name__, "message": str(e)},
            )
            raise
    workflow_completed(status="completed")
except HaltError:
    # HALT is the single exception: immediate kill, no cleanup, no
    # pending-activity close. Core treats unreceived completions as
    # terminated when WorkflowFailed arrives with a halt reason.
    workflow_failed(status="terminated", error={"type": "halt", "message": "halted by verdict"})
except Exception as e:
    workflow_failed(status="failed", error={"type": type(e).__name__, "message": str(e)})
    raise
```

The same shape applies in TypeScript (`try/finally`), Go (`defer`),
and every first-party SDK. If your language has
`finally` / `defer` / `ensure`, completion events must live there,
not on the happy path.

## ID propagation rules

Generate once, pass everywhere. Never regenerate mid-session. ID
mismatches between events create orphaned workflows and lose tracking.

| ID | Generated | Reused across |
|---|---|---|
| `workflow_id` | once, at session start | every event in the session |
| `run_id` | once, at session start | every event in the session |
| `activity_id` | once, per action | `ActivityStarted` and the matching `ActivityCompleted` |

## Canonical event types

All first-party SDKs emit exactly these six `event_type` values.
Unknown strings will not 4xx at the bind layer; the server processes
them as generic workflow events, but no downstream classifier
branches on them, so guardrails, trust, and behavior rules silently
no-op. Stay on the canonical six:

| Event | When it fires | Notes |
|---|---|---|
| `WorkflowStarted` | Session start | Carries `goal` for drift detection |
| `SignalReceived` | External signal mid-workflow | `signal_name` and `signal_args` |
| `ActivityStarted` | Before each tool or LLM call | Input-stage guardrails fire here |
| `ActivityCompleted` | After each tool or LLM call | Output-stage guardrails fire here |
| `WorkflowCompleted` | Normal session end | Triggers trust scoring and goal-drift check |
| `WorkflowFailed` | Abnormal termination | Closes dead workflows on halt, crash, or timeout |

## Canonical `activity_type` names

`activity_type` is a free-form string server-side; whatever the
client sends is matched against the guardrail config created for the
agent. First-party SDKs share conventions so agents stay portable
across integrations.

Canonical union, what `openbox --experimental verify` accepts as non-inventive:

| Action | `activity_type` | Emitted by |
|---|---|---|
| User or agent prompt | `PromptSubmission` | runtime/claude-code, runtime/cursor, SDK convention |
| File read | `FileRead` | runtime/claude-code, runtime/cursor |
| File write or edit | `FileEdit` | runtime/claude-code, runtime/cursor |
| File delete | `FileDelete` | runtime/claude-code, runtime/cursor |
| Shell command | `ShellExecution` | runtime/claude-code, runtime/cursor |
| Shell output | `ShellOutput` | runtime/cursor |
| HTTP request | `HTTPRequest` | runtime/claude-code |
| MCP tool call | `MCPToolCall` | runtime/mcp, runtime/claude-code, runtime/cursor |
| MCP tool response | `MCPToolResponse` | runtime/cursor |
| Agent LLM response | `AgentResponse` | runtime/cursor |
| Agent thinking or reasoning | `AgentThinking` | runtime/cursor |
| Subagent spawn | `AgentSpawn` | runtime/claude-code |
| Session-scope marker | `ClaudeCodeSession`, `CursorSession` | runtime/claude-code, runtime/cursor |
| LLM completion in raw integrations | `LLMCompleted` | skill convention |
| Tool call in raw integrations | `ToolCompleted` | skill convention |
| SDK default | `DefaultActivity` | SDK default when `config.activityType` is unset |

Inventions like `LLMCompletion`, `LLMInvocation`, or `ToolInvocation`
will not match guardrails configured against canonical names. If you
coin your own names, every guardrail on that agent must use the exact
same string; wildcards do not work. `ActivityCompleted` is an
`event_type`, not a valid `activity_type`.

### Domain-level activity_types for non-coding agents

The canonical set above is biased toward coding-agent integrations.
The backend itself imposes no enum: `governance_events.activity_type`
is `varchar(255)` with no whitelist.

Domain agents in procurement, finance, infra orchestration, or ops
automation routinely need higher-level workflow `activity_type`
values that do not map to any tool primitive. Examples:
`ProcurementPOApproval`, `WireTransferRequest`, `IAMRoleGrant`,
`DeploymentRollout`, `DatabaseFailover`. These are fully supported on
the wire; the trade-offs are entirely client-side:

| Give up | Keep |
|---|---|
| First-party SDK `emit*` shortcuts only emit canonical names. Domain types need a custom emitter, either a raw `fetch` to `/api/v1/governance/evaluate` or `OpenBoxClient` with the `config.activityType` override | Guardrail matching: create the guardrail's `settings.activities[].activity_type` with the exact string |
| Trust-scoring and goal-alignment classifiers may fall back to generic processing for unknown types | Approval flow, behavior rules, audit log, and dashboards: all keyed on the custom string |
| Portability across first-party SDKs | Portability across your fleet, as long as your agents agree on the vocabulary |

Naming conventions for domain types: PascalCase to match the
canonical SDK style. Use `ProcurementPOApproval`, not
`procurement_po_approval`. One verb-or-noun phrase per type. Avoid
prefix collisions with the canonical set so consumers can route on
the prefix.

The system gives first-class support to coding-agent canonical names
through SDK helpers, hook emitters, and opinionated guardrail
templates. Domain-level vocabulary is fully open as long as the
guardrails reference the exact same strings.

## Stage gating

Guardrails only run at the event stage they're configured for.

| `processing_stage` | Fires on | `fields_to_check` prefix | Use for |
|---|---|---|---|
| `"0"` | `ActivityStarted` only | must start with `input.` | Input validation: PII redaction, ban words, prompt injection |
| `"1"` | `ActivityCompleted` only | must start with `output.` | Output validation: toxicity, regex, output PII |
| any other value, including `"both"` | nothing; silently skipped | n/a | never use |

A `--stage 1` guardrail meant to redact outgoing PII on tool results
will not run if the integration only emits `ActivityStarted`. A
`--stage 0` input validation will not run if you skip the start
event. The complete lifecycle is required for configured guardrails
to execute.

Correct guardrail JSON shape uses `settings.activities[]` with one
entry per `activity_type`:

```bash
# Stage-0 PII redaction on ActivityStarted events with activity_type=PromptSubmission.
openbox --experimental guardrail create $AGENT_ID -n "Redact PII" --type pii --stage 0 \
  --body '{"settings":{"activities":[{"activity_type":"PromptSubmission","fields_to_check":["input.*.message"]}]}}'

# Stage-1 toxicity filter on ActivityCompleted events with activity_type=LLMCompleted.
openbox --experimental guardrail create $AGENT_ID -n "Toxicity filter" --type toxicity --stage 1 \
  --body '{"settings":{"activities":[{"activity_type":"LLMCompleted","fields_to_check":["output.response"]}]}}'
```

## Verdict handling

There are exactly four production verdicts, lowercase on the wire:
`allow`, `require_approval`, `block`, `halt`. When writing integration
code or documentation, always enumerate these four explicitly.
`constrain` is defined in the spec but the live server never emits
it, so do not add a `case "constrain":` branch.

Check `response.verdict` for SDK-normalized output, or
`response.action` for the raw wire field returned by
`/governance/evaluate` and `/governance/approval`:

- `allow`: execute the action.
- `require_approval`: poll the approval endpoint (see below).
- `block`: skip the action; return reason to caller.
- `halt`: stop everything, end session immediately, fire
  `WorkflowFailed`.

Four, not five. The skill checks integration write-ups for this
specifically because the spec-vs-implementation gap is exactly the
kind of drift that bites users who trust the OpenAPI spec over the
live server.

## Approval polling (HITL)

When the verdict is `require_approval`:

```
loop:
  POST /api/v1/governance/approval { workflow_id, run_id, activity_id }

  response shape (core wire):
    { id, action, reason, approval_expiration_time }
    # `action` is the wire field. The TypeScript SDK normalizes it to
    # `verdict` internally, which is why SDK consumers read .verdict.
    # Raw-HTTP callers MUST read .action.

  check response.action:
    "allow"              → approved, continue
    "block" / "halt"     → rejected, return reason
    "require_approval"   → still pending, wait and poll again

  check expiration (client-side; server does NOT send an .expired flag):
    now >= approval_expiration_time → expired, treat as block

  sleep(pollInterval)  # 3-5 seconds
  if elapsed > maxWait → timeout, treat as block
```

Production code must actually poll and wait. Never auto-accept
programmatically. That's only for test scripts clearly marked as
test-only.

## Span construction

Every `ActivityStarted` event must include spans with the correct
gate attribute for the tool type. Without it, behavior rules don't
fire.

| Tool does | Span must have | Span name must contain |
|---|---|---|
| HTTP call | `http.method` | GET / POST / PUT / etc. |
| DB query | `db.system` | SELECT / INSERT / etc. |
| File I/O | `file.path` | `file.read` / `file.write` / etc. |
| LLM call | `http.method` and `http.url` (LLM domain) | EMBED / TOOL / COMPLETION |

See `references/span-reference.md` for the full attribute reference
and the LLM detection workaround.

## Protocol self-check

Before calling an integration complete, trace one real request through
your code (success path and failure path) and confirm:

- [ ] Exactly one `WorkflowStarted` per session.
- [ ] Every tool or LLM call emits both `ActivityStarted` and
  `ActivityCompleted`, including on exceptions, block verdicts,
  timeouts, and cancellations. Use `finally` or `defer` to guarantee
  completion.
- [ ] Failed activities fire `ActivityCompleted` with
  `status="failed"` and an `error` object, never dangling.
- [ ] `workflow_id` and `run_id` are identical across every event in
  a session.
- [ ] `activity_id` is identical within each Start and Complete pair
  and unique across pairs.
- [ ] A terminal `WorkflowCompleted` or `WorkflowFailed` fires even
  when the body throws. Covers normal exit, exceptions, and HALT
  verdicts.
- [ ] `activity_type` strings match the guardrail config. Use the
  canonical past-tense names.
- [ ] Raw-HTTP approval polling reads `response.action`. SDK
  consumers read `.verdict`; the SDK normalizes internally.

Executable version: `openbox --experimental verify <your-integration-path>` lints
for 14 common protocol drifts. The full rule list is in
`references/commands.md` § verify. Exit code 1 on error-severity
findings, useful in CI.

For runtime validation against live sessions: `openbox --experimental session
inspect <agentId> <sessionIdOrWorkflowId>`. See
`references/commands.md` § verify and § session inspect.

## Testing governance

Use the CLI; never write custom HTTP scripts:

```bash
# Test a specific tool type.
OPENBOX_API_KEY=$KEY openbox --experimental core evaluate --json @test-event.json

# Poll approval.
openbox --experimental core poll-approval --workflow-id $WF --run-id $RUN --activity-id $ACT

# Validate key.
OPENBOX_API_KEY=$KEY openbox --experimental core validate
```

The CLI handles edge cases. Custom HTTP scripts introduce bugs in
headers, missing fields, and ID mismatches.

## Wire format and response shape

### Event payload (POST `/api/v1/governance/evaluate`)

| Field | Required | Type | Notes |
|---|---|---|---|
| `event_type` | Yes | string | One of the six canonical values. Unknown strings silently no-op downstream |
| `workflow_id` | Yes | string | Session identifier. Reused across every event |
| `run_id` | Yes | string | Execution identifier. Reused across every event |
| `activity_id` | On Activity* events | string | Per-action. Reused across the Start and Complete pair |
| `activity_type` | No | string | Free-form. Match the guardrail config |
| `activity_input` | No | **array** | Must be an array. Wrap single payloads as `[{...}]`. Sending an object returns 422 or 500 |
| `activity_output` | No | any | On `ActivityCompleted` |
| `spans` | No | array | Required for behavior-rule matching. See `span-reference.md` |
| `goal` | No | string | On `WorkflowStarted`, for drift detection |
| `signal_name`, `signal_args` | On `SignalReceived` | string | Mid-workflow signal |
| `status`, `error` | On `WorkflowFailed` and `WorkflowCompleted` | string, object | Termination reason |
| `task_queue` | No | string | Framework identifier. Open string, not an enum |
| `source` | No | string | Default: `workflow-telemetry` |
| `timestamp` | No | ISO 8601 | Event time |
| `hook_trigger` | No | boolean | `true` for mid-activity hook-originated events. Affects span deduplication |
| `__openbox` | No | object | Carries `{ tool_type, subagent_name }`. Used by the hook SDKs |

### Verdict response shape

```json
{
  "governance_event_id": "uuid",
  "verdict": "allow",
  "risk_score": 0,
  "action": "allow",
  "trust_tier": 2,
  "reason": "...",
  "policy_id": "uuid",
  "approval_id": "uuid",
  "fallback_used": false,
  "metadata": { "event_type": "...", "trust_tier": 2, "workflow_id": "..." },
  "guardrails_result": { "validation_passed": true, "input_type": "activity_input", "redacted_input": null, "reasons": [] },
  "age_result": { "allowed": true, "verdict": "allow", "goal_alignment_checked": false, "goal_drifted": false, "span_results": [], "violations_count": 0 }
}
```

Key fields:

- `trust_tier` is an integer 1-4 or null. Some older SDK types say
  string; ignore those. The live server sends an int.
- There is no `alignment_score` at root. Per-span alignment lives at
  `age_result.span_results[].alignment_result.score`.
- `guardrails_result` only appears on `ActivityStarted` and
  `ActivityCompleted` responses, never on workflow events.
- `action` is a legacy field mirroring `verdict`. Normalize by
  reading `verdict || action`.

## Spec vs implementation mismatches

Places where the OpenAPI spec or older SDK types disagree with the
live server. Always trust implementation.

### `activity_input` must be an array

Spec: `oneOf: [array, object]`. Live: validated as a list. Passing an
object returns 422 on a clean translation or 500 when the rejection
bubbles through unmapped. The fix is identical: always wrap as
`[{...}]`.

### `CONSTRAIN` verdict is never emitted

Spec: verdicts are `ALLOW | CONSTRAIN | REQUIRE_APPROVAL | BLOCK | HALT`.
Live: `CONSTRAIN` is defined as a placeholder for future sandbox
enforcement, but no code path returns it. The `Constraints []string`
response field is never populated. Active verdicts on the wire:
`allow`, `require_approval`, `block`, `halt`. Don't branch on
`constrain`.

### `task_queue` is not a closed enum

Spec: `enum: [langgraph, temporal, mastra]`. Live: plain string with
no validation. Any value is accepted. New frameworks should invent
their own identifier.

### `drift_detection_action: 'constrain'` is not implemented

Spec: `enum: [alert_only, constrain, terminate]`. Live: no code path
handles `constrain`. Use `alert_only` or `terminate` only.

### `trust_tier` is an integer, not a string

Some older generated types declare it as a string; the live server
returns an integer. The TypeScript SDK correctly types it as
`number | null`.

### `alignment_score` is not at root response level

Some older SDK types include it on the root verdict; the live server
does not. Alignment is per-span at
`age_result.span_results[].alignment_result.score`. Goal drift is
indicated by the boolean `age_result.goal_drifted`.

### Guardrails require the full lifecycle to fire

Calling `governOutput()` alone, which sends `WorkflowCompleted`, does
not trigger output-stage guardrails. Those fire only on
`ActivityCompleted`. SDKs must emit `governInput()` followed by
`governOutput()`. This is the most common cause of "my output
guardrail isn't firing" in production.

## Known production behaviors

| Event | Behavior |
|---|---|
| `WorkflowStarted`, `WorkflowCompleted` | Always `allow`. No guardrails check |
| `ActivityStarted` with spans | Full evaluation |
| `ActivityStarted` without spans | OPA and guardrails run. Behavior-rule matcher evaluates 0 spans |
| `ActivityStarted` with `activity_input` as object | Rejection: 422 or 500. See the mismatch table above |
| Session tracking | `WorkflowStarted` creates a session. `WorkflowCompleted` closes it |
| Trust scoring | Updated based on violations and compliance across sessions |
| `ActivityStarted` with a repeated span fingerprint after a prior approval | Approval cache hit: short-circuits to `allow` and skips downstream evaluators. To force a fresh evaluation, vary a span field that is part of the fingerprint |

## Server-side limits

The platform enforces server-side timeouts on workflow execution and
per-activity steps. Clients cannot override them. A workflow that
exceeds the server limit is killed regardless of whether storage
steps ran. If approvals seem missing for a long-running call, the
workflow may have died before the storage step.

## Common bugs

| Bug | Cause | Fix |
|---|---|---|
| ID mismatch | Regenerating `workflow_id` or `run_id` between events | Generate once, pass everywhere |
| Verdict ignored | Reading `action` when the SDK normalizes to `verdict`, or vice versa | Use the right field for your call style |
| Behavior rules do not fire | Missing gate attribute in span | Add `http.method`, `db.system`, etc. |
| Approval auto-accepted | Code bypasses polling | Actually poll and wait for the human |
| Orphaned session | Missing `WorkflowCompleted` | Always send from a finally or cleanup block |
| 422 on evaluate | `activity_input` as object | Wrap as array: `[{...}]` |
| Guardrail never fires | `--stage both` or a non-`0`/`1` value | Use `--stage 0` or `--stage 1` explicitly |
| Stage-1 guardrail never fires | Integration emits only `ActivityStarted` | Emit `ActivityCompleted` too |
| `activity_type` mismatch | Client sends `LLMCompletion`, config expects `LLMCompleted` | Use canonical names from the table above |
