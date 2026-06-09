// ts/src/core-client/core-client.ts
import { createHash, createPrivateKey, randomUUID, sign } from "crypto";

// ts/src/env/generated/env-bindings.ts
var ENV_VAR_BINDINGS = {
  apiUrl: { "name": "OPENBOX_API_URL" },
  coreUrl: { "name": "OPENBOX_CORE_URL" },
  platformUrl: { "name": "OPENBOX_PLATFORM_URL" },
  authUrl: { "name": "OPENBOX_AUTH_URL" },
  stackUrl: { "name": "OPENBOX_STACK_URL" },
  apiKey: { "name": "OPENBOX_API_KEY" },
  experimentalLevel: { "name": "OPENBOX_EXPERIMENTAL_LEVEL" },
  features: { "name": "OPENBOX_FEATURES" }
};
var CLIENT_VARIANT_PATTERN = /^[A-Za-z0-9._+-]+$/;

// ts/src/env/connection.ts
function normalizeStackUrl(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("OpenBox stack URL cannot be empty.");
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
    throw new Error("OpenBox stack URL must use https:// unless it points at localhost.");
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}
function endpointsFromStackUrl(raw) {
  const stackUrl = normalizeStackUrl(raw);
  const url = new URL(stackUrl);
  const rootHost = url.hostname.replace(/^(api|core|auth)\./, "");
  const origin = `${url.protocol}//`;
  return {
    apiUrl: `${origin}api.${rootHost}/ob`,
    coreUrl: `${origin}core.${rootHost}/ob`,
    authUrl: `${origin}auth.${rootHost}/ob`,
    platformUrl: stackUrl
  };
}
var resolveConnection = (opts = {}) => {
  const stackUrl = opts.stackUrl ?? process.env[ENV_VAR_BINDINGS.stackUrl.name];
  const stackEndpoints = stackUrl ? endpointsFromStackUrl(stackUrl) : void 0;
  const apiUrl = requireUrl(
    "OPENBOX_API_URL",
    opts.apiUrl ?? process.env[ENV_VAR_BINDINGS.apiUrl.name] ?? stackEndpoints?.apiUrl
  );
  const coreUrl = requireUrl(
    "OPENBOX_CORE_URL",
    opts.coreUrl ?? process.env[ENV_VAR_BINDINGS.coreUrl.name] ?? stackEndpoints?.coreUrl
  );
  const platformUrl = opts.platformUrl ?? process.env[ENV_VAR_BINDINGS.platformUrl.name] ?? stackEndpoints?.platformUrl;
  const authUrl = opts.authUrl ?? process.env[ENV_VAR_BINDINGS.authUrl.name] ?? stackEndpoints?.authUrl;
  return {
    apiUrl,
    coreUrl,
    platformUrl,
    authUrl,
    stackUrl,
    displayName: opts.displayName ?? process.env.OPENBOX_STACK_NAME,
    source: stackUrl && !opts.apiUrl && !opts.coreUrl ? "stack-url" : "explicit"
  };
};
function requireUrl(name, value) {
  if (!value) throw new Error(`${name} is required. Set explicit OpenBox service URLs.`);
  return normalizeServiceUrl(name, value);
}
function normalizeServiceUrl(name, raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`${name} cannot be empty.`);
  const url = new URL(trimmed);
  if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
    throw new Error(`${name} must use https:// unless it points at localhost.`);
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}
function isLoopbackHost(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

// ts/src/env/token-codec.ts
function applyField(entry, field, value) {
  if (field === "ACCESS_TOKEN") return { ...entry, accessToken: value };
  if (field === "REFRESH_TOKEN") return { ...entry, refreshToken: value || void 0 };
  if (field === "API_KEY") return { ...entry, apiKey: value || void 0 };
  if (field === "UPDATED_AT") return { ...entry, updatedAt: value };
  if (field === "PERMISSIONS") {
    return {
      ...entry,
      permissions: value.split(",").map((s) => s.trim()).filter(Boolean)
    };
  }
  if (field === "FEATURES") {
    const features = value.split(",").reduce((acc, pair) => {
      const [key, rawValue] = pair.split(":").map((s) => s.trim());
      return key ? { ...acc, [key]: rawValue === "true" } : acc;
    }, {});
    return { ...entry, features };
  }
  return entry;
}
var parseTokenStore = (content) => {
  let store = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (!match) continue;
    store = applyField(store, match[1], match[2]);
  }
  return store;
};

// ts/src/env/client-name.ts
var resolveClientName = (base2, variant) => {
  const raw = variant ?? process.env.OPENBOX_CLIENT_VARIANT;
  if (!raw) return base2;
  const trimmed = raw.trim();
  if (!trimmed) return base2;
  if (!CLIENT_VARIANT_PATTERN.test(trimmed)) {
    console.error(
      `[openbox] OPENBOX_CLIENT_VARIANT='${trimmed}' contains invalid characters; ignoring. Allowed: letters, digits, '.', '_', '+', '-'.`
    );
    return base2;
  }
  return `${base2}/${trimmed}`;
};

// ts/src/env/auth-header.ts
function buildAuthHeader(creds) {
  if (creds.apiKey) return { "X-API-Key": creds.apiKey };
  if (creds.accessToken) return { Authorization: `Bearer ${creds.accessToken}` };
  return {};
}

// ts/src/client/rate-limiter.ts
var TokenBucket = class {
  tokens;
  lastRefill;
  capacity;
  refillRate;
  // tokens per ms
  constructor(requestsPerSecond, burst) {
    this.capacity = burst ?? requestsPerSecond;
    this.tokens = this.capacity;
    this.refillRate = requestsPerSecond / 1e3;
    this.lastRefill = Date.now();
  }
  async acquire() {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = (1 - this.tokens) / this.refillRate;
    return new Promise((resolve2) => {
      setTimeout(() => {
        this.refill();
        this.tokens -= 1;
        resolve2();
      }, waitMs);
    });
  }
  refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
};

// ts/src/core-client/core-client.ts
var CoreApiError = class extends Error {
  status;
  body;
  constructor(message, status, body) {
    super(message);
    this.name = "CoreApiError";
    this.status = status;
    this.body = body;
  }
};
var OpenBoxCoreClient = class _OpenBoxCoreClient {
  baseUrl;
  config;
  rateLimiter = null;
  constructor(config) {
    this.config = { ...config };
    this.baseUrl = requireCoreUrl(this.config.apiUrl ?? process.env.OPENBOX_CORE_URL);
    if (config.rateLimit) {
      this.rateLimiter = new TokenBucket(
        config.rateLimit.requestsPerSecond,
        config.rateLimit.burst
      );
    }
  }
  // =========================================================================
  // Public API
  // =========================================================================
  /**
   * Dynamic operation request used by compact API-first tooling.
   * Generated methods remain the preferred typed surface; this method
   * exists for operationId-driven callers that already resolved a
   * generated endpoint manifest entry.
   */
  async requestOperation(method, path3, options) {
    const renderedPath = appendQuery(path3, options?.params);
    return this.request(method, renderedPath, { data: options?.data });
  }
  async health() {
    return this.request("GET", "/");
  }
  async validateApiKey() {
    return this.request("GET", "/api/v1/auth/validate");
  }
  async evaluate(payload) {
    return this.request("POST", "/api/v1/governance/evaluate", {
      data: payload,
      retryable: false
    });
  }
  async pollApproval(request) {
    return this.request("POST", "/api/v1/governance/approval", {
      data: request
    });
  }
  // =========================================================================
  // Private helpers
  // =========================================================================
  static RETRYABLE_STATUSES = /* @__PURE__ */ new Set([429, 500, 502, 503, 504]);
  async request(method, path3, options) {
    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }
    const url = `${this.baseUrl}${path3}`;
    const timeoutMs = this.config.timeoutMs ?? 35e3;
    const baseHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`
    };
    const body = options?.data ? JSON.stringify(options.data) : void 0;
    const signedHeaders = this.config.agentIdentity ? signAgentIdentityRequest({
      identity: this.config.agentIdentity,
      method,
      path: new URL(url).pathname,
      body
    }) : {};
    const headers = { ...baseHeaders, ...signedHeaders };
    const retryable = options?.retryable ?? true;
    const response = retryable ? await this.executeWithRetry({ url, method, headers, body, timeoutMs }) : await this.executeOnce({ url, method, headers, body, timeoutMs });
    const contentType = response.headers.get("content-type");
    const isJson = contentType?.includes("application/json");
    if (!response.ok) {
      const errBody = isJson ? await response.json() : await response.text();
      throw new CoreApiError(
        `Request failed: ${response.status} ${response.statusText}`,
        response.status,
        errBody
      );
    }
    if (!isJson) {
      return response.text();
    }
    return response.json();
  }
  /** Single-attempt fetch with the same per-request abort/timeout shape
   *  as one iteration of executeWithRetry. Used by endpoints that opt
   *  out of retries (evaluate). Network errors / timeouts surface as
   *  exceptions for reportAndExit; HTTP 5xx come back as Response so
   *  the caller can wrap them as CoreApiError. */
  async executeOnce(req) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      return await fetch(req.url, {
        method: req.method,
        credentials: "omit",
        headers: req.headers,
        body: req.body,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }
  async executeWithRetry(req) {
    const maxRetries = this.config.retry?.maxRetries ?? 3;
    const initialDelay = this.config.retry?.initialDelayMs ?? 500;
    const maxDelay = this.config.retry?.maxDelayMs ?? 3e4;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), req.timeoutMs);
      const fetchOptions = {
        method: req.method,
        // credentials: 'omit' prevents RN/iOS from auto-sending cookies that
        // leaked from a WKWebView via sharedCookiesEnabled. The backend's
        // CSRF guard fires when an XSRF-TOKEN cookie is present without a
        // matching X-XSRF-TOKEN header; Bearer-auth clients don't carry
        // that header and shouldn't send cookies in the first place.
        credentials: "omit",
        headers: req.headers,
        body: req.body,
        signal: controller.signal
      };
      try {
        const response = await fetch(req.url, fetchOptions);
        if (response.ok || !_OpenBoxCoreClient.RETRYABLE_STATUSES.has(response.status)) {
          return response;
        }
        if (attempt === maxRetries) return response;
        const delay = this.calculateBackoff(attempt, initialDelay, maxDelay);
        await new Promise((r) => setTimeout(r, delay));
      } catch (err) {
        const isNetworkError = err instanceof TypeError;
        const isTimeout = err instanceof Error && err.name === "AbortError";
        if (attempt === maxRetries || !isNetworkError && !isTimeout) throw err;
        const delay = this.calculateBackoff(attempt, initialDelay, maxDelay);
        await new Promise((r) => setTimeout(r, delay));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error("Retry loop exited unexpectedly");
  }
  calculateBackoff(attempt, initialDelay, maxDelay) {
    const exponential = initialDelay * Math.pow(2, attempt);
    const jitter = Math.random() * initialDelay * 0.5;
    return Math.min(exponential + jitter, maxDelay);
  }
};
function requireCoreUrl(value) {
  if (!value) throw new Error("OPENBOX_CORE_URL is required. Set the core API URL explicitly.");
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}
function appendQuery(path3, params) {
  if (!params) return path3;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === void 0 || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== void 0 && item !== null) search.append(key, String(item));
      }
    } else {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  if (!query) return path3;
  return `${path3}${path3.includes("?") ? "&" : "?"}${query}`;
}
var ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
function signAgentIdentityRequest(input) {
  const timestamp = input.timestamp ?? (/* @__PURE__ */ new Date()).toISOString();
  const nonce = input.nonce ?? randomUUID();
  const bodySha256 = createHash("sha256").update(input.body ?? "").digest("hex");
  const canonical = [
    input.method.toUpperCase(),
    input.path,
    timestamp,
    nonce,
    bodySha256
  ].join("\n");
  const privateKey = ed25519PrivateKeyFromRawBase64(input.identity.privateKey);
  const signature = sign(null, Buffer.from(canonical), privateKey).toString("base64");
  return {
    "X-OpenBox-Agent-DID": input.identity.did,
    "X-OpenBox-Agent-Timestamp": timestamp,
    "X-OpenBox-Agent-Nonce": nonce,
    "X-OpenBox-Body-SHA256": bodySha256,
    "X-OpenBox-Agent-Signature": signature
  };
}
function ed25519PrivateKeyFromRawBase64(rawBase64) {
  const raw = Buffer.from(rawBase64, "base64");
  if (raw.length !== 32) {
    throw new Error("agent identity privateKey must be a base64-encoded 32-byte Ed25519 key");
  }
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, raw]),
    format: "der",
    type: "pkcs8"
  });
}

// ts/src/core-client/generated/govern.ts
var CANONICAL_ACTIVITY_LABELS = Object.freeze({ "AGENT_STEP": "Agent Step", "ActivityTaskCanceled": "Activity Task Canceled", "ActivityTaskCompleted": "Activity Task Completed", "ActivityTaskFailed": "Activity Task Failed", "ActivityTaskScheduled": "Activity Task Scheduled", "ActivityTaskStarted": "Activity Task Started", "ActivityTaskTimedOut": "Activity Task Timed Out", "AgentExecutionCompleted": "Agent Execution Completed", "AgentExecutionStarted": "Agent Execution Started", "AgentSpawn": "Agent Spawn", "CHUNKING": "Chunking", "CallToolsNode": "Call Tools Node", "ChildWorkflowExecutionCompleted": "Child Workflow Execution Completed", "ChildWorkflowExecutionInitiated": "Child Workflow Execution Initiated", "CrewKickoffCompleted": "Crew Kickoff Completed", "CrewKickoffStarted": "Crew Kickoff Started", "EMBEDDING": "Embedding", "EXCEPTION": "Exception", "End": "End", "FUNCTION_CALL": "Function Call", "FileDelete": "File Delete", "FileEdit": "File Edit", "FileRead": "File Read", "HTTPRequest": "HTTP Request", "HandoffMessage": "Handoff Message", "LLM": "LLM", "LLMCallCompleted": "LLM Call Completed", "LLMCallStarted": "LLM Call Started", "LLMCompleted": "LLM Completed", "MCPToolCall": "MCP Tool Call", "MarkerRecorded": "Marker Recorded", "MemoryQueryEvent": "Memory Query", "ModelRequestNode": "Model Request Node", "MultiModalMessage": "Multi-Modal Message", "Notification": "Notification", "OperationCompleted": "Operation Completed", "OperationStarted": "Operation Started", "PermissionRequest": "Permission Request", "PostToolUse": "Post-Tool Use", "PreCompact": "Pre-Compact", "PreSyncHookStarted": "Pre-Sync Hook Started", "PreSyncHookSucceeded": "Pre-Sync Hook Succeeded", "PreToolUse": "Pre-Tool Use", "PromptSubmission": "Prompt Submission", "QUERY": "Query", "RERANKING": "Reranking", "RETRIEVE": "Retrieve", "ResourceUpdated": "Resource Updated", "SUB_QUESTION": "Sub-Question", "SYNTHESIZE": "Synthesize", "ShellExecution": "Shell Execution", "Stop": "Stop", "StopMessage": "Stop Message", "SubagentStart": "Subagent Start", "SubagentStop": "Subagent Stop", "SyncStatusChanged": "Sync Status Changed", "TaskCompleted": "Task Completed", "TaskStart": "Task Start", "TaskStarted": "Task Started", "TextMessage": "Text Message", "TimerFired": "Timer Fired", "TimerStarted": "Timer Started", "ToolCallExecutionEvent": "Tool Call Execution", "ToolCallRequestEvent": "Tool Call Request", "ToolCompleted": "Tool Completed", "ToolStarted": "Tool Started", "ToolUsageError": "Tool Usage Error", "ToolUsageFinished": "Tool Usage Finished", "ToolUsageStarted": "Tool Usage Started", "UserInputRequestedEvent": "User Input Requested", "UserPromptNode": "User Prompt Node", "UserPromptSubmit": "User Prompt Submit", "WorkflowExecutionSignaled": "Workflow Execution Signaled", "afterAgentResponse": "After Agent Response", "afterAgentThought": "After Agent Thought", "afterFileEdit": "After File Edit", "afterMCPExecution": "After MCP Execution", "afterShellExecution": "After Shell Execution", "agentStop": "Agent Stop", "auto_function_invocation_post": "Auto Function Invocation Post", "auto_function_invocation_pre": "Auto Function Invocation Pre", "beforeMCPExecution": "Before MCP Execution", "beforeReadFile": "Before Read File", "beforeShellExecution": "Before Shell Execution", "beforeSubmitPrompt": "Before Submit Prompt", "checkpoint": "Checkpoint", "custom_event": "Custom Event", "error": "Error", "error-trigger": "Error Trigger", "errorOccurred": "Error Occurred", "function_invocation_post": "Function Invocation Post", "function_invocation_pre": "Function Invocation Pre", "incident.acknowledged": "Incident Acknowledged", "incident.annotated": "Incident Annotated", "incident.delegated": "Incident Delegated", "incident.escalated": "Incident Escalated", "incident.priority_updated": "Incident Priority Updated", "incident.reassigned": "Incident Reassigned", "incident.reopened": "Incident Reopened", "incident.resolved": "Incident Resolved", "incident.triggered": "Incident Triggered", "incident.unacknowledged": "Incident Unacknowledged", "interrupt": "Interrupt", "node-post-execute": "Node Post-Execute", "node-pre-execute": "Node Pre-Execute", "node_end": "Node End", "node_start": "Node Start", "onAbort": "Abort", "onError": "Error", "onFinish": "Finish", "onStepFinish": "Step Finish", "on_agent_action": "Agent Action", "on_agent_finish": "Agent Finish", "on_chain_end": "Chain End", "on_chain_start": "Chain Start", "on_chat_model_start": "Chat Model Start", "on_execute_callback": "Execute Callback", "on_failure_callback": "Failure Callback", "on_llm_end": "LLM End", "on_llm_error": "LLM Error", "on_llm_start": "LLM Start", "on_retriever_end": "Retriever End", "on_retriever_start": "Retriever Start", "on_retry_callback": "Retry Callback", "on_skipped_callback": "Skipped Callback", "on_success_callback": "Success Callback", "on_tool_end": "Tool End", "on_tool_error": "Tool Error", "on_tool_start": "Tool Start", "output_validator": "Output Validator", "payment_order.approved": "Payment Order Approved", "payment_order.begin_processing": "Payment Order Begin Processing", "payment_order.failed": "Payment Order Failed", "payment_order.reconciled": "Payment Order Reconciled", "payment_reference.created": "Payment Reference Created", "postToolUse": "Post-Tool Use", "preToolUse": "Pre-Tool Use", "prompt_render_post": "Prompt Render Post", "prompt_render_pre": "Prompt Render Pre", "sla_miss_callback": "SLA Miss Callback", "subagentStop": "Subagent Stop", "task_end": "Task End", "task_start": "Task Start", "tool-call": "Tool Call", "tool-result": "Tool Result", "tool_retry": "Tool Retry", "userPromptSubmitted": "User Prompt Submitted", "workflow-step-finish": "Workflow Step Finish", "workflow-step-progress": "Workflow Step Progress", "workflow-step-start": "Workflow Step Start" });
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

// ts/src/file-tokens/agent-keys.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

// ts/src/env/os-paths.ts
import { homedir } from "os";
import { join } from "path";
function openboxDataRoot() {
  const override = process.env.OPENBOX_HOME;
  if (override) return override;
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "openbox");
  }
  if (process.platform === "linux") {
    const xdg = process.env.XDG_DATA_HOME;
    if (xdg) return join(xdg, "openbox");
  }
  return join(homedir(), ".openbox");
}
var resolveOsPath = (scope) => {
  return join(openboxDataRoot(), scope);
};

// ts/src/file-tokens/agent-keys.ts
function getPath() {
  const path3 = resolveOsPath("agent-keys");
  const dir = dirname(path3);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return path3;
}
function read() {
  const path3 = getPath();
  if (!existsSync(path3)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path3, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function recallAgentKey(agentId) {
  return read()[agentId] ?? null;
}

// ts/src/governance/check.ts
var ACTIVITY_TYPE_MAP = {
  llm: "PromptSubmission",
  file_read: "FileRead",
  file_write: "FileEdit",
  shell: "ShellExecution",
  http: "HTTPRequest",
  db: "DatabaseQuery",
  mcp: "MCPToolCall"
};
function hex(len) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
function buildSpan(spanType, input) {
  const base2 = {
    span_id: hex(16),
    trace_id: hex(32),
    parent_span_id: null,
    kind: "CLIENT",
    stage: "started",
    start_time: Date.now() * 1e6,
    end_time: null,
    duration_ns: null,
    status: { code: "OK", description: null },
    events: [],
    error: null
  };
  switch (spanType) {
    case "llm":
      return {
        ...base2,
        name: "llm.chat.completion",
        hook_type: "function_call",
        semantic_type: "llm_completion",
        attributes: {
          "gen_ai.system": "openai",
          "http.method": "POST",
          "http.url": "https://api.openai.com/v1/chat/completions"
        },
        function: "LLMCall",
        module: "activity",
        args: input,
        result: null
      };
    case "file_read":
      return {
        ...base2,
        name: "file.read",
        kind: "INTERNAL",
        hook_type: "file_operation",
        semantic_type: "file_read",
        attributes: { "file.path": input.file_path || "", "file.operation": "read" },
        file_path: input.file_path || "",
        file_mode: "r",
        file_operation: "read"
      };
    case "file_write":
      return {
        ...base2,
        name: "file.write",
        kind: "INTERNAL",
        hook_type: "file_operation",
        semantic_type: "file_write",
        attributes: { "file.path": input.file_path || "", "file.operation": "write" },
        file_path: input.file_path || "",
        file_mode: "w",
        file_operation: "write"
      };
    case "shell":
      return {
        ...base2,
        name: "ShellExecution",
        kind: "INTERNAL",
        hook_type: "function_call",
        semantic_type: "internal",
        attributes: { "shell.command": input.command || "", "shell.cwd": input.cwd || "" },
        function: "ShellExecution",
        module: "activity",
        args: input,
        result: null
      };
    case "http": {
      const method = (input.method || "POST").toUpperCase();
      const url = input.url || "https://api.example.com";
      return {
        ...base2,
        name: `${method} ${url}`,
        hook_type: "http_request",
        attributes: { "http.method": method, "http.url": url },
        http_method: method,
        http_url: url,
        request_body: null,
        response_body: null
      };
    }
    case "db": {
      const dbOp = (input.operation || "SELECT").toUpperCase();
      return {
        ...base2,
        name: dbOp,
        hook_type: "db_query",
        attributes: { "db.system": input.system || "postgresql", "db.operation": dbOp },
        db_system: input.system || "postgresql",
        db_operation: dbOp,
        db_statement: input.statement || ""
      };
    }
    case "mcp":
      return {
        ...base2,
        name: "MCPToolCall",
        kind: "INTERNAL",
        hook_type: "function_call",
        semantic_type: "internal",
        attributes: { "mcp.tool": input.tool || "" },
        function: "MCPToolCall",
        module: "activity",
        args: input,
        result: null
      };
  }
}
function isRuntimeKey(k) {
  return !!k && (k.startsWith("obx_live_") || k.startsWith("obx_test_"));
}
function resolveApiKey(opts) {
  const candidates = [
    opts.apiKey,
    process.env.OPENBOX_API_KEY,
    recallAgentKey(opts.agentId ?? "")?.runtimeKey
  ];
  const key = candidates.find(isRuntimeKey);
  if (!key) {
    throw new Error(
      `No agent runtime key for ${opts.agentId ?? "(unset)"}. Pass apiKey, set OPENBOX_API_KEY to obx_live_*/obx_test_*, or mint/recover a runtime key from the dashboard/backend API. (OPENBOX_API_KEY=obx_key_* is the org X-API-Key and is ignored here.)`
    );
  }
  return key;
}
function resolveCoreUrl(coreUrlOverride) {
  if (coreUrlOverride) return coreUrlOverride;
  return resolveConnection().coreUrl;
}
async function checkGovernance(opts) {
  const apiKey = resolveApiKey(opts);
  const coreUrl = resolveCoreUrl(opts.coreUrl);
  const span = buildSpan(opts.spanType, opts.activityInput);
  const payload = {
    source: "sdk",
    event_type: "ActivityStarted",
    workflow_id: hex(32),
    run_id: hex(32),
    workflow_type: "SdkCheck",
    task_queue: "sdk",
    activity_id: hex(32),
    activity_type: ACTIVITY_TYPE_MAP[opts.spanType] || opts.spanType,
    activity_input: [opts.activityInput],
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    hook_trigger: true,
    spans: [span],
    span_count: 1,
    attempt: 1
  };
  const client = new OpenBoxCoreClient({ apiUrl: coreUrl, apiKey });
  return client.evaluate(payload);
}

// ts/src/governance/spans.ts
function hex2(len) {
  return Array.from(
    { length: len },
    () => Math.floor(Math.random() * 16).toString(16)
  ).join("");
}
function base() {
  return {
    span_id: hex2(16),
    trace_id: hex2(32),
    parent_span_id: null,
    kind: "CLIENT",
    stage: "started",
    start_time: Date.now() * 1e6,
    end_time: null,
    duration_ns: null,
    status: { code: "OK", description: null },
    events: [],
    error: null
  };
}
function buildSpan2(host, type, input) {
  const b = base();
  switch (type) {
    case "llm":
      return {
        ...b,
        name: "llm.chat.completion",
        hook_type: "function_call",
        semantic_type: "llm_completion",
        attributes: {
          "gen_ai.system": host,
          "http.method": "POST",
          "http.url": "https://api.openai.com/v1/chat/completions"
        },
        function: "LLMCall",
        module: host,
        args: input,
        result: input.response ?? null
      };
    case "file_read":
      return {
        ...b,
        name: "file.read",
        kind: "INTERNAL",
        hook_type: "file_operation",
        semantic_type: "file_read",
        attributes: {
          "file.path": input.file_path ?? "",
          "file.operation": "read"
        },
        module: host,
        file_path: input.file_path ?? "",
        file_mode: "r",
        file_operation: "read"
      };
    case "file_write":
      return {
        ...b,
        name: "file.write",
        kind: "INTERNAL",
        hook_type: "file_operation",
        semantic_type: "file_write",
        attributes: {
          "file.path": input.file_path ?? "",
          "file.operation": "write"
        },
        module: host,
        file_path: input.file_path ?? "",
        file_mode: "w",
        file_operation: "write"
      };
    case "file_delete":
      return {
        ...b,
        name: "file.delete",
        kind: "INTERNAL",
        hook_type: "file_operation",
        semantic_type: "file_delete",
        attributes: {
          "file.path": input.file_path ?? "",
          "file.operation": "delete"
        },
        module: host,
        file_path: input.file_path ?? "",
        file_operation: "delete"
      };
    case "shell":
      return {
        ...b,
        name: "ShellExecution",
        kind: "INTERNAL",
        hook_type: "function_call",
        semantic_type: "internal",
        attributes: {
          "shell.command": input.command ?? "",
          "shell.cwd": input.cwd ?? ""
        },
        function: "ShellExecution",
        module: host,
        args: input,
        result: null
      };
    case "mcp":
      return {
        ...b,
        name: `tool.${input.tool_name ?? "call"}`,
        hook_type: "function_call",
        semantic_type: "llm_tool_call",
        attributes: {
          "gen_ai.system": "mcp",
          "http.method": "POST",
          "http.url": "https://api.openai.com/v1/chat/completions"
        },
        function: `mcp.${input.tool_name ?? "call"}`,
        module: host,
        args: input,
        result: input.tool_output ?? null
      };
    case "http":
      return {
        ...b,
        name: "http.request",
        hook_type: "function_call",
        semantic_type: `http_${(input.method ?? "get").toLowerCase()}`,
        attributes: {
          "http.method": input.method ?? "GET",
          "http.url": input.url ?? ""
        },
        function: "HTTPCall",
        module: host,
        args: input,
        result: null
      };
  }
}

// ts/src/governance/events.ts
var EVENT = {
  START: "ActivityStarted",
  COMPLETE: "ActivityCompleted",
  SIGNAL: "SignalReceived"
};

// ts/src/governance/skip-patterns.ts
import path from "path";
var SKIP_PATTERNS = [
  /\.cursor\//,
  /\.claude\//,
  /\/mcps\//,
  /\/node_modules\//,
  /\.git\//,
  /INSTRUCTIONS\.md$/,
  /SERVER_METADATA\.json$/,
  /SKILL\.md$/
];
function isSkipped(filePath) {
  return SKIP_PATTERNS.some((p) => p.test(filePath));
}
function isInsideAnyRoot(filePath, roots, cwd) {
  if (!filePath || !roots || roots.length === 0) return false;
  const norm = (p) => p.replace(/\/+$/, "");
  const f = norm(path.resolve(cwd ?? roots[0] ?? process.cwd(), filePath));
  return roots.some((r) => {
    const root = norm(path.resolve(r));
    return f === root || f.startsWith(root + "/");
  });
}

// ts/src/runtime/mcp/config.ts
import * as fs from "fs";
import * as path2 from "path";
function readTokens(opts = {}) {
  let tokenPath = opts.tokensPath;
  if (!tokenPath) {
    const local = path2.resolve(".tokens");
    const home = resolveOsPath("tokens");
    tokenPath = fs.existsSync(local) ? local : home;
  }
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`No tokens at ${tokenPath}. Run: openbox auth set-api-key`);
  }
  const store = parseTokenStore(fs.readFileSync(tokenPath, "utf-8"));
  if (!store.accessToken && !store.apiKey) {
    throw new Error(
      `No API_KEY in ${tokenPath}. Run: openbox auth set-api-key (mint a key in the dashboard: Organization -> API Keys). Mobile/SSO consumers can populate ACCESS_TOKEN via the JWT path; CLI / MCP / IDE / runtime use X-API-Key.`
    );
  }
  return {
    access: store.accessToken,
    refresh: store.refreshToken,
    apiKey: store.apiKey
  };
}
var mcpCallerName;
function currentClientName() {
  const base2 = mcpCallerName ? `runtime/mcp/${mcpCallerName}` : "runtime/mcp";
  return resolveClientName(base2);
}
function createApi(opts = {}) {
  const connection = resolveConnection();
  let cachedApiKey;
  let cachedAccess;
  try {
    const tokens = readTokens({ tokensPath: opts.tokensPath });
    cachedApiKey = tokens.apiKey;
    cachedAccess = tokens.access;
  } catch {
  }
  return async function api(urlPath, method = "GET", body) {
    if (!cachedApiKey && !cachedAccess) {
      const tokens = readTokens({ tokensPath: opts.tokensPath });
      cachedApiKey = tokens.apiKey;
      cachedAccess = tokens.access;
    }
    const authHeader = buildAuthHeader({
      apiKey: cachedApiKey,
      accessToken: cachedAccess
    });
    const response = await fetch(`${connection.apiUrl}${urlPath}`, {
      method,
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
        "X-Openbox-Client": currentClientName()
      },
      ...body ? { body: JSON.stringify(body) } : {}
    });
    if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
    const json = await response.json();
    return json?.data ?? json;
  };
}

// ts/src/governance/rules-projection.ts
var PROJECTION_VERSION = 1;
function severityFromTrustImpact(impact) {
  switch (impact) {
    case "high":
    case "critical":
      return "block";
    case "medium":
      return "warn";
    default:
      return "info";
  }
}
function globsFromParams(params) {
  if (!params) return void 0;
  const raw = params.path_globs ?? params.globs ?? params.file_globs;
  if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) {
    return raw;
  }
  return void 0;
}
function projectGuardrail(g) {
  if (!g.is_active) return null;
  const globs = globsFromParams(g.params);
  return {
    id: `guardrail/${g.id}`,
    source: "guardrail",
    description: g.description ?? g.name,
    body: renderGuardrailBody(g),
    trigger: globs ? "globMatch" : "always",
    severity: severityFromTrustImpact(g.trust_impact),
    ...globs ? { globs } : {},
    rendererHints: {
      guardrailType: g.guardrail_type,
      processingStage: g.processing_stage
    }
  };
}
function projectPolicy(p) {
  if (!p.is_active) return null;
  return {
    id: `policy/${p.id}`,
    source: "policy",
    description: p.description ?? p.name,
    body: renderPolicyBody(p),
    // Policies fire across every span; agent-requested keeps them out
    // of the always-on context unless the model decides they're
    // relevant. Operators can override with rendererHints.alwaysApply.
    trigger: "agentRequested",
    severity: severityFromTrustImpact(p.trust_impact)
  };
}
function renderGuardrailBody(g) {
  const lines = [
    `**${g.name}** (${g.guardrail_type}, ${g.processing_stage})`,
    "",
    g.description ?? "_No description provided._"
  ];
  if (g.params && Object.keys(g.params).length > 0) {
    lines.push("", "Parameters:", "```json", JSON.stringify(g.params, null, 2), "```");
  }
  return lines.join("\n");
}
function renderPolicyBody(p) {
  return [
    `**${p.name}** (OPA policy)`,
    "",
    p.description ?? "_No description provided._",
    "",
    `Policy id: \`${p.id}\``
  ].join("\n");
}
async function fetchRulesProjection(opts) {
  const api = createApi({ tokensPath: opts.tokensPath });
  const [guardrails, policies] = await Promise.all([
    api(`/agent/${opts.agentId}/guardrails?page=0&perPage=200`),
    api(`/agent/${opts.agentId}/policies?page=0&perPage=200`)
  ]);
  const guardrailEnvelope = guardrails;
  const policyEnvelope = policies;
  const grList = Array.isArray(guardrails) ? guardrails : guardrailEnvelope.data ?? [];
  const polList = Array.isArray(policies) ? policies : policyEnvelope.data ?? [];
  const rules = [];
  for (const g of grList) {
    const r = projectGuardrail(g);
    if (r) rules.push(r);
  }
  for (const p of polList) {
    const r = projectPolicy(p);
    if (r) rules.push(r);
  }
  rules.sort((a, b) => a.id.localeCompare(b.id));
  return {
    agentId: opts.agentId,
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
    version: PROJECTION_VERSION,
    rules
  };
}

// ts/src/core-client/generated/runtime/cursor.ts
var HOOK_EVENT_LABELS = {
  "beforeSubmitPrompt": "Prompt submission",
  "beforeReadFile": "File read",
  "beforeShellExecution": "Shell command",
  "beforeMCPExecution": "MCP tool call",
  "preToolUse": "Tool call",
  "afterAgentResponse": "Agent response",
  "afterAgentThought": "Agent thought",
  "afterShellExecution": "Shell completion",
  "afterFileEdit": "File edit",
  "afterMCPExecution": "MCP completion",
  "postToolUse": "Tool completion",
  "postToolUseFailure": "Tool failure",
  "sessionStart": "Session start",
  "stop": "Stop",
  "beforeTabFileRead": "Tab file read",
  "afterTabFileEdit": "Tab file edit",
  "sessionEnd": "Session end",
  "preCompact": "Pre-compact",
  "subagentStart": "Subagent spawn",
  "subagentStop": "Subagent stop"
};

// ts/src/core-client/generated/runtime/claude-code.ts
var HOOK_EVENT_LABELS2 = {
  "PreToolUse": "Tool call",
  "PostToolUse": "Tool completion",
  "UserPromptSubmit": "Prompt submission",
  "PermissionRequest": "Permission request",
  "PreCompact": "Pre-compact",
  "SessionStart": "Session start",
  "SessionEnd": "Session end",
  "SubagentStart": "Subagent spawn",
  "SubagentStop": "Subagent stop",
  "Stop": "Stop",
  "Notification": "Notification"
};

// ts/src/governance/hook-event-labels.ts
var HOOK_EVENT_LABELS3 = {
  ...HOOK_EVENT_LABELS,
  ...HOOK_EVENT_LABELS2
};
function hookEventLabel(hookEvent) {
  if (!hookEvent) return "Action";
  return HOOK_EVENT_LABELS3[hookEvent] ?? hookEvent;
}
export {
  EVENT,
  HOOK_EVENT_LABELS3 as HOOK_EVENT_LABELS,
  SKIP_PATTERNS,
  buildSpan2 as buildSpan,
  checkGovernance,
  fetchRulesProjection,
  hookEventLabel,
  isInsideAnyRoot,
  isSkipped
};
