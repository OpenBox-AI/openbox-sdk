# openbox-sdk

Spec-driven SDKs for integrating applications and agent runtimes with OpenBox.

This monorepo is API-first. It provides generated clients for OpenBox Core and
Backend, workflow governance helpers, generated types/models, and optional
runtime adapters. Shared public contracts come from TypeSpec and the OpenBox
emitter; language packages should not hand-roll divergent contract surfaces.

## Install

```bash
npm install @openbox-ai/openbox-sdk
```

## Runtime Governance

Use `@openbox-ai/openbox-sdk/core-client` for runtime governance. The key is an agent
runtime key such as `obx_live_*` or `obx_test_*`.

```ts
import { OpenBoxCoreClient, govern, presets } from "@openbox-ai/openbox-sdk/core-client";

const core = new OpenBoxCoreClient({
  apiUrl: process.env.OPENBOX_CORE_URL,
  apiKey: process.env.OPENBOX_API_KEY,
});

await govern({ core, preset: presets.default }, async (session) => {
  const verdict = await session.activity("ActivityStarted", "llm_tool_call", {
    input: [{ tool_name: "send_update", args: { audience: "customer" } }],
  });

  if (verdict.arm === "block") throw new Error(verdict.reason);
});
```

## Backend API

Use `@openbox-ai/openbox-sdk` or `@openbox-ai/openbox-sdk/client` for Backend/API setup, admin, and
readiness work. The key is an org/API key such as `obx_key_*`.

```ts
import { OpenBoxClient } from "@openbox-ai/openbox-sdk";

const backend = new OpenBoxClient({
  apiUrl: process.env.OPENBOX_API_URL,
  apiKey: process.env.OPENBOX_BACKEND_API_KEY,
});
```

Key split:

- `OPENBOX_API_KEY`: agent runtime key for Core governance.
- `OPENBOX_BACKEND_API_KEY`: org/API key for Backend setup and reads.

## Public Imports

| Import | Purpose |
| --- | --- |
| `@openbox-ai/openbox-sdk` | Root facade and Backend client |
| `@openbox-ai/openbox-sdk/client` | Backend client |
| `@openbox-ai/openbox-sdk/core-client` | Core client, `govern()`, presets, redaction helpers |
| `@openbox-ai/openbox-sdk/types` | Generated DTO namespaces |
| `@openbox-ai/openbox-sdk/runtime/*` | Optional runtime adapters |

`package.json` is the exhaustive export list. Integration-specific docs belong
with that integration or example, not in this top-level README.

## Develop

```bash
npm install
npm run check:sdks
npm run ci:local
npm run check:generated-drift
npm run lint:generated-banners
```

TypeSpec under `specs/typespec/` is the source for generated contracts. Fix the
spec or generator first; do not patch generated output by hand.
`check:sdks` is the generic validation gate for every language SDK target; it
currently covers TypeScript and Python from the shared TypeSpec emitter.
The repository layout and generation boundaries are documented in
[`docs/repo-structure.md`](./docs/repo-structure.md).

## License

[MIT](./LICENSE)
