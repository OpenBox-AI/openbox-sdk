# `ts/env/src/generated/`

**AUTO-GENERATED. Do not hand-edit any file in this directory.**

| Source | Reproduces |
|---|---|
| `specs/typespec/env/main.tsp` | the `EnvName`, `EnvConfig`, and `EnvLoader` types - and the `ENV_VAR_BINDINGS`, `validateApiKeyFormat`, `OS_PATH_FIELDS` constants |
| `codegen/emitters/ts/src/index.ts` | the emit logic that walks the spec and writes this directory |

Regenerate everything in this folder with:

```bash
npm run specs:compile
```

## How hand-written code in this package relates

The files in `ts/env/src/*.ts` (excluding this `generated/` dir):

- **import** types from `./generated/env-bindings.js`
- **never** redeclare those types - TypeScript fails compile if you do
- **must** annotate any function listed on `EnvLoader` with
  `EnvLoader['<name>']` so a spec/impl signature drift is a `tsc`
  error rather than a runtime surprise

Hand-written files own:

- runtime functions (`resolveEnv`, `resolveUrls`)
- internal data-only modules (`token-codec.ts`, `client-name.ts`) that
  describe wire formats not part of the public env contract

If you find yourself wanting to add a public type to a hand-written
file, add it to `specs/typespec/env/main.tsp` instead and rerun the
codegen - that's how the contract grows.
