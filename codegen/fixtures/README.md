# Conformance fixtures

Cross-language test inputs. Every language SDK runs **the same**
fixtures through its emitted code and asserts the same observable
behavior. This is how we catch "TS works, Rust drifted" without
running the same end-to-end scenario six different ways.

## Layout

| File | Drives |
|---|---|
| `env-resolution.json` | `loadRuntime()` produces the same `RuntimeConfig` from a given env-var snapshot, regardless of language |
| `cli-auth.json` | `openbox auth login`/`logout`/`profile` accept the same flags, fail on the same malformed inputs, and emit the same JSON output |
| `govern-protocol.json` | A scripted sequence of `WorkflowStarted` / `ActivityStarted` / `ActivityCompleted` events fires in the same order with the same canonical activity_type strings |

## How a language wires up

Each language's test runner reads the fixture, drives its emitted
code through the scenario, and asserts the recorded outputs match.
Snapshots live in `codegen/snapshots/` for the emitter side; the
runtime-behavior side gets compared against the `expected` block
embedded in each fixture.

- TS: `vitest` test under `ts/<package>/tests/conformance/`
- Rust: `cargo test --package openbox-sdk --test conformance`
- Python: `pytest tests/conformance/` 
- Go: `go test ./conformance/...` 
