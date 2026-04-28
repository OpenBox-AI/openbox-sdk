<!-- TODO: post-monorepo-consolidation rewrite. References below describe the standalone repos; the consolidated openbox-sdk has the same surface under openbox-sdk/runtime/<x> sub-paths and openbox-sdk CLI subcommands. -->
# Existing OpenBox SDKs

Prefer using an existing SDK over raw API calls. The SDK handles governance event construction, verdict enforcement, session lifecycle, and approval polling correctly.

## Available SDKs

| SDK | Repo | Language | Framework | Status |
|-----|------|----------|-----------|--------|
| TypeScript SDK | `OpenBox-AI/openbox-sdk` | TypeScript | Any Node.js agent | Production |
| Temporal Python | `OpenBox-AI/openbox-temporal-sdk-python` | Python | Temporal workflows | Production |
| LangGraph Python | `OpenBox-AI/openbox-langgraph-sdk-python` | Python | LangGraph agents | Production |
| LangChain Python | `OpenBox-AI/openbox-langchain-sdk-python` | Python | LangChain | Production |
| LangChain TS | `OpenBox-AI/openbox-langchain-sdk-ts` | TypeScript | LangChain | Production |
| Mastra SDK | `OpenBox-AI/openbox-mastra-sdk` | TypeScript | Mastra | Production |
| DeepAgents Python | `OpenBox-AI/openbox-deepagents-sdk-python` | Python | DeepAgents | Production |
| Cloudflare Agents | `OpenBox-AI/openbox-cloudflare-agents-sdk` | TypeScript | Cloudflare Workers | Production |
| SDK (monorepo) | `OpenBox-AI/openbox-sdk` | TypeScript | CLI + client + core-client + types | Production |
| API Client CLI | `OpenBox-AI/openbox-api-client` | TypeScript | CLI + programmatic | Archived → use openbox-sdk |

| Claude Code Hooks | `OpenBox-AI/claude-hooks` | TypeScript | Claude Code CLI | Production |
| Cursor Hooks | `OpenBox-AI/cursor-hooks` | TypeScript | Cursor IDE | Production |
| n8n POC | `OpenBox-AI/n8n-openbox-poc` | TypeScript | n8n | POC |

## Planned / Coming Soon

| Framework | Status |
|-----------|--------|
| CrewAI | Documented, SDK in development |
| OpenClaw | Plugin exists, docs coming |

## SDK Selection Priority

1. **Framework-specific SDK** - if the user's framework has an SDK above, use it. These handle event construction, verdict enforcement, session lifecycle, and approval polling out of the box.
2. **`openbox-sdk`** - the primary agent SDK for TypeScript/Node.js. Install: `npm install openbox-sdk@github:OpenBox-AI/openbox-sdk`. Use `govern()` for all integrations. This is the proper way to integrate.
3. **`openbox-sdk`** - single github-installable package. Replaces `openbox-api-client`. Install: `npm install github:OpenBox-AI/openbox-sdk` (clones, runs `prepare` to build, drops `dist/` into `node_modules` - **not on npm**). Internally a monorepo (`packages/{client,core-client,env,types,cli}/`), externally exposed via `exports` map: `import ... from 'openbox-sdk/client'`, `'openbox-sdk/core-client'`, `'openbox-sdk/env'`, `'openbox-sdk/types'`, or the root `'openbox-sdk'` for everything. For testing, debugging, setup automation, and programmatic access. `openbox-sdk/types` ships both hand-curated DTOs (friendly names: `CreateAgentDto`, `GuardrailsResult`, etc.) AND auto-generated `Backend` / `Core` namespaces derived from the OpenAPI specs. Regenerate via `npm run generate:types` whenever `specs/backend.json` or `specs/core.yaml` is refreshed.
4. **Raw Core API HTTP calls** - never for production. Only for understanding the API contract when building a new SDK from scratch.

The `openbox-sdk` is the reference implementation. Read its source when building integrations - it shows the correct patterns for event construction, verdict handling, and session management.

All SDKs are under the `OpenBox-AI` GitHub org (private repos).
