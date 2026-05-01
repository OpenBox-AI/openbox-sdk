# Guardrail reference

Configuration and debugging notes for guardrails: the
content-validation layer that runs alongside OPA and behavior rules
during `core evaluate`.

## Contents

- [Numeric type IDs](#numeric-type-ids)
- [Required params per type](#required-params-per-type)
- [`settings` shape](#settings-shape)
- [Stage gating and event pairing](#stage-gating-and-event-pairing)
- [Field path prefixes](#field-path-prefixes)
- [`activity_type` matching](#activity_type-matching)
- [`on_fail` semantics](#on_fail-semantics)
- [Response shape](#response-shape)
- [Per-field status values](#per-field-status-values)
- [PII entity rename](#pii-entity-rename)
- [Ban-list matched-word suppression](#ban-list-matched-word-suppression)
- [Trust impact defaults](#trust-impact-defaults)
- [Validation gaps at the backend layer](#validation-gaps-at-the-backend-layer)

## Numeric type IDs

The platform maps these numeric IDs to validators:

| ID | Name | CLI aliases |
|---|---|---|
| `1` | PII Detection | `pii_detection`, `pii` |
| `2` | NSFW / Content Filter | `nsfw`, `nsfw_detection`, `content_safety` |
| `3` | Toxicity | `toxicity`, `toxicity_detection` |
| `4` | Ban List | `ban_list`, `ban_words` |
| `5` | Regex Match | `regex`, `regex_match` |

The CLI maps friendly names to numeric IDs before sending. Raw HTTP
clients must send the numeric ID as a string. Sending a name stores
it verbatim and core won't match it at eval time.

## Required params per type

| Type | `params` | `settings.on_fail` |
|---|---|---|
| PII, `1` | `entities: string[]`, optional. Example: `["EMAIL_ADDRESS","US_SSN"]`. The platform renames this field internally for the underlying validator | `1` to block, `0` to redact |
| NSFW, `2` | none | `1` |
| Toxicity, `3` | none | `1` |
| Ban List, `4` | `banned_words: string[]` is required. The validator cannot instantiate without it | `1` |
| Regex, `5` | `regex: string` is required. Single pattern; use `\|` for alternation. `match_type: "search"` is optional | `1` |

`params.entities` is renamed internally before reaching the
validator. Send `entities` as documented; the platform handles the
rewrite.

## `settings` shape

Every guardrail needs `settings.activities[]`. Each entry binds the
guardrail to a specific `activity_type` plus the fields to scan:

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

Multiple entries in `activities[]` mean "fire for any of these
activity_types". No wildcards.

## Stage gating and event pairing

Guardrails fire only at the event stage they're configured for:

| `processing_stage` | Matching `event_type` | `fields_to_check` prefix | Use for |
|---|---|---|---|
| `"0"` | `ActivityStarted` | must start with `input.` | Input validation: PII redaction, ban words, prompt injection |
| `"1"` | `ActivityCompleted` | must start with `output.` | Output validation: toxicity, output PII, regex on results |
| any other value such as `"both"`, `"2"`, `""` | none | n/a | guardrail silently skips every event |

> **Validation gap.** The backend does not validate
> `processing_stage`. It accepts any string and persists it. The CLI
> rejects `"both"`, `"2"`, and `""` before write, but raw HTTP clients
> can store invalid values that silently disable the guardrail
> forever. The evaluator returns no prefix at eval time and the
> guardrail is skipped.

Integrations that emit only `ActivityStarted` or only
`ActivityCompleted` silently half-disable their guardrail config. See
`references/governance-flow.md` § Required event sequence.

For input and output coverage, create two separate guardrails: one
per stage.

## Field path prefixes

`fields_to_check` paths are literal prefixes matched against the
field path. Paths that do not start with the resolved stage prefix
of `input` or `output` are silently dropped.

| Path | Matches on | Why |
|---|---|---|
| `input.*.message` | `message` field in any element of the `activity_input` array via array wildcard | Stage 0; starts with `input` |
| `input.*.body` | `body` in any `activity_input` element | Stage 0 |
| `input.prompt` | `prompt` at root, extracted by core for LLM events | Stage 0 |
| `output.response` | `response` in `activity_output` | Stage 1 |
| `output.*.content` | `content` field in any element of an array-shaped output | Stage 1 |
| `prompt` | nothing; dropped | No `input` or `output` prefix |

## `activity_type` matching

The matcher uses exact string equality. No wildcards, no regex.

- If a client sends `"LLMCompletion"` and the guardrail is configured
  for `"LLMCompleted"`, the guardrail will not fire. No error, no
  warning.
- For multiple activity types, list them as separate entries in
  `settings.activities[]`.

See `references/governance-flow.md` § Canonical `activity_type` for
the conventional past-tense PascalCase strings every first-party SDK
uses.

## `on_fail` semantics

| `on_fail` | Meaning | Effect |
|---|---|---|
| `0` | FIX | Transform or redact the offending content and continue |
| `1` | EXCEPTION | Block. Raise. Verdict flips to `block` |

Default is `0` if omitted.

## Response shape

The platform returns per-field validation details, forwarded as
`guardrails_result` in the governance verdict:

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

`guardrails_result` only appears on `ActivityStarted` and
`ActivityCompleted` responses, never on `WorkflowStarted` or
`WorkflowCompleted`.

## Per-field status values

| `status` | Meaning |
|---|---|
| `allow` | Field passed validation |
| `transformed` | Field was modified, e.g. PII redacted or ban word masked. Content moves to `redacted_input` |
| `block` | Field failed and the guardrail was `on_fail=1`. Verdict flips to `block` |
| `error` | Validator crashed mid-check. Logged and skipped |

Top-level `action` is either `"continue"` or `"stop"`. Core uses it
to decide whether to short-circuit the rest of the evaluation
pipeline.

## PII entity rename

The platform renames `params.entities` internally before passing it
to the underlying PII validator. The user-facing API is `entities`.
This is an implementation detail but matters when debugging by
diffing the DB row against what the validator receives.

## Ban-list matched-word suppression

The ban-list validator masks the matched word internally before
returning. The platform surfaces a generic reason,
`"Output contains banned words"`, and does not say which word hit.

To surface the matched word in your UI, re-match client-side against
the known `banned_words` list after the guardrail fires. The
dashboard uses this pattern.

## Trust impact defaults

`trust_impact` defaults to `NONE` on create when the field is
omitted. TrustImpact enum values: `none`, `low`, `medium`, `high`.

Only `low`, `medium`, and `high` contribute to trust-score decay on
guardrail violations. `none` means log it without decaying trust.

## All matching guardrails fire

There is no per-content routing. Every active guardrail whose
`activity_type` matches the event's `activity_type` evaluates. There
is no "only run NSFW on image-like content" filtering. Configuring
both PII and NSFW on the same `activity_type` means both run on every
event with that type.

To avoid false positives, split by `activity_type`. Use distinct
types per scenario, such as `UserPrompt`, `LLMCompletion`,
`ToolResult`, or `ImageCaption`, and scope each guardrail to only the
types where its validator applies.

## Validation gaps at the backend layer

Important for anyone building a raw HTTP client and skipping CLI
validation:

- `guardrail_type` is typed as a string up to 255 chars at the DTO.
  The backend does not enforce the `"1"` through `"5"` range. Invalid
  IDs persist silently; the matcher skips them at eval time and no
  row appears in the eval response.
- `processing_stage` is a free string. The backend does not validate
  `"0"` or `"1"`. A raw client can store `"both"` and the guardrail
  silently skips every event forever. The CLI's `--stage 0|1` check
  exists to prevent this, but the backend itself does not.
- Violation-log endpoint filter: `openbox guardrail violations` only
  returns entries with non-`allow` status. Passing evaluations are
  filtered out at the query layer and will not appear in the
  violation log.

## Related references

- `references/governance-flow.md`: full event sequence and
  stage-gating in protocol context.
- `references/commands.md` § guardrail: CLI options and canonical
  JSON examples.
- `references/rego-reference.md`: the policy layer that runs
  alongside guardrails.
- `references/span-reference.md`: span attributes that feed behavior
  rules. Distinct from guardrails.
