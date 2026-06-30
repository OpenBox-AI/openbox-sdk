# Differential parity harness — TS SDK vs canonical langgraph-py

The reference is the ONLY oracle. We do not assert hand-written expectations; we run
the **real** reference instrumentation over **real** operations (real OTel SDK, real
file I/O, real `@traced` call), capture the genuine `span_data` it emits, and diff the
TS SDK's real emission field-by-field. No fake spans, no stubs, no synthetic golden.

## Run
```
cd ../../../openbox-langgraph-sdk-python && uv run --python 3.12 \
  python ../openbox-sdk/tests/differential/capture_reference_spans.py \
  > ../openbox-sdk/tests/differential/reference-spans.json
cd ../openbox-sdk && npx tsx tests/differential/diff.mjs
```

## Inventory — covered surface
Volatile-normalized: span_id, trace_id, parent_span_id, start/end/duration.

| Span | Status |
|---|---|
| file.write started+completed | ✅ 1:1 (incl. OTel attributes) |
| file.read started+completed | ✅ 1:1 |
| file.open started | ✅ 1:1 |
| file.close completed (cumulative bytes + operations[]) | ✅ 1:1 |
| function started/completed (hook_type/kind/stage/status/function/module/args/result) | ✅ 1:1 |

| http_request completed | ✅ 1:1 (name "HTTP POST", method, url, request_body, request_headers incl. httpx defaults + redaction, response_body, response_headers, http_status_code) |

### Documented, justified divergences (NOT bugs)
- **function `attributes`**: REF `{}` vs TS `{code.function, code.namespace, function.arg.*, function.result}`. The reference's `tracing.py:48` `isinstance(raw_attrs, dict)` drops real OTel `BoundedAttributes`, so it emits `{}` — almost certainly an unintended bug (file spans have no such guard and DO carry attributes). **Decision: keep the TS attributes** — they are what the reference INTENDED; TS is more correct.
- **function `args` serialization**: `{"args":[1,3],"kwargs":{}}` (TS) vs `{"args": [1], "kwargs": {"y": 3}}` (ref). Two language differences: TS `JSON.stringify` whitespace (idiomatic TS, not imitating Python `json.dumps`), and JS has no keyword args so positional/kwargs can't be split. **Exempt — language, not divergence.**

## What this caught that TDD + 100% coverage did NOT
- function COMPLETED span emitted `args` (canonical: args on started, null on completed) — FIXED.
- file.close was missing cumulative bytes/operations[] AND my first "fix" wrongly renamed it
  "file.close" — the REAL reference (with OTel SDK configured) keeps the name "file.open";
  the `file.total_bytes_*` attributes were a TS superset (reference puts them on the parent) — FIXED.
- "attributes 1:1" was silently false: it depended on the OTel SDK being configured (NoOp tracer
  drops attributes) AND on the reference isinstance() quirk.

- **http `attributes`**: REF `{}` vs TS `{http.method, http.url}`  14 the http governance hook sets NO attributes itself; these come from the EXTERNAL OTel httpx instrumentor (semconv). Instrumentor-provided, external to both repos. Exempt.

## NOT yet covered (honest gaps in the harness itself)
db_query: COVERED via a REAL Postgres (docker postgres:16) + psycopg2 + the OTel psycopg2 instrumentor, which DOES route through the reference CursorTracer governance. Result: 1:1 on the full contract (name "SELECT", db_system, db_name, db_operation, db_statement, server_address, server_port, rowcount). This caught a real divergence the fake-span fixture missed: the TS canonicalizeSpan rewrote db names to "{op} {system}" ("SELECT postgresql"), but real dbapi instrumentors name spans by operation alone ("SELECT") — FIXED. db `attributes` follow the same reference isinstance() quirk as function (REF={} vs TS db.*; kept by decision). LLM/assistant-output collapses to http_request (covered above).

## Reproduce db
```
docker run -d --name diff-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=diff -p 5432:5432 postgres:16
cd ../../../openbox-langgraph-sdk-python && uv run --python 3.12 --with psycopg2-binary \\
  --with opentelemetry-instrumentation-psycopg2 python ../openbox-sdk/tests/differential/capture_db_reference_spans.py
``` These remain to be added for full coverage.
