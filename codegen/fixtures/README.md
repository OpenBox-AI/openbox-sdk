# Conformance fixtures

Cross-language test inputs. Every language SDK runs the same fixtures
through its emitted code and asserts the same observable behavior.
This is how we catch "TS works, Rust drifted" without running the
same end-to-end scenario in each language separately.

## Layout

| File | Drives |
|---|---|
| `env-resolution.json` | `loadRuntime()` produces the same `RuntimeConfig` from a given env-var snapshot, regardless of language |
| `cli-auth.json` | `openbox auth set-api-key`, `clear-api-key`, and `status` accept the same flags, fail on the same malformed inputs, and produce the same side-effects on the token store |
| `govern-protocol.json` | A scripted sequence of `WorkflowStarted`, `ActivityStarted`, and `ActivityCompleted` events fires in the same order with the same canonical `activity_type` strings |

## How a language wires up

Each language's test runner reads the fixture, drives its emitted
code through the scenario, and asserts the recorded outputs match.
Snapshots live in `codegen/snapshots/` for the emitter side. The
runtime-behavior side is compared against the `expected*` fields in
each fixture case.

- TS: `tests/contract/wire-conformance.test.ts` covers wire behavior;
  `tests/unit/fixtures.test.ts` covers fixture shape and loading.
- Rust: `cargo test --package openbox-sdk --test conformance`,
  planned.
- Python and Go runners are planned alongside their respective
  emitters.
