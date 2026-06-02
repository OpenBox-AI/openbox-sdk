# `ts/src/client/generated/`

**AUTO-GENERATED. Do not hand-edit.**

| Source | Reproduces |
|---|---|
| `specs/typespec/backend/main.tsp` (compiled via `@typespec/http`'s `listHttpOperationsIn`) | `endpoint-manifest.ts` (`BACKEND_ENDPOINT_MANIFEST`): array of every (path, verb, operationId, pathPattern) tuple |
| `codegen/emitters/typespec-emitter-typescript/src/index.ts` | the emit logic |

Regenerate with `npm run specs:compile`.

## Two layers of enforcement

| Layer | Source | Generated artifact | Enforcer |
|---|---|---|---|
| Wire types | `specs/generated/openapi3/OpenboxBackend.json` (TypeSpec-emitted) | `ts/src/types/generated/backend.ts` (via `openapi-typescript`) | TypeScript: methods MUST type against `Backend.paths['/...']['<verb>']`. |
| Method coverage | This file's `BACKEND_ENDPOINT_MANIFEST` | enumerated above | `tests/unit/endpoint-coverage.test.ts`: for every entry in the manifest, asserts the wrapper has a `this.<verb>(<path>, ...)` call. |

Adding a route to the spec without a matching wrapper method now fails CI on the next `npm run specs:compile` cycle.

## Authoring rules

1. Every method on `OpenBoxClient` MUST be typed with the `Backend.paths['/...']['<verb>']` row from `openbox-sdk/types`. No freehand request/response shapes.
2. Don't add a method whose path/verb isn't in the OpenAPI spec. Either the spec is wrong (fix it upstream) or the method doesn't belong here.
3. Don't redeclare a request DTO; import it from `openbox-sdk/types`.
4. The allowlist in `tests/unit/endpoint-coverage.test.ts` is empty: every endpoint declared in the spec must have a wrapper. The Keycloak browser redirect URL is a navigation, not an HTTP call, and isn't in the manifest at all. If you genuinely need to skip an endpoint, add it to the allowlist with a one-line reason and prepare to defend it in review.
