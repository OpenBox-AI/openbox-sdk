---
name: openbox
description: |
  Use this skill for anything involving the OpenBox AI-agent governance platform: adding guardrails, policies, behavior rules, PII redaction, prompt-injection defenses, jailbreak / content-moderation filters, or human-in-the-loop approvals to LLM agents. Trigger whenever a user mentions OpenBox, or wants to secure / govern / monitor / score / add compliance controls to AI agents built with LangChain, LangGraph, CrewAI, Autogen, Claude Code, Cursor, Vercel AI SDK, Mastra, Haystack, Pydantic AI, or any custom agent framework. Also trigger for: detecting agent goal drift, restricting tool use, gating risky actions (DDL queries, external API calls, customer-facing output), scoring agent trust, writing OPA/Rego policies for AI agents, testing governance workflows, building new OpenBox SDK integrations, or wrapping the openbox CLI as an MCP server. ALSO trigger when the user asks to describe / list / show / overview / audit / inspect any of: agent, agents, organization, org, team, teams, session, sessions, approval, approvals, guardrail, guardrails, policy, policies, behavior, behaviors, behavior rule, trust, trust score, trust state, observability, observe, governance, webhook, webhooks, sso, audit log, aivss, even when the user does not say the word "OpenBox" out loud. Phrases like "describe agent <id>", "list my agents", "what guardrails do I have", "what's pending", "show me my org", "session inspect", "agent audit" all map to this skill. The `mcp__openbox__*` tools (agent_describe, org_overview, trust_overview, etc.) and the `openbox` CLI are how this skill gets data; reach for them, not for filesystem search through `~/.claude/projects/` or `~/.cursor/transcripts/` (those are unrelated Cursor / Claude Code transcripts and have no connection to OpenBox agents). Do NOT trigger for generic OPA/Rego unrelated to AI agents, AWS IAM policies, SOC2 docs, or PR/review workflow tools unless the user explicitly ties them to AI agents.
---

# OpenBox AI Governance: CLI and integration reference

The TypeSpec specs at `specs/typespec/` are the source of truth when in
doubt about live API shape.

## CLI maturity gating

Most CLI verbs are tagged `[experimental]` and require either the
`--experimental` flag or `OPENBOX_EXPERIMENTAL_LEVEL=experimental`
in the environment. The gate is intentional - experimental
commands stay out of stable workflows by default.

**Stable verbs (no flag needed):**

- `openbox auth` (set-api-key / clear-api-key / status)
- `openbox doctor`
- `openbox health`
- `openbox versions`
- `openbox api-key rotate / recall / revoke`

**Always-resolvable subtrees (tagged `[experimental]` but execute
without the flag because install scripts run on a fresh shell):**

- `openbox install`, `openbox uninstall`
- `openbox mcp`, `openbox skill`
- `openbox claude-code`, `openbox cursor`

**Experimental verbs (the flag IS required):**

- `agent`, `approval`, `audit`, `aivss`, `behavior`, `config`,
  `core`, `goal`, `guardrail`, `member`, `observe`, `org`,
  `policy`, `session`, `sso`, `team`, `trust`, `verify`,
  `violation`, `webhook`
- `api-key list / get / create / delete / update`
  (the `rotate / recall / revoke` triplet is stable)

When you write a CLI example in a code block, **always include
`--experimental` for the verbs that need it**. Otherwise the user
(or the LLM following the example) hits `error: unknown command`.

```
# Stable - no flag
openbox doctor
openbox auth set-api-key
openbox api-key rotate <agentId>

# Experimental - flag required
openbox --experimental agent list
openbox --experimental approval pending <agentId>
openbox --experimental core evaluate --type shell --command "ls"
openbox --experimental behavior create <agent> --verdict 2 ...
```

## Active env: single source of truth

`~/.openbox/config` is the one place every OpenBox process reads the
active env. Every surface running on this machine applies the same
precedence chain at startup (or per-event for stateless hooks). That
includes CLI invocations, the MCP server Cursor launches, cursor
hooks, claude-code hooks, the extension's pending-approvals view,
and slash commands:

1. `--env <flag>` (CLI surfaces only, per-invocation)
2. `process.env.OPENBOX_ENV` (per-process, when explicitly exported)
3. `~/.openbox/config`'s global `OPENBOX_ENV=...`
4. build-pinned `DEFAULT_ENV`

Same chain governs `OPENBOX_API_URL`, `OPENBOX_CORE_URL`, and
`OPENBOX_API_KEY` (the runtime key hooks use). Per-env keys live
under `<env>.<KEY>` lines in the file:

```
OPENBOX_ENV=local
local.OPENBOX_API_URL=http://localhost:3000
local.OPENBOX_CORE_URL=http://localhost:8086
local.OPENBOX_API_KEY=obx_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
production.OPENBOX_API_KEY=obx_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Switching env: edit the file (or the extension's debug-view env
switcher writes there for you, or `openbox --experimental config set
OPENBOX_ENV staging --global`). The next CLI command, the next hook
event, the next MCP tool call all see the new env. The MCP daemon
itself reads env at startup; restart Cursor to flip a long-running
MCP server (or the extension's switcher does this).



The CLI guarantees a strict output contract whenever it's NOT running
under a real terminal. Anything that captures stdout (Cursor's bash
tool, MCP servers, CI scripts, `node child_process.exec`) gets clean
JSON automatically. Pass `--json` explicitly to force the same
behavior in a TTY.

In machine mode:

- **stdout** = exactly one JSON document, nothing else
- **stderr** = empty on success; one-line `{"error":{...}}` on failure
- **exit code** = source of truth (`0` success, `2` usage, `3` auth, `4` feature-disabled, `5` not-found, `1` everything else)
- progress / banners / `[recipe]` description tags / colors are silenced

Concretely:

```sh
# Capture combined output and parse:
openbox --experimental agent list 2>&1 | jq '.'

# Catch errors as JSON:
openbox --experimental api-key rotate 2>&1 | jq '.error.message'

# Install summary as a structured envelope:
openbox install --only mcp --dry-run 2>&1
# → { "installed": ["mcp"], "skipped": [], "failed": [] }
```

Don't try to extract data from stderr in machine mode; it's only
populated on failure (and then it's a single JSON line). For TTY
sessions the format reverts to cargo-style multi-line errors and
human-readable progress.

## Common queries (read this first)

The CLI has TWO tiers. Tier 1 ops map 1:1 to the OpenAPI surface
(every `list`, `get`, `create`, `update`, `delete`). Tier 2 are
**recipes**, composite commands that fan out to several tier-1 calls
and assemble the result. **When the user asks a question, reach for
the recipe first.** Recipes are why this skill exists; without them
an LLM agent does 10–20 tier-1 calls to answer one question.

### Two ground rules (do not skip these)

**Act first, narrate second.** When the user says *"what guardrails do
I have"*, *"what's pending"*, *"show me my agents"*, etc., they want
live state. Run the recipe and report what came back. Do NOT recite
the skill's conceptual content (verdict ladder, lifecycle, etc.) as if
you were summarizing a spec. The skill is a tool for YOU; the user
wants their data.

**Plural questions = enumerate first.** When the user says *"agents"*,
*"my agents"*, *"all agents"* without naming one, do NOT ask which
agent. Run `agent list` (or `org overview` if they said "org") then
loop the per-agent recipe over each row. Same for *"my teams"*,
*"my webhooks"*, *"my sessions on agent X"*: list, then describe.
Asking the user *"which agent ID?"* when the question is plural is a
failure mode; they would have named one if they meant one.

| User asks | Run |
|---|---|
| "what guardrails / policies / behaviors does my agent have?" (plural OR singular) | `openbox --experimental agent list` then `openbox --experimental agent describe <id>` per agent |
| "show me everything about agent X" | `openbox --experimental agent describe <agentId>` |
| "show me my agents" | `openbox --experimental agent list` then describe per row |
| "show me everything about my org" | `openbox --experimental org overview <orgId>` |
| "what's the trust state of my agent?" | `openbox --experimental trust overview <agentId>` |
| "what's the AIVSS picture for agent X?" | `openbox --experimental aivss describe <agentId>` |
| "what's the goal-alignment state?" | `openbox --experimental goal overview <agentId>` |
| "show me the full guardrail picture" | `openbox --experimental guardrail overview <agentId>` |
| "show me the full behavior-rule picture" | `openbox --experimental behavior overview <agentId>` |
| "show me the full policy picture" | `openbox --experimental policy overview <agentId>` |
| "show me everything approval-side for agent X" | `openbox --experimental approval describe <agentId>` |
| "what's the observability picture for agent X?" | `openbox --experimental observe overview <agentId>` |
| "show me everything about team X" | `openbox --experimental team describe <orgId> <teamId>` |
| "show me everything about webhook X" | `openbox --experimental webhook describe <id>` |
| "what's the SSO state?" | `openbox --experimental sso overview` |
| "audit-log surface" | `openbox --experimental audit overview` |
| "core diagnostic" | `openbox --experimental core overview` |
| "what's pending approval?" | `openbox --experimental approval pending <agentId>` |
| "is anything dangling on my agent?" | `openbox --experimental agent audit <agentId>` |
| "show me everything about session X" | `openbox --experimental session describe <agentId> <sessionId>` |
| "did this session follow protocol?" | `openbox --experimental session inspect <agentId> <sessionIdOrWorkflowId>` |
| "is my CLI reachable?" | `openbox doctor` |
| "what versions are deployed?" | `openbox versions` |
| "is my code drift-free?" | `openbox --experimental verify <path>` |

Recipe envelopes:

- `agent describe <id>` → `{ agent, guardrails, behaviors, policies, goal }`
- `aivss describe <id>` → `{ agent, assessments }`
- `goal overview <agentId>` → `{ trend, drifts }`
- `guardrail overview <agentId>` → `{ guardrails, metrics, violations }`
- `behavior overview <agentId>` → `{ rules, current, metrics, violations }`
- `policy overview <agentId>` → `{ policies, current, metrics }`
- `org overview <orgId>` → `{ org, settings, dashboard, approval_metrics, approval_sla, feed, tier_trends, trust_drift, slo, violation_heatmap }`
- `trust overview <agentId>` → `{ histories, events, tier_changes, recovery }`
- `session describe <agentId> <sessionId>` → `{ session, events, goal_stats }`
- `approval describe <agentId>` → `{ metrics, pending, history }`
- `observe overview <agentId>` → `{ data, issues, insights, drift, logs }`
- `team describe <orgId> <teamId>` → `{ team, members }`
- `webhook describe <id>` → `{ webhook, deliveries }`
- `sso overview` → `{ status, config, metadata }`
- `audit overview` → `{ logs, exports }`
- `core overview` → `{ health, api_key }`

Do NOT loop the underlying tier-1 calls yourself; the recipe
exists for that reason. If the user wants a flat per-agent view
across the org, walk `agent list` then call `describe` per row.

If a recipe fits the question, use it. Only drop to tier-1 ops when
the user is editing state (`create`, `update`, `delete`) or wants a
specific narrow read the recipe doesn't cover.

## How to work with the user

Don't run a survey. Pick up what they already said, ask one or two
questions that branch on it, and load only the reference files the
answers imply. By the third exchange you should be running CLI
commands or writing code, not still profiling them.

Three paths cover almost every OpenBox ask. Figure out which one in
the first message; you usually don't need to ask.

**A. Retrofit governance onto an existing agent.** User has a LangChain /
Vercel AI / custom agent and wants guardrails or policies. Skip "what
SDK" and "what LLM" questions. Jump to "which actions are risky, what
should happen when they fire."

**B. Greenfield agent with governance from day one.** User starts from
scratch. Design the agent with the governance: pick the SDK that
matches their ecosystem, sketch tools and risks together, then
scaffold.

**C. Operate or debug an existing OpenBox integration.** User has a
live agent and something's wrong (guardrail doesn't fire, approval
hangs, trust score tanked). Go to `openbox --experimental session inspect`,
`openbox --experimental agent audit`, `openbox --experimental violation agent`. The CLI surfaces the
issue faster than an interview.

If the first message is ambiguous, ask one question with
`AskUserQuestion`: "Are you retrofitting governance onto an existing
agent, building one from scratch, or debugging a live integration?".

### Intent-triggered reference loading

| User mentions | Load |
|---|---|
| PII, email redaction, credit card, SSN, content safety, toxicity, NSFW | `references/guardrails.md` |
| OPA, Rego, policy code, "block if X" custom rules | `references/rego-reference.md` |
| Behavior rules, state triggers, rate limits, sequence patterns | `references/behaviors.md` |
| Approval, human-in-the-loop, HITL | `references/governance-flow.md` § Approval Polling, `references/commands.md` § approval |
| Goal alignment, agent drift, "stay on topic" | `references/governance-flow.md`, `references/commands.md` § goal |
| Trust score, tier, AIVSS | `references/commands.md` § aivss, trust |
| Claude Code, Cursor, MCP host, Skills install | `references/existing-sdks.md` |
| LangChain / LangGraph / CrewAI / Mastra / Vercel AI / Autogen | `references/existing-sdks.md` |
| TypeScript / Node raw integration | `references/existing-sdks.md`, `references/governance-flow.md` |
| Span shape, gate attributes, "why isn't my LLM span classified" | `references/span-reference.md` |
| Debug a live session, "my guardrail didn't fire", audit | `references/commands.md` § session inspect, agent audit, violation; `references/validation-checklist.md` |
| Backend API shape, response envelope | `references/backend-api.md` |
| "Show me every command" | `references/commands.md` |

When in doubt, grep the skill: `grep -rn <keyword> references/` before
asking. If a reference genuinely doesn't cover it, say so.

### Conversation shape

**Path A, retrofit.** One round of 3-4 questions via
`AskUserQuestion`:

- Which actions does the agent already do? `multiSelect` over HTTP,
  DB, file ops, payments, email.
- Which of those are risky? `multiSelect` over the same list.
- Per risky action: allow with log, require approval, or block.
- Any PII in prompts or responses? If yes, which kinds.

Do not ask about LLM provider, web framework, or deployment.

**Path B, greenfield.** Two rounds. First round: what the agent does
plus the chosen SDK or framework. Second round: tools list and risks,
same as the Path A round. Then scaffold.

**Path C, debug.** No questions. Get the agent ID, then
`openbox --experimental session list <agent>`,
`openbox --experimental session inspect <agent> <session>`, and
`openbox --experimental agent audit <agent>`. Only ask if the CLI surfaces something
ambiguous.

### Hard rules regardless of path

- Never hardcode org IDs, team IDs, or user IDs. Derive them at
  runtime from `openbox --experimental org get` and `openbox --experimental team list <orgId>`.
- The runtime API key has format `obx_live_*` or `obx_test_*` and is
  returned **once**, in the `agent create` response or `api-key
  rotate` output. Capture it on creation. The `token` field on
  `agent list` and `agent get` is not the API key; it is an internal
  attestation token. Passing it as `OPENBOX_API_KEY` makes core
  return 500: `invalid API key format. Expected format:
  obx_live_... or obx_test_...`.
- Runtime keys auto-persist on `agent create` and `api-key rotate`
  to `~/.openbox/agent-keys` at mode `0o600`. Recover with
  `openbox api-key recall <agentId>`, which is non-destructive and
  does not rotate. If `recall` returns "no cached runtime key", the
  cache is empty from a fresh install or new shell; fall back to
  `openbox api-key rotate`, which is destructive and invalidates the
  running key.
- Persistent CLI config removes the `export OPENBOX_*=...`
  boilerplate. `openbox --experimental config set <KEY> <VALUE>` writes per-env, and
  `--global` writes to `~/.openbox/config` at mode `0o600`. Values
  layer into `process.env` on every command. Explicit shell exports
  still win. The keys auto-promoted to global scope are
  `OPENBOX_ENV`, `OPENBOX_HOME`, `OPENBOX_CLIENT_VARIANT`, and
  `OPENBOX_EXPERIMENTAL_LEVEL`.
- Before any destructive CLI command, confirm the arguments in
  natural language and wait for a yes. The destructive commands are
  `agent create`, `agent delete`, `team delete`, `member remove`,
  `member invite`, `api-key rotate`, `api-key revoke`, `goal update`,
  and `aivss recalculate`.
- Run `openbox <command> --help` before running a command you have
  not used in the last few turns. The help output is the
  authoritative contract.
- If the user says "build it" without detail, ask one clarifying
  question, not ten.

## Pre-flight: before any command or code

Done once per conversation. Do not narrate each step.

1. Run `which openbox`. If missing, install the SDK globally with
   `npm install -g openbox-sdk@github:OpenBox-AI/openbox-sdk`. The
   CLI ships in the same npm package.
2. Auth: ensure the user has saved an org X-API-Key with
   `openbox auth set-api-key`. Confirm with `openbox auth status`.
3. Run `openbox --experimental org get <orgId>` to pull the active org if you need
   an `orgId` and the user has not given one.
4. Run `openbox <command> --help` before any CLI command you have not
   used this turn.

## Building or changing governance

Three pieces must exist together: an agent registered in OpenBox,
governance attached to that agent through guardrails, behavior rules,
policies, or goal alignment, and application code wired through a
proper SDK. Missing any piece fails at runtime.

**Pattern for every change: list, then create, then verify.** Run
`openbox <kind> list <agent>` first to avoid duplicates. After
creating, `get` it back to confirm. Trust the CLI exit code: `0`
landed, `2` rejected the input and prints a `help:` line, `1` is a
backend failure.

**The CLI is the contract enforcer.** Before any HTTP call it rejects
OpenBox-broken inputs with exit `2` and a `help:` plus `see:` pointer.
If the CLI accepts your input, the backend will. No silent drift.

**Build-order for a new agent:**

1. Run `openbox --experimental agent create -n "name" -t <teamId>`. `-t` is
   required. Capture the returned runtime key, formatted `obx_live_*`
   or `obx_test_*`. The `token` field in the same response is the
   internal attestation token, not the API key. If the create
   response was lost, run `openbox api-key rotate <agent>` for a
   fresh key. The old key stops working immediately.
2. Attach governance based on the path A or path B answers:
   - Guardrails for PII, content safety, or custom regex:
     `openbox --experimental guardrail create <agent> --body @guardrail.json`. See
     `references/guardrails.md` for the `settings.activities` shape.
   - Policies in Rego: one per agent, so combine rules into a single
     file. `openbox --experimental policy create <agent> --rego-file policy.rego`.
     See `references/rego-reference.md`.
   - Behavior rules for sequence, rate-limit, or state triggers:
     `openbox --experimental behavior create <agent> ...`. See
     `references/behaviors.md`.
   - Goal alignment:
     `openbox --experimental goal update <agent> --threshold 70 --action alert_only --frequency every_action --model gpt-4o-mini`.
     All four fields required.
3. Test each span type before wiring the app:
   `openbox --experimental core evaluate --type llm --prompt "hi" --api-key <key>`.
   See `references/commands.md` § core evaluate. Do not write custom
   HTTP scripts to test governance.
4. Wire the application through a framework SDK from
   `references/existing-sdks.md` when one matches the user's stack.
   Raw integrations go through `openbox-sdk`. The integration code
   must fire `WorkflowStarted`, paired `ActivityStarted` and
   `ActivityCompleted`, and a terminal `WorkflowCompleted` or
   `WorkflowFailed` from a finally block. See
   `references/governance-flow.md`.
5. Write a headless e2e test that runs the full lifecycle.
   `references/validation-checklist.md` is the checklist.

**Triggering an approval.** An approval row is materialized only as a
side-effect of `core evaluate` returning `REQUIRE_APPROVAL`. That
requires an OPA policy or a behavior_rule attached to the agent that
returns that verdict for the matching event. OPA on an existing agent
is the canonical path because no management permissions are needed
beyond a runtime key.

1. Pick a target agent the user names, or one with prior approval
   history via `openbox --experimental approval history <agentId> --json`. Do not
   attach a fresh policy to a fresh agent unless you have confirmed
   the user has `create:agent_policy` or `create:agent_behavior_rule`.
2. Recover the runtime key with `openbox api-key recall <agentId>`.
   If empty, run `openbox api-key rotate <agentId> -y`. Rotation is
   destructive; confirm first.
3. `export OPENBOX_API_KEY=$(openbox api-key recall <agentId> --json | jq -r .runtimeKey)`.
4. Match the policy trigger by `activity_type`. Read prior approval
   history to see what `activity_type` rows the policy fires on.
   `references/rego-reference.md` lists the seven `--type` shorthands:
   `llm`, `file_read`, `file_write`, `shell`, `http`, `db`, `mcp`.
5. Run `openbox --experimental core evaluate --type <shorthand> [args]`.
   The response surfaces `verdict: require_approval`, `policy_id`, and
   `governance_event_id`. If `verdict: allow`, the policy did not
   match. Try a different `--type`, or pass `--show-payload` to
   inspect what core sees.
6. Verify: `openbox --experimental approval pending <agentId> --json` should show
   one new row matching the `governance_event_id`.

**Approval timeout: pick the right surface.**

- **OPA policy** via `policy create`: the timeout is not user-
  controlled. `CreatePolicyDto` has no `approval_timeout` field; the
  Rego `result` shape is `{decision, reason}` only. Core injects a
  server-side default. When a user complains "I set 5m but it shows
  30m", verify they used `behavior create`. `policy create` ignores
  any user-supplied timeout because the flag does not exist there.
- **behavior_rule** via `behavior create`: the timeout is
  user-controlled. `CreateBehaviorRuleDto` has `approval_timeout:
  numeric`, required when `verdict=2`. `--approval-timeout 300`
  produces a 5-minute window.
- They coexist. An agent can have both. Both run during `core
  evaluate`, and the strictest verdict wins. When a user wants
  OPA-style flexibility plus a custom timeout, attach both scoped to
  the same trigger.

**Debug-order for a live agent:**

1. `openbox --experimental agent audit <agent> --sessions 50` aggregates protocol
   health, verdict distribution, dangling sessions, and the
   `activity_type` inventory across the last N sessions.
2. `openbox --experimental session inspect <agent> <sessionId>` drills into one
   session: paired Start and Complete, workflow terminal, per-session
   `activity_type` inventory.
3. `openbox --experimental violation agent <agent>` paginates guardrail, policy, and
   behavior violations.
4. `openbox --experimental verify <path-to-integration-code>` is a static linter on
   the user's integration source. Catches canonical-value drift,
   unbounded approval polls, GET with body, missing finally blocks,
   and hardcoded UUIDs.

Never fabricate command flags or enum values. If something looks
wrong, run `--help`.

## Architecture

```
Agent (any framework) → Core API (core.openbox.ai) → governance pipeline → verdict
```

**Four verdicts, lowercase in JSON:** `allow`, `require_approval`,
`block`, `halt`. `constrain` is defined in the OpenAPI spec but the
live server does not emit it. Do not branch on it. Core also returns a
legacy `action` field mirroring `verdict`.

| API | Host | Auth | Purpose |
|-----|------|------|---------|
| Backend | `api.openbox.ai` | `X-API-Key` for org keys, or `Authorization: Bearer <jwt>` | Management of agents, guardrails, policies |
| Core | `core.openbox.ai` | `Authorization: Bearer <obx_live_*>` agent runtime key | Runtime governance evaluation |

## Client-side workflow protocol

Governance is event-sequenced, not a single "evaluate this" RPC. If
events fire in the wrong order or any are dropped, governance is
incomplete: guardrails do not run at the right stage, trust scoring
never finalizes, and the session is orphaned.

Every integration must:

1. Fire `WorkflowStarted` once at session start, then paired
   `ActivityStarted` and `ActivityCompleted` for every governed
   action, then a terminal `WorkflowCompleted` or `WorkflowFailed`
   from a finally block.
2. Generate `workflow_id` and `run_id` once per session and reuse
   them across every event. `activity_id` is per-action and must
   match across its Start and Complete pair.
3. Use `--stage 0` to fire only on `ActivityStarted` or `--stage 1`
   to fire only on `ActivityCompleted` when creating guardrails.
   `--stage both` is silently ignored; use two separate guardrails
   instead.
4. Use canonical `activity_type` strings so events match the
   guardrail config. The full list is in
   `references/governance-flow.md` § Canonical activity_type. Common
   values: `PromptSubmission`, `LLMCompleted`, `ToolCompleted`,
   `FileRead`, `FileEdit`, `ShellExecution`, `MCPToolCall`. Invented
   variants like `LLMCompletion` or `ToolInvocation` will not match.
   `ActivityCompleted` is an `event_type`, not a valid
   `activity_type`; do not confuse the two.

Read `references/governance-flow.md` before building. It has the
event-sequence diagram, canonical event_type and activity_type
tables, stage-gating rules, verdict handling, approval polling, span
construction, and a protocol self-check list.

## Core governance contract

Every event in the sequence above is a
`POST /api/v1/governance/evaluate` call. The verdict determines
whether to proceed.

Wire details, including the verdict response shape, approval polling
semantics, and spec-vs-implementation mismatches, live in
`references/governance-flow.md`.

Span attribute details, including gate attributes per tool class and
the LLM domain-detection workaround, live in
`references/span-reference.md`. The SDK's `gen_ai` span type and the
`openbox-sdk/runtime/claude-code` and `openbox-sdk/runtime/cursor`
runtime adapters inject the required attributes automatically. Custom
clients must replicate them.

One hard rule belongs in-line: **`activity_input` must be an array**.
Wrap single payloads as `[{...}]`. Objects return 422.

## OPA / Rego policies

Policies use a `result` object with `decision` and `reason`. The
`decision` value is uppercase: `ALLOW`, `REQUIRE_APPROVAL`, `BLOCK`,
or `HALT`. Package name: `package org.openbox_ai.<name>`. Only one
policy is active per agent, so combine rules into a single file.

See `references/rego-reference.md` for the rest:

- Syntax for `contains`, `startswith`, and
  `input.activity_input[0].<field>` access.
- The extracted-fields rule. Only `prompt` and `messages` land at
  root.
- Ready-to-use templates and debugging patterns.
- Policy lifecycle gotchas: immutability, one-active-per-agent, and
  why `result.decision` must replace `deny[msg]`.

## Behavior rules and goal alignment

See `references/commands.md`. `behavior create` and `goal update`
both have non-obvious required fields. High-friction gotchas:

- Shell commands classify as `internal`; there is no dedicated
  trigger type. Use `--trigger internal --states internal`.
- Verdict `2`, REQUIRE_APPROVAL, requires `--approval-timeout
  <seconds>` or returns 422.
- `goal update --model` is required. Without it, 422.

## SDKs and host integrations

`references/existing-sdks.md` is the single source of truth. It
carries the decision tree for picking a path, the full sub-path
inventory for `openbox-sdk`, and the framework SDK guidance.

**TypeScript or Node:**

```bash
npm install openbox-sdk@github:OpenBox-AI/openbox-sdk
```

```typescript
import { govern, presets } from 'openbox-sdk/core-client';

await govern({ core, preset: presets.claudeCode }, async (session) => {
  const verdict = await session.preToolUse({ input: [...] });
  if (verdict.arm === 'block') return;
  // ...your tool body
});
```

`govern()` opens the workflow envelope and finalizes it on return,
including on throw. For per-event-process binaries, use
`govern.attach()`. See `references/governance-flow.md`.

**Host integrations** for Claude Code, Cursor, MCP, and Skills:

```bash
npm install -g openbox-sdk@github:OpenBox-AI/openbox-sdk

openbox claude-code install   # writes ~/.claude/settings.json hooks
openbox cursor install        # writes ~/.cursor/hooks.json
openbox mcp serve             # MCP stdio server
openbox skill install         # copies SKILL.md and references to ~/.claude/skills/openbox/

# Confine the install to a single project instead of the user account:
openbox claude-code install --scope project
openbox cursor install --scope project
# Claude Code also supports `--scope local` for a personal,
# gitignored override (~/.claude/settings.local.json under <cwd>).
```

## CLI

Full command reference: `references/commands.md`. All `--body` options
support a raw JSON string, `@file.json`, or `-` for stdin. Run
`openbox <command> --help` before using a command you have not run
recently.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OPENBOX_ENV` | `production` | Selects backend and core URLs from the SDK registry. Values: `production`, `staging`, `local` |
| `OPENBOX_API_URL` | per env | Backend URL override |
| `OPENBOX_CORE_URL` | per env | Core URL override |
| `OPENBOX_API_KEY` | unset | Agent runtime key for core calls |
| `OPENBOX_BACKEND_API_KEY` | unset | Org X-API-Key for the backend management API used by the CLI |
| `OPENBOX_ORG_ID` | unset | Organization ID |
| `OPENBOX_CLIENT_VARIANT` | unset | Suffix appended to `X-Openbox-Client` for telemetry |

### `OPENBOX_CLIENT_VARIANT`

When an LLM tool such as Claude Code, Codex, or Cursor is about to run
`openbox` shell commands, set `OPENBOX_CLIENT_VARIANT` first so
backend telemetry can distinguish skill-driven traffic from human use:

```bash
export OPENBOX_CLIENT_VARIANT=claude-code
openbox auth status
openbox --env staging agent list
```

The CLI auto-appends `/<variant>` to its `X-Openbox-Client` header,
producing strings like `openbox-cli/claude-code`. Allowed characters:
`[A-Za-z0-9._+-]`. Invalid values are silently dropped with a warning
so a typo cannot poison the header.

When the user is talking to the OpenBox MCP server via
`openbox mcp serve` instead of a direct CLI shell, the server reads
its calling client name from the MCP `initialize` handshake
automatically. `OPENBOX_CLIENT_VARIANT` is not needed there.

### `X-Openbox-Client` header

Backend calls require this header. The check is presence-only; any
non-empty value works. Without it, every backend call returns 401 even
with valid auth. CLI and first-party SDKs send it automatically. The
core API does not require it.

See `references/backend-api.md` for the full story. The backend-wide
`{status, data}` response envelope and auth flow live there too.

## Evaluation pipeline

OPA, Guardrails, and goal alignment run concurrently in core. The
final verdict is the strictest across them, ordered
`allow < require_approval < block < halt`. OPA non-`ALLOW`
short-circuits the others.

Full mechanics live in `references/governance-flow.md`.
