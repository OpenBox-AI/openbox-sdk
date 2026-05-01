# Platform-specific runtime contract

`OpenBoxClient` and `OpenBoxCoreClient` split into two layers:

```
spec-driven                hand-written platform runtime
───────────                ─────────────────────────────
generated/wrapper-methods.ts   client.ts
  - 136 wire methods            - constructor + state
  - signatures from spec        - request(): fetch + retry + rate-limit + CSRF + auth
  - bodies are 1-line           - httpGet / httpPost / httpPut / httpPatch / httpDelete
                                  helpers consumed by the generated bodies
                                - rate-limiter.ts: TokenBucket
```

Anything in the right column is hand-written because it touches a
platform primitive: `fetch`, `setTimeout`, JS Promise scheduling,
`Headers`, `URLSearchParams`. The wire shapes are still spec-driven;
the hand-written code is just *how those shapes get on the wire*.

## What stays platform-specific

| Behavior | Why hand-written |
|---|---|
| `fetch()` invocation | Each language has its own HTTP client. JS and TS use `fetch`, Rust uses `reqwest`, Python uses `requests` or `httpx`, Go uses `net/http`. The shape of the request and the parsing of the response are spec-driven; the call itself is not |
| Retry with backoff | `setTimeout`, `Promise.race`, and `AbortController` are JS-specific. Rust uses `tokio::time::sleep`, Python uses `asyncio.sleep` |
| Rate limiting via token bucket | Pure algorithm, but concurrency primitives differ per language |
| CSRF token round-trip | Browser-cookie semantics plus the `XSRF-TOKEN` cookie and the `X-XSRF-TOKEN` header. The *protocol* is stable; the *implementation* uses platform cookie APIs |
| JWT refresh callback `onTokenRefresh` | TS uses a callback pattern. Rust would use a channel, Python a Future, Go a chan |
| Per-OS path resolution `resolveOsPath` | `os.homedir()`, `process.platform`, `%APPDATA%`, and `XDG_DATA_HOME` are platform APIs. The contract is in the spec via `OsPathResolver` and `OsPathScope`; the implementation and per-OS output are locked by `tests/unit/os-paths.test.ts` mocking `process.platform` for Linux, macOS, and Windows |

## What the contract MUST guarantee

These behaviors are locked by `tests/unit/runtime-contract.test.ts`.
Any reimplementation, in TS or another language, must produce them or
the test fails:

- **Authorization.** Every authenticated request sends
  `Authorization: Bearer <accessToken>`.
- **Client identity.** Every request sends
  `X-Openbox-Client: <clientName>`, with `OPENBOX_CLIENT_VARIANT`
  appended via the env library's `resolveClientName`. Covered in
  `openbox-sdk/env`'s contract tests.
- **Path concatenation.** The request URL is exactly
  `<baseUrl>/<path>`. Path placeholders like `/agent/{agentId}` are
  substituted by the generated wrapper before the call reaches this
  layer.
- **Body encoding.** Non-GET requests send `JSON.stringify(body)`
  with `Content-Type: application/json`. GET requests send no body.
- **Query encoding.** The `params` argument, when present, is
  URL-encoded onto the path via `URLSearchParams` semantics.
- **2xx unwrap.** A `{ status, data }` envelope is unwrapped to the
  inner `data`. A bare body is returned as-is.
- **Non-2xx.** Throws `OpenBoxApiError` carrying the response status
  and parsed body. The thrown value satisfies
  `instanceof OpenBoxApiError`.

## Per-OS path contract

`tests/unit/os-paths.test.ts` pins down `resolveOsPath` for all three
host platforms by mocking `process.platform` and the relevant env
vars. Any reimplementation must produce:

| Platform | `resolveOsPath('tokens')` |
|---|---|
| Linux | `$XDG_DATA_HOME/openbox/tokens` if set, else `~/.openbox/tokens` |
| macOS | `~/.openbox/tokens`. Deliberately not `~/Library/Application Support/...` |
| Windows | `%APPDATA%\openbox\tokens` if set, else `~\AppData\Roaming\openbox\tokens` |
| any | `$OPENBOX_HOME/tokens` always wins. Used by CI and sandboxes |

## Reproducibility

Two engineers or two languages implementing the runtime against this
contract must produce the same wire output for the same inputs.
Enforced through three layers:

1. The behavioral test above.
2. `endpoint-coverage.test.ts` ensures every spec endpoint has a
   wrapper, so the surface stays uniform.
3. `no-redeclared-types.test.ts` ensures hand-written code never
   shadows spec-defined types.

When porting to a new language: replicate the runtime contract
assertions in that language's test framework, then run the
conformance fixtures from `codegen/fixtures/` against the new
implementation. Any deviation surfaces as a fixture failure.
