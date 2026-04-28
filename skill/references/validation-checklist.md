# Validation Checklist

Run these checks at each step. Every mutation should be followed by a GET to confirm state.

## After agent create

```bash
# Verify agent exists and is accessible
openbox agent get $AGENT_ID
# Verify API key works
OPENBOX_API_KEY=$API_KEY openbox core validate
```

If either fails, the agent was created wrong (missing `-t` team ID is the usual cause).

## After guardrail create

```bash
# Verify guardrail is listed and active
openbox guardrail list $AGENT_ID
```

Check `is_active: true` and `processing_stage` matches what you intended (pre/post).

## After behavior rule create

```bash
# Verify rule exists
openbox behavior list $AGENT_ID
```

Check `trigger`, `verdict`, and `is_active` match intent.

## After goal alignment update

```bash
# Verify config
openbox goal trend $AGENT_ID
```

## Before running the app - exhaustive verification

Run every test. If any fails, fix before proceeding.

```bash
# 1. Health
openbox health
OPENBOX_API_KEY=$API_KEY openbox core health

# 2. API key validation
OPENBOX_API_KEY=$API_KEY openbox core validate
# Must return: { valid: true, agent_id: "...", agent_name: "..." }

# 3. Full lifecycle test
OPENBOX_API_KEY=$API_KEY openbox core evaluate --json '{"event_type":"WorkflowStarted","workflow_id":"verify-test","run_id":"verify-run"}'
OPENBOX_API_KEY=$API_KEY openbox core evaluate --json '{"event_type":"ActivityStarted","workflow_id":"verify-test","run_id":"verify-run","activity_id":"act-1","activity_type":"test","activity_input":[{"test":"data"}],"spans":[{"name":"POST /test","attributes":{"http.method":"POST"}}]}'
OPENBOX_API_KEY=$API_KEY openbox core evaluate --json '{"event_type":"WorkflowCompleted","workflow_id":"verify-test","run_id":"verify-run"}'

# 4. Verify session was created
openbox session list $AGENT_ID
```

### Per-feature verification

**For each tool type in the app:**
- Send ActivityStarted with correct span (matching gate attribute) → expect verdict
- Verify semantic type detected correctly (check `age_result.span_results[].semantic_type`)

**If guardrails configured:**
- Send input WITH PII → check if guardrail detects it
- Send clean input → expect ALLOW

**If behavior rules configured:**
- Send matching action type → expect the configured verdict (BLOCK/REQUIRE_APPROVAL)
- Send non-matching type → expect ALLOW

**If HITL configured:**
- Trigger REQUIRE_APPROVAL → check approval appears in `openbox approval pending $AGENT_ID`
- Verify polling uses `verdict` field (not `action`) from response

**Coverage check - every tool type must be tested:**
- List every tool in the app (check_availability, process_payment, send_email, etc.)
- For each one, verify a governance event is sent with correct span and gate attributes
- If a behavior rule was configured for that tool's action type, confirm it fires
- If a guardrail was configured, confirm it evaluates the input
- Don't skip "safe" tools - governance must cover everything

**ID consistency check:**
- workflowId and runId must be identical across all events in a session
- Each activityId must be unique per tool call but consistent between ActivityStarted and ActivityCompleted
- Test: send WorkflowStarted, then ActivityStarted with same workflowId/runId → verify session list shows 1 session

## After running the app

```bash
# Check sessions were created
openbox session list $AGENT_ID

# Check for violations
openbox violation agent $AGENT_ID

# Check trust score
openbox trust histories $AGENT_ID
```

## Cleanup

```bash
openbox agent delete $AGENT_ID
```
