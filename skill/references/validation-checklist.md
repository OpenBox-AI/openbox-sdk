# Validation checklist

Run these checks at each step. Every mutation should be followed by a
GET to confirm state.

## After agent create

```bash
# Verify the agent exists and is accessible.
openbox --experimental agent get $AGENT_ID
# Verify the API key works.
OPENBOX_API_KEY=$API_KEY openbox --experimental core validate
```

If either fails, the agent was created wrong. The usual cause is a
missing `-t` team ID.

## After guardrail create

```bash
# Verify the guardrail is listed and active.
openbox --experimental guardrail list $AGENT_ID
```

Check that `is_active: true` and `processing_stage` matches the
intent: pre or post.

## After behavior-rule create

```bash
# Verify the rule exists.
openbox --experimental behavior list $AGENT_ID
```

Check `trigger`, `verdict`, and `is_active` match intent.

## After goal-alignment update

```bash
# Verify the config.
openbox --experimental goal trend $AGENT_ID
```

## Before running the app: exhaustive verification

Run every test. If any fails, fix before proceeding.

```bash
# 1. Health
openbox health
OPENBOX_API_KEY=$API_KEY openbox --experimental core health

# 2. API key validation
OPENBOX_API_KEY=$API_KEY openbox --experimental core validate
# Must return: { valid: true, agent_id: "...", agent_name: "..." }

# 3. Full lifecycle test
OPENBOX_API_KEY=$API_KEY openbox --experimental core evaluate --json '{"event_type":"WorkflowStarted","workflow_id":"verify-test","run_id":"verify-run"}'
OPENBOX_API_KEY=$API_KEY openbox --experimental core evaluate --json '{"event_type":"ActivityStarted","workflow_id":"verify-test","run_id":"verify-run","activity_id":"act-1","activity_type":"test","activity_input":[{"test":"data"}],"spans":[{"name":"POST /test","attributes":{"http.method":"POST"}}]}'
OPENBOX_API_KEY=$API_KEY openbox --experimental core evaluate --json '{"event_type":"WorkflowCompleted","workflow_id":"verify-test","run_id":"verify-run"}'

# 4. Verify the session was created
openbox --experimental session list $AGENT_ID
```

### Per-feature verification

**For each tool type in the app:**

- Send `ActivityStarted` with the correct span carrying the matching
  gate attribute. Expect a verdict.
- Verify the semantic type was detected correctly under
  `age_result.span_results[].semantic_type`.

**If guardrails are configured:**

- Send input with PII. Check that the guardrail detects it.
- Send clean input. Expect `allow`.

**If behavior rules are configured:**

- Send a matching action type. Expect the configured verdict, either
  `block` or `require_approval`.
- Send a non-matching type. Expect `allow`.

**If HITL is configured:**

- Trigger `require_approval`. Check that the approval appears in
  `openbox --experimental approval pending $AGENT_ID`.
- Verify polling reads the `verdict` field, not `action`. SDK
  consumers see `verdict`; raw HTTP callers read `action`.

**Coverage check.** Every tool type must be tested:

- List every tool in the app, such as `check_availability`,
  `process_payment`, `send_email`.
- For each, verify a governance event is sent with the correct span
  and gate attributes.
- If a behavior rule was configured for that tool's action type,
  confirm it fires.
- If a guardrail was configured, confirm it evaluates the input.
- Do not skip "safe" tools. Governance must cover everything.

**ID consistency check:**

- `workflow_id` and `run_id` must be identical across all events in a
  session.
- Each `activity_id` must be unique per tool call but consistent
  between `ActivityStarted` and `ActivityCompleted`.
- Test: send `WorkflowStarted`, then `ActivityStarted` with the same
  `workflow_id` and `run_id`. Verify the session list shows one
  session.

## After running the app

```bash
# Check sessions were created.
openbox --experimental session list $AGENT_ID

# Check for violations.
openbox --experimental violation agent $AGENT_ID

# Check trust score.
openbox --experimental trust histories $AGENT_ID
```

## Cleanup

```bash
openbox --experimental agent delete $AGENT_ID
```
