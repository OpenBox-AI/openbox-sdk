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
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
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
import { EVENT } from "../../governance/events.js";
import { withSpanActivityId, type SpanType } from "../../governance/spans.js";
import {
  MCP_PROMPT_SURFACES,
  MCP_RESOURCE_TEMPLATE_SURFACES,
  MCP_TOOL_SURFACES,
  type McpPromptSurfaceEntry,
  type McpResourceTemplateSurfaceEntry,
  type McpToolSurfaceEntry,
} from "../../governance/capability-matrix.js";

export interface RunMcpServerOptions {
  transport?: "stdio" | "http";
  host?: string;
  port?: number;
  path?: string;
  signal?: AbortSignal;
}

type ToolInputSchema = Record<string, unknown>;
type ToolCallback = (args: any) => Promise<any> | any;

export async function runMcpServer(options: RunMcpServerOptions = {}): Promise<void> {
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

  function mcpToolSurface(name: string): McpToolSurfaceEntry | undefined {
    return MCP_TOOL_SURFACES.find((entry) => entry.name === name);
  }

  function mcpToolDescription(name: string, description: string): string {
    const surface = mcpToolSurface(name);
    if (!surface) return description;
    return [
      description,
      `OpenBox risk: ${surface.risk}.`,
      `Approval behavior: ${surface.approval}.`,
      `Side effects: ${surface.sideEffects}.`,
    ].join(" ");
  }

  function mcpToolAnnotations(surface: McpToolSurfaceEntry | undefined): ToolAnnotations | undefined {
    if (!surface) return undefined;
    return {
      title: surface.title,
      readOnlyHint: surface.readOnlyHint,
      destructiveHint: surface.destructiveHint,
      idempotentHint: surface.idempotentHint,
      openWorldHint: surface.openWorldHint,
    };
  }

  function registerOpenBoxTool(
    name: string,
    description: string,
    inputSchema: ToolInputSchema,
    cb: ToolCallback,
  ): void {
    const surface = mcpToolSurface(name);
    const annotatedDescription = mcpToolDescription(name, description);
    const annotations = mcpToolAnnotations(surface);
    const registerable = server as unknown as {
      registerTool?: (
        toolName: string,
        config: Record<string, unknown>,
        callback: ToolCallback,
      ) => unknown;
      tool: (
        toolName: string,
        toolDescription: string,
        toolSchema: ToolInputSchema,
        callback: ToolCallback,
      ) => unknown;
    };
    if (typeof registerable.registerTool === "function") {
      registerable.registerTool(
        name,
        {
          title: surface?.title,
          description: annotatedDescription,
          inputSchema,
          annotations,
          _meta: surface
            ? {
                "openbox/risk": surface.risk,
                "openbox/approval": surface.approval,
                "openbox/sideEffects": surface.sideEffects,
              }
            : undefined,
        },
        cb,
      );
      return;
    }
    registerable.tool(name, annotatedDescription, inputSchema, cb);
  }

registerOpenBoxTool("get_profile", "Get current user profile and permissions", {}, async () => {
  const profile = await client().getProfile();
  return { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }] };
});

registerOpenBoxTool("cursor_status", "Return a compact OpenBox backend status for Cursor slash commands without using shell execution", {}, async () => {
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

registerOpenBoxTool("openbox_status", "Return a compact OpenBox backend status for plugin slash commands without using shell execution", {}, async () => {
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

registerOpenBoxTool("cursor_doctor", "Verify installed Cursor/OpenBox surfaces and runtime readiness without requiring Cursor chat to run shell commands", {
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

registerOpenBoxTool("claude_code_doctor", "Verify installed Claude Code/OpenBox plugin surfaces and runtime readiness without requiring Claude Code chat to run shell commands", {
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

registerOpenBoxTool("list_agents", "List all agents in the organization", {}, async () => {
  const agents = await client().listAgents({ page: 0, perPage: 50 });
  return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
});

registerOpenBoxTool("get_agent", "Get agent details including trust score and tier", {
  agent_id: z.string().describe("Agent ID"),
}, async ({ agent_id }) => {
  const agent = await client().getAgent(agent_id);
  return { content: [{ type: "text", text: JSON.stringify(agent, null, 2) }] };
});

registerOpenBoxTool("list_pending_approvals", "List pending approval requests across all agents", {}, async () => {
  const profile = (await client().getProfile()) as { orgId?: string };
  const orgId = profile.orgId;
  if (!orgId) return { content: [{ type: "text", text: "No organization found" }] };
  const approvals = await listPendingApprovals(orgId);
  return { content: [{ type: "text", text: JSON.stringify(approvals, null, 2) }] };
});

registerOpenBoxTool("decide_approval", "Approve or reject a pending approval", {
  agent_id: z.string().describe("Agent ID"),
  approval_id: z.string().describe("Approval ID"),
  action: z.enum(["approve", "reject"]).describe("Decision"),
}, async ({ agent_id, approval_id, action }) => {
  await client().decideApproval(agent_id, approval_id, { action });
  return { content: [{ type: "text", text: `${action}d` }] };
});

registerOpenBoxTool("list_guardrails", "List guardrails configured for an agent", {
  agent_id: z.string().describe("Agent ID"),
}, async ({ agent_id }) => {
  const data = await client().listGuardrails(agent_id, { page: 0, perPage: 50 });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

registerOpenBoxTool("list_policies", "List policies configured for an agent", {
  agent_id: z.string().describe("Agent ID"),
}, async ({ agent_id }) => {
  const data = await client().listPolicies(agent_id, { page: 0, perPage: 50 });
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

registerOpenBoxTool("get_trust_score", "Get an agent's current trust score and tier", {
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
  const normalized =
    typeof arm === "string" ? arm.trim().toLowerCase().replace(/-/g, "_") : arm;
  return (
    normalized === "allow" ||
    normalized === "continue" ||
    normalized === "constrain" ||
    normalized === 0 ||
    normalized === 1
  );
}

async function coreEvaluate(
  apiKey: string,
  spanType: string,
  activityInput: Record<string, unknown>,
  coreUrl: string,
  source: string,
  agentIdentity?: AgentIdentityConfig,
) {
  const activityId = crypto.randomUUID();
  const span = withSpanActivityId(
    buildMcpGovernanceSpan(spanType as SpanType, activityInput),
    activityId,
  );
  const payload = {
    source,
    event_type: EVENT.START,
    workflow_id: crypto.randomUUID(),
    run_id: crypto.randomUUID(),
    workflow_type: "MCPCheck",
    task_queue: "mcp",
    activity_id: activityId,
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
  const {
    spans: _parentSpans,
    span_count: _parentSpanCount,
    hook_trigger: _parentHookTrigger,
    ...parentFields
  } = payload;
  const parentPayload = {
    ...parentFields,
    hook_trigger: false,
  };
  const parentVerdict = await client.evaluate(
    parentPayload as unknown as Parameters<typeof client.evaluate>[0],
  );
  const hookVerdict = await client.evaluate(
    payload as unknown as Parameters<typeof client.evaluate>[0],
  );
  return isAllowishVerdict(parentVerdict) ? hookVerdict : parentVerdict;
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

registerOpenBoxTool("check_governance", "Evaluate an action against governance rules. The tool builds the span shape required for behavioral rule matching. When the response carries verdict=require_approval, an approval row is materialized server-side. The expiration window comes from whichever surface produced the verdict. For behavior_rule-driven verdicts, the value is `behavior_rule.approval_timeout`, which is user-settable. For OPA-policy-driven verdicts, the value is the core server default of around 30 minutes; OPA policies have no `approval_timeout` field, so use a behavior_rule when the window matters.", {
  agent_id: z.string().optional().describe("Agent ID. Used to resolve the API key when OPENBOX_API_KEY is unset."),
  span_type: z.enum(["llm", "file_read", "file_write", "file_delete", "shell", "http", "db", "mcp"]).describe("Type of action to evaluate."),
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

function promptArgsSchema(prompt: McpPromptSurfaceEntry): Record<string, any> {
  const schema: Record<string, any> = {};
  for (const arg of prompt.args) {
    const base = z.string().describe(arg.description);
    schema[arg.name] = arg.required ? base : base.optional();
  }
  return schema;
}

function renderPrompt(prompt: McpPromptSurfaceEntry, args: Record<string, unknown>): string {
  const providedArgs = Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== undefined && value !== ""),
  );
  const renderedArgs = Object.keys(providedArgs).length
    ? `\n\nArguments:\n${JSON.stringify(providedArgs, null, 2)}`
    : "";
  return `${prompt.instructions}${renderedArgs}`;
}

for (const prompt of MCP_PROMPT_SURFACES) {
  server.registerPrompt(
    prompt.name,
    {
      title: prompt.title,
      description: prompt.description,
      argsSchema: promptArgsSchema(prompt),
    },
    async (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: renderPrompt(prompt, args as Record<string, unknown>),
          },
        },
      ],
    }),
  );
}

// Skill references; one per topical domain.
const SKILL_PATHS = [
  { name: "governance-flow", path: "references/governance-flow.md", desc: "Event protocol, wire format, verdicts, approval polling, spec-vs-implementation mismatches" },
  { name: "guardrails", path: "references/guardrails.md", desc: "Guardrail configuration: numeric IDs, stage gating, legacy binding no-ops, per-field status, backend validation gaps" },
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
    path.join(process.cwd(), ".agents", "skills", "openbox"),
    path.join(process.cwd(), ".agents", "plugins", "openbox", "skills", "openbox"),
    path.join(process.cwd(), ".claude", "skills", "openbox", "skills", "openbox"),
    path.join(process.cwd(), ".cursor", "plugins", "local", "openbox", "skills", "openbox"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function textResource(uri: string | URL, text: string, mimeType: string) {
  return {
    contents: [
      {
        uri: String(uri),
        text,
        mimeType,
      },
    ],
  };
}

function jsonResource(uri: string | URL, data: unknown) {
  return textResource(uri, JSON.stringify(data, null, 2), "application/json");
}

function varString(vars: Record<string, string | string[]>, name: string): string {
  const value = vars[name];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function payloadRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as {
    data?: unknown;
    approvals?: { data?: unknown[] };
  };
  if (Array.isArray(record.approvals?.data)) return record.approvals.data;
  if (Array.isArray(record.data)) return record.data;
  if (
    record.data &&
    typeof record.data === "object" &&
    Array.isArray((record.data as { data?: unknown[] }).data)
  ) {
    return (record.data as { data?: unknown[] }).data ?? [];
  }
  return [];
}

function rowId(row: unknown): string | undefined {
  if (!row || typeof row !== "object") return undefined;
  const record = row as Record<string, unknown>;
  const candidate =
    record.id ??
    record.event_id ??
    record.eventId ??
    record.approval_id ??
    record.approvalId;
  return typeof candidate === "string" ? candidate : undefined;
}

async function readSkillReference(name: string, uri: string | URL) {
  const ref = SKILL_PATHS.find((entry) => entry.name === name);
  if (!ref) {
    return textResource(uri, `Unknown OpenBox skill reference: ${name}`, "text/plain");
  }
  const skillDir = findSkillDir();
  if (!skillDir) {
    return textResource(
      uri,
      "Skill not installed. Run a project-local install: openbox install cursor, openbox install claude-code, or openbox install codex.",
      "text/plain",
    );
  }
  const filePath = path.join(skillDir, ref.path);
  if (!fs.existsSync(filePath)) {
    return textResource(uri, `File not found: ${ref.path}`, "text/plain");
  }
  return textResource(uri, fs.readFileSync(filePath, "utf-8"), "text/markdown");
}

async function readTemplateResource(
  template: McpResourceTemplateSurfaceEntry,
  uri: URL,
  variables: Record<string, string | string[]>,
) {
  const agentId = varString(variables, "agent_id");
  switch (template.name) {
    case "agent":
      return jsonResource(uri, await client().getAgent(agentId));
    case "guardrail":
      return jsonResource(
        uri,
        await client().getGuardrail(agentId, varString(variables, "guardrail_id")),
      );
    case "policy":
      return jsonResource(
        uri,
        await client().getPolicy(agentId, varString(variables, "policy_id")),
      );
    case "behavior-rule":
      return jsonResource(
        uri,
        await client().getBehaviorRule(agentId, varString(variables, "behavior_rule_id")),
      );
    case "approval": {
      const approvalId = varString(variables, "approval_id");
      const pending = payloadRows(
        await client().getPendingApprovals(agentId, { page: 0, perPage: 100 }),
      );
      const pendingMatch = pending.find((row) => rowId(row) === approvalId);
      if (pendingMatch) return jsonResource(uri, pendingMatch);
      const history = payloadRows(
        await client().getApprovalHistory(agentId, { page: 0, perPage: 100 }),
      );
      return jsonResource(
        uri,
        history.find((row) => rowId(row) === approvalId) ?? {
          id: approvalId,
          status: "not_found",
        },
      );
    }
    case "skill-reference":
      return readSkillReference(varString(variables, "name"), uri);
    default:
      return textResource(uri, `Unsupported OpenBox MCP resource template: ${template.name}`, "text/plain");
  }
}

for (const template of MCP_RESOURCE_TEMPLATE_SURFACES) {
  server.registerResource(
    template.name,
    new ResourceTemplate(template.uriTemplate, { list: undefined }),
    {
      title: template.title,
      description: template.description,
      mimeType: template.mimeType,
    },
    async (uri, variables) => readTemplateResource(template, uri, variables),
  );
}

for (const ref of SKILL_PATHS) {
  server.resource(ref.name, `openbox://skill/${ref.name}`, { description: ref.desc }, async () => {
    return readSkillReference(ref.name, `openbox://skill/${ref.name}`);
  });
}

  function updateCallerName(): void {
    callerName = server.server.getClientVersion()?.name;
    setMcpClientName(callerName);
  }

  if ((options.transport ?? "stdio") === "http") {
    await serveHttp(server, options, updateCallerName);
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // After the MCP `initialize` handshake completes,
  // getClientVersion() returns the calling LLM tool's identity, such
  // as "claude-code" or "cursor". Plug that into the X-Openbox-Client
  // header so backend telemetry can distinguish MCP traffic per LLM.
  // Connect resolves once initialize is done.
  updateCallerName();
}

async function serveHttp(
  server: McpServer,
  options: RunMcpServerOptions,
  updateCallerName: () => void,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  const route = options.path ?? "/mcp";
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3927;
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
    if (url.pathname !== route) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
      res.statusCode = 405;
      res.setHeader("allow", "GET, POST, DELETE");
      res.end("Method not allowed");
      return;
    }
    try {
      await transport.handleRequest(req, res);
      updateCallerName();
    } catch (err: any) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "text/plain");
      }
      res.end(`OpenBox MCP HTTP transport error: ${err?.message ?? String(err)}`);
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      httpServer.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      httpServer.off("error", onError);
      resolve();
    };
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(port, host);
  });

  const close = () => {
    void transport.close();
    httpServer.close();
  };
  options.signal?.addEventListener("abort", close, { once: true });
  const address = httpServer.address();
  const renderedAddress =
    typeof address === "object" && address
      ? `${address.address}:${address.port}${route}`
      : `${host}:${port}${route}`;
  console.error(`OpenBox MCP Streamable HTTP listening at http://${renderedAddress}`);
}
