---
name: openbox
description: |
  Use this skill for anything involving the OpenBox AI-agent governance platform - adding guardrails, policies, behavior rules, PII redaction, prompt-injection defenses, jailbreak / content-moderation filters, or human-in-the-loop approvals to LLM agents. Trigger whenever a user mentions OpenBox, or wants to secure / govern / monitor / score / add compliance controls to AI agents built with LangChain, LangGraph, CrewAI, Autogen, Claude Code, Cursor, Vercel AI SDK, Mastra, Haystack, Pydantic AI, or any custom agent framework. Also trigger for: detecting agent goal drift, restricting tool use, gating risky actions (DDL queries, external API calls, customer-facing output), scoring agent trust, writing OPA/Rego policies for AI agents, testing governance workflows, building new OpenBox SDK integrations, or wrapping the openbox CLI as an MCP server. Do NOT trigger for generic OPA/Rego not tied to AI agents, AWS IAM policies, SOC2 docs, or PR/review workflow tools unless the user explicitly ties them to AI agents.
---

# OpenBox AI Governance - CLI & Integration Reference

> Refreshed against the consolidated `openbox-sdk` monorepo (post-merge of `openbox-typescript-sdk`, `openbox-mcp`, `openbox-skill`, `claude-hooks`, `cursor-hooks`, `openbox-extension`). When in doubt about live API shape, the TypeSpec specs at `specs/typespec/` are the source of truth.

## How to work with the user

Don't run a survey. Have a conversation: pick up what they already said, ask one or two questions that branch on it, and load only the reference files the answers imply. Every round gets tighter - by the third exchange you should be running CLI commands or writing code, not still profiling them.

Three paths cover almost every OpenBox ask. Figure out which one in the first message; you usually don't need to ask.

**A - Retrofit governance onto an existing agent.** User already has a LangChain / Vercel AI / custom agent and wants to add guardrails or policies. Skip the "what SDK" and "what LLM" questions - they've told you. Jump to "which actions are risky, what should happen when they fire."

**B - Greenfield agent with governance from day one.** User is starting from scratch. Design the agent WITH the governance - pick the SDK that matches their ecosystem, sketch the tools + risks together, then scaffold the full app.

**C - Operate / debug an existing OpenBox integration.** User has a live agent and something's wrong - guardrail doesn't fire, approval hangs, trust score tanked. Go straight to `openbox session inspect` / `openbox agent audit` / `openbox violation agent` - the CLI will surface the actual issue faster than any interview.

If the user's first message is ambiguous, ask ONE question to disambiguate: "Are you retrofitting governance onto an existing agent, building one from scratch, or debugging a live integration?" Use `AskUserQuestion` for that - clickable beats typed.

### Intent-triggered reference loading

Load only what the user's stated intent actually needs. Don't preload the whole `references/` tree.

| They mention / want | Load first |
|---|---|
| PII, email redaction, credit card, SSN, content safety, toxicity, NSFW | `references/guardrails.md` |
| OPA, Rego, policy code, "block if X" custom rules | `references/rego-reference.md` |
| Behavior rules, state triggers, rate limits, sequence patterns | `references/behaviors.md` |
| Approval, human-in-the-loop, HITL, approve/reject flow | `references/governance-flow.md` (§ Approval Polling) + `references/commands.md` (§ approval) |
| Goal alignment, agent drift, "stay on topic" | `references/governance-flow.md` + `references/commands.md` (§ goal) |
| Trust score, tier, AIVSS | `references/commands.md` (§ aivss, trust) |
| Claude Code, Cursor, MCP host, Skills install | `references/existing-sdks.md` (CLI subcommands: `openbox claude-code install`, `openbox cursor install`, `openbox mcp serve`, `openbox skill install`) |
| LangChain / LangGraph / CrewAI / Mastra / Vercel AI / Autogen | `references/existing-sdks.md`, then whichever framework SDK matches |
| TypeScript/Node raw integration (no framework SDK fits) | `references/existing-sdks.md` (openbox-sdk sub-paths) + `references/governance-flow.md` |
| Span shape, gate attributes, "why isn't my LLM span classified" | `references/span-reference.md` |
| Debugging a live session, "my guardrail didn't fire", audit | `references/commands.md` (§ session inspect, agent audit, violation) + `references/validation-checklist.md` |
| Backend API shape, response envelope, self-hosting | `references/backend-api.md` |
| "Show me every command" | `references/commands.md` |

When in doubt, grep the skill: `grep -rn <keyword> references/` before asking. If a reference genuinely doesn't cover it, say so and check the relevant SDK/backend repo.

### Conversation shape

Once you know the path, ask questions that branch:

**Path A (retrofit).** One round, 3-4 questions via `AskUserQuestion`:
- Which actions does the agent already do? (HTTP, DB, file ops, payments, email - multiSelect)
- Which are risky? (multiSelect of the above)
- Per risky action: allow + log / require approval / block outright?
- Any PII in prompts or responses? (yes → which kinds)

Don't ask LLM provider, web framework, deployment - you don't need them for retrofit.

**Path B (greenfield).** Two rounds. First: "what does the agent do" + SDK/framework. Second (after their answer): tools list + risks, exactly like Path A round above. Then scaffold.

**Path C (debug).** No questions - go straight to the CLI. Get the agent ID, then `openbox session list <agent>`, `openbox session inspect <agent> <session>`, `openbox agent audit <agent>`. The output tells you what's wrong. Only ask if the CLI surfaces something ambiguous.

### Hard rules regardless of path

- Never hardcode org IDs, team IDs, or user IDs. Always derive from `openbox auth profile` and `openbox team list <orgId>` at runtime.
- The runtime API key (`obx_live_*` / `obx_test_*`) is returned **once** in the `agent create` response or `api-key rotate` output. Capture it on creation. The `token` field in `agent list`/`agent get` is **NOT** the API key - it's an internal attestation token. Passing it as `OPENBOX_API_KEY` causes core to reject with 500 ("invalid API key format. Expected format: obx_live_... or obx_test_..."). The CLI also rejects malformed keys client-side at `core` commands with a clear hint.
- **Runtime keys auto-persist on `agent create` / `api-key rotate`** to `~/.openbox/agent-keys` (mode 0o600). Recover with `openbox api-key recall <agentId>` - non-destructive, no rotation needed. If `recall` returns "no cached runtime key" the cache is empty (fresh install / new shell), then fall back to `api-key rotate` (destructive - invalidates whatever's running). Always try `recall` first.
- **Persistent CLI config eliminates `export OPENBOX_*=...` boilerplate.** `openbox config set <KEY> <VALUE>` (per-env) or `--global` writes to `~/.openbox/config` (mode 0o600); the values layer into `process.env` on every command - explicit shell exports still win. Auto-promoted-to-global keys: `OPENBOX_ENV`, `OPENBOX_HOME`, `OPENBOX_CLIENT_VARIANT`, `OPENBOX_EXPERIMENTAL_LEVEL`. Use `config list --all` to see both scopes.
- Before any destructive CLI command (`agent create/delete`, `team delete`, `member remove/invite`, `api-key rotate/revoke`, `goal update`, `aivss recalculate`), confirm the arguments in natural language and wait for a yes.
- `openbox <command> --help` before running a command you haven't used in the last few turns. The CLI's help output is authoritative - don't guess flags.
- If the user says "build it" without detail, don't guess - ask one clarifying question, not ten.

## Pre-flight (before any command or code)

Done once per conversation. Fast - don't narrate each step to the user.

1. `which openbox` - if missing, install the SDK globally (the CLI binary ships in the same npm package): `npm install -g openbox-sdk@github:OpenBox-AI/openbox-sdk`. Org is **OpenBox-AI**.
2. Auth: look for `.tokens` in cwd or `~/.openbox/tokens`. If missing, tell the user `openbox auth login`. Don't proceed with management commands until they have a token.
3. `openbox auth profile` → grab `orgId`. This is the only way to get it; don't ask the user to paste it.
4. For every CLI command you plan to run that you haven't used this turn: `openbox <command> --help`. The help output is the authoritative contract - flags, exit codes, required vs optional. Guessing causes 400/422 / cryptic errors.

## Building or changing governance

The integration works when three pieces exist together: an agent registered in OpenBox, governance attached to it (guardrails / behavior rules / policies / goal), and application code wired through a proper SDK. Missing any piece = runtime failure.

**Pattern for every change: list → create → verify.** Before creating something, list what's already there (`openbox <kind> list <agent>`) so you don't make duplicates. After creating, `get` it back to confirm it landed the way you expected. Trust the CLI's exit code: `0` = landed, `2` = your input was bad (read the `fix:` line), `1` = backend failure.

**The CLI is the contract enforcer.** Before any HTTP call it rejects the OpenBox-broken inputs and exits `2` with a `fix:` + `see:` pointer: `--stage both` (doesn't exist - use two guardrails, one per stage), `--trigger http_request` (the 19-value `BehaviorRuleTrigger` enum doesn't include that), `--verdict 2` without `--approval-timeout`, `fields_to_check` paths missing the stage prefix, Rego using `deny[msg]` or non-canonical decisions, unknown team IDs on agent create, invalid date strings on `--from`/`--to`, enum filter typos on `--event-type` / `--source-type` / `--status` / `--duration`. If the CLI accepts your input, the backend will - no silent drift.

**Build-order for a new agent:**

1. `openbox agent create -n "name" -t <teamId>` - `-t` is required. Capture the returned `.apiKey` field (`obx_live_*` / `obx_test_*`) - that's the runtime API key the application code uses. The `.token` field on the SAME response is an internal attestation token, **not** the API key (passing it as `OPENBOX_API_KEY` makes core return a 500 "invalid API key format"). If the create response was lost, run `openbox api-key rotate <agent>` to get a fresh `obx_live_*` - the old one stops working at that moment.
2. Attach governance based on the path-A/B answers:
   - Guardrails (PII, content safety, custom regex) - `openbox guardrail create <agent> --json @guardrail.json`. See `references/guardrails.md` for the settings.activities shape.
   - Policies (Rego) - one per agent, so combine rules into a single file. `openbox policy create <agent> --rego-file policy.rego`. See `references/rego-reference.md`.
   - Behavior rules (sequence / rate-limit / state triggers) - `openbox behavior create <agent> ...`. See `references/behaviors.md`.
   - Goal alignment - `openbox goal update <agent> --threshold 70 --action alert_only --frequency every_action --model gpt-4o-mini`. All four fields required.
3. Test each span type before wiring the app: `openbox core evaluate --type llm --prompt "hi" --api-key <key>`. See `references/commands.md § core evaluate` for every span type. Don't write custom HTTP scripts to test governance.
4. Wire the application using a framework SDK from `references/existing-sdks.md` when one exists for the user's stack. Raw integration goes through `openbox-sdk`. The integration code MUST fire `WorkflowStarted` → paired `ActivityStarted`/`ActivityCompleted` → `WorkflowCompleted` or `WorkflowFailed` in a finally-block. See `references/governance-flow.md`.
5. Write a headless e2e test that runs the full lifecycle end-to-end before declaring it done. `references/validation-checklist.md` is the checklist.

**Triggering an approval (the one-shot recipe).** When the user asks "create / fire / trigger an approval for me", an approval row is **only** materialized as a side-effect of `core evaluate` returning `REQUIRE_APPROVAL`. That requires either an OPA policy OR a behavior_rule attached to the agent that returns that verdict for the matching event. **OPA policy on an existing agent is the canonical path** - no management perms needed beyond a runtime key.

1. Pick a target agent. Either an agent the user names, or a canary you discovered via `openbox --experimental org approvals <orgId> --json` - agents with prior approval history have policies/rules already wired. Don't try to create a new policy/rule on a fresh agent unless you've confirmed the user has `create:agent_policy` / `create:agent_behavior_rule` (some prod Admin roles **don't**, and `policy create` / `behavior create` 403 server-side, not just at the CLI preflight).
2. Recover the runtime key: `openbox api-key recall <agentId>`. If empty, `openbox api-key rotate <agentId> -y` (destructive - confirm with the user first). Both write to `~/.openbox/agent-keys` (0o600).
3. `export OPENBOX_API_KEY=$(openbox api-key recall <agentId> --json | jq -r .runtimeKey)`.
4. Match the policy's trigger by `activity_type`. Read prior approval history (`openbox approval history <agentId> --json | head`) to see what `activity_type` rows the policy actually fires on. The skill's `references/rego-reference.md` lists the seven `--type` shorthands (`llm`, `file_read`, `file_write`, `shell`, `http`, `db`, `mcp`) that map to canonical activity_types.
5. `openbox --experimental core evaluate --type <shorthand> [args]`. The response surfaces `verdict: require_approval` + `policy_id` + `governance_event_id`. If `verdict: allow`, the policy didn't match - try a different `--type` or check `--show-payload` to inspect what core is seeing. **Known flake**: `core evaluate` can return `500 failed to start workflow: context deadline exceeded` (or `RST_STREAM CANCEL`) when core's Temporal layer is cold/overloaded - particularly on staging. The CLI/SDK/key layers are NOT the issue when this happens (verify with `core health` returning `"hello world"` + `core validate` confirming the key is active). Retry 2–3 times with 5–10s backoff; if still timing out, fall back to a known-good agent in production.
6. Verify: `openbox approval pending <agentId> --json` should show one new row matching the `governance_event_id`.

**Approval timeout - pick the right surface.** The expiration on the resulting approval row depends on which trigger fired:
- **OPA policy** (`policy create`): you do **not** control the timeout. `CreatePolicyDto` has no `approval_timeout` field; the Rego `result` shape is `{decision, reason}` only. Core injects a server-side default (~30m observed). If a user complains "I set 5m but it shows 30m", verify they actually used `behavior create` - `policy create` ignores any user-supplied timeout because the flag doesn't exist on that command.
- **behavior_rule** (`behavior create`): you control the timeout. `CreateBehaviorRuleDto` has `approval_timeout: numeric` (required when `verdict=2`). `--approval-timeout 300` on `behavior create` produces a 5-minute window.
- They coexist. An agent can have both an OPA policy AND a behavior_rule attached; both run during `core evaluate` and the strictest verdict wins. So if a user wants OPA-style flexibility plus a custom timeout, the answer is "attach both, scoped to the same trigger".

**Debug-order when something's wrong on a live agent:**

1. `openbox agent audit <agent> --sessions 50` - first look. It aggregates protocol health, verdict distribution, dangling sessions, and an `activity_type inventory` across the last N sessions. If there's a mismatch between what the app emits and what guardrails target, you'll see it here.
2. `openbox session inspect <agent> <sessionId>` - drill into one session. Shows the event protocol checks (paired Start/Complete, workflow terminal, etc.) + the per-session activity_type inventory.
3. `openbox violation agent <agent>` - paginated list of every guardrail / policy / behavior violation.
4. `openbox verify <path-to-integration-code>` - 14-rule static linter on the user's integration source. Catches canonical-value drift, unbounded approval polls, GET-with-body, missing finally blocks, hardcoded UUIDs. Runs in seconds.

Never fabricate command flags or enum values. If something looks wrong, `--help` it.

## Architecture

```
Agent (any framework) → Core API (core.openbox.ai) → OPA + Guardrails + AGE + Goal Alignment → Verdict
```

**Verdicts - there are exactly four** (lowercase in JSON): `allow`, `require_approval`, `block`, `halt`. When writing integration code or guides, always enumerate these four AND explicitly note that `constrain` is defined in the OpenAPI spec (as `VerdictConstrain = 1` in core) but **never emitted by the live server** - it's a "sandbox enforcement future" placeholder. Don't branch on it; don't list it as a fifth verdict. Core also returns a legacy `action` field mirroring `verdict`.

| API | URL | Auth | Purpose |
|-----|-----|------|---------|
| Backend | `api.openbox.ai` | JWT | Management (agents, guardrails, policies) |
| Core | `core.openbox.ai` | API key (`obx_live_*`) | Runtime governance evaluation |

## Client-Side Workflow Protocol

Governance is **Temporal-style event sequencing**, not a single "evaluate this" RPC. If the events fire in the wrong order or any are dropped, governance is incomplete - guardrails won't run at the right stage, trust scoring never finalizes, and the session is orphaned.

**Every integration must:**
1. Fire `WorkflowStarted` once at session start, then paired `ActivityStarted` + `ActivityCompleted` for every governed action, then `WorkflowCompleted` (or `WorkflowFailed`) in a finally-block.
2. Generate `workflow_id` / `run_id` once per session and reuse them across every event. `activity_id` is per-action and must match across its Start/Complete pair.
3. Use `--stage 0` (fires only on `ActivityStarted`) OR `--stage 1` (fires only on `ActivityCompleted`) when creating guardrails. `--stage both` is silently ignored by the guardrails service - use two separate guardrails instead.
4. Use canonical `activity_type` strings so events match the guardrail config. Full list in `references/governance-flow.md` § "Canonical `activity_type` Names" - the union of what `openbox-sdk/runtime/claude-code` + `openbox-sdk/runtime/cursor` emit plus aspirational names for hand-rolled integrations. Common ones: `PromptSubmission`, `LLMCompleted`, `ToolCompleted`, `FileRead`, `FileEdit`, `ShellExecution`, `MCPToolCall`. Invented variants like `LLMCompletion` / `ToolInvocation` won't match. **`ActivityCompleted` is an event_type, not a valid activity_type value** - don't confuse the two.

**Read `references/governance-flow.md` before building** - it has the full event sequence diagram, the canonical event_type and activity_type tables, stage-gating rules with correct JSON shape for `settings.activities[]`, verdict handling, approval polling, span construction, and a protocol self-check list to run before declaring an integration done.

## Core Governance Contract

Every event in the sequence above is a `POST /api/v1/governance/evaluate` call. The verdict determines whether to proceed.

**Wire details live in `references/governance-flow.md`** - don't restate them here. That file has the full payload schema, verdict response shape (including why `trust_tier` is an integer and there's no root-level `alignment_score`), approval polling semantics (server returns `action`, raw-HTTP callers must read it; SDK normalizes to `verdict`), and the full spec-vs-implementation mismatch list.

Span attribute details (gate attributes per tool class, LLM domain detection workaround) live in `references/span-reference.md`. The openbox-sdk's `gen_ai` span type and both runtime adapters (`openbox-sdk/runtime/claude-code`, `openbox-sdk/runtime/cursor`) inject required attributes automatically; custom clients must replicate.

Only one hard rule belongs in-line: **`activity_input` must be an array**, wrap single payloads as `[{...}]`. Objects return 422 (or 500 depending on which layer surfaces).

## OPA / Rego Policies

Policies must use `result` with `decision`/`reason` (uppercase `ALLOW`/`REQUIRE_APPROVAL`/`BLOCK`/`HALT`). Package name: `package org.openbox_ai.<name>`. Only one policy active per agent, so combine rules into a single file.

**See `references/rego-reference.md`** for syntax (`contains`, `startswith`, `input.activity_input[0].<field>` access), the extracted-fields rule (only `prompt` and `messages` land at root - everything else is nested), ready-to-use templates (DDL block, approval gate, trust-tier gates, combined), debugging patterns, and the "Policy Lifecycle Gotchas" section covering policy immutability, the one-active-per-agent rule, and why `result.decision` must replace `deny[msg]`.

## Behavior Rules + Goal Alignment

See `references/commands.md` - `behavior create` and `goal update` both have non-obvious required fields. High-friction gotchas:

- Shell commands classify as `internal` (no dedicated type) - use `--trigger internal --states internal`.
- Verdict `2` (REQUIRE_APPROVAL) requires `--approval-timeout <seconds>` or 422.
- `goal update --model` is required - without it, 422.

## SDKs and host integrations

`references/existing-sdks.md` is the single source of truth - decision tree
for picking a path, full sub-path inventory for `openbox-sdk`, the framework
SDK catalogue, and what was archived during consolidation.

**TL;DR for TypeScript/Node:**

```bash
npm install openbox-sdk@github:OpenBox-AI/openbox-sdk
```

```typescript
import { govern, presets } from 'openbox-sdk/core-client';

await govern({ core, preset: presets.claudeCode }, async (session) => {
  const verdict = await session.preToolUse({ input: [...] });
  if (verdict.arm === 'block') return; // governance fired
  // ...your tool body
});
```

`govern()` opens the workflow envelope and finalizes it on return (even on
throw). For per-event-process binaries use `govern.attach()` instead - see
`references/governance-flow.md`.

**TL;DR for host integrations** (Claude Code, Cursor, MCP, Skills):

```bash
npm install -g openbox-sdk@github:OpenBox-AI/openbox-sdk

openbox claude-code install   # writes ~/.claude/settings.json hooks block
openbox cursor install        # writes ~/.cursor/hooks.json
openbox mcp serve             # MCP stdio server (configure host to spawn this)
openbox skill install         # copies SKILL.md + references into ~/.claude/skills/openbox/
```

These are flagged `experimental` until verified. Pass `--experimental` (or
`OPENBOX_EXPERIMENTAL_LEVEL=experimental`) to surface them in `--help`.

## CLI

Full command reference: `references/commands.md`. All `--json` options
support raw string, `@file.json`, or `-` (stdin). Run `openbox <command>
--help` before using a command you haven't run recently - the help output
is the authoritative contract.

The CLI uses a maturity gate: most commands are gated `experimental` by
default until they've been individually verified, exposed by the
`--experimental` flag or `OPENBOX_EXPERIMENTAL_LEVEL=experimental` env.
Stable today: `auth`, `health`, `versions`, `doctor`. Everything else is
opt-in.

## Environment Variables + HTTP Headers

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENBOX_ENV` | `production` | `production` \| `staging` \| `local` - selects backend + core URLs from the SDK's registry |
| `OPENBOX_API_URL` | per env | Override backend URL on top of `OPENBOX_ENV` |
| `OPENBOX_CORE_URL` | per env | Override core URL on top of `OPENBOX_ENV` |
| `OPENBOX_API_KEY` | - | Agent API key for core calls |
| `OPENBOX_ORG_ID` | - | Organization ID |
| `OPENBOX_CLIENT_VARIANT` | unset | Suffix appended to `X-Openbox-Client` for telemetry (see below) |

### `OPENBOX_CLIENT_VARIANT` - identify yourself when running CLI commands

If you (Claude Code, Codex, Cursor, or any other LLM tool driving this skill) are about to run `openbox <cmd>` shell commands, **set `OPENBOX_CLIENT_VARIANT` first** so backend telemetry can distinguish skill-driven CLI traffic from human CLI usage:

```bash
export OPENBOX_CLIENT_VARIANT=claude-code   # or codex, cursor, claude-desktop, ...
openbox auth profile
openbox --env staging agent list
```

The CLI auto-appends `/<variant>` to its `X-Openbox-Client` header (`openbox-cli/claude-code`). Allowed characters: `[A-Za-z0-9._+-]`. Invalid values are silently dropped with a warning so a typo can't poison the header. Setting this helps the OpenBox team see which LLM tools are using the skill, debug per-tool issues, and prioritize support - set it once at the start of your session.

If the user is talking to the OpenBox MCP server (`openbox mcp serve` - the runtime under `openbox-sdk/runtime/mcp`) instead of a direct CLI shell, the server reads its calling client's name from the MCP `initialize` handshake and sets `openbox-mcp/<caller>` automatically - no `OPENBOX_CLIENT_VARIANT` needed.

### `X-Openbox-Client` header - backend's auth tripwire

**Backend calls require the `X-Openbox-Client` header** (presence-only - any value). Without it, every backend call returns 401 even with a valid JWT. CLI and first-party SDKs send this automatically. See `references/backend-api.md` for the full story (the check is at the edge proxy, not in NestJS source - has implications for self-hosters). Core API does NOT require this header - it auths via the `obx_live_*` key.

Backend-wide conventions (`{status, data}` response envelope, auth refresh status, CLI-stays-inside-backend-proxy principle) also live in `references/backend-api.md`.

## Evaluation Pipeline

Short version: OPA + Guardrails + AGE run concurrently in core, final verdict = highest priority across the three (`allow < require_approval < block < halt`). OPA non-ALLOW short-circuits the others. Full mechanics + known production behaviors: `references/governance-flow.md` § "Spec vs Implementation Mismatches" + § "Known Production Behaviors".
