# openbox-sdk

TypeScript SDK for integrating applications and agent runtimes with OpenBox.

The SDK is API-first. It provides typed clients for OpenBox Core and Backend,
workflow governance helpers, generated types, and optional runtime adapters.
It should stay generic: no app-specific business logic, demo data, or hidden
compatibility behavior belongs in the package.

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
npm run build
npx tsc --noEmit -p tsconfig.build.json
npm run test:unit
npm run test:contract
npm run test:hook-integration
npm run test:e2e
npm run check:generated-drift
npm run lint:generated-banners
```

TypeSpec under `specs/typespec/` is the source for generated contracts. Fix the
spec or generator first; do not patch generated output by hand.

## License

[MIT](./LICENSE)
