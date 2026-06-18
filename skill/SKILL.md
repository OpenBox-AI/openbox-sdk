---
name: openbox
description: |
  Use this skill for OpenBox AI-agent governance: guardrails, policies, behavior rules, OPA/Rego, PII redaction, goal drift, tool/action gating, human approvals, audit trails, trust scoring, runtime governance, Cursor, Claude Code, MCP, CopilotKit, or direct SDK/API integration. Do not use it for unrelated policy, cloud IAM, SOC2, or generic code review unless the user ties the work to OpenBox or AI-agent governance.
---

# OpenBox SDK And Runtime Integration

OpenBox has two policy planes:

- **Backend API** manages agents, rules, policies, approvals, org state, audit state, and dashboard data.
- **Core API** evaluates runtime governance events, applies guardrails/redaction, tracks workflow/session lifecycle, polls approvals, and enforces verdicts.

The TypeScript SDK is the reference SDK for those APIs. Treat `specs/typespec/` as the contract source of truth.

## Public SDK Surfaces

Use the narrowest import that fits:

| Import | Use |
|---|---|
| `@openbox-ai/openbox-sdk` | Root facade for common SDK exports |
| `@openbox-ai/openbox-sdk/client` | Backend management client |
| `@openbox-ai/openbox-sdk/core-client` | Core governance client, `govern()`, presets, sessions |
| `@openbox-ai/openbox-sdk/env` | URL/key/client-name resolution helpers |
| `@openbox-ai/openbox-sdk/config` | Node config-file readers and shared OpenBox config store |
| `@openbox-ai/openbox-sdk/types` | Generated Backend/Core DTO namespaces |
| `@openbox-ai/openbox-sdk/validators` | Shared validation/error helpers |
| `@openbox-ai/openbox-sdk/approvals` | Platform-agnostic approval formatting/state helpers |
| `@openbox-ai/openbox-sdk/runtime/mcp` | MCP stdio runtime |
| `@openbox-ai/openbox-sdk/runtime/cursor` | Cursor project plugin + hook runtime |
| `@openbox-ai/openbox-sdk/runtime/claude-code` | Claude Code project plugin + hook runtime |
| `@openbox-ai/openbox-sdk/copilotkit` | CopilotKit runtime adapter |
| `@openbox-ai/openbox-sdk/copilotkit/react` | CopilotKit React hooks/renderers |

There is no public `@openbox-ai/openbox-sdk/approvals/mocks` import. Test fixtures stay in repository tests or explicit test utilities.

## Environment Model

Runtime/Core calls need:

```sh
OPENBOX_CORE_URL=http://localhost:8086
OPENBOX_API_KEY=obx_test_...
```

Backend/API calls need:

```sh
OPENBOX_API_URL=http://localhost:3000
OPENBOX_BACKEND_API_KEY=obx_key_...
```

Use `openbox connect --api-url <url> --core-url <url> --api-key <key>` or `openbox auth set-api-key` to persist backend credentials locally. The shared config store is read by CLI, MCP, Cursor, and extension surfaces. Claude Code hooks read the project-local `.claude-hooks/config.json` or `.claude-hooks/.env` created by the project plugin install; do not rely on user-level Claude or OpenBox config for hook governance.

## CLI Shape

The CLI is a small installer/runtime/API utility, not a broad hand-written admin console.

Stable command groups:

- `openbox auth`
- `openbox connect`
- `openbox config`
- `openbox api`
- `openbox health`
- `openbox doctor`
- `openbox install`
- `openbox uninstall`
- `openbox cursor`
- `openbox claude-code`
- `openbox mcp`

Management operations go through the spec-driven API caller:

```sh
openbox api list backend
openbox api backend <operationId> --body '{"key":"value"}'
openbox api list core
openbox api core <operationId> --body '{"key":"value"}'
```

Do not recommend old generated CRUD command groups such as `openbox agent`, `openbox policy`, or `openbox guardrail`; they are not the lean mainline CLI surface.

## Project-Local Host Installs

Host setup is project-scoped. Do not write host-level Cursor or Claude Code config by default.

```sh
openbox install cursor --cwd <project>
openbox install claude-code --cwd <project>
openbox cursor plugin export --out <dir>
openbox claude-code plugin export --out <dir>
openbox claude-code doctor --cwd <project> --surface-only --json
openbox mcp serve
```

Cursor install writes a local plugin under `<project>/.cursor/plugins/local/openbox`. Claude Code install writes skill/plugin assets under the target project. MCP and hook commands are runtime entrypoints used by those project-local assets.

## Governance Runtime Pattern

For custom TypeScript agents, use Core client sessions instead of hand-rolling workflow envelopes:

```ts
import { OpenBoxCoreClient, govern, presets } from '@openbox-ai/openbox-sdk/core-client';

const core = new OpenBoxCoreClient({
  apiUrl: process.env.OPENBOX_CORE_URL,
  apiKey: process.env.OPENBOX_API_KEY,
});

await govern({ core, preset: presets.claudeCode }, async (session) => {
  const verdict = await session.preToolUse({
    input: [{ tool_name: 'Read', file_path: '/workspace/customer.csv' }],
  });
  // Enforce allow/constrain/require_approval/block/halt from verdict.
});
```

The SDK must fail closed on governed paths. If Core is unavailable, do not silently proceed with risky prompts, tools, final text, or external actions.

## References

- `references/commands.md`: current CLI/API command shape.
- `references/existing-sdks.md`: integration path by host/framework.
- `references/governance-flow.md`: workflow/session/event lifecycle.
- `references/claude-code-governance.md`: current Claude Code hook/plugin/MCP surface audit.
- `references/guardrails.md`, `references/rego-reference.md`, `references/behaviors.md`: policy concepts and examples.
- `references/validation-checklist.md`: release/integration checks.
