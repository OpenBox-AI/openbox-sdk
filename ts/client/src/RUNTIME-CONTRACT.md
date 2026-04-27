# Platform-specific runtime contract

`OpenBoxClient` (and `OpenBoxCoreClient`) split into two layers:

```
spec-driven                hand-written platform runtime
───────────                ─────────────────────────────
generated/wrapper-methods.ts   client.ts (this file)
  - 136 wire methods            - constructor + state
  - signatures from spec        - request() (fetch + retry + rate-limit + CSRF + auth)
  - bodies are 1-line           - httpGet / httpPost / httpPut / httpPatch / httpDelete
                                  helpers consumed by the generated bodies
                                - rate-limiter.ts: TokenBucket
```

Anything in the right column is hand-written because it touches a
platform primitive (`fetch`, `setTimeout`, JS Promise scheduling,
`Headers`/`URLSearchParams`). The wire shapes it deals with are still
spec-driven; what's hand-written is *how those shapes get on the wire*.

## What stays platform-specific

| Behavior | Why hand-written |
|---|---|
| `fetch()` invocation | Each language has its own HTTP client (`fetch` in JS/TS, `reqwest` in Rust, `requests` / `httpx` in Python, `net/http` in Go). The shape of the request and the parsing of the response are spec-driven; the call itself is not. |
| Retry-with-backoff | `setTimeout` / `Promise.race` / `AbortController` are JS-specific. Rust uses `tokio::time::sleep`; Python uses `asyncio.sleep`. |
| Token bucket (rate limiting) | Pure algorithm, but concurrency primitives differ per language. |
| CSRF token round-trip | Browser-cookie semantics + `XSRF-TOKEN` cookie + `X-XSRF-TOKEN` header - the *protocol* is stable, the *implementation* uses platform cookie APIs. |
| JWT refresh callback (`onTokenRefresh`) | TS uses a callback pattern. Rust would use a channel; Python a Future; Go a chan. |

## What the contract MUST guarantee

These behaviors are locked by `tests/unit/runtime-contract.test.ts`. Any
reimplementation (TS or other language) must produce them or the test
fails:

- **Authorization**: every authenticated request sends
  `Authorization: Bearer <accessToken>`.
- **Client identity**: every request sends `X-Openbox-Client: <clientName>`,
  with `OPENBOX_CLIENT_VARIANT` appended via the env library's
  `resolveClientName` (covered in `@openbox/env`'s contract tests).
- **Path concatenation**: the request URL is exactly `<baseUrl>/<path>`.
  Path placeholders (`/agent/{agentId}`) get substituted by the
  generated wrapper before the call lands here.
- **Body encoding**: non-GET requests send `JSON.stringify(body)` with
  `Content-Type: application/json`. GET requests send no body.
- **Query encoding**: the `params` argument (when present) is
  URL-encoded onto the path via `URLSearchParams` semantics.
- **2xx unwrap**: a `{ status, data }` envelope is unwrapped to the
  inner `data`. A bare body is returned as-is.
- **Non-2xx**: throws `OpenBoxApiError` carrying the response status
  and parsed body. The thrown value `instanceof OpenBoxApiError`.

## Reproducibility

Two engineers (or two languages) implementing the runtime against
this contract must produce the same wire output for the same inputs.
That's enforceable through three layers:

1. The behavioral test above.
2. The `endpoint-coverage.test.ts` ensures every spec endpoint has
   a wrapper, so the surface stays uniform.
3. The `no-redeclared-types.test.ts` ensures hand-written code never
   shadows spec-defined types.

When porting to a new language, the order is: replicate the runtime
contract assertions (in that language's test framework), then run
the conformance fixtures from `codegen/fixtures/` against the new
implementation. Any deviation surfaces as a fixture failure.
