// ts/src/core-client/core-client.ts
import { createHash, createPrivateKey, randomUUID, sign } from "crypto";
var ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

// ts/src/core-client/generated/govern.ts
var CANONICAL_ACTIVITY_LABELS = Object.freeze({ "AGENT_STEP": "Agent Step", "ActivityTaskCanceled": "Activity Task Canceled", "ActivityTaskCompleted": "Activity Task Completed", "ActivityTaskFailed": "Activity Task Failed", "ActivityTaskScheduled": "Activity Task Scheduled", "ActivityTaskStarted": "Activity Task Started", "ActivityTaskTimedOut": "Activity Task Timed Out", "AgentAction": "Agent Action", "AgentExecutionCompleted": "Agent Execution Completed", "AgentExecutionStarted": "Agent Execution Started", "AgentSpawn": "Agent Spawn", "CHUNKING": "Chunking", "CallToolsNode": "Call Tools Node", "ChildWorkflowExecutionCompleted": "Child Workflow Execution Completed", "ChildWorkflowExecutionInitiated": "Child Workflow Execution Initiated", "CrewKickoffCompleted": "Crew Kickoff Completed", "CrewKickoffStarted": "Crew Kickoff Started", "EMBEDDING": "Embedding", "EXCEPTION": "Exception", "End": "End", "FUNCTION_CALL": "Function Call", "FileDelete": "File Delete", "FileEdit": "File Edit", "FileRead": "File Read", "HTTPRequest": "HTTP Request", "HandoffMessage": "Handoff Message", "LLM": "LLM", "LLMCallCompleted": "LLM Call Completed", "LLMCallStarted": "LLM Call Started", "LLMCompleted": "LLM Completed", "MCPToolCall": "MCP Tool Call", "MarkerRecorded": "Marker Recorded", "MemoryQueryEvent": "Memory Query", "ModelRequestNode": "Model Request Node", "MultiModalMessage": "Multi-Modal Message", "Notification": "Notification", "OperationCompleted": "Operation Completed", "OperationStarted": "Operation Started", "PermissionRequest": "Permission Request", "PostToolUse": "Post-Tool Use", "PreCompact": "Pre-Compact", "PreSyncHookStarted": "Pre-Sync Hook Started", "PreSyncHookSucceeded": "Pre-Sync Hook Succeeded", "PreToolUse": "Pre-Tool Use", "PromptSubmission": "Prompt Submission", "QUERY": "Query", "RERANKING": "Reranking", "RETRIEVE": "Retrieve", "ResourceUpdated": "Resource Updated", "SUB_QUESTION": "Sub-Question", "SYNTHESIZE": "Synthesize", "ShellExecution": "Shell Execution", "Stop": "Stop", "StopMessage": "Stop Message", "SubagentStart": "Subagent Start", "SubagentStop": "Subagent Stop", "SyncStatusChanged": "Sync Status Changed", "TaskCompleted": "Task Completed", "TaskStart": "Task Start", "TaskStarted": "Task Started", "TextMessage": "Text Message", "TimerFired": "Timer Fired", "TimerStarted": "Timer Started", "ToolCallExecutionEvent": "Tool Call Execution", "ToolCallRequestEvent": "Tool Call Request", "ToolCompleted": "Tool Completed", "ToolStarted": "Tool Started", "ToolUsageError": "Tool Usage Error", "ToolUsageFinished": "Tool Usage Finished", "ToolUsageStarted": "Tool Usage Started", "UserInputRequestedEvent": "User Input Requested", "UserPromptNode": "User Prompt Node", "UserPromptSubmit": "User Prompt Submit", "WorkflowExecutionSignaled": "Workflow Execution Signaled", "afterAgentResponse": "After Agent Response", "afterAgentThought": "After Agent Thought", "afterFileEdit": "After File Edit", "afterMCPExecution": "After MCP Execution", "afterShellExecution": "After Shell Execution", "agentStop": "Agent Stop", "auto_function_invocation_post": "Auto Function Invocation Post", "auto_function_invocation_pre": "Auto Function Invocation Pre", "beforeMCPExecution": "Before MCP Execution", "beforeReadFile": "Before Read File", "beforeShellExecution": "Before Shell Execution", "beforeSubmitPrompt": "Before Submit Prompt", "checkpoint": "Checkpoint", "custom_event": "Custom Event", "error": "Error", "error-trigger": "Error Trigger", "errorOccurred": "Error Occurred", "function_invocation_post": "Function Invocation Post", "function_invocation_pre": "Function Invocation Pre", "incident.acknowledged": "Incident Acknowledged", "incident.annotated": "Incident Annotated", "incident.delegated": "Incident Delegated", "incident.escalated": "Incident Escalated", "incident.priority_updated": "Incident Priority Updated", "incident.reassigned": "Incident Reassigned", "incident.reopened": "Incident Reopened", "incident.resolved": "Incident Resolved", "incident.triggered": "Incident Triggered", "incident.unacknowledged": "Incident Unacknowledged", "interrupt": "Interrupt", "node-post-execute": "Node Post-Execute", "node-pre-execute": "Node Pre-Execute", "node_end": "Node End", "node_start": "Node Start", "onAbort": "Abort", "onError": "Error", "onFinish": "Finish", "onStepFinish": "Step Finish", "on_agent_action": "Agent Action", "on_agent_finish": "Agent Finish", "on_chain_end": "Chain End", "on_chain_start": "Chain Start", "on_chat_model_start": "Chat Model Start", "on_execute_callback": "Execute Callback", "on_failure_callback": "Failure Callback", "on_llm_end": "LLM End", "on_llm_error": "LLM Error", "on_llm_start": "LLM Start", "on_retriever_end": "Retriever End", "on_retriever_start": "Retriever Start", "on_retry_callback": "Retry Callback", "on_skipped_callback": "Skipped Callback", "on_success_callback": "Success Callback", "on_tool_end": "Tool End", "on_tool_error": "Tool Error", "on_tool_start": "Tool Start", "output_validator": "Output Validator", "payment_order.approved": "Payment Order Approved", "payment_order.begin_processing": "Payment Order Begin Processing", "payment_order.failed": "Payment Order Failed", "payment_order.reconciled": "Payment Order Reconciled", "payment_reference.created": "Payment Reference Created", "postToolUse": "Post-Tool Use", "preToolUse": "Pre-Tool Use", "prompt_render_post": "Prompt Render Post", "prompt_render_pre": "Prompt Render Pre", "sla_miss_callback": "SLA Miss Callback", "subagentStop": "Subagent Stop", "task_end": "Task End", "task_start": "Task Start", "tool-call": "Tool Call", "tool-result": "Tool Result", "tool_retry": "Tool Retry", "userPromptSubmitted": "User Prompt Submitted", "workflow-step-finish": "Workflow Step Finish", "workflow-step-progress": "Workflow Step Progress", "workflow-step-start": "Workflow Step Start" });
async function govern(config, body) {
  const { preset: Ctor, ...sessionConfig } = config;
  const session = new Ctor(sessionConfig);
  try {
    await session.workflowStarted();
    const result = await body(session);
    await session.workflowCompleted();
    return result;
  } catch (err) {
    await session.workflowFailed(err);
    throw err;
  }
}
function governAttach(config) {
  const { preset: Ctor, ...rest } = config;
  return new Ctor({
    ...rest,
    registerExitHandlers: rest.registerExitHandlers ?? false,
    attached: true
  });
}
((govern2) => {
  govern2.attach = governAttach;
})(govern || (govern = {}));

// ts/src/approvals/format.ts
var VERDICT_LABEL = {
  0: "Allow",
  1: "Constrain",
  2: "Require Approval",
  3: "Block",
  4: "Halt"
};
function verdictLabel(v) {
  return v == null ? void 0 : VERDICT_LABEL[v];
}
var UPPERCASE_WORDS = /* @__PURE__ */ new Set([
  "api",
  "id",
  "url",
  "http",
  "sql",
  "db",
  "ui",
  "io",
  "ip",
  "llm",
  "mcp",
  "sdk",
  "sse",
  "rpc",
  "sso",
  "iam",
  "pii",
  "json",
  "xml",
  "css",
  "html",
  "cli",
  "aws",
  "gcp",
  "jwt",
  "oauth"
]);
function formatLabel(s) {
  if (!s) return "";
  const specLabel = CANONICAL_ACTIVITY_LABELS[s];
  if (specLabel) return specLabel;
  return s.split("_").flatMap(
    (chunk) => chunk.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(" ")
  ).filter((w) => w.length > 0).map((w) => {
    const lower = w.toLowerCase();
    if (UPPERCASE_WORDS.has(lower)) return w.toUpperCase();
    if (w.length > 1 && w === w.toUpperCase()) return w;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(" ");
}

// ts/src/approvals/summarize.ts
function summarizeInput(activityType, input) {
  if (!Array.isArray(input) || input.length === 0) return null;
  const first = input[0];
  if (first == null) return null;
  if (typeof first !== "object") return String(first);
  const obj = first;
  const pick = (...keys) => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string" && v.length > 0) return v;
    }
    return null;
  };
  switch (activityType) {
    // Coding-agent canonical activity types
    case "ShellExecution":
    case "ShellOutput":
      return pick("command");
    case "PromptSubmission":
    case "UserPromptSubmit":
    case "beforeSubmitPrompt":
    case "LLMCompleted":
    case "AgentResponse":
    case "AgentThinking":
    case "on_llm_start":
    case "on_llm_end":
    case "on_chat_model_start":
      return pick("prompt", "message", "text", "content");
    case "FileRead":
    case "FileEdit":
    case "FileDelete":
    case "beforeReadFile":
    case "afterFileEdit":
      return pick("file_path", "path");
    case "HTTPRequest": {
      const method = pick("method", "http_method");
      const url = pick("url", "http_url");
      if (method && url) return `${method} ${url}`;
      return url ?? method;
    }
    case "MCPToolCall":
    case "MCPToolResponse":
    case "beforeMCPExecution":
    case "afterMCPExecution": {
      const server = pick("server", "mcp_server");
      const tool = pick("tool_name", "tool", "name");
      if (server && tool) return `${server}.${tool}`;
      return tool ?? server;
    }
    case "PreToolUse":
    case "PostToolUse":
    case "preToolUse":
    case "postToolUse":
    case "ToolStarted":
    case "ToolCompleted":
    case "on_tool_start":
    case "on_tool_end":
      return pick("tool_name", "tool", "name", "command", "description");
    case "AgentSpawn":
    case "subagentStop":
    case "SubagentStop":
      return pick("agent_type", "task", "description");
    default:
      return pick("description", "name", "title", "summary", "command", "message") ?? truncate(JSON.stringify(obj), 200);
  }
}
function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "\u2026";
}

// ts/src/approvals/status.ts
function statusOf(a) {
  const s = (a.status || "").toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "expired") return "expired";
  if (a.decided_at) {
    if (a.verdict === 0 || a.verdict === 1) return "approved";
    if (a.verdict === 3 || a.verdict === 4) return "rejected";
  }
  if (a.approval_expired_at && !a.decided_at) {
    const t = Date.parse(a.approval_expired_at);
    if (Number.isFinite(t) && t < Date.now()) return "expired";
  }
  return "pending";
}

// ts/src/approvals/tier.ts
var BRAND_PRIMARY = "#3b9eff";
function tierColor(tier) {
  if (tier == null) return "#8E8E93";
  if (tier >= 4) return "#30D158";
  if (tier === 3) return BRAND_PRIMARY;
  if (tier === 2) return "#FF9F0A";
  return "#FF453A";
}
function tierBg(tier) {
  const c = tierColor(tier);
  const n = parseInt(c.slice(1), 16);
  const r = n >> 16 & 255;
  const g = n >> 8 & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},0.15)`;
}

// ts/src/approvals/time.ts
function parseTs(s) {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : Math.floor(t / 1e3);
}
function nowEpoch() {
  return Math.floor(Date.now() / 1e3);
}
function timeAgo(createdAt) {
  const ts = parseTs(createdAt);
  if (!ts) return "";
  const diff = Math.max(0, nowEpoch() - ts);
  if (diff < 3) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
function timeRemaining(expiresAt) {
  const ts = parseTs(expiresAt);
  if (!ts) return "";
  const diff = ts - nowEpoch();
  if (diff <= 0) return "expired";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  const hrs = Math.floor(diff / 3600);
  const rmins = Math.floor(diff % 3600 / 60);
  return rmins > 0 ? `${hrs}h ${rmins}m` : `${hrs}h`;
}

// ts/src/approvals/filters.ts
var EMPTY_FILTERS = { sort: "newest", dateRange: "all" };
function hasActiveFilters(f) {
  return !!(f.search || f.tier || f.activityType || f.teamId || f.ownerId || f.dateRange && f.dateRange !== "all");
}
var DATE_RANGE_LABEL = {
  today: "Today",
  week: "Last 7 days",
  month: "Last 30 days",
  all: "All time"
};
function summarizeFilters(f, lookups = {}) {
  const parts = [];
  if (f.search) parts.push(`"${f.search}"`);
  if (f.tier) parts.push(`Tier ${f.tier}`);
  if (f.activityType) parts.push(f.activityType);
  if (f.teamId) {
    const n = lookups.teamName?.(f.teamId);
    parts.push(`Team: ${n || f.teamId}`);
  }
  if (f.ownerId) {
    const n = lookups.ownerName?.(f.ownerId);
    parts.push(`Owner: ${n || f.ownerId}`);
  }
  if (f.dateRange && f.dateRange !== "all") parts.push(DATE_RANGE_LABEL[f.dateRange]);
  return parts.length ? `Filters: ${parts.join(" \xB7 ")}` : void 0;
}
function dateRangeBounds(key) {
  if (!key || key === "all") return {};
  const now = /* @__PURE__ */ new Date();
  const end = now.toISOString();
  const start = new Date(now);
  if (key === "today") start.setHours(0, 0, 0, 0);
  else if (key === "week") start.setDate(start.getDate() - 7);
  else if (key === "month") start.setDate(start.getDate() - 30);
  return { fromTime: start.toISOString(), toTime: end };
}
function applyClientFilters(approvals, filters, agentOwnerLookup) {
  let out = approvals;
  if (filters.ownerId) {
    out = out.filter((a) => {
      const owner = a.agent_id ? agentOwnerLookup(a.agent_id) : void 0;
      return owner === filters.ownerId;
    });
  }
  if (filters.activityType) {
    out = out.filter((a) => (a.action_type || a.activity_type) === filters.activityType);
  }
  if (filters.sort === "oldest") {
    out = [...out].sort(
      (a, b) => Date.parse(a.created_at || "") - Date.parse(b.created_at || "")
    );
  } else {
    out = [...out].sort(
      (a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || "")
    );
  }
  return out;
}

// ts/src/approvals/socket-client.ts
import * as net from "net";
import * as path from "path";

// ts/src/env/os-paths.ts
import { join, resolve } from "path";
function openboxDataRoot() {
  const override = process.env.OPENBOX_HOME;
  if (override) return resolve(override);
  return resolve(process.cwd(), ".openbox");
}

// ts/src/approvals/socket-client.ts
function defaultApprovalSocketPath() {
  return path.join(openboxDataRoot(), "run", "openbox.sock");
}
var APPROVAL_SOCKET_PATH = defaultApprovalSocketPath();
function connectApprovalSocket(socketPath = defaultApprovalSocketPath()) {
  return new Promise((resolve2) => {
    const socket = net.createConnection({ path: socketPath });
    let settled = false;
    const onConnect = () => {
      if (settled) return;
      settled = true;
      resolve2(buildHandle(socket));
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
      }
      resolve2(null);
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
      }
      resolve2(null);
    }, 200);
  });
}
function buildHandle(socket) {
  let buffer = "";
  const listenersByGeid = /* @__PURE__ */ new Map();
  const dispatch = (geid, r) => {
    const list = listenersByGeid.get(geid);
    if (!list) return;
    listenersByGeid.delete(geid);
    for (const l of list) {
      try {
        l(r);
      } catch {
      }
    }
  };
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      try {
        const msg = JSON.parse(line);
        if (msg.type === "decision" && typeof msg.governance_event_id === "string" && (msg.decision === "approve" || msg.decision === "reject")) {
          dispatch(msg.governance_event_id, {
            kind: "decision",
            decision: msg.decision
          });
        }
      } catch {
      }
    }
  });
  const drainAll = (r) => {
    for (const [geid] of [...listenersByGeid]) dispatch(geid, r);
  };
  socket.once("close", () => drainAll({ kind: "closed" }));
  socket.once("error", () => drainAll({ kind: "closed" }));
  return {
    socket,
    notifyPending: (p) => {
      try {
        socket.write(JSON.stringify({ type: "pending", ...p }) + "\n");
      } catch {
      }
    },
    awaitDecision: (geid, deadlineMs) => new Promise((resolve2) => {
      const list = listenersByGeid.get(geid) ?? [];
      list.push(resolve2);
      listenersByGeid.set(geid, list);
      if (deadlineMs > 0) {
        setTimeout(() => {
          const cur = listenersByGeid.get(geid);
          if (!cur) return;
          const idx = cur.indexOf(resolve2);
          if (idx === -1) return;
          cur.splice(idx, 1);
          if (cur.length === 0) listenersByGeid.delete(geid);
          resolve2({ kind: "timeout" });
        }, deadlineMs);
      }
    }),
    close: () => {
      try {
        socket.end();
      } catch {
      }
    }
  };
}

// ts/src/approvals/socket-server.ts
import * as net2 from "net";
import * as fs from "fs";
import * as path2 from "path";
var ApprovalSocketServer = class {
  constructor(handlers, options = {}) {
    this.handlers = handlers;
    this.socketPath = options.socketPath ?? defaultApprovalSocketPath();
    this.log = options.log ?? (() => void 0);
  }
  handlers;
  server;
  conns = /* @__PURE__ */ new Set();
  socketPath;
  log;
  /** Path the server is (or will be) listening on. */
  get path() {
    return this.socketPath;
  }
  start() {
    const runDir = path2.dirname(this.socketPath);
    try {
      fs.mkdirSync(runDir, { recursive: true, mode: 448 });
    } catch (err) {
      this.log(`[socket] mkdir failed: ${String(err)}`);
    }
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
    }
    this.server = net2.createServer((socket) => this.onConnection(socket));
    this.server.on("error", (err) => {
      this.log(`[socket] server error: ${String(err)}`);
    });
    this.server.listen(this.socketPath, () => {
      try {
        fs.chmodSync(this.socketPath, 384);
      } catch {
      }
      this.log(`[socket] listening at ${this.socketPath}`);
    });
  }
  onConnection(socket) {
    const geids = /* @__PURE__ */ new Set();
    const iface = {
      geids,
      writeDecision: (geid, decision) => {
        try {
          socket.write(
            JSON.stringify({
              type: "decision",
              governance_event_id: geid,
              decision
            }) + "\n"
          );
        } catch {
        }
      }
    };
    const conn = { socket, geids, iface };
    this.conns.add(conn);
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        try {
          const msg = JSON.parse(line);
          if (msg.type !== "pending") continue;
          if (!msg.governance_event_id) continue;
          geids.add(msg.governance_event_id);
          this.handlers.onPending(msg, iface);
        } catch (err) {
          this.log(`[socket] bad line: ${String(err)}`);
        }
      }
    });
    socket.on("error", () => void 0);
    socket.on("close", () => {
      this.conns.delete(conn);
      this.handlers.onConnectionClosed(iface);
    });
  }
  stop() {
    for (const conn of this.conns) {
      try {
        conn.socket.destroy();
      } catch {
      }
    }
    this.conns.clear();
    this.server?.close();
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
    }
  }
};

// ts/src/approvals/resolve.ts
var APPROVAL_LOOKUP_PAGE_SIZE = 100;
var APPROVAL_LOOKUP_MAX_PAGES = 10;
function extractApprovalRows(payload) {
  if (!payload || typeof payload !== "object") return [];
  const root = payload;
  return root.approvals?.data ?? root.data?.approvals?.data ?? [];
}
function findApprovalRow(rows, governanceEventId, storeGeid) {
  return rows.find(
    (r) => r.id && (r.id === governanceEventId || r.id === storeGeid) || r.event_id && (r.event_id === governanceEventId || r.event_id === storeGeid)
  );
}
async function resolveApprovalIdentity(client, hint) {
  const callerAid = hint.agentId && hint.agentId.length > 0 ? hint.agentId : void 0;
  const storeAid = hint.storeRow?.agent_id && hint.storeRow.agent_id.length > 0 ? hint.storeRow.agent_id : void 0;
  let aid = callerAid ?? storeAid;
  let realGeid = hint.governanceEventId;
  let governanceEventId = hint.storeRow?.governance_event_id;
  if (realGeid) {
    try {
      const profile = await client.getProfile();
      const orgId = profile?.orgId;
      if (orgId) {
        const storeGeid = hint.storeRow?.governance_event_id;
        let match;
        for (let page = 0; page < APPROVAL_LOOKUP_MAX_PAGES && !match; page += 1) {
          const list = await client.getOrgApprovals(orgId, {
            status: "pending",
            page,
            perPage: APPROVAL_LOOKUP_PAGE_SIZE
          });
          const rows = extractApprovalRows(list);
          match = findApprovalRow(rows, hint.governanceEventId, storeGeid);
          if (rows.length < APPROVAL_LOOKUP_PAGE_SIZE) break;
        }
        if (match) {
          aid ??= match.agent_id;
          governanceEventId = match.event_id ?? governanceEventId;
          realGeid = match.id ?? match.event_id ?? realGeid;
        }
      }
    } catch {
    }
  }
  if (!aid) {
    throw new ApprovalIdentityNotFoundError(
      "this approval row is no longer in the pending list; it may have already been resolved",
      hint
    );
  }
  return { agentId: aid, eventId: realGeid, governanceEventId };
}
var ApprovalIdentityNotFoundError = class extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
    this.name = "ApprovalIdentityNotFoundError";
  }
  hint;
};
async function decideApproval(client, hint, decision) {
  const identity = await resolveApprovalIdentity(client, hint);
  await client.decideApproval(identity.agentId, identity.eventId, {
    action: decision
  });
  return identity;
}

// ts/src/approvals/source.ts
var SOURCE_INPUT_KEY = "_openbox_source";
function readMetadataSource(a) {
  const meta = a.metadata;
  if (!meta || typeof meta !== "object") return void 0;
  const src = meta.source;
  return typeof src === "string" && src.length > 0 ? src : void 0;
}
function readInputSource(a) {
  const input = a.input;
  if (!Array.isArray(input) || input.length === 0) return void 0;
  const head = input[0];
  if (!head || typeof head !== "object") return void 0;
  const src = head[SOURCE_INPUT_KEY];
  return typeof src === "string" && src.length > 0 ? src : void 0;
}
function readSpanModule(a) {
  const spans = a.spans;
  if (!Array.isArray(spans) || spans.length === 0) return void 0;
  const span = spans[0];
  if (!span || typeof span !== "object") return void 0;
  const s = span;
  if (typeof s.module === "string" && s.module.length > 0) return s.module;
  const attrs = s.attributes;
  if (attrs && typeof attrs === "object") {
    const sys = attrs["gen_ai.system"];
    if (typeof sys === "string" && sys.length > 0) return sys;
  }
  return void 0;
}
function approvalSource(a) {
  return readMetadataSource(a) ?? readInputSource(a) ?? readSpanModule(a);
}
export {
  APPROVAL_SOCKET_PATH,
  ApprovalIdentityNotFoundError,
  ApprovalSocketServer,
  EMPTY_FILTERS,
  UPPERCASE_WORDS,
  applyClientFilters,
  approvalSource,
  connectApprovalSocket,
  dateRangeBounds,
  decideApproval,
  defaultApprovalSocketPath,
  formatLabel,
  hasActiveFilters,
  resolveApprovalIdentity,
  statusOf,
  summarizeFilters,
  summarizeInput,
  tierBg,
  tierColor,
  timeAgo,
  timeRemaining,
  verdictLabel
};
