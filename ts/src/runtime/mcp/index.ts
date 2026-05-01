// MCP server runtime; exposes OpenBox tools/resources to any
// MCP-compatible LLM (Claude Desktop, Cursor, etc.) over stdio.
//
// Invoked as `openbox mcp serve` from the CLI subcommand. Configures
// from OPENBOX_ENV / OPENBOX_API_URL / OPENBOX_CORE_URL / OPENBOX_API_KEY.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { OpenBoxCoreClient } from "../../core-client/index.js";
import { resolveEnv, createApi, setMcpClientName } from "./config.js";
import { recallAgentKey } from "../_shared/agent-keys-store.js";

export async function runMcpServer(): Promise<void> {
  // See ./config.ts for OPENBOX_ENV / OPENBOX_API_URL / OPENBOX_CORE_URL.
  const ENV = resolveEnv();
  const API_URL = ENV.apiUrl;
  const CORE_URL = ENV.coreUrl;

  const api = createApi();

  const server = new McpServer({ name: "openbox", version: "0.1.0" });

server.tool("get_profile", "Get current user profile and permissions", {}, async () => {
  const profile = await api("/auth/profile");
  return { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }] };
});

server.tool("list_agents", "List all agents in the organization", {}, async () => {
  const agents = await api("/agent/list?page=0&perPage=50");
  return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
});

server.tool("get_agent", "Get agent details including trust score and tier", {
  agent_id: z.string().describe("Agent ID"),
}, async ({ agent_id }) => {
  const agent = await api(`/agent/${agent_id}`);
  return { content: [{ type: "text", text: JSON.stringify(agent, null, 2) }] };
});

server.tool("list_pending_approvals", "List pending approval requests across all agents", {}, async () => {
  const profile = await api("/auth/profile");
  const orgId = profile.orgId;
  if (!orgId) return { content: [{ type: "text", text: "No organization found" }] };
  const data = await api(`/organization/${orgId}/approvals?status=pending&page=0&perPage=50`);
  // After api() unwraps the {status, data} envelope, `data` is the
  // PaginatedResponse<Approval> → { data: Approval[], total, start, limit }.
  // Earlier code read data.approvals?.data, which never matched → empty []
  // for every caller. Correct path is data.data (or data itself if the
  // backend ever flattens).
  const approvals = Array.isArray(data) ? data : (data?.data ?? []);
  return { content: [{ type: "text", text: JSON.stringify(approvals, null, 2) }] };
});

server.tool("decide_approval", "Approve or reject a pending approval", {
  agent_id: z.string().describe("Agent ID"),
  approval_id: z.string().describe("Approval ID"),
  action: z.enum(["approve", "reject"]).describe("Decision"),
}, async ({ agent_id, approval_id, action }) => {
  await api(`/agent/${agent_id}/approvals/${approval_id}/decide?action=${action}`, "PUT");
  return { content: [{ type: "text", text: `${action}d` }] };
});

server.tool("list_guardrails", "List guardrails configured for an agent", {
  agent_id: z.string().describe("Agent ID"),
}, async ({ agent_id }) => {
  const data = await api(`/agent/${agent_id}/guardrails?page=0&perPage=50`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("list_policies", "List policies configured for an agent", {
  agent_id: z.string().describe("Agent ID"),
}, async ({ agent_id }) => {
  const data = await api(`/agent/${agent_id}/policies?page=0&perPage=50`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("get_trust_score", "Get an agent's current trust score and tier", {
  agent_id: z.string().describe("Agent ID"),
}, async ({ agent_id }) => {
  const data = await api(`/agent/${agent_id}/trust`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

// Span builder for governance payloads with proper gate attributes
function hex(len: number): string {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function buildSpan(spanType: string, input: Record<string, unknown>): Record<string, unknown> {
  const base = {
    span_id: hex(16),
    trace_id: hex(32),
    parent_span_id: null,
    kind: "CLIENT",
    stage: "started",
    start_time: Date.now() * 1_000_000,
    end_time: null,
    duration_ns: null,
    status: { code: "OK", description: null },
    events: [],
    error: null,
  };

  switch (spanType) {
    case "llm":
      return {
        ...base,
        name: "llm.chat.completion",
        hook_type: "function_call",
        semantic_type: "llm_completion",
        attributes: {
          "gen_ai.system": "openai",
          // WORKAROUND: Core needs http.method/url for LLM detection
          "http.method": "POST",
          "http.url": "https://api.openai.com/v1/chat/completions",
        },
        function: "LLMCall",
        module: "activity",
        args: input,
        result: null,
      };
    case "file_read":
      return {
        ...base,
        name: "file.read",
        kind: "INTERNAL",
        hook_type: "file_operation",
        semantic_type: "file_read",
        attributes: { "file.path": input.file_path || "", "file.operation": "read" },
        file_path: input.file_path || "",
        file_mode: "r",
        file_operation: "read",
      };
    case "file_write":
      return {
        ...base,
        name: "file.write",
        kind: "INTERNAL",
        hook_type: "file_operation",
        semantic_type: "file_write",
        attributes: { "file.path": input.file_path || "", "file.operation": "write" },
        file_path: input.file_path || "",
        file_mode: "w",
        file_operation: "write",
      };
    case "shell":
      return {
        ...base,
        name: "ShellExecution",
        kind: "INTERNAL",
        hook_type: "function_call",
        semantic_type: "internal",
        attributes: { "shell.command": input.command || "", "shell.cwd": input.cwd || "" },
        function: "ShellExecution",
        module: "activity",
        args: input,
        result: null,
      };
    case "http":
      const method = ((input.method as string) || "POST").toUpperCase();
      const url = (input.url as string) || "https://api.example.com";
      return {
        ...base,
        name: `${method} ${url}`,
        hook_type: "http_request",
        attributes: { "http.method": method, "http.url": url },
        http_method: method,
        http_url: url,
        request_body: null,
        response_body: null,
      };
    case "db":
      const dbOp = ((input.operation as string) || "SELECT").toUpperCase();
      return {
        ...base,
        name: `${dbOp}`,
        hook_type: "db_query",
        attributes: { "db.system": input.system || "postgresql", "db.operation": dbOp },
        db_system: input.system || "postgresql",
        db_operation: dbOp,
        db_statement: input.statement || "",
      };
    case "mcp":
      return {
        ...base,
        name: `tool.${input.tool_name || "call"}`,
        hook_type: "function_call",
        semantic_type: "llm_tool_call",
        attributes: {
          "gen_ai.system": "mcp",
          "http.method": "POST",
          "http.url": "https://api.openai.com/v1/chat/completions",
        },
        function: `mcp.${input.tool_name || "call"}`,
        module: "activity",
        args: input,
        result: null,
      };
    default:
      return { ...base, name: "unknown", kind: "INTERNAL", hook_type: "function_call", attributes: {}, function: "unknown", module: "activity", args: input, result: null };
  }
}

// Canonical activity_type values the skill emits. Must match what guardrail
// settings.activities[].activity_type specifies; no match, no fire.
// See openbox-skill/references/governance-flow.md § "Canonical activity_type Names".
//
// `llm` is PromptSubmission (not LLMCompleted): coreEvaluate() below emits
// event_type=ActivityStarted (pre-flight, before the LLM is called). The
// canonical pairing for pre-LLM input-stage is PromptSubmission, which
// input-stage guardrails match with `fields_to_check: ["input.*.prompt"]` .
// and activity_input carries `{prompt: ...}`, so the match works.
//
// The span itself still describes an LLM call shape (`llm.chat.completion`,
// `http.method=POST`, `http.url=api.openai.com`); those are a Core-side
// workaround so `isLLMCall()` classifies the span; they don't affect which
// guardrails fire. See buildSpan() case "llm".
const ACTIVITY_TYPE_MAP: Record<string, string> = {
  llm: "PromptSubmission",
  file_read: "FileRead",
  file_write: "FileEdit",
  shell: "ShellExecution",
  http: "HTTPRequest",
  db: "DatabaseQuery",
  mcp: "MCPToolCall",
};

async function coreEvaluate(apiKey: string, spanType: string, activityInput: Record<string, unknown>) {
  const span = buildSpan(spanType, activityInput);
  const payload = {
    source: "mcp",
    event_type: "ActivityStarted",
    workflow_id: crypto.randomUUID(),
    run_id: crypto.randomUUID(),
    workflow_type: "MCPCheck",
    task_queue: "mcp",
    activity_id: crypto.randomUUID(),
    activity_type: ACTIVITY_TYPE_MAP[spanType] || spanType,
    activity_input: [activityInput],
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
    apiUrl: CORE_URL,
    apiKey,
  });
  return await client.evaluate(payload as unknown as Parameters<typeof client.evaluate>[0]);
}

async function resolveApiKey(agentId?: string): Promise<string> {
  let apiKey = process.env.OPENBOX_API_KEY;
  if (!apiKey && agentId) {
    // Try the per-agent runtime-key cache first. The CLI's `agent
    // create` and `api-key rotate` post-callbacks write here at
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
        "Set OPENBOX_API_KEY, or run `openbox api-key recall <agentId>` " +
        "to surface a cached key. To mint a fresh key, run " +
        "`openbox api-key rotate <agentId> -y`. Rotation is destructive " +
        "and invalidates the previous key.",
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
    const apiKey = await resolveApiKey(agent_id);
    const input = (typeof activity_input === "object" && activity_input) ? activity_input : { value: activity_input };
    const result = await coreEvaluate(apiKey, span_type, input as Record<string, unknown>);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }] };
  }
});

// Skill references; one per topical domain.
const SKILL_PATHS = [
  { name: "governance-flow", path: "references/governance-flow.md", desc: "Event protocol, wire format, verdicts, approval polling, spec-vs-implementation mismatches" },
  { name: "guardrails", path: "references/guardrails.md", desc: "Guardrail configuration: numeric IDs, stage gating, settings.activities[] shape, per-field status, backend validation gaps" },
  { name: "behaviors", path: "references/behaviors.md", desc: "Behavior rules: trigger/states enum, time_window, priority, active toggle, shell-as-internal" },
  { name: "backend-api", path: "references/backend-api.md", desc: "Backend conventions: {status,data} envelope, X-Openbox-Client header, /auth/refresh caveats, swagger availability" },
  { name: "rego-reference", path: "references/rego-reference.md", desc: "Rego policy syntax, input fields, example policies, policy lifecycle gotchas" },
  { name: "span-reference", path: "references/span-reference.md", desc: "Span types, gate attributes, semantic type detection" },
  { name: "commands", path: "references/commands.md", desc: "Full CLI command reference" },
  { name: "existing-sdks", path: "references/existing-sdks.md", desc: "Available SDKs and installation" },
];

function findSkillDir(): string | null {
  const candidates = [
    path.join(os.homedir(), ".claude", "skills", "openbox"),
    path.join(os.homedir(), ".cursor", "skills", "openbox"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

for (const ref of SKILL_PATHS) {
  server.resource(ref.name, `openbox://skill/${ref.name}`, { description: ref.desc }, async () => {
    const skillDir = findSkillDir();
    if (!skillDir) return { contents: [{ uri: `openbox://skill/${ref.name}`, text: "Skill not installed. Run: git clone https://github.com/OpenBox-AI/openbox-skill.git ~/.cursor/skills/openbox", mimeType: "text/plain" }] };
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
  setMcpClientName(server.server.getClientVersion()?.name);
}
