// MCP server runtime; exposes OpenBox tools/resources to any
// MCP-compatible LLM (Claude Desktop, Cursor, etc.) over stdio.
//
// Invoked as `openbox mcp serve` from the CLI subcommand. Configures
// from OPENBOX_API_URL / OPENBOX_CORE_URL / OPENBOX_API_KEY.
//
// Every backend call goes through the spec-emitted OpenBoxClient
// (ts/src/client/generated/wrapper-methods.ts) so URL strings are
// validated against the OpenAPI manifest at compile time. Hand-rolling
// `api(<path>)` calls here bypasses that guardrail and lets endpoint
// drift through silently.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { OpenBoxClient } from "../../client/index.js";
import {
  OpenBoxCoreClient,
  type AgentIdentityConfig,
  type GovernanceVerdictResponse,
} from "../../core-client/index.js";
import { loadApiKey } from "../../file-tokens/index.js";
import { listConfig } from "../../config/index.js";
import { setMcpClientName } from "./config.js";
import { resolveAgentIdentity, resolveConnection } from "../../env/index.js";
import { recallAgentKey } from "../../file-tokens/agent-keys.js";
import { stampSource } from "../../approvals/source.js";
import { verifyCursorInstall } from "../cursor/install.js";
import {
  claudeCodeRuntimeDiagnostics,
  summarizeClaudeCodeChecks,
  verifyClaudeCodeInstall,
} from "../claude-code/doctor.js";
import { buildMcpGovernanceSpan, MCP_ACTIVITY_TYPE_MAP } from "./governance-span.js";
import { claudeCodeGovernanceSummary } from "../claude-code/governance-matrix.js";

export async function runMcpServer(): Promise<void> {
  const server = new McpServer({ name: "openbox", version: "0.1.0" });
  let callerName: string | undefined;

  function runtimeState() {
    const config = listConfig();
    const connection = resolveConnection({
      apiUrl: config.OPENBOX_API_URL,
      coreUrl: config.OPENBOX_CORE_URL,
      platformUrl: config.OPENBOX_PLATFORM_URL,
      authUrl: config.OPENBOX_AUTH_URL,
    });
    const apiUrl = connection.apiUrl;
    const coreUrl = connection.coreUrl;
    const backendApiKey = loadApiKey();
    const runtimeApiKey = process.env.OPENBOX_API_KEY ?? config.OPENBOX_API_KEY ?? "";
    const agentIdentity = resolveAgentIdentity({
      OPENBOX_AGENT_DID: process.env.OPENBOX_AGENT_DID ?? config.OPENBOX_AGENT_DID,
      OPENBOX_AGENT_PRIVATE_KEY: process.env.OPENBOX_AGENT_PRIVATE_KEY ?? config.OPENBOX_AGENT_PRIVATE_KEY,
    });
    return {
      apiUrl,
      coreUrl,
      backendApiKey,
      runtimeApiKey,
      agentIdentity,
      governancePolicy: "fail_closed",
      approvalMode: "remote",
    };
  }

  function runtimeDiagnostics() {
    const runtime = runtimeState();
    return {
      apiUrl: runtime.apiUrl,
      coreUrl: runtime.coreUrl,
      mcpReady: Boolean(runtime.backendApiKey),
      runtimeEnv: {
        backendApiKeyPresent: Boolean(runtime.backendApiKey),
        runtimeApiKeyPresent: Boolean(runtime.runtimeApiKey),
        coreUrlPresent: Boolean(runtime.coreUrl),
      },
      failMode: runtime.governancePolicy,
      approvalMode: runtime.approvalMode,
      unsupportedOrOptInSurfaces: {
        worktreeCreate: "opt_in",
        monitors: "opt_in_unsandboxed",
        lsp: "out_of_scope_no_language_server",
        managedSettings: "enterprise_diagnose_only",
        channels: "diagnose_only_research_preview",
      },
    };
  }

  function resolveRuntime() {
    const runtime = runtimeState();

    // MCP talks to the backend API, so it must use the org X-API-Key.
    // OPENBOX_API_KEY is the agent runtime key used by hooks/core
    // governance checks; project-local hook config may provide it, and
    // sending it to backend endpoints yields 401s in chat MCP calls.
    if (!runtime.backendApiKey) {
      throw new Error(
        `OpenBox MCP: no X-API-Key for the active OpenBox connection. ` +
          `Run \`openbox connect --api-url <url> --core-url <url> --api-key <key>\` in this project or set OPENBOX_BACKEND_API_KEY.`,
      );
    }
    return {
      coreUrl: runtime.coreUrl,
      agentIdentity: runtime.agentIdentity,
      client: new OpenBoxClient({
        apiUrl: runtime.apiUrl,
        apiKey: runtime.backendApiKey,
        clientName: "runtime/mcp",
      }),
    };
  }

  function client(): OpenBoxClient {
    return resolveRuntime().client;
  }

  function sourceLabel(): string {
    return callerName?.toLowerCase().includes("cursor") ? "cursor-mcp" : "mcp";
  }

  function approvalRows(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    const root = payload as {
      approvals?: { data?: unknown[] };
      data?: unknown[];
    };
    return root.approvals?.data ?? root.data ?? [];
  }

  async function listPendingApprovals(orgId: string): Promise<unknown[]> {
    const perPage = 100;
    const maxPages = 10;
    const out: unknown[] = [];
    for (let page = 0; page < maxPages; page += 1) {
      const data = await client().getOrgApprovals(orgId, {
        status: "pending",
        page,
        perPage,
      });
      const rows = approvalRows(data);
      out.push(...rows);
      if (rows.length < perPage) break;
    }
    return out;
  }

server.tool("get_profile", "Get current user profile and permissions", {}, async () => {
  const profile = await client().getProfile();
  return { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }] };
});

server.tool("cursor_status", "Return a compact OpenBox backend status for Cursor slash commands without using shell execution", {}, async () => {
  try {
    const health = await client().health();
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ status: "connected", health }, null, 2),
      }],
    };
  } catch (err: any) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ status: "not_reachable", error: err?.message ?? String(err) }, null, 2),
      }],
      isError: true,
    };
  }
});

server.tool("openbox_status", "Return a compact OpenBox backend status for plugin slash commands without using shell execution", {}, async () => {
  const diagnostics = runtimeDiagnostics();
  try {
    const health = await client().health();
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "connected",
          health,
          coreUrl: diagnostics.coreUrl,
          mcpReadiness: diagnostics,
          claudeCodeRuntimeReadiness: claudeCodeRuntimeDiagnostics(process.cwd()),
          claudeCodeGovernance: claudeCodeGovernanceSummary(),
        }, null, 2),
      }],
    };
  } catch (err: any) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "not_reachable",
          error: err?.message ?? String(err),
          mcpReadiness: diagnostics,
          claudeCodeRuntimeReadiness: claudeCodeRuntimeDiagnostics(process.cwd()),
          claudeCodeGovernance: claudeCodeGovernanceSummary(),
        }, null, 2),
      }],
      isError: true,
    };
  }
});

server.tool("cursor_doctor", "Verify installed Cursor/OpenBox surfaces and runtime readiness without requiring Cursor chat to run shell commands", {
  cwd: z.string().optional().describe("Project root for project-local install."),
  plugin_target: z.string().optional().describe("Explicit project-local plugin folder to inspect."),
  surface_only: z.boolean().optional().describe("When true, skip runtime key/core validation and only inspect installed files."),
  validate_core: z.boolean().optional().describe("When false, validate runtime config/key format without calling core."),
}, async ({ cwd, plugin_target, surface_only, validate_core }) => {
  const base = {
    cwd,
    pluginTarget: plugin_target,
  };
  const checks = surface_only
    ? verifyCursorInstall(base)
    : await verifyCursorInstall({
        ...base,
        includeRuntime: true,
        validateRuntime: validate_core !== false,
      });
  const summary = checks.reduce(
    (acc, check) => {
      acc[check.status] += 1;
      return acc;
    },
    { pass: 0, skip: 0, fail: 0 } as Record<"pass" | "skip" | "fail", number>,
  );
  return { content: [{ type: "text", text: JSON.stringify({ checks, summary }, null, 2) }] };
});

server.tool("claude_code_doctor", "Verify installed Claude Code/OpenBox plugin surfaces and runtime readiness without requiring Claude Code chat to run shell commands", {
  cwd: z.string().optional().describe("Project root for project-local install."),
  plugin_target: z.string().optional().describe("Explicit project-local plugin folder to inspect."),
  target: z.string().optional().describe("Alias for plugin_target."),
  surface_only: z.boolean().optional().describe("When true, skip runtime key/core validation and only inspect installed files."),
  validate_core: z.boolean().optional().describe("When false, validate runtime config and key format without calling core."),
  include_opt_in_hooks: z.boolean().optional().describe("Validate an installation that intentionally includes opt-in hooks."),
}, async ({ cwd, plugin_target, target, surface_only, validate_core, include_opt_in_hooks }) => {
  const checks = await Promise.resolve(
    surface_only
      ? verifyClaudeCodeInstall({
          cwd,
          pluginTarget: plugin_target,
          target,
          includeOptInHooks: include_opt_in_hooks,
        })
      : verifyClaudeCodeInstall({
          cwd,
          pluginTarget: plugin_target,
          target,
          includeOptInHooks: include_opt_in_hooks,
          includeRuntime: true,
          validateRuntime: validate_core !== false,
        }),
  );
  const summary = summarizeClaudeCodeChecks(checks);
  return { content: [{ type: "text", text: JSON.stringify({
    checks,
    summary,
    mcpReadiness: runtimeDiagnostics(),
    runtimeReadiness: claudeCodeRuntimeDiagnostics(cwd),
    claudeCodeGovernance: claudeCodeGovernanceSummary(),
  }, null, 2) }] };
});

server.tool("list_agents", "List all agents in the organization", {}, async () => {
  const agents = await client().listAgents({ page: 0, perPage: 50 });
  return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
});

server.tool("get_agent", "Get agent details including trust score and tier", {
  agent_id: z.string().describe("Agent ID"),
}, async ({ agent_id }) => {
  const agent = await client().getAgent(agent_id);
  return { content: [{ type: "text", text: JSON.stringify(agent, null, 2) }] };
});

server.tool("list_pending_approvals", "List pending approval requests across all agents", {}, async () => {
  const profile = (await client().getProfile()) as { orgId?: string };
  const orgId = profile.orgId;
  if (!orgId) return { content: [{ type: "text", text: "No organization found" }] };
  const approvals = await listPendingApprovals(orgId);
  return { content: [{ type: "text", text: JSON.stringify(approvals, null, 2) }] };
});

server.tool("decide_approval", "Approve or reject a pending approval", {
  agent_id: z.string().describe("Agent ID"),
  approval_id: z.string().describe("Approval ID"),
  action: z.enum(["approve", "reject"]).describe("Decision"),
}, async ({ agent_id, approval_id, action }) => {
  await client().decideApproval(agent_id, approval_id, { action });
  return { content: [{ type: "text", text: `${action}d` }] };
});

server.tool("list_guardrails", "List guardrails configured for an agent", {
  agent_id: z.string().describe("Agent ID"),
}, async ({ agent_id }) => {
  const data = await client().listGuardrails(agent_id, { page: 0, perPage: 50 });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("list_policies", "List policies configured for an agent", {
  agent_id: z.string().describe("Agent ID"),
}, async ({ agent_id }) => {
  const data = await client().listPolicies(agent_id, { page: 0, perPage: 50 });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_trust_score", "Get an agent's current trust score and tier", {
  agent_id: z.string().describe("Agent ID"),
}, async ({ agent_id }) => {
  // Backend has no dedicated `/agent/{id}/trust` endpoint; trust
  // score lives inline on the agent record at `agent_trust_score`.
  // The granular endpoints (`/trust/events`, `/trust/histories`,
  // `/trust/recovery-status`) return event logs, not the current
  // snapshot. So we read the agent and surface the subset.
  const agent = (await client().getAgent(agent_id)) as { agent_trust_score?: unknown };
  const ts = agent.agent_trust_score ?? null;
  return { content: [{ type: "text", text: JSON.stringify(ts, null, 2) }] };
});

function isAllowishVerdict(response: GovernanceVerdictResponse): boolean {
  const arm: unknown = response.verdict ?? response.action;
  return arm === "allow" || arm === "constrain" || arm === 0 || arm === 1;
}

async function coreEvaluate(
  apiKey: string,
  spanType: string,
  activityInput: Record<string, unknown>,
  coreUrl: string,
  source: string,
  agentIdentity?: AgentIdentityConfig,
) {
  const span = buildMcpGovernanceSpan(spanType, activityInput);
  const payload = {
    source,
    event_type: "ActivityStarted",
    workflow_id: crypto.randomUUID(),
    run_id: crypto.randomUUID(),
    workflow_type: "MCPCheck",
    task_queue: "mcp",
    activity_id: crypto.randomUUID(),
    activity_type: MCP_ACTIVITY_TYPE_MAP[spanType] || spanType,
    activity_input: [stampSource(activityInput, source)],
    timestamp: new Date().toISOString(),
    hook_trigger: true,
    spans: [span],
    span_count: 1,
    attempt: 1,
  };
  // Through the SDK so we get the API key format validation, the 35s
  // timeout default (above core's 30s WorkflowExecutionTimeout so real
  // server errors surface instead of AbortController-cancelling), and
  // any future client-side improvements automatically. Cast through
  // unknown because GovernanceEventPayload uses richer types than the
  // loose record we've assembled here; the wire shape is the same and
  // core re-validates everything server-side.
  const client = new OpenBoxCoreClient({
    apiUrl: coreUrl,
    apiKey,
    agentIdentity,
  });
  const parentPayload = {
    ...payload,
    hook_trigger: undefined,
    spans: undefined,
    span_count: undefined,
  };
  const parentVerdict = await client.evaluate(
    parentPayload as unknown as Parameters<typeof client.evaluate>[0],
  );
  if (!isAllowishVerdict(parentVerdict)) {
    return parentVerdict;
  }
  return await client.evaluate(payload as unknown as Parameters<typeof client.evaluate>[0]);
}

async function resolveApiKey(agentId: string | undefined): Promise<string> {
  let apiKey = process.env.OPENBOX_API_KEY;
  if (!apiKey && agentId) {
    // Try the per-agent runtime-key cache first. The CLI's `agent
    // Backend runtime-key creation/rotation flows write here at
    // mode 0o600; the canonical source of obx_live_*/obx_test_*
    // keys outside an in-process env var. Falling back to
    // GET /agent/{id} and using `agent.token` (the previous path)
    // is broken: `agent.token` is an internal attestation token,
    // NOT the runtime API key. Passing it to core returns a 500
    // "invalid API key format. Expected obx_live_... or
    // obx_test_..."; exactly the surprise the skill warns about.
    apiKey = recallAgentKey(agentId)?.runtimeKey;
  }
  if (!apiKey) {
    throw new Error(
      `No API key found for agent ${agentId ?? "(unset)"}. ` +
        'Set OPENBOX_API_KEY or mint/recover a runtime key from the dashboard/backend API.',
    );
  }
  if (!apiKey.startsWith("obx_live_") && !apiKey.startsWith("obx_test_")) {
    throw new Error(
      `Resolved key for agent ${agentId ?? ""} doesn't look like a runtime ` +
        "key. Expected format `obx_live_*` or `obx_test_*`. The agent " +
        "record's `token` field is an attestation token, not the core API " +
        "key.",
    );
  }
  return apiKey;
}

server.tool("check_governance", "Evaluate an action against governance rules. The tool builds the span shape required for behavioral rule matching. When the response carries verdict=require_approval, an approval row is materialized server-side. The expiration window comes from whichever surface produced the verdict. For behavior_rule-driven verdicts, the value is `behavior_rule.approval_timeout`, which is user-settable. For OPA-policy-driven verdicts, the value is the core server default of around 30 minutes; OPA policies have no `approval_timeout` field, so use a behavior_rule when the window matters.", {
  agent_id: z.string().optional().describe("Agent ID. Used to resolve the API key when OPENBOX_API_KEY is unset."),
  span_type: z.enum(["llm", "file_read", "file_write", "shell", "http", "db", "mcp"]).describe("Type of action to evaluate."),
  activity_input: z.any().describe("Action input payload. Examples: { prompt: '...' }, { file_path: '...' }, { command: '...' }."),
}, async ({ agent_id, span_type, activity_input }) => {
  try {
    const runtime = resolveRuntime();
    const apiKey = await resolveApiKey(agent_id);
    const input = (typeof activity_input === "object" && activity_input) ? activity_input : { value: activity_input };
    const result = await coreEvaluate(
      apiKey,
      span_type,
      input as Record<string, unknown>,
      runtime.coreUrl,
      sourceLabel(),
      runtime.agentIdentity,
    );
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

// Skill references; one per topical domain.
const SKILL_PATHS = [
  { name: "governance-flow", path: "references/governance-flow.md", desc: "Event protocol, wire format, verdicts, approval polling, spec-vs-implementation mismatches" },
  { name: "guardrails", path: "references/guardrails.md", desc: "Guardrail configuration: numeric IDs, stage gating, legacy activity bindings, per-field status, backend validation gaps" },
  { name: "behaviors", path: "references/behaviors.md", desc: "Behavior rules: trigger/states enum, time_window, priority, active toggle, shell-as-internal" },
  { name: "backend-api", path: "references/backend-api.md", desc: "Backend conventions: {status,data} envelope, X-Openbox-Client header, /auth/refresh caveats, OpenAPI availability" },
  { name: "rego-reference", path: "references/rego-reference.md", desc: "Rego policy syntax, input fields, example policies, policy lifecycle gotchas" },
  { name: "span-reference", path: "references/span-reference.md", desc: "Span types, gate attributes, semantic type detection" },
  { name: "commands", path: "references/commands.md", desc: "Full CLI command reference" },
  { name: "claude-code-governance", path: "references/claude-code-governance.md", desc: "Claude Code hook/plugin/MCP governance surface audit and coverage matrix" },
  { name: "existing-sdks", path: "references/existing-sdks.md", desc: "Available SDKs and installation" },
];

function findSkillDir(): string | null {
  const candidates = [
    path.join(process.cwd(), ".claude", "skills", "openbox", "skills", "openbox"),
    path.join(process.cwd(), ".cursor", "plugins", "local", "openbox", "skills", "openbox"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

for (const ref of SKILL_PATHS) {
  server.resource(ref.name, `openbox://skill/${ref.name}`, { description: ref.desc }, async () => {
    const skillDir = findSkillDir();
    if (!skillDir) return { contents: [{ uri: `openbox://skill/${ref.name}`, text: "Skill not installed. Run a project-local install: openbox install cursor or openbox install claude-code", mimeType: "text/plain" }] };
    const filePath = path.join(skillDir, ref.path);
    if (!fs.existsSync(filePath)) return { contents: [{ uri: `openbox://skill/${ref.name}`, text: `File not found: ${ref.path}`, mimeType: "text/plain" }] };
    const text = fs.readFileSync(filePath, "utf-8");
    return { contents: [{ uri: `openbox://skill/${ref.name}`, text, mimeType: "text/markdown" }] };
  });
}

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // After the MCP `initialize` handshake completes,
  // getClientVersion() returns the calling LLM tool's identity, such
  // as "claude-code" or "cursor". Plug that into the X-Openbox-Client
  // header so backend telemetry can distinguish MCP traffic per LLM.
  // Connect resolves once initialize is done.
  callerName = server.server.getClientVersion()?.name;
  setMcpClientName(callerName);
}
