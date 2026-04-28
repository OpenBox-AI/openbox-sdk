# Guardrail Reference

Everything specific to configuring and debugging guardrails - the content-validation layer that runs via the FastAPI `the-guardrails-service` service behind core.

## Contents

- [Numeric Type IDs](#numeric-type-ids)
- [Required Params Per Type](#required-params-per-type)
- [`settings` Shape](#settings-shape)
- [Stage Gating + Event Pairing](#stage-gating--event-pairing)
- [Field Path Prefixes](#field-path-prefixes)
- [`activity_type` Matching](#activity_type-matching)
- [`on_fail` Semantics](#on_fail-semantics)
- [Response Shape](#response-shape)
- [Per-Field Status Values](#per-field-status-values)
- [PII Entity Rename](#pii-entity-rename)
- [Ban-List Matched-Word Suppression](#ban-list-matched-word-suppression)
- [Trust Impact Defaults](#trust-impact-defaults)
- [Validation Gaps at the Backend Layer](#validation-gaps-at-the-backend-layer)

## Numeric Type IDs

The guardrails service (`the-guardrails-service/src/services/guardrails.py:GUARDRAILS_MAP`) maps these numeric IDs to GuardrailsHub validators:

| ID | Name | CLI aliases |
|----|------|-------------|
| `1` | PII Detection | `pii_detection`, `pii` |
| `2` | NSFW / Content Filter | `nsfw`, `nsfw_detection`, `content_safety` |
| `3` | Toxicity | `toxicity`, `toxicity_detection` |
| `4` | Ban List | `ban_list`, `ban_words` |
| `5` | Regex Match | `regex`, `regex_match` |

The CLI (`packages/cli/src/commands/guardrail.ts`) maps friendly names to numeric IDs before sending. Raw HTTP clients must send the numeric ID as a string - sending a name stores it verbatim and core won't match it at eval time.

## Required Params Per Type

| Type | `params` | `settings.on_fail` |
|------|----------|---------------------|
| PII (`1`) | `entities: string[]` (optional, e.g. `["EMAIL_ADDRESS","US_SSN"]`) - the service auto-renames this to `pii_entities` before instantiating `DetectPII` | `1` (block) or `0` (redact) |
| NSFW (`2`) | none | `1` |
| Toxicity (`3`) | none | `1` |
| Ban List (`4`) | **`banned_words: string[]`** - REQUIRED; service crashes instantiating `BanList` without it | `1` |
| Regex (`5`) | **`regex: string`** - REQUIRED, single pattern. Use alternation `|` for multiple. `match_type: "search"` optional | `1` |

`params.entities` being auto-renamed to `params.pii_entities` is silent - send `entities` per the docs, the service handles the rewrite.

## `settings` Shape

Every guardrail needs `settings.activities[]` - each entry binds the guardrail to a specific `activity_type` value plus the fields to scan:

```json
{
  "settings": {
    "activities": [
      {
        "activity_type": "LLMCompleted",
        "fields_to_check": ["output.response", "output.content"]
      }
    ],
    "on_fail": 1,
    "log_violation": true
  }
}
```

Multiple entries in `activities[]` means "fire for any of these activity_types." No wildcards.

## Stage Gating + Event Pairing

Guardrails fire only at the event stage they're configured for. The service's `_get_field_check_prefix(event_type, processing_stage)` is the authoritative mapping:

| `processing_stage` | Matching `event_type` | `fields_to_check` prefix | Use for |
|---|---|---|---|
| `"0"` | `ActivityStarted` | must start with `input.` | Input validation (PII redaction, ban words, prompt injection) |
| `"1"` | `ActivityCompleted` | must start with `output.` | Output validation (toxicity, output PII, regex on results) |
| any other value (`"both"`, `"2"`, `""`) | none | - | **returns `None` → guardrail silently skips every event** |

> **Validation gap:** the backend does NOT validate `processing_stage` - it accepts any string and persists it. The CLI validator catches `"both"`/`"2"`/`""` before write, but raw HTTP clients can store invalid values that silently disable the guardrail forever (the service's `_get_field_check_prefix()` returns `None` at eval time and the guardrail is skipped).

This is why integrations that emit only `ActivityStarted` (or only `ActivityCompleted`) silently half-disable their guardrail config. See `references/governance-flow.md` § Required Event Sequence for the full protocol.

If you want input AND output coverage, create two separate guardrails - one per stage.

## Field Path Prefixes

`fields_to_check` paths are literal prefixes matched by `field.startswith(field_check)` in the service. Paths that don't start with the resolved stage prefix (`input` or `output`) are silently dropped.

| Path | Matches on | Why |
|------|-----------|-----|
| `input.*.message` | `message` field in any element of the `activity_input` array (array wildcard) | Stage 0, starts with `input` |
| `input.*.body` | `body` in any `activity_input` element | Stage 0 |
| `input.prompt` | `prompt` at root (extracted by core's `buildOPAInput` for LLM events) | Stage 0 |
| `output.response` | `response` in `activity_output` | Stage 1 |
| `output.*.content` | `content` field in any element of an array-shaped output | Stage 1 |
| `prompt` (no prefix) | **nothing** - dropped | No `input`/`output` prefix |

## `activity_type` Matching

`services/guardrails.py:67` uses `logs.get("activity_type") == activity.get("activity_type")` - exact string match, no wildcards, no regex.

- If your client sends `"LLMCompletion"` and the guardrail is configured for `"LLMCompleted"`, **the guardrail won't fire.** No error, no warning.
- If you want the guardrail to apply to multiple activity types, list them as separate entries in `settings.activities[]`.

See `references/governance-flow.md` § Canonical `activity_type` Names for the conventional past-tense PascalCase strings every first-party SDK uses.

## `on_fail` Semantics

Maps to the GuardrailsHub `OnFailAction` enum:

| `on_fail` | Meaning | Effect |
|-----------|---------|--------|
| `0` | FIX | Transform / redact the offending content and continue |
| `1` | EXCEPTION | Block - raise, verdict flips to `block` |

Default is `0` if omitted.

## Response Shape

The guardrails service returns per-field validation details. The core forwards this as `guardrails_result` in the governance verdict:

```json
{
  "guardrails_result": {
    "validation_passed": true,
    "input_type": "activity_input",
    "redacted_input": null,
    "reasons": [],
    "guardrail_results": [
      {
        "guardrail_type": "1",
        "results": [
          { "field": "input.0.message", "order": 0, "status": "allow", "reason": null }
        ]
      }
    ],
    "action": "continue"
  }
}
```

`guardrails_result` only appears on `ActivityStarted` / `ActivityCompleted` responses - not `WorkflowStarted` / `WorkflowCompleted`.

## Per-Field Status Values

The per-field `status` field (new since the last skill refresh - document explicitly):

| `status` | Meaning |
|----------|---------|
| `allow` | Field passed validation |
| `transformed` | Field was modified (PII redacted, ban word masked, etc.) - content now in `redacted_input` |
| `block` | Field failed and the guardrail was `on_fail=1` - verdict flips to `block` |
| `error` | Guardrail validator crashed mid-check - logged, skipped |

Top-level `action` is either `"continue"` or `"stop"`. The core uses this to decide whether to short-circuit the rest of the evaluation pipeline.

## PII Entity Rename

`services/guardrails.py:87-88` silently renames `params.entities` → `params.pii_entities` before passing to `DetectPII`. Docs elsewhere say "send `entities: string[]`" - that's the user-facing API. The rename is implementation detail but worth knowing if you're debugging by diffing the DB row vs what the GuardrailsHub validator receives.

## Ban-List Matched-Word Suppression

The GuardrailsHub `BanList` validator masks the matched word internally before returning. The service surfaces only a generic reason: `"Output contains banned words"`. It does NOT tell you which word hit.

If you want to surface the matched word in your UI, re-match client-side against the known `banned_words` list after the guardrail fires. This is the pattern the dashboard uses.

## Trust Impact Defaults

`the-backend-service`'s `guardrail.service.ts` defaults `trust_impact` to `NONE` on create when the field is omitted. TrustImpact enum: `none | low | medium | high` (`trust.enum.ts`).

Only `low` / `medium` / `high` contribute to trust-score decay on guardrail violations. `none` means "log it but don't ding trust."

## All Matching Guardrails Fire - No Per-Content Routing

Every active guardrail whose `activity_type` matches the event's `activity_type` will evaluate. There's no "only run NSFW on image-like content" routing - if you configure both PII and NSFW on the same `activity_type`, both run on every event with that type.

To avoid false positives (NSFW flagging PII-heavy content, ban-words hitting legitimate technical prose), split by `activity_type`: use distinct types per scenario category (`UserPrompt`, `LLMCompletion`, `ToolResult`, `ImageCaption`) and scope each guardrail to only the types where its validator makes sense.

## Validation Gaps at the Backend Layer

Important for anyone building a raw HTTP client (skipping the CLI's validation):

- **`guardrail_type`** is typed as `string` up to 255 chars in `CreateGuardrailDto`. Backend does NOT enforce "1"-"5". Invalid IDs persist silently; the guardrails service simply `continue`s past them (no row in the eval response).
- **`processing_stage`** is a free string. Backend does NOT validate "0"/"1". A raw client can store `"both"` and it will silently skip every event forever - the CLI's "`--stage` must be 0 or 1" check exists to prevent this, but the backend itself doesn't.
- **Violation-log endpoint filter** (`guardrail.service.ts:157-159`): `openbox guardrail violations` only returns entries with status in {block, transformed, error/other violation states}. Entries with `status: "allow"` are filtered out at the query layer - you won't see your passing evaluations in the violation log.

## Related references

- `references/governance-flow.md` - full event sequence, stage-gating in protocol context
- `references/commands.md` § guardrail - CLI options + canonical JSON examples
- `references/rego-reference.md` - the policy layer that runs alongside guardrails
- `references/span-reference.md` - span attributes that feed behavior rules (distinct from guardrails)
