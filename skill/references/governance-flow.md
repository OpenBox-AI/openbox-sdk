# Governance Implementation Flow

This flow is deterministic - implement it as fixed code structure, not LLM-decided logic. The sequence never varies. First-party SDKs (`openbox-sdk`, `openbox-langchain-sdk-python`, runtime/claude-code, runtime/cursor) exist specifically to enforce this contract; custom clients must replicate it.

## Contents

- [Required Event Sequence](#required-event-sequence)
- [ID Propagation Rules](#id-propagation-rules)
- [Canonical Event Types](#canonical-event-types)
- [Canonical `activity_type` Names](#canonical-activity_type-names)
- [Stage Gating](#stage-gating)
- [Verdict Handling](#verdict-handling)
- [Approval Polling (HITL)](#approval-polling-hitl)
- [Span Construction](#span-construction)
- [Protocol Self-Check](#protocol-self-check)
- [Testing Governance](#testing-governance)
- [Wire Format + Response Shape](#wire-format--response-shape)
- [Spec vs Implementation Mismatches](#spec-vs-implementation-mismatches)
- [Common Bugs](#common-bugs)

## Required Event Sequence

```
WorkflowStarted(workflow_id, run_id, workflow_type, goal?)                            ← once, at session start
  [SignalReceived(signal_name, signal_args)]                                          ← optional, mid-workflow signals
  FOR EACH governed action:
    ActivityStarted(activity_id, activity_type, activity_input)                       ← input-stage guardrails fire here
    ActivityCompleted(activity_id, activity_output, status)                           ← output-stage guardrails fire here; status = "completed"|"failed"|"block"|"cancelled"|"terminated"
WorkflowCompleted(duration_ms, status="completed") | WorkflowFailed(status, error)    ← always fires - finally block, not happy-path only
```

### Nothing dangles (Temporal-style completion)

Every `Started` event must be paired with a `Completed` - **including on failure, exception, block, or timeout**. A started-but-never-completed activity or workflow leaves an orphan in core: trust scoring never finalizes, guardrails that rely on output-stage evaluation silently skip, and dashboard state stays stuck "in progress."

The `status` field on `ActivityCompleted` and `WorkflowCompleted` carries the outcome:

| `status` | When to use |
|----------|-------------|
| `completed` | Normal success |
| `failed` | Exception raised, `block` verdict, or infrastructure error - include the `error` object with `type` + `message` |
| `cancelled` | Caller cancelled before execution finished |
| `terminated` | External kill signal |

**Implementation pattern:**

```python
workflow_started()
try:
    for action in actions:
        activity_started(activity_id, activity_type, input)
        try:
            result = run(action)
            activity_completed(activity_id, output=result, status="completed")
        except Exception as e:
            activity_completed(activity_id, status="failed", error={"type": type(e).__name__, "message": str(e)})
            raise
    workflow_completed(status="completed")
except HaltError:
    # HALT is the single exception - immediate kill, no cleanup, no pending-activity close.
    # Core treats unreceived completions as terminated when WorkflowFailed arrives with halt reason.
    workflow_failed(status="terminated", error={"type": "halt", "message": "halted by verdict"})
except Exception as e:
    workflow_failed(status="failed", error={"type": type(e).__name__, "message": str(e)})
    raise
```

The same shape applies in TypeScript (`try/finally`), Go (`defer`), and every first-party SDK. **If your language has `finally`/`defer`/`ensure`, completion events must live there - not in the happy path.**

## ID Propagation Rules

Generate once, pass everywhere. Never regenerate mid-session - ID mismatches between events create orphaned workflows in core and lose tracking.

| ID | Generated | Reused across |
|----|-----------|---------------|
| `workflow_id` | once, at session start | every event in the session |
| `run_id` | once, at session start | every event in the session |
| `activity_id` | once, per action | `ActivityStarted` + matching `ActivityCompleted` |

## Canonical Event Types

All first-party SDKs emit exactly these six `event_type` values. Core's `services/governance.go` has a `default:` branch that processes unknown strings as generic workflow events - so arbitrary strings won't 4xx at the bind layer, but no downstream classifier branches on them and you get silent no-ops for guardrails/trust/AGE. Stay on the canonical six:

| Event | When it fires | Notes |
|-------|---------------|-------|
| `WorkflowStarted` | Session start | Carries `goal` for drift detection |
| `SignalReceived` | External signal mid-workflow | `signal_name` + `signal_args`; Temporal-style pattern |
| `ActivityStarted` | Before each tool/LLM call | Input-stage guardrails fire here |
| `ActivityCompleted` | After each tool/LLM call | Output-stage guardrails fire here |
| `WorkflowCompleted` | Normal session end | Triggers trust scoring, AGE drift check |
| `WorkflowFailed` | Abnormal termination | Closes dead workflows (halt, crash, timeout) |

## Canonical `activity_type` Names

`activity_type` is a free-form string server-side - whatever the client sends is matched against the guardrail config created for the agent. But first-party SDKs share conventions so agents stay portable across integrations.

**Canonical union** (what `openbox verify` accepts as non-inventive, drawn from runtime/claude-code + runtime/cursor emitters + SDK conventions):

| Action | `activity_type` | Emitted by |
|--------|-----------------|------------|
| User/agent prompt | `PromptSubmission` | runtime/claude-code, runtime/cursor, SDK-aspirational |
| File read | `FileRead` | runtime/claude-code, runtime/cursor |
| File write/edit | `FileEdit` | runtime/claude-code, runtime/cursor |
| File delete | `FileDelete` | runtime/claude-code, runtime/cursor |
| Shell command | `ShellExecution` | runtime/claude-code, runtime/cursor |
| Shell output | `ShellOutput` | runtime/cursor |
| HTTP request | `HTTPRequest` | runtime/claude-code |
| MCP tool call | `MCPToolCall` | runtime/claude-code, runtime/cursor |
| MCP tool response | `MCPToolResponse` | runtime/cursor |
| Agent LLM response | `AgentResponse` | runtime/cursor |
| Agent thinking/reasoning | `AgentThinking` | runtime/cursor |
| Subagent spawn | `AgentSpawn` | runtime/claude-code |
| Session-scope marker | `ClaudeCodeSession` / `CursorSession` | runtime/claude-code / runtime/cursor |
| LLM completion (aspirational / hand-rolled) | `LLMCompleted` | skill convention for raw-HTTP integrations |
| Tool call (aspirational / hand-rolled) | `ToolCompleted` | skill convention for raw-HTTP integrations |
| openbox-sdk default (user-overridable) | `DefaultActivity` | SDK default if `config.activityType` not set - **won't match specific-type guardrails**; override unless you want a catch-all |

**Inventions like `LLMCompletion` / `LLMInvocation` / `ToolInvocation` won't match** guardrails configured against canonical names. If you coin your own names, every guardrail on that agent must be created with that exact string - wildcards don't work. `ActivityCompleted` is an event_type, NOT a valid activity_type value.

### Domain-level activity_types (non-coding agents)

The canonical set above is **first-party SDK convention biased toward coding-agent integrations** - runtime/claude-code, runtime/cursor, and openbox-sdk emit at tool granularity (`FileRead`, `ShellExecution`, `HTTPRequest`, `MCPToolCall`). Backend itself imposes no enum: `governance_events.activity_type` is `varchar(255)`, no `@Max`, no whitelist (verified against `agent/dto/approvals.dto.ts` and the entity).

Domain agents (procurement, finance, infra orchestration, ops automation) routinely need **higher-level workflow activity_types** that don't map to any tool primitive - `ProcurementPOApproval`, `WireTransferRequest`, `IAMRoleGrant`, `DeploymentRollout`, `DatabaseFailover`. Those are fully supported on the wire; the trade-offs are entirely client-side:

| What you give up | What you keep |
|---|---|
| First-party SDK helpers - `emit*` shortcuts in runtime/claude-code, runtime/cursor, openbox-sdk core only emit canonical names. Domain types need a custom emitter (raw `fetch` → `/api/v1/governance/evaluate`, or `OpenBoxClient` with `config.activityType` override). | Guardrail matching works the same - create the guardrail's `settings.activities[].activity_type` with the exact string. |
| Trust-scoring + AGE classifiers may fall back to generic processing for unknown types. | Approval flow, behavior rules, audit log, dashboards - all still work, just keyed on your custom string. |
| Portability across first-party SDKs. | Portability across YOUR fleet, as long as your agents agree on the vocabulary. |

**Naming conventions for domain types**: stay PascalCase to match the canonical SDK style (`ProcurementPOApproval` not `procurement_po_approval`). One verb-or-noun phrase per type. Avoid prefix collisions with the canonical set so consumers can route on the prefix if needed.

The system gives **first-class support to coding-agent canonical names** (built-in SDK helpers, hook emitters, opinionated guardrail templates) and **leaves room for any creativity** at the domain level - define your own canonical set per project as long as your guardrails reference the exact same strings.

## Stage Gating

Guardrails only run at the event stage they're configured for. The guardrails service resolves the stage-prefix once per request:

| `processing_stage` | Fires on | `fields_to_check` prefix | Use for |
|---------|----------|--------------------------|---------|
| `"0"` | `ActivityStarted` only | must start with `input.` | Input validation (PII redaction, ban words, prompt injection) |
| `"1"` | `ActivityCompleted` only | must start with `output.` | Output validation (toxicity, regex, output PII) |
| any other value incl. `"both"` | **nothing** - silently skipped | - | **never use** |

A guardrail intended to redact outgoing PII on tool results (`--stage 1`) will not run if your integration only emits `ActivityStarted`. Conversely, `--stage 0` input validation won't run if you skip the start event. The complete lifecycle is required for configured guardrails to execute.

**Correct guardrail JSON shape** (`settings.activities[]`, one entry per activity_type):

```bash
# Stage-0 PII redaction on ActivityStarted events where activity_type=PromptSubmission
openbox guardrail create $AGENT_ID -n "Redact PII" --type pii --stage 0 \
  --json '{"settings":{"activities":[{"activity_type":"PromptSubmission","fields_to_check":["input.*.message"]}]}}'

# Stage-1 toxicity filter on ActivityCompleted events where activity_type=LLMCompleted
openbox guardrail create $AGENT_ID -n "Toxicity filter" --type toxicity --stage 1 \
  --json '{"settings":{"activities":[{"activity_type":"LLMCompleted","fields_to_check":["output.response"]}]}}'
```

## Verdict Handling

**There are exactly four production verdicts**: `allow`, `require_approval`, `block`, `halt` (lowercase on the wire). When writing integration code or documentation, **always** enumerate these four explicitly AND note that `constrain` is defined in the OpenAPI spec and `governance.go:26` (as `VerdictConstrain = 1`) but is never emitted by the live server today - the comment calls it "sandbox enforcement future." Don't add a `case "constrain":` branch; it will never execute, and leaving it in suggests the spec and implementation agree (they don't).

Check `response.verdict` (SDK-normalized) or `response.action` (raw wire field - the one `/governance/evaluate` and `/governance/approval` actually return):

- `allow` → execute the action
- `require_approval` → poll the approval endpoint (see below)
- `block` → skip action, return reason to caller
- `halt` → stop everything, end session immediately (fire `WorkflowFailed`)

**Four, not five.** The skill checks integration write-ups for this specifically because the spec→implementation gap is exactly the kind of drift that bites users who trust the OpenAPI doc over the live server's behavior.

## Approval Polling (HITL)

When verdict is `require_approval`:

```
loop:
  poll POST /api/v1/governance/approval
    { workflow_id, run_id, activity_id }

  response shape (core wire):
    { id, action, reason, approval_expiration_time }
    ^^^ action is the wire field name - NOT verdict.
    The TypeScript SDK normalizes `action` to `verdict` internally
    (see verdict.ts:`parseGovernanceResponse`), which is why SDK consumers
    read .verdict. Raw-HTTP callers MUST read .action.

  check response.action:
    "allow" → approved, continue
    "block" / "halt" → rejected, return reason
    "require_approval" → still pending, wait and poll again

  check expiration (client-side - server does NOT send an .expired flag):
    now >= approval_expiration_time → expired, treat as block

  sleep(pollInterval)  // 3-5 seconds
  if elapsed > maxWait → timeout, treat as block
```

Production code must actually poll and wait. Never auto-accept programmatically - that's only for test scripts clearly marked as test-only.

## Span Construction

Every `ActivityStarted` event must include spans with the correct gate attribute for the tool type. Without the gate attribute, behavior rules won't fire.

| Tool does | Span must have | Span name must contain |
|-----------|---------------|----------------------|
| HTTP call | `http.method` | GET/POST/PUT/etc. |
| DB query | `db.system` | SELECT/INSERT/etc. |
| File I/O | `file.path` | `file.read` / `file.write` / etc. |
| LLM call | `http.method` + `http.url` (LLM domain) | EMBED/TOOL/COMPLETION |

See `references/span-reference.md` for the full span attribute reference and the LLM detection workaround.

## Protocol Self-Check

Before calling an integration complete, trace one real request through your code (success path AND failure path) and confirm:

- [ ] Exactly one `WorkflowStarted` per session
- [ ] Every tool/LLM call emits BOTH `ActivityStarted` and `ActivityCompleted` - **including on exceptions, block verdicts, timeouts, and cancellations** (use `finally`/`defer` to guarantee completion)
- [ ] Failed activities fire `ActivityCompleted` with `status="failed"` + `error` object, not left dangling
- [ ] `workflow_id` and `run_id` are identical across every event in a session
- [ ] `activity_id` is identical within each Start/Complete pair, unique across pairs
- [ ] A terminal `WorkflowCompleted` or `WorkflowFailed` fires even when the body throws - covers normal exit, exceptions, and HALT verdicts
- [ ] `activity_type` strings match what your guardrail config expects (use canonical past-tense names)
- [ ] Raw-HTTP approval polling reads `response.action` (SDK consumers read `.verdict` - SDK normalizes internally)

**Executable version:** run `openbox verify <your-integration-path>` to lint for 14 common protocol drifts (activity_input as object, invented verdicts, `--stage both`, missing `X-Openbox-Client`, non-canonical event_type / activity_type, hardcoded UUIDs, missing `finally` around workflow/activity, raw-HTTP reading `.verdict` on approval, span missing gate attribute, workflow_id generated per event, unbounded approval poll, require_approval without hitlEnabled). Exit code 1 on error-severity findings - useful in CI.

For runtime validation against live sessions, use `openbox session inspect <agentId> <sessionIdOrWorkflowId>`. See `references/commands.md` § verify + § session inspect.

## Testing Governance

Test governance using the CLI - never write custom HTTP scripts:

```bash
# Test a specific tool type
OPENBOX_API_KEY=$KEY openbox core evaluate --json @test-event.json

# Poll approval
openbox core poll-approval --workflow-id $WF --run-id $RUN --activity-id $ACT

# Validate key
OPENBOX_API_KEY=$KEY openbox core validate
```

The CLI is proven and handles all edge cases. Custom HTTP scripts introduce bugs (wrong headers, missing fields, ID mismatches).

## Wire Format + Response Shape

### Event payload (POST `/api/v1/governance/evaluate`)

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `event_type` | Yes | string | One of the six canonical values. Unknown strings silently no-op downstream. |
| `workflow_id` | Yes | string | Session identifier, reused across every event |
| `run_id` | Yes | string | Execution identifier, reused across every event |
| `activity_id` | On Activity* events | string | Per-action; reused across Start/Complete pair |
| `activity_type` | No | string | Free-form; match guardrail config. See canonical names. |
| `activity_input` | No | **array** | Must be array, not object. Wrap single payloads as `[{...}]`. Sending an object returns 422 or 500 depending on which layer surfaces the error. |
| `activity_output` | No | any | On `ActivityCompleted` |
| `spans` | No | array | Required for behavior rule matching. See `span-reference.md`. |
| `goal` | No | string | On `WorkflowStarted`, for drift detection |
| `signal_name` / `signal_args` | On `SignalReceived` | string | Temporal-style mid-workflow signal |
| `status` / `error` | On `WorkflowFailed`/`WorkflowCompleted` | string/object | Termination reason |
| `task_queue` | No | string | Framework identifier - **open string**, not an enum. Any value accepted. |
| `source` | No | string | Default: `workflow-telemetry` |
| `timestamp` | No | ISO 8601 | Event time |
| `hook_trigger` | No | boolean | `true` for hook-originated events (mid-activity). Affects span deduplication. |
| `__openbox` | No | object | `{ tool_type, subagent_name }` - only used by the hook SDKs |

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
  "age_result": { "allowed": true, "verdict": "allow", "goal_alignment_checked": false, "goal_drifted": false, "span_results": [...], "violations_count": 0 }
}
```

Key fields:
- `trust_tier` is an **integer 1-4 or null** (some older SDK types say string - ignore; core sends int).
- There is NO `alignment_score` at root. Per-span alignment is at `age_result.span_results[].alignment_result.score`.
- `guardrails_result` only appears on `ActivityStarted` / `ActivityCompleted` responses, never on workflow events.
- `action` is a legacy field mirroring `verdict`. Normalize by reading `verdict || action`.

## Spec vs Implementation Mismatches

These are places where the OpenAPI spec or older SDK types disagree with the live server. Always trust implementation.

### `activity_input` must be an array

**Spec says:** `oneOf: [array, object]`. **Live:** AGE validates as a list. Passing an object returns **422** `"Input should be a valid list"` when AGE translates cleanly, or **500** when the rejection bubbles through the Go wrapper without translation. Fix is identical - always wrap as `[{...}]`.

### `CONSTRAIN` verdict is never emitted

**Spec says:** Verdicts are `ALLOW | CONSTRAIN | REQUIRE_APPROVAL | BLOCK | HALT`. **Live:** `VerdictConstrain = 1` is defined in `governance.go:26` with a "sandbox enforcement future" comment, but no service path returns it. The `Constraints []string` response field is never populated. Active verdicts on the wire: `allow`, `require_approval`, `block`, `halt`. Don't branch on `constrain` in client code.

### `task_queue` is not a closed enum

**Spec says:** `enum: [langgraph, temporal, mastra]`. **Live:** `content/governance.go:192` types it as plain string with no validation. Any value is accepted. New frameworks should invent their own identifier.

### `drift_detection_action: 'constrain'` is not implemented

**Spec says:** `enum: [alert_only, constrain, terminate]`. **Live:** no code path handles `constrain`. Use `alert_only` or `terminate` only.

### `trust_tier` is an integer, not a string

**Spec says:** some generated types declare it as string. **Live:** `GovernanceVerdictPublicResponse.TrustTier` is `*int` in Go. The TypeScript SDK correctly types it as `number | null`.

### `alignment_score` is not at root response level

**Spec says:** some older SDK types include it on the root verdict. **Live:** not in `GovernanceVerdictPublicResponse`. Alignment is per-span at `age_result.span_results[].alignment_result.score`. Goal drift is indicated by the boolean `age_result.goal_drifted`.

### Guardrails require full lifecycle to fire

Using only `governOutput()` (which sends `WorkflowCompleted`) does NOT trigger output-stage guardrails - those fire only on `ActivityCompleted`. SDKs must emit both `governInput()` → `governOutput()` in sequence. This is the single most common cause of "my output guardrail isn't firing" in production.

## Known Production Behaviors (snapshot)

| Event | Behavior |
|-------|----------|
| `WorkflowStarted` / `WorkflowCompleted` | Always ALLOW verdict; no guardrails check |
| `ActivityStarted` with spans | Full evaluation (OPA + guardrails + AGE) |
| `ActivityStarted` without spans | OPA + guardrails run; AGE runs but evaluates 0 spans |
| `ActivityStarted` with `activity_input` as object | Rejection (422 or 500) - see mismatch table above |
| Session tracking | `WorkflowStarted` creates a session; `WorkflowCompleted` closes it |
| Attestation | Merkle root + ECDSA signature generated per session |
| Trust scoring | Updated based on violations + compliance across sessions |
| `ActivityStarted` with repeated identical span fingerprint after a prior approval | Approval cache hit - short-circuits to ALLOW, skips OPA / guardrails / AGE entirely (`CheckApprovalCacheActivity`). To force a fresh evaluation, vary a span field that's part of the fingerprint. |

## Backend Eval Pipeline (deterministic - not LLM-decided)

When an event hits `POST /api/v1/governance/evaluate`, the-core-service runs a Temporal workflow with this fixed activity sequence (see `internal/services/governance_workflow.go`):

```
1.  ValidateAgentActivity          - agent API key check
2.  CheckExistingEventActivity     - idempotency dedup (workflow_id+run_id+activity_id+event_type)
3.  CheckSessionStatusActivity     - session pre-check (halted?)
4.  SessionLifecycleActivity       - create/update session row
5.  CheckApprovalCacheActivity     - Redis fingerprint lookup (bypass)
    [if cache hit → step 9 with ALLOW]

    PARALLEL (Temporal coroutines):
6a. PolicyEvaluationActivity       - calls OPA
6b. GuardrailsCheckActivity        - calls the-guardrails-service service
6c. AGECheckActivity               - calls AGE service (skipped when AGE_URL unset)
    [Guardrails+AGE early-cancelled when OPA returns non-ALLOW]

7.  Verdict aggregation            - HighestPriorityVerdict([policy, age])
                                     Priority: HALT > BLOCK > REQUIRE_APPROVAL > CONSTRAIN > ALLOW
8.  if REQUIRE_APPROVAL: set ApprovalExpirationTime = now + agent.GetApprovalWaitTime()
9.  StoreHookSpanActivity OR StoreGovernanceEvent  - INSERT governance_events row
10. Store{Policy,Guardrails,AGE}Evaluation         - per-eval snapshot tables
11. RecordTrustTriggersActivity (when AGE.GoalDrifted) - trust adjustment
12. SetApprovalCacheActivity       - Redis write for future bypass
13. StartAttestationWorkflowActivity - fire-and-forget Merkle/KMS sign
```

**Hardcoded server-side limits (cannot be overridden from clients):**
- Workflow execution timeout: 30s
- Per-activity StartToCloseTimeout: 30s
- AGE HTTP client timeout: 30s

A workflow that exceeds 30s is killed regardless of whether storage steps ran. If approvals seem missing, it may mean the workflow died before step 9.

## Common Bugs

| Bug | Cause | Fix |
|-----|-------|-----|
| ID mismatch | Regenerating workflowId/runId between events | Generate once, pass everywhere |
| Verdict ignored | Reading `action` instead of `verdict` | Use `verdict` field consistently |
| Behavior rules don't fire | Missing gate attribute in span | Add `http.method`, `db.system`, etc. |
| Approval auto-accepted | Code bypasses polling | Actually poll, wait for human |
| Orphaned session | Missing WorkflowCompleted | Always send in finally/cleanup block |
| 422 on evaluate | `activity_input` as object | Wrap as array: `[{...}]` |
| Guardrail never fires | `--stage both` or non-0/1 value | Use `--stage 0` or `--stage 1` explicitly |
| Stage-1 guardrail never fires | Integration emits only `ActivityStarted` | Emit `ActivityCompleted` too |
| `activity_type` mismatch | Client sends `LLMCompletion`, config expects `LLMCompleted` | Use canonical names table above |
