# Differential parity harness — TS SDK vs canonical langgraph-py

The reference is the ONLY oracle. We do not assert hand-written expectations; we run
the **real** reference instrumentation over **real** operations, capture the genuine
`span_data` it emits, and diff the TS SDK's real emission against it field-by-field.
No fake spans, no stubs, no synthetic golden.

## Run
```
# 1. Capture real reference spans (read-only; monkeypatches only the gate in-harness):
cd ../../../openbox-langgraph-sdk-python && uv run --python 3.12 \
  python ../openbox-sdk/tests/differential/capture_reference_spans.py \
  > ../openbox-sdk/tests/differential/reference-spans.json
# 2. Diff TS emission vs the captured reference:
cd ../openbox-sdk && npx tsx tests/differential/diff.mjs
```

## Classified inventory (current)
Only an audited volatile set is normalized: span_id, trace_id, parent_span_id,
start_time, end_time, duration_ns.

| Span | Field | Status |
|---|---|---|
| file.write/read started+completed | all | ✅ 1:1 (incl. OTel attributes) |
| function started/completed | hook_type/kind/stage/status/events/function/module/result | ✅ 1:1 |
| function | `args` whitespace + positional/kwargs split | **language** — JS has no kwargs; idiomatic TS JSON. Exempt. |
| function | `attributes` REF={} vs TS {code.*} | **reference-quirk** — tracing.py:48 `isinstance(raw_attrs, dict)` drops real OTel BoundedAttributes, so canonical emits {}. TS keeps the (intended) code.* telemetry. DECISION NEEDED: match the {} bug, or keep useful attrs. |
| file.close completed | `bytes_read`/`bytes_written` cumulative + `operations[]` + name "file.close" | **gap** — reference holds the open span across the file's life and emits cumulative counts on close; TS models each op standalone (file_open named "file.open"). Lifecycle refactor needed for 1:1. |

## What this caught that TDD + 100% coverage did NOT
- function COMPLETED span carried `args` (should be null; only started has args) — FIXED.
- The "attributes 1:1" claim was false: it depended on the OTel SDK being configured
  (NoOp tracer silently drops attributes) AND on the reference's isinstance quirk.
