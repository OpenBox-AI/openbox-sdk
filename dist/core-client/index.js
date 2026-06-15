// ts/src/core-client/core-client.ts
import { createHash, createPrivateKey, randomUUID, sign } from "crypto";

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
    return new Promise((resolve) => {
      setTimeout(() => {
        this.refill();
        this.tokens -= 1;
        resolve();
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

// ts/src/version.ts
var OPENBOX_SDK_VERSION = "0.1.0";

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
  async requestOperation(method, path, options) {
    const renderedPath = appendQuery(path, options?.params);
    return this.request(method, renderedPath, { data: options?.data });
  }
  async health() {
    return this.request("GET", "/");
  }
  async validateApiKey() {
    return this.request("GET", "/api/v1/auth/validate");
  }
  async evaluate(payload) {
    const versionedPayload = payload.sdk_version && payload.sdk_version !== "" ? payload : { ...payload, sdk_version: OPENBOX_SDK_VERSION };
    return this.request("POST", "/api/v1/governance/evaluate", {
      data: versionedPayload,
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
  async request(method, path, options) {
    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }
    const url = `${this.baseUrl}${path}`;
    const timeoutMs = this.config.timeoutMs ?? 35e3;
    const baseHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      "X-OpenBox-SDK-Version": OPENBOX_SDK_VERSION
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
function appendQuery(path, params) {
  if (!params) return path;
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
  if (!query) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
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
var PRESET_MANIFEST = [
  {
    "preset": "airflow",
    "methods": [
      {
        "name": "onExecuteCallback",
        "eventType": "ActivityStarted",
        "activityType": "on_execute_callback"
      },
      {
        "name": "onSuccessCallback",
        "eventType": "ActivityCompleted",
        "activityType": "on_success_callback"
      },
      {
        "name": "onFailureCallback",
        "eventType": "ActivityCompleted",
        "activityType": "on_failure_callback"
      },
      {
        "name": "onRetryCallback",
        "eventType": "ActivityCompleted",
        "activityType": "on_retry_callback"
      },
      {
        "name": "slaMissCallback",
        "eventType": "ActivityCompleted",
        "activityType": "sla_miss_callback"
      },
      {
        "name": "onSkippedCallback",
        "eventType": "ActivityCompleted",
        "activityType": "on_skipped_callback"
      }
    ]
  },
  {
    "preset": "argocd",
    "methods": [
      {
        "name": "operationStarted",
        "eventType": "ActivityStarted",
        "activityType": "OperationStarted"
      },
      {
        "name": "operationCompleted",
        "eventType": "ActivityCompleted",
        "activityType": "OperationCompleted"
      },
      {
        "name": "resourceUpdated",
        "eventType": "ActivityCompleted",
        "activityType": "ResourceUpdated"
      },
      {
        "name": "preSyncHookStarted",
        "eventType": "ActivityStarted",
        "activityType": "PreSyncHookStarted"
      },
      {
        "name": "preSyncHookSucceeded",
        "eventType": "ActivityCompleted",
        "activityType": "PreSyncHookSucceeded"
      },
      {
        "name": "syncStatusChanged",
        "eventType": "ActivityCompleted",
        "activityType": "SyncStatusChanged"
      }
    ]
  },
  {
    "preset": "autogen",
    "methods": [
      {
        "name": "textMessage",
        "eventType": "ActivityCompleted",
        "activityType": "TextMessage"
      },
      {
        "name": "multiModalMessage",
        "eventType": "ActivityCompleted",
        "activityType": "MultiModalMessage"
      },
      {
        "name": "toolCallRequestEvent",
        "eventType": "ActivityStarted",
        "activityType": "ToolCallRequestEvent"
      },
      {
        "name": "toolCallExecutionEvent",
        "eventType": "ActivityCompleted",
        "activityType": "ToolCallExecutionEvent"
      },
      {
        "name": "memoryQueryEvent",
        "eventType": "ActivityCompleted",
        "activityType": "MemoryQueryEvent"
      },
      {
        "name": "userInputRequestedEvent",
        "eventType": "SignalReceived",
        "activityType": "UserInputRequestedEvent"
      },
      {
        "name": "handoffMessage",
        "eventType": "SignalReceived",
        "activityType": "HandoffMessage"
      },
      {
        "name": "stopMessage",
        "eventType": "ActivityCompleted",
        "activityType": "StopMessage"
      }
    ]
  },
  {
    "preset": "claude-code",
    "methods": [
      {
        "name": "preToolUse",
        "eventType": "ActivityStarted",
        "activityType": "PreToolUse"
      },
      {
        "name": "postToolUse",
        "eventType": "ActivityCompleted",
        "activityType": "PostToolUse"
      },
      {
        "name": "userPromptSubmit",
        "eventType": "ActivityStarted",
        "activityType": "UserPromptSubmit"
      },
      {
        "name": "permissionRequest",
        "eventType": "ActivityStarted",
        "activityType": "PermissionRequest"
      },
      {
        "name": "preCompact",
        "eventType": "ActivityStarted",
        "activityType": "PreCompact"
      },
      {
        "name": "subagentStop",
        "eventType": "ActivityStarted",
        "activityType": "SubagentStop"
      },
      {
        "name": "notification",
        "eventType": "ActivityCompleted",
        "activityType": "Notification"
      },
      {
        "name": "stop",
        "eventType": "ActivityCompleted",
        "activityType": "Stop"
      }
    ]
  },
  {
    "preset": "cline",
    "methods": [
      {
        "name": "preToolUse",
        "eventType": "ActivityStarted",
        "activityType": "PreToolUse"
      },
      {
        "name": "postToolUse",
        "eventType": "ActivityCompleted",
        "activityType": "PostToolUse"
      },
      {
        "name": "userPromptSubmit",
        "eventType": "ActivityStarted",
        "activityType": "UserPromptSubmit"
      },
      {
        "name": "taskStart",
        "eventType": "ActivityStarted",
        "activityType": "TaskStart"
      }
    ]
  },
  {
    "preset": "codex",
    "methods": [
      {
        "name": "userPromptSubmit",
        "eventType": "ActivityStarted",
        "activityType": "UserPromptSubmit"
      },
      {
        "name": "preToolUse",
        "eventType": "ActivityStarted",
        "activityType": "PreToolUse"
      },
      {
        "name": "permissionRequest",
        "eventType": "ActivityStarted",
        "activityType": "PermissionRequest"
      },
      {
        "name": "postToolUse",
        "eventType": "ActivityCompleted",
        "activityType": "PostToolUse"
      },
      {
        "name": "stop",
        "eventType": "ActivityCompleted",
        "activityType": "Stop"
      }
    ]
  },
  {
    "preset": "copilot",
    "methods": [
      {
        "name": "userPromptSubmitted",
        "eventType": "ActivityStarted",
        "activityType": "userPromptSubmitted"
      },
      {
        "name": "preToolUse",
        "eventType": "ActivityStarted",
        "activityType": "preToolUse"
      },
      {
        "name": "postToolUse",
        "eventType": "ActivityCompleted",
        "activityType": "postToolUse"
      },
      {
        "name": "agentStop",
        "eventType": "ActivityCompleted",
        "activityType": "agentStop"
      },
      {
        "name": "subagentStop",
        "eventType": "ActivityCompleted",
        "activityType": "subagentStop"
      },
      {
        "name": "errorOccurred",
        "eventType": "ActivityCompleted",
        "activityType": "errorOccurred"
      }
    ]
  },
  {
    "preset": "crewai",
    "methods": [
      {
        "name": "crewKickoffStarted",
        "eventType": "ActivityStarted",
        "activityType": "CrewKickoffStarted"
      },
      {
        "name": "crewKickoffCompleted",
        "eventType": "ActivityCompleted",
        "activityType": "CrewKickoffCompleted"
      },
      {
        "name": "agentExecutionStarted",
        "eventType": "ActivityStarted",
        "activityType": "AgentExecutionStarted"
      },
      {
        "name": "agentExecutionCompleted",
        "eventType": "ActivityCompleted",
        "activityType": "AgentExecutionCompleted"
      },
      {
        "name": "taskStarted",
        "eventType": "ActivityStarted",
        "activityType": "TaskStarted"
      },
      {
        "name": "taskCompleted",
        "eventType": "ActivityCompleted",
        "activityType": "TaskCompleted"
      },
      {
        "name": "toolUsageStarted",
        "eventType": "ActivityStarted",
        "activityType": "ToolUsageStarted"
      },
      {
        "name": "toolUsageFinished",
        "eventType": "ActivityCompleted",
        "activityType": "ToolUsageFinished"
      },
      {
        "name": "toolUsageError",
        "eventType": "ActivityCompleted",
        "activityType": "ToolUsageError"
      },
      {
        "name": "llmCallStarted",
        "eventType": "ActivityStarted",
        "activityType": "LLMCallStarted"
      },
      {
        "name": "llmCallCompleted",
        "eventType": "ActivityCompleted",
        "activityType": "LLMCallCompleted"
      }
    ]
  },
  {
    "preset": "cursor",
    "methods": [
      {
        "name": "beforeSubmitPrompt",
        "eventType": "ActivityStarted",
        "activityType": "beforeSubmitPrompt"
      },
      {
        "name": "preToolUse",
        "eventType": "ActivityStarted",
        "activityType": "preToolUse"
      },
      {
        "name": "postToolUse",
        "eventType": "ActivityCompleted",
        "activityType": "postToolUse"
      },
      {
        "name": "beforeShellExecution",
        "eventType": "ActivityStarted",
        "activityType": "beforeShellExecution"
      },
      {
        "name": "afterShellExecution",
        "eventType": "ActivityCompleted",
        "activityType": "afterShellExecution"
      },
      {
        "name": "beforeMCPExecution",
        "eventType": "ActivityStarted",
        "activityType": "beforeMCPExecution"
      },
      {
        "name": "afterMCPExecution",
        "eventType": "ActivityCompleted",
        "activityType": "afterMCPExecution"
      },
      {
        "name": "beforeReadFile",
        "eventType": "ActivityStarted",
        "activityType": "beforeReadFile"
      },
      {
        "name": "afterFileEdit",
        "eventType": "ActivityCompleted",
        "activityType": "afterFileEdit"
      },
      {
        "name": "afterAgentResponse",
        "eventType": "ActivityCompleted",
        "activityType": "afterAgentResponse"
      },
      {
        "name": "afterAgentThought",
        "eventType": "ActivityCompleted",
        "activityType": "afterAgentThought"
      }
    ]
  },
  {
    "preset": "custom",
    "methods": [
      {
        "name": "activity"
      }
    ]
  },
  {
    "preset": "default",
    "methods": [
      {
        "name": "prompt",
        "eventType": "ActivityStarted",
        "activityType": "PromptSubmission"
      },
      {
        "name": "llm",
        "eventType": "ActivityCompleted",
        "activityType": "LLMCompleted"
      },
      {
        "name": "tool",
        "eventType": "ActivityStarted",
        "activityType": "ToolStarted"
      },
      {
        "name": "toolCompleted",
        "eventType": "ActivityCompleted",
        "activityType": "ToolCompleted"
      },
      {
        "name": "read",
        "eventType": "ActivityStarted",
        "activityType": "FileRead"
      },
      {
        "name": "write",
        "eventType": "ActivityStarted",
        "activityType": "FileEdit"
      },
      {
        "name": "fileDelete",
        "eventType": "ActivityStarted",
        "activityType": "FileDelete"
      },
      {
        "name": "shell",
        "eventType": "ActivityStarted",
        "activityType": "ShellExecution"
      },
      {
        "name": "httpRequest",
        "eventType": "ActivityStarted",
        "activityType": "HTTPRequest"
      },
      {
        "name": "mcpToolCall",
        "eventType": "ActivityStarted",
        "activityType": "MCPToolCall"
      },
      {
        "name": "agentSpawn",
        "eventType": "ActivityStarted",
        "activityType": "AgentSpawn"
      }
    ]
  },
  {
    "preset": "langchain",
    "methods": [
      {
        "name": "onLlmStart",
        "eventType": "ActivityStarted",
        "activityType": "on_llm_start"
      },
      {
        "name": "onLlmEnd",
        "eventType": "ActivityCompleted",
        "activityType": "on_llm_end"
      },
      {
        "name": "onLlmError",
        "eventType": "ActivityCompleted",
        "activityType": "on_llm_error"
      },
      {
        "name": "onChatModelStart",
        "eventType": "ActivityStarted",
        "activityType": "on_chat_model_start"
      },
      {
        "name": "onToolStart",
        "eventType": "ActivityStarted",
        "activityType": "on_tool_start"
      },
      {
        "name": "onToolEnd",
        "eventType": "ActivityCompleted",
        "activityType": "on_tool_end"
      },
      {
        "name": "onToolError",
        "eventType": "ActivityCompleted",
        "activityType": "on_tool_error"
      },
      {
        "name": "onChainStart",
        "eventType": "ActivityStarted",
        "activityType": "on_chain_start"
      },
      {
        "name": "onChainEnd",
        "eventType": "ActivityCompleted",
        "activityType": "on_chain_end"
      },
      {
        "name": "onAgentAction",
        "eventType": "ActivityCompleted",
        "activityType": "on_agent_action"
      },
      {
        "name": "onAgentFinish",
        "eventType": "ActivityCompleted",
        "activityType": "on_agent_finish"
      },
      {
        "name": "onRetrieverStart",
        "eventType": "ActivityStarted",
        "activityType": "on_retriever_start"
      },
      {
        "name": "onRetrieverEnd",
        "eventType": "ActivityCompleted",
        "activityType": "on_retriever_end"
      }
    ]
  },
  {
    "preset": "langgraph",
    "methods": [
      {
        "name": "nodeStart",
        "eventType": "ActivityStarted",
        "activityType": "node_start"
      },
      {
        "name": "nodeEnd",
        "eventType": "ActivityCompleted",
        "activityType": "node_end"
      },
      {
        "name": "interrupt",
        "eventType": "SignalReceived",
        "activityType": "interrupt"
      },
      {
        "name": "checkpoint",
        "eventType": "SignalReceived",
        "activityType": "checkpoint"
      },
      {
        "name": "taskStart",
        "eventType": "ActivityStarted",
        "activityType": "task_start"
      },
      {
        "name": "taskEnd",
        "eventType": "ActivityCompleted",
        "activityType": "task_end"
      },
      {
        "name": "customEvent",
        "eventType": "SignalReceived",
        "activityType": "custom_event"
      }
    ]
  },
  {
    "preset": "llamaindex",
    "methods": [
      {
        "name": "chunking",
        "eventType": "ActivityStarted",
        "activityType": "CHUNKING"
      },
      {
        "name": "llm",
        "eventType": "ActivityCompleted",
        "activityType": "LLM"
      },
      {
        "name": "query",
        "eventType": "ActivityStarted",
        "activityType": "QUERY"
      },
      {
        "name": "retrieve",
        "eventType": "ActivityStarted",
        "activityType": "RETRIEVE"
      },
      {
        "name": "synthesize",
        "eventType": "ActivityCompleted",
        "activityType": "SYNTHESIZE"
      },
      {
        "name": "embedding",
        "eventType": "ActivityStarted",
        "activityType": "EMBEDDING"
      },
      {
        "name": "functionCall",
        "eventType": "ActivityStarted",
        "activityType": "FUNCTION_CALL"
      },
      {
        "name": "agentStep",
        "eventType": "ActivityCompleted",
        "activityType": "AGENT_STEP"
      },
      {
        "name": "reranking",
        "eventType": "ActivityCompleted",
        "activityType": "RERANKING"
      },
      {
        "name": "subQuestion",
        "eventType": "ActivityStarted",
        "activityType": "SUB_QUESTION"
      },
      {
        "name": "exception",
        "eventType": "ActivityCompleted",
        "activityType": "EXCEPTION"
      }
    ]
  },
  {
    "preset": "mastra",
    "methods": [
      {
        "name": "workflowStepStart",
        "eventType": "ActivityStarted",
        "activityType": "workflow-step-start"
      },
      {
        "name": "workflowStepFinish",
        "eventType": "ActivityCompleted",
        "activityType": "workflow-step-finish"
      },
      {
        "name": "workflowStepProgress",
        "eventType": "ActivityCompleted",
        "activityType": "workflow-step-progress"
      },
      {
        "name": "toolCall",
        "eventType": "ActivityStarted",
        "activityType": "tool-call"
      },
      {
        "name": "toolResult",
        "eventType": "ActivityCompleted",
        "activityType": "tool-result"
      },
      {
        "name": "error",
        "eventType": "ActivityCompleted",
        "activityType": "error"
      }
    ]
  },
  {
    "preset": "modern-treasury",
    "methods": [
      {
        "name": "paymentOrderApproved",
        "eventType": "ActivityStarted",
        "activityType": "payment_order.approved"
      },
      {
        "name": "paymentOrderBeginProcessing",
        "eventType": "ActivityStarted",
        "activityType": "payment_order.begin_processing"
      },
      {
        "name": "paymentOrderFailed",
        "eventType": "ActivityCompleted",
        "activityType": "payment_order.failed"
      },
      {
        "name": "paymentOrderReconciled",
        "eventType": "ActivityCompleted",
        "activityType": "payment_order.reconciled"
      },
      {
        "name": "paymentReferenceCreated",
        "eventType": "ActivityCompleted",
        "activityType": "payment_reference.created"
      }
    ]
  },
  {
    "preset": "n8n",
    "methods": [
      {
        "name": "nodePreExecute",
        "eventType": "ActivityStarted",
        "activityType": "node-pre-execute"
      },
      {
        "name": "nodePostExecute",
        "eventType": "ActivityCompleted",
        "activityType": "node-post-execute"
      },
      {
        "name": "errorTrigger",
        "eventType": "ActivityCompleted",
        "activityType": "error-trigger"
      }
    ]
  },
  {
    "preset": "pagerduty",
    "methods": [
      {
        "name": "incidentTriggered",
        "eventType": "ActivityStarted",
        "activityType": "incident.triggered"
      },
      {
        "name": "incidentAcknowledged",
        "eventType": "ActivityCompleted",
        "activityType": "incident.acknowledged"
      },
      {
        "name": "incidentEscalated",
        "eventType": "ActivityCompleted",
        "activityType": "incident.escalated"
      },
      {
        "name": "incidentReassigned",
        "eventType": "ActivityCompleted",
        "activityType": "incident.reassigned"
      },
      {
        "name": "incidentDelegated",
        "eventType": "ActivityCompleted",
        "activityType": "incident.delegated"
      },
      {
        "name": "incidentPriorityUpdated",
        "eventType": "ActivityCompleted",
        "activityType": "incident.priority_updated"
      },
      {
        "name": "incidentResolved",
        "eventType": "ActivityCompleted",
        "activityType": "incident.resolved"
      },
      {
        "name": "incidentReopened",
        "eventType": "ActivityCompleted",
        "activityType": "incident.reopened"
      },
      {
        "name": "incidentUnacknowledged",
        "eventType": "ActivityCompleted",
        "activityType": "incident.unacknowledged"
      },
      {
        "name": "incidentAnnotated",
        "eventType": "ActivityCompleted",
        "activityType": "incident.annotated"
      }
    ]
  },
  {
    "preset": "pydantic-ai",
    "methods": [
      {
        "name": "userPromptNode",
        "eventType": "ActivityStarted",
        "activityType": "UserPromptNode"
      },
      {
        "name": "modelRequestNode",
        "eventType": "ActivityStarted",
        "activityType": "ModelRequestNode"
      },
      {
        "name": "callToolsNode",
        "eventType": "ActivityCompleted",
        "activityType": "CallToolsNode"
      },
      {
        "name": "end",
        "eventType": "ActivityCompleted",
        "activityType": "End"
      },
      {
        "name": "outputValidator",
        "eventType": "ActivityCompleted",
        "activityType": "output_validator"
      },
      {
        "name": "toolRetry",
        "eventType": "ActivityCompleted",
        "activityType": "tool_retry"
      }
    ]
  },
  {
    "preset": "semantic-kernel",
    "methods": [
      {
        "name": "functionInvocationPre",
        "eventType": "ActivityStarted",
        "activityType": "function_invocation_pre"
      },
      {
        "name": "functionInvocationPost",
        "eventType": "ActivityCompleted",
        "activityType": "function_invocation_post"
      },
      {
        "name": "promptRenderPre",
        "eventType": "ActivityStarted",
        "activityType": "prompt_render_pre"
      },
      {
        "name": "promptRenderPost",
        "eventType": "ActivityCompleted",
        "activityType": "prompt_render_post"
      },
      {
        "name": "autoFunctionInvocationPre",
        "eventType": "ActivityStarted",
        "activityType": "auto_function_invocation_pre"
      },
      {
        "name": "autoFunctionInvocationPost",
        "eventType": "ActivityCompleted",
        "activityType": "auto_function_invocation_post"
      }
    ]
  },
  {
    "preset": "temporal",
    "methods": [
      {
        "name": "activityTaskScheduled",
        "eventType": "ActivityStarted",
        "activityType": "ActivityTaskScheduled"
      },
      {
        "name": "activityTaskStarted",
        "eventType": "ActivityStarted",
        "activityType": "ActivityTaskStarted"
      },
      {
        "name": "activityTaskCompleted",
        "eventType": "ActivityCompleted",
        "activityType": "ActivityTaskCompleted"
      },
      {
        "name": "activityTaskFailed",
        "eventType": "ActivityCompleted",
        "activityType": "ActivityTaskFailed"
      },
      {
        "name": "activityTaskTimedOut",
        "eventType": "ActivityCompleted",
        "activityType": "ActivityTaskTimedOut"
      },
      {
        "name": "activityTaskCanceled",
        "eventType": "ActivityCompleted",
        "activityType": "ActivityTaskCanceled"
      },
      {
        "name": "childWorkflowExecutionInitiated",
        "eventType": "ActivityStarted",
        "activityType": "ChildWorkflowExecutionInitiated"
      },
      {
        "name": "childWorkflowExecutionCompleted",
        "eventType": "ActivityCompleted",
        "activityType": "ChildWorkflowExecutionCompleted"
      },
      {
        "name": "workflowExecutionSignaled",
        "eventType": "SignalReceived",
        "activityType": "WorkflowExecutionSignaled"
      },
      {
        "name": "markerRecorded",
        "eventType": "SignalReceived",
        "activityType": "MarkerRecorded"
      },
      {
        "name": "timerStarted",
        "eventType": "SignalReceived",
        "activityType": "TimerStarted"
      },
      {
        "name": "timerFired",
        "eventType": "SignalReceived",
        "activityType": "TimerFired"
      }
    ]
  },
  {
    "preset": "vercel-ai",
    "methods": [
      {
        "name": "onStepFinish",
        "eventType": "ActivityCompleted",
        "activityType": "onStepFinish"
      },
      {
        "name": "onFinish",
        "eventType": "ActivityCompleted",
        "activityType": "onFinish"
      },
      {
        "name": "onError",
        "eventType": "ActivityCompleted",
        "activityType": "onError"
      },
      {
        "name": "onAbort",
        "eventType": "ActivityCompleted",
        "activityType": "onAbort"
      }
    ]
  }
];
var CANONICAL_EVENT_TYPES = /* @__PURE__ */ new Set(["ActivityCompleted", "ActivityStarted", "SignalReceived", "WorkflowCompleted", "WorkflowFailed", "WorkflowStarted"]);
var CANONICAL_ACTIVITY_TYPES = /* @__PURE__ */ new Set(["AGENT_STEP", "ActivityTaskCanceled", "ActivityTaskCompleted", "ActivityTaskFailed", "ActivityTaskScheduled", "ActivityTaskStarted", "ActivityTaskTimedOut", "AgentAction", "AgentExecutionCompleted", "AgentExecutionStarted", "AgentSpawn", "CHUNKING", "CallToolsNode", "ChildWorkflowExecutionCompleted", "ChildWorkflowExecutionInitiated", "CrewKickoffCompleted", "CrewKickoffStarted", "EMBEDDING", "EXCEPTION", "End", "FUNCTION_CALL", "FileDelete", "FileEdit", "FileRead", "HTTPRequest", "HandoffMessage", "LLM", "LLMCallCompleted", "LLMCallStarted", "LLMCompleted", "MCPToolCall", "MarkerRecorded", "MemoryQueryEvent", "ModelRequestNode", "MultiModalMessage", "Notification", "OperationCompleted", "OperationStarted", "PermissionRequest", "PostToolUse", "PreCompact", "PreSyncHookStarted", "PreSyncHookSucceeded", "PreToolUse", "PromptSubmission", "QUERY", "RERANKING", "RETRIEVE", "ResourceUpdated", "SUB_QUESTION", "SYNTHESIZE", "ShellExecution", "Stop", "StopMessage", "SubagentStart", "SubagentStop", "SyncStatusChanged", "TaskCompleted", "TaskStart", "TaskStarted", "TextMessage", "TimerFired", "TimerStarted", "ToolCallExecutionEvent", "ToolCallRequestEvent", "ToolCompleted", "ToolStarted", "ToolUsageError", "ToolUsageFinished", "ToolUsageStarted", "UserInputRequestedEvent", "UserPromptNode", "UserPromptSubmit", "WorkflowExecutionSignaled", "afterAgentResponse", "afterAgentThought", "afterFileEdit", "afterMCPExecution", "afterShellExecution", "agentStop", "auto_function_invocation_post", "auto_function_invocation_pre", "beforeMCPExecution", "beforeReadFile", "beforeShellExecution", "beforeSubmitPrompt", "checkpoint", "custom_event", "error", "error-trigger", "errorOccurred", "function_invocation_post", "function_invocation_pre", "incident.acknowledged", "incident.annotated", "incident.delegated", "incident.escalated", "incident.priority_updated", "incident.reassigned", "incident.reopened", "incident.resolved", "incident.triggered", "incident.unacknowledged", "interrupt", "node-post-execute", "node-pre-execute", "node_end", "node_start", "onAbort", "onError", "onFinish", "onStepFinish", "on_agent_action", "on_agent_finish", "on_chain_end", "on_chain_start", "on_chat_model_start", "on_execute_callback", "on_failure_callback", "on_llm_end", "on_llm_error", "on_llm_start", "on_retriever_end", "on_retriever_start", "on_retry_callback", "on_skipped_callback", "on_success_callback", "on_tool_end", "on_tool_error", "on_tool_start", "output_validator", "payment_order.approved", "payment_order.begin_processing", "payment_order.failed", "payment_order.reconciled", "payment_reference.created", "postToolUse", "preToolUse", "prompt_render_post", "prompt_render_pre", "sla_miss_callback", "subagentStop", "task_end", "task_start", "tool-call", "tool-result", "tool_retry", "userPromptSubmitted", "workflow-step-finish", "workflow-step-progress", "workflow-step-start"]);
var CANONICAL_ACTIVITY_LABELS = Object.freeze({ "AGENT_STEP": "Agent Step", "ActivityTaskCanceled": "Activity Task Canceled", "ActivityTaskCompleted": "Activity Task Completed", "ActivityTaskFailed": "Activity Task Failed", "ActivityTaskScheduled": "Activity Task Scheduled", "ActivityTaskStarted": "Activity Task Started", "ActivityTaskTimedOut": "Activity Task Timed Out", "AgentAction": "Agent Action", "AgentExecutionCompleted": "Agent Execution Completed", "AgentExecutionStarted": "Agent Execution Started", "AgentSpawn": "Agent Spawn", "CHUNKING": "Chunking", "CallToolsNode": "Call Tools Node", "ChildWorkflowExecutionCompleted": "Child Workflow Execution Completed", "ChildWorkflowExecutionInitiated": "Child Workflow Execution Initiated", "CrewKickoffCompleted": "Crew Kickoff Completed", "CrewKickoffStarted": "Crew Kickoff Started", "EMBEDDING": "Embedding", "EXCEPTION": "Exception", "End": "End", "FUNCTION_CALL": "Function Call", "FileDelete": "File Delete", "FileEdit": "File Edit", "FileRead": "File Read", "HTTPRequest": "HTTP Request", "HandoffMessage": "Handoff Message", "LLM": "LLM", "LLMCallCompleted": "LLM Call Completed", "LLMCallStarted": "LLM Call Started", "LLMCompleted": "LLM Completed", "MCPToolCall": "MCP Tool Call", "MarkerRecorded": "Marker Recorded", "MemoryQueryEvent": "Memory Query", "ModelRequestNode": "Model Request Node", "MultiModalMessage": "Multi-Modal Message", "Notification": "Notification", "OperationCompleted": "Operation Completed", "OperationStarted": "Operation Started", "PermissionRequest": "Permission Request", "PostToolUse": "Post-Tool Use", "PreCompact": "Pre-Compact", "PreSyncHookStarted": "Pre-Sync Hook Started", "PreSyncHookSucceeded": "Pre-Sync Hook Succeeded", "PreToolUse": "Pre-Tool Use", "PromptSubmission": "Prompt Submission", "QUERY": "Query", "RERANKING": "Reranking", "RETRIEVE": "Retrieve", "ResourceUpdated": "Resource Updated", "SUB_QUESTION": "Sub-Question", "SYNTHESIZE": "Synthesize", "ShellExecution": "Shell Execution", "Stop": "Stop", "StopMessage": "Stop Message", "SubagentStart": "Subagent Start", "SubagentStop": "Subagent Stop", "SyncStatusChanged": "Sync Status Changed", "TaskCompleted": "Task Completed", "TaskStart": "Task Start", "TaskStarted": "Task Started", "TextMessage": "Text Message", "TimerFired": "Timer Fired", "TimerStarted": "Timer Started", "ToolCallExecutionEvent": "Tool Call Execution", "ToolCallRequestEvent": "Tool Call Request", "ToolCompleted": "Tool Completed", "ToolStarted": "Tool Started", "ToolUsageError": "Tool Usage Error", "ToolUsageFinished": "Tool Usage Finished", "ToolUsageStarted": "Tool Usage Started", "UserInputRequestedEvent": "User Input Requested", "UserPromptNode": "User Prompt Node", "UserPromptSubmit": "User Prompt Submit", "WorkflowExecutionSignaled": "Workflow Execution Signaled", "afterAgentResponse": "After Agent Response", "afterAgentThought": "After Agent Thought", "afterFileEdit": "After File Edit", "afterMCPExecution": "After MCP Execution", "afterShellExecution": "After Shell Execution", "agentStop": "Agent Stop", "auto_function_invocation_post": "Auto Function Invocation Post", "auto_function_invocation_pre": "Auto Function Invocation Pre", "beforeMCPExecution": "Before MCP Execution", "beforeReadFile": "Before Read File", "beforeShellExecution": "Before Shell Execution", "beforeSubmitPrompt": "Before Submit Prompt", "checkpoint": "Checkpoint", "custom_event": "Custom Event", "error": "Error", "error-trigger": "Error Trigger", "errorOccurred": "Error Occurred", "function_invocation_post": "Function Invocation Post", "function_invocation_pre": "Function Invocation Pre", "incident.acknowledged": "Incident Acknowledged", "incident.annotated": "Incident Annotated", "incident.delegated": "Incident Delegated", "incident.escalated": "Incident Escalated", "incident.priority_updated": "Incident Priority Updated", "incident.reassigned": "Incident Reassigned", "incident.reopened": "Incident Reopened", "incident.resolved": "Incident Resolved", "incident.triggered": "Incident Triggered", "incident.unacknowledged": "Incident Unacknowledged", "interrupt": "Interrupt", "node-post-execute": "Node Post-Execute", "node-pre-execute": "Node Pre-Execute", "node_end": "Node End", "node_start": "Node Start", "onAbort": "Abort", "onError": "Error", "onFinish": "Finish", "onStepFinish": "Step Finish", "on_agent_action": "Agent Action", "on_agent_finish": "Agent Finish", "on_chain_end": "Chain End", "on_chain_start": "Chain Start", "on_chat_model_start": "Chat Model Start", "on_execute_callback": "Execute Callback", "on_failure_callback": "Failure Callback", "on_llm_end": "LLM End", "on_llm_error": "LLM Error", "on_llm_start": "LLM Start", "on_retriever_end": "Retriever End", "on_retriever_start": "Retriever Start", "on_retry_callback": "Retry Callback", "on_skipped_callback": "Skipped Callback", "on_success_callback": "Success Callback", "on_tool_end": "Tool End", "on_tool_error": "Tool Error", "on_tool_start": "Tool Start", "output_validator": "Output Validator", "payment_order.approved": "Payment Order Approved", "payment_order.begin_processing": "Payment Order Begin Processing", "payment_order.failed": "Payment Order Failed", "payment_order.reconciled": "Payment Order Reconciled", "payment_reference.created": "Payment Reference Created", "postToolUse": "Post-Tool Use", "preToolUse": "Pre-Tool Use", "prompt_render_post": "Prompt Render Post", "prompt_render_pre": "Prompt Render Pre", "sla_miss_callback": "SLA Miss Callback", "subagentStop": "Subagent Stop", "task_end": "Task End", "task_start": "Task Start", "tool-call": "Tool Call", "tool-result": "Tool Result", "tool_retry": "Tool Retry", "userPromptSubmitted": "User Prompt Submitted", "workflow-step-finish": "Workflow Step Finish", "workflow-step-progress": "Workflow Step Progress", "workflow-step-start": "Workflow Step Start" });
function randomUUID2() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : r & 3 | 8).toString(16);
  });
}
var SessionAlreadyTerminatedError = class extends Error {
  constructor() {
    super("[govern] session already terminated; create a new govern() scope to continue.");
    this.name = "SessionAlreadyTerminatedError";
  }
};
var BaseGovernedSession = class {
  workflowId;
  runId;
  workflowType;
  taskQueue;
  core;
  approvalPollIntervalMs;
  approvalPollMaxIntervalMs;
  approvalPollBackoffFactor;
  approvalPollJitter;
  approvalMaxWaitMs;
  inlineApproval;
  opened = false;
  finalized = false;
  autoOpenSuppressed;
  inFlight = /* @__PURE__ */ new Set();
  activityStartsMs = /* @__PURE__ */ new Map();
  exitHandlerCleanup = [];
  onPendingApproval;
  onApprovalResolved;
  awaitExternalDecision;
  constructor(config) {
    this.core = config.core;
    this.workflowId = config.workflowId ?? randomUUID2();
    this.runId = config.runId ?? randomUUID2();
    this.workflowType = config.workflowType ?? "governed_agent";
    this.taskQueue = config.taskQueue ?? "generic";
    this.approvalPollIntervalMs = config.approvalPollIntervalMs ?? 500;
    this.approvalPollMaxIntervalMs = config.approvalPollMaxIntervalMs ?? 5e3;
    this.approvalPollBackoffFactor = config.approvalPollBackoffFactor ?? 1.5;
    this.approvalPollJitter = config.approvalPollJitter ?? 0.25;
    this.approvalMaxWaitMs = config.approvalMaxWaitMs ?? 6e4;
    this.inlineApproval = config.inlineApproval === true;
    this.autoOpenSuppressed = config.attached === true;
    this.onPendingApproval = config.onPendingApproval;
    this.onApprovalResolved = config.onApprovalResolved;
    this.awaitExternalDecision = config.awaitExternalDecision;
    if (config.registerExitHandlers !== false) {
      this.installExitHandlers();
    }
  }
  /** True once `begin()` has been called. */
  get isOpen() {
    return this.opened && !this.finalized;
  }
  /** True after a terminal event (Workflow{Completed,Failed}) fired. */
  get isTerminated() {
    return this.finalized;
  }
  /**
   * Fire WorkflowStarted. Idempotent; safe to call multiple times,
   * only the first emits. Public so harness-owned consumers (claude-hooks,
   * cursor-hooks) can drive lifecycle when the workflow spans processes.
   * `govern()` calls this automatically before the body runs;
   * `govern.attach()` does NOT; caller decides when (if ever).
   *
   * Backward-compat alias: `begin()`.
   */
  async workflowStarted() {
    if (this.opened) return;
    this.opened = true;
    await this.emit({ event_type: "WorkflowStarted" });
  }
  /** @deprecated use `workflowStarted()`; same behavior. */
  async begin() {
    return this.workflowStarted();
  }
  /**
   * Fire WorkflowCompleted. Idempotent. Same public/cross-process
   * rationale as `workflowStarted`. `govern()` calls this on the
   * happy-path return from the body; `govern.attach()` does NOT.
   *
   * Backward-compat alias: `complete()`.
   */
  async workflowCompleted() {
    if (this.finalized) return void 0;
    this.finalized = true;
    try {
      return await this.emit({ event_type: "WorkflowCompleted", status: "completed" });
    } finally {
      this.cleanupExitHandlers();
    }
  }
  /** @deprecated use `workflowCompleted()`; same behavior. */
  async complete() {
    return this.workflowCompleted();
  }
  /**
   * Fire WorkflowFailed with an error payload. Idempotent. `govern()`
   * calls this if the body throws or if a process-exit handler fires;
   * `govern.attach()` does NOT; caller invokes explicitly on harness-
   * signaled session failure.
   *
   * Backward-compat alias: `fail()`.
   */
  async workflowFailed(error) {
    if (this.finalized) return void 0;
    this.finalized = true;
    try {
      return await this.emit({
        event_type: "WorkflowFailed",
        status: "failed",
        error: errorInfoFrom(error)
      });
    } finally {
      this.cleanupExitHandlers();
    }
  }
  /** @deprecated use `workflowFailed()`; same behavior. */
  async fail(error) {
    return this.workflowFailed(error);
  }
  /**
   * Public escape for firing arbitrary (eventType, activityType, payload)
   * tuples beyond what the bound preset's typed methods cover. Used by
   * runtime adapters (claude-hooks / cursor-hooks) when one hook event
   * needs to dispatch to multiple activity_types based on internal
   * routing; e.g. Claude's PreToolUse hook fires FileRead, FileEdit,
   * ShellExecution etc. depending on `tool_name`.
   *
   * Mirrors the `custom` preset's free-form `activity()`. Same lifecycle
   * invariants (workflow open, paired Start/Complete, idempotent terminal).
   */
  async activity(eventType, activityType, payload) {
    return this.runActivity(eventType, activityType, payload);
  }
  /**
   * Split-stage activity for callers that must run business logic between
   * the input gate and the output gate (e.g. governed tools that gate the
   * produced artifact). Emits ActivityStarted and returns the gate verdict
   * plus a `complete()` bound to the same activity id, so the pair cannot
   * drift apart. Stopped starts (block/halt) and pending approvals are
   * canonically left unpaired; the caller resolves them via the workflow
   * terminal or approval resume (ActivityCompleted with this activity id).
   */
  async openActivity(activityType, payload) {
    if (this.finalized) throw new SessionAlreadyTerminatedError();
    if (!this.opened && !this.autoOpenSuppressed) await this.begin();
    const activityId = payload.activityId ?? randomUUID2();
    const startTime = payload.startTime ?? Date.now();
    this.activityStartsMs.set(activityId, startTime);
    this.inFlight.add(activityId);
    try {
      const verdict = await this.emitWithSpanHook({
        event_type: "ActivityStarted",
        activity_id: activityId,
        activity_type: activityType,
        activity_input: payload.input,
        start_time: startTime,
        spans: payload.spans
      });
      verdict.activityId = activityId;
      if (verdict.arm !== "allow" && verdict.arm !== "constrain") {
        this.activityStartsMs.delete(activityId);
      }
      return {
        activityId,
        verdict,
        complete: (completionPayload, completionActivityType) => this.runActivity(
          "ActivityCompleted",
          completionActivityType ?? activityType,
          { ...completionPayload, activityId }
        )
      };
    } finally {
      this.inFlight.delete(activityId);
    }
  }
  /**
   * Run one activity through the canonical envelope. Preset classes
   * call this with their fixed (eventType, activityType) tuple; the
   * `custom` preset takes them from the user.
   *
   * Strategy depends on `eventType`:
   *   ActivityStarted   → emit start; pre-stage block → no completion fired.
   *                       Otherwise emit a paired ActivityCompleted.
   *   ActivityCompleted → emit completion only (post-stage observe / gate).
   *   SignalReceived    → fire-and-forget telemetry (no gate).
   */
  async runActivity(eventType, activityType, payload) {
    if (this.finalized) throw new SessionAlreadyTerminatedError();
    if (!this.opened && !this.autoOpenSuppressed) await this.begin();
    const activityId = payload.activityId ?? randomUUID2();
    const startTime = payload.startTime ?? Date.now();
    this.inFlight.add(activityId);
    try {
      if (eventType === "SignalReceived") {
        const signalVerdict = await this.emit({
          event_type: "SignalReceived",
          activity_id: activityId,
          activity_type: activityType,
          activity_input: payload.input,
          signal_name: payload.signalName,
          signal_args: payload.signalArgs,
          spans: payload.spans
        });
        signalVerdict.activityId = activityId;
        return signalVerdict;
      }
      if (eventType === "ActivityStarted") {
        this.activityStartsMs.set(activityId, startTime);
        const startedVerdict = await this.emitWithSpanHook({
          event_type: "ActivityStarted",
          activity_id: activityId,
          activity_type: activityType,
          activity_input: payload.input,
          start_time: startTime,
          spans: payload.spans
        });
        startedVerdict.activityId = activityId;
        if (startedVerdict.arm === "constrain") {
          try {
            await this.emitCompleted(activityId, activityType, payload);
          } catch {
          }
          return startedVerdict;
        }
        if (startedVerdict.arm !== "allow") {
          this.activityStartsMs.delete(activityId);
          if (startedVerdict.arm === "require_approval") {
            const approvalId = startedVerdict.approvalId ?? activityId;
            if (this.onPendingApproval) {
              try {
                await this.onPendingApproval({
                  approvalId,
                  governanceEventId: startedVerdict.governanceEventId,
                  activityId,
                  activityType,
                  expiresAt: startedVerdict.approvalExpiresAt,
                  reason: startedVerdict.reason
                });
              } catch {
              }
            }
            if (this.inlineApproval) {
              return startedVerdict;
            }
            const polled = await this.pollApproval(activityId, activityType, startedVerdict);
            polled.activityId = activityId;
            if (this.onApprovalResolved) {
              try {
                await this.onApprovalResolved({
                  approvalId,
                  activityId,
                  activityType,
                  arm: polled.arm
                });
              } catch {
              }
            }
            return polled;
          }
          return startedVerdict;
        }
        return this.emitCompleted(activityId, activityType, payload);
      }
      return this.emitCompleted(activityId, activityType, payload);
    } finally {
      this.inFlight.delete(activityId);
    }
  }
  async emitCompleted(activityId, activityType, payload) {
    const startTime = payload.startTime ?? this.activityStartsMs.get(activityId);
    const endTime = payload.endTime ?? Date.now();
    const durationMs = payload.durationMs ?? (typeof startTime === "number" ? Math.max(0, endTime - startTime) : void 0);
    const completedVerdict = await this.emitWithSpanHook({
      event_type: "ActivityCompleted",
      activity_id: activityId,
      activity_type: activityType,
      status: activityCompletionStatus(activityType),
      activity_input: payload.input,
      activity_output: payload.output,
      start_time: startTime,
      end_time: endTime,
      duration_ms: durationMs,
      spans: payload.spans
    });
    this.activityStartsMs.delete(activityId);
    completedVerdict.activityId = activityId;
    if (completedVerdict.arm === "require_approval") {
      const approvalId = completedVerdict.approvalId ?? activityId;
      if (this.onPendingApproval) {
        try {
          await this.onPendingApproval({
            approvalId,
            governanceEventId: completedVerdict.governanceEventId,
            activityId,
            activityType,
            expiresAt: completedVerdict.approvalExpiresAt,
            reason: completedVerdict.reason
          });
        } catch {
        }
      }
      if (this.inlineApproval) {
        return completedVerdict;
      }
      const polled = await this.pollApproval(activityId, activityType, completedVerdict);
      polled.activityId = activityId;
      if (this.onApprovalResolved) {
        try {
          await this.onApprovalResolved({ approvalId, activityId, activityType, arm: polled.arm });
        } catch {
        }
      }
      return polled;
    }
    return completedVerdict;
  }
  async emitWithSpanHook(event) {
    const hasActivitySpans = (event.event_type === "ActivityStarted" || event.event_type === "ActivityCompleted") && Array.isArray(event.spans) && event.spans.some(isPersistableHookSpan);
    if (!hasActivitySpans) return this.emit(event);
    const baseVerdict = await this.emit({ ...event, spans: void 0 });
    if (baseVerdict.arm !== "allow" && baseVerdict.arm !== "constrain") {
      return baseVerdict;
    }
    const hookVerdict = await this.emit({
      ...event,
      hook_trigger: true
    });
    return stricterVerdict(baseVerdict, hookVerdict);
  }
  async emit(event) {
    const payload = {
      ...event,
      source: "workflow-telemetry",
      workflow_id: this.workflowId,
      run_id: this.runId,
      workflow_type: this.workflowType,
      task_queue: this.taskQueue,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      span_count: event.spans?.length
    };
    const response = await this.core.evaluate(payload);
    return mapVerdict(response);
  }
  async pollApproval(activityId, activityType, initial) {
    const approvalId = initial.approvalId ?? activityId;
    const cfgDeadline = Date.now() + this.approvalMaxWaitMs;
    const srvDeadline = initial.approvalExpiresAt ? new Date(initial.approvalExpiresAt).getTime() : Number.POSITIVE_INFINITY;
    const deadline = Math.min(cfgDeadline, srvDeadline);
    let externalSignaled = false;
    const externalDecision = this.awaitExternalDecision ? this.awaitExternalDecision({
      approvalId,
      governanceEventId: initial.governanceEventId,
      activityId,
      activityType,
      expiresAt: initial.approvalExpiresAt
    }).then(
      (d) => {
        externalSignaled = d === "approve" || d === "reject";
        return d;
      },
      () => void 0
    ) : void 0;
    let nextInterval = this.approvalPollIntervalMs;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const jittered = applyJitter(nextInterval, this.approvalPollJitter);
      const sleepMs = Math.max(0, Math.min(jittered, remaining));
      if (externalDecision) {
        await Promise.race([sleep(sleepMs), externalDecision]);
      } else {
        await sleep(sleepMs);
      }
      const status = await this.core.pollApproval({
        workflow_id: this.workflowId,
        run_id: this.runId,
        activity_id: activityId
      });
      if (status.action && status.action !== "require_approval") {
        return {
          arm: normalizeArm(status.action),
          approvalId: initial.approvalId,
          governanceEventId: initial.governanceEventId,
          approvalExpiresAt: status.approval_expiration_time,
          reason: status.reason,
          riskScore: initial.riskScore,
          trustTier: initial.trustTier
        };
      }
      nextInterval = externalSignaled ? this.approvalPollIntervalMs : Math.min(
        nextInterval * this.approvalPollBackoffFactor,
        this.approvalPollMaxIntervalMs
      );
    }
    return initial;
  }
  /**
   * Best-effort handlers for process death. SIGINT/SIGTERM/uncaught
   * exceptions get a brief async window to fire WorkflowFailed; `exit`
   * is synchronous-only so we just log a warning. Multiple sessions in
   * the same process each register their own handlers; cleanup on
   * normal completion removes them.
   */
  installExitHandlers() {
    if (typeof process === "undefined" || !process.on) return;
    const failOnSignal = (reason) => async () => {
      if (this.finalized) return;
      try {
        await Promise.race([
          this.fail(new Error(`process_exit:${reason}`)),
          sleep(2e3)
        ]);
      } catch {
      }
    };
    const sigint = failOnSignal("SIGINT");
    const sigterm = failOnSignal("SIGTERM");
    const beforeExit = failOnSignal("beforeExit");
    const uncaught = (err) => {
      void failOnSignal("uncaughtException")();
    };
    const unhandled = (err) => {
      void failOnSignal("unhandledRejection")();
    };
    process.on("SIGINT", sigint);
    process.on("SIGTERM", sigterm);
    process.on("beforeExit", beforeExit);
    process.on("uncaughtException", uncaught);
    process.on("unhandledRejection", unhandled);
    this.exitHandlerCleanup.push(() => {
      process.removeListener("SIGINT", sigint);
      process.removeListener("SIGTERM", sigterm);
      process.removeListener("beforeExit", beforeExit);
      process.removeListener("uncaughtException", uncaught);
      process.removeListener("unhandledRejection", unhandled);
    });
  }
  cleanupExitHandlers() {
    for (const fn of this.exitHandlerCleanup) {
      try {
        fn();
      } catch {
      }
    }
    this.exitHandlerCleanup.length = 0;
  }
};
function activityCompletionStatus(activityType) {
  return /(error|fail|failed|failure|timeout|timedout|cancel|abort)/i.test(activityType) ? "failed" : "completed";
}
function toolActivityTypeFromPayload(payload) {
  const direct = namedToolFromRecord(payload);
  if (direct) return direct;
  for (const item of payload.input ?? []) {
    const name = namedToolFromRecord(item);
    if (name) return name;
  }
  return "ToolCall";
}
function namedToolFromRecord(value) {
  if (!value || typeof value !== "object") return void 0;
  const record = value;
  const direct = firstNonEmptyString(
    record.toolName,
    record.tool_name,
    record.tool,
    record.name
  );
  if (direct) return direct;
  return namedToolFromRecord(record.toolCall) ?? namedToolFromRecord(record.tool_call) ?? namedToolFromRecord(record.call) ?? namedToolFromRecord(record.args);
}
function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return void 0;
}
var AirflowSession = class extends BaseGovernedSession {
  async onExecuteCallback(payload) {
    return this.runActivity("ActivityStarted", "on_execute_callback", payload);
  }
  async onSuccessCallback(payload) {
    return this.runActivity("ActivityCompleted", "on_success_callback", payload);
  }
  async onFailureCallback(payload) {
    return this.runActivity("ActivityCompleted", "on_failure_callback", payload);
  }
  async onRetryCallback(payload) {
    return this.runActivity("ActivityCompleted", "on_retry_callback", payload);
  }
  async slaMissCallback(payload) {
    return this.runActivity("ActivityCompleted", "sla_miss_callback", payload);
  }
  async onSkippedCallback(payload) {
    return this.runActivity("ActivityCompleted", "on_skipped_callback", payload);
  }
};
var ArgocdSession = class extends BaseGovernedSession {
  async operationStarted(payload) {
    return this.runActivity("ActivityStarted", "OperationStarted", payload);
  }
  async operationCompleted(payload) {
    return this.runActivity("ActivityCompleted", "OperationCompleted", payload);
  }
  async resourceUpdated(payload) {
    return this.runActivity("ActivityCompleted", "ResourceUpdated", payload);
  }
  async preSyncHookStarted(payload) {
    return this.runActivity("ActivityStarted", "PreSyncHookStarted", payload);
  }
  async preSyncHookSucceeded(payload) {
    return this.runActivity("ActivityCompleted", "PreSyncHookSucceeded", payload);
  }
  async syncStatusChanged(payload) {
    return this.runActivity("ActivityCompleted", "SyncStatusChanged", payload);
  }
};
var AutogenSession = class extends BaseGovernedSession {
  async textMessage(payload) {
    return this.runActivity("ActivityCompleted", "TextMessage", payload);
  }
  async multiModalMessage(payload) {
    return this.runActivity("ActivityCompleted", "MultiModalMessage", payload);
  }
  async toolCallRequestEvent(payload) {
    return this.runActivity("ActivityStarted", "ToolCallRequestEvent", payload);
  }
  async toolCallExecutionEvent(payload) {
    return this.runActivity("ActivityCompleted", "ToolCallExecutionEvent", payload);
  }
  async memoryQueryEvent(payload) {
    return this.runActivity("ActivityCompleted", "MemoryQueryEvent", payload);
  }
  async userInputRequestedEvent(payload) {
    return this.runActivity("SignalReceived", "UserInputRequestedEvent", payload);
  }
  async handoffMessage(payload) {
    return this.runActivity("SignalReceived", "HandoffMessage", payload);
  }
  async stopMessage(payload) {
    return this.runActivity("ActivityCompleted", "StopMessage", payload);
  }
};
var ClaudeCodeSession = class extends BaseGovernedSession {
  async preToolUse(payload) {
    return this.runActivity("ActivityStarted", "PreToolUse", payload);
  }
  async postToolUse(payload) {
    return this.runActivity("ActivityCompleted", "PostToolUse", payload);
  }
  async userPromptSubmit(payload) {
    return this.runActivity("ActivityStarted", "UserPromptSubmit", payload);
  }
  async permissionRequest(payload) {
    return this.runActivity("ActivityStarted", "PermissionRequest", payload);
  }
  async preCompact(payload) {
    return this.runActivity("ActivityStarted", "PreCompact", payload);
  }
  async subagentStop(payload) {
    return this.runActivity("ActivityStarted", "SubagentStop", payload);
  }
  async notification(payload) {
    return this.runActivity("ActivityCompleted", "Notification", payload);
  }
  async stop(payload) {
    return this.runActivity("ActivityCompleted", "Stop", payload);
  }
};
var ClineSession = class extends BaseGovernedSession {
  async preToolUse(payload) {
    return this.runActivity("ActivityStarted", "PreToolUse", payload);
  }
  async postToolUse(payload) {
    return this.runActivity("ActivityCompleted", "PostToolUse", payload);
  }
  async userPromptSubmit(payload) {
    return this.runActivity("ActivityStarted", "UserPromptSubmit", payload);
  }
  async taskStart(payload) {
    return this.runActivity("ActivityStarted", "TaskStart", payload);
  }
};
var CodexSession = class extends BaseGovernedSession {
  async userPromptSubmit(payload) {
    return this.runActivity("ActivityStarted", "UserPromptSubmit", payload);
  }
  async preToolUse(payload) {
    return this.runActivity("ActivityStarted", "PreToolUse", payload);
  }
  async permissionRequest(payload) {
    return this.runActivity("ActivityStarted", "PermissionRequest", payload);
  }
  async postToolUse(payload) {
    return this.runActivity("ActivityCompleted", "PostToolUse", payload);
  }
  async stop(payload) {
    return this.runActivity("ActivityCompleted", "Stop", payload);
  }
};
var CopilotSession = class extends BaseGovernedSession {
  async userPromptSubmitted(payload) {
    return this.runActivity("ActivityStarted", "userPromptSubmitted", payload);
  }
  async preToolUse(payload) {
    return this.runActivity("ActivityStarted", "preToolUse", payload);
  }
  async postToolUse(payload) {
    return this.runActivity("ActivityCompleted", "postToolUse", payload);
  }
  async agentStop(payload) {
    return this.runActivity("ActivityCompleted", "agentStop", payload);
  }
  async subagentStop(payload) {
    return this.runActivity("ActivityCompleted", "subagentStop", payload);
  }
  async errorOccurred(payload) {
    return this.runActivity("ActivityCompleted", "errorOccurred", payload);
  }
};
var CrewaiSession = class extends BaseGovernedSession {
  async crewKickoffStarted(payload) {
    return this.runActivity("ActivityStarted", "CrewKickoffStarted", payload);
  }
  async crewKickoffCompleted(payload) {
    return this.runActivity("ActivityCompleted", "CrewKickoffCompleted", payload);
  }
  async agentExecutionStarted(payload) {
    return this.runActivity("ActivityStarted", "AgentExecutionStarted", payload);
  }
  async agentExecutionCompleted(payload) {
    return this.runActivity("ActivityCompleted", "AgentExecutionCompleted", payload);
  }
  async taskStarted(payload) {
    return this.runActivity("ActivityStarted", "TaskStarted", payload);
  }
  async taskCompleted(payload) {
    return this.runActivity("ActivityCompleted", "TaskCompleted", payload);
  }
  async toolUsageStarted(payload) {
    return this.runActivity("ActivityStarted", "ToolUsageStarted", payload);
  }
  async toolUsageFinished(payload) {
    return this.runActivity("ActivityCompleted", "ToolUsageFinished", payload);
  }
  async toolUsageError(payload) {
    return this.runActivity("ActivityCompleted", "ToolUsageError", payload);
  }
  async llmCallStarted(payload) {
    return this.runActivity("ActivityStarted", "LLMCallStarted", payload);
  }
  async llmCallCompleted(payload) {
    return this.runActivity("ActivityCompleted", "LLMCallCompleted", payload);
  }
};
var CursorSession = class extends BaseGovernedSession {
  async beforeSubmitPrompt(payload) {
    return this.runActivity("ActivityStarted", "beforeSubmitPrompt", payload);
  }
  async preToolUse(payload) {
    return this.runActivity("ActivityStarted", "preToolUse", payload);
  }
  async postToolUse(payload) {
    return this.runActivity("ActivityCompleted", "postToolUse", payload);
  }
  async beforeShellExecution(payload) {
    return this.runActivity("ActivityStarted", "beforeShellExecution", payload);
  }
  async afterShellExecution(payload) {
    return this.runActivity("ActivityCompleted", "afterShellExecution", payload);
  }
  async beforeMCPExecution(payload) {
    return this.runActivity("ActivityStarted", "beforeMCPExecution", payload);
  }
  async afterMCPExecution(payload) {
    return this.runActivity("ActivityCompleted", "afterMCPExecution", payload);
  }
  async beforeReadFile(payload) {
    return this.runActivity("ActivityStarted", "beforeReadFile", payload);
  }
  async afterFileEdit(payload) {
    return this.runActivity("ActivityCompleted", "afterFileEdit", payload);
  }
  async afterAgentResponse(payload) {
    return this.runActivity("ActivityCompleted", "afterAgentResponse", payload);
  }
  async afterAgentThought(payload) {
    return this.runActivity("ActivityCompleted", "afterAgentThought", payload);
  }
};
var CustomSession = class extends BaseGovernedSession {
  /**
   * Run an arbitrary activity. The runtime stamps:
   *   stage="pre"  → event_type=ActivityStarted
   *   stage="post" → event_type=ActivityCompleted
   */
  async activity(activityType, stage, payload) {
    const eventType = stage === "pre" ? "ActivityStarted" : "ActivityCompleted";
    return this.runActivity(eventType, activityType, payload);
  }
};
var DefaultSession = class extends BaseGovernedSession {
  async prompt(payload) {
    return this.runActivity("ActivityStarted", "PromptSubmission", payload);
  }
  async llm(payload) {
    return this.runActivity("ActivityCompleted", "LLMCompleted", payload);
  }
  async tool(payload) {
    return this.runActivity("ActivityStarted", "ToolStarted", payload);
  }
  async toolCompleted(payload) {
    return this.runActivity("ActivityCompleted", "ToolCompleted", payload);
  }
  async read(payload) {
    return this.runActivity("ActivityStarted", "FileRead", payload);
  }
  async write(payload) {
    return this.runActivity("ActivityStarted", "FileEdit", payload);
  }
  async fileDelete(payload) {
    return this.runActivity("ActivityStarted", "FileDelete", payload);
  }
  async shell(payload) {
    return this.runActivity("ActivityStarted", "ShellExecution", payload);
  }
  async httpRequest(payload) {
    return this.runActivity("ActivityStarted", "HTTPRequest", payload);
  }
  async mcpToolCall(payload) {
    return this.runActivity("ActivityStarted", "MCPToolCall", payload);
  }
  async agentSpawn(payload) {
    return this.runActivity("ActivityStarted", "AgentSpawn", payload);
  }
};
var LangchainSession = class extends BaseGovernedSession {
  async onLlmStart(payload) {
    return this.runActivity("ActivityStarted", "on_llm_start", payload);
  }
  async onLlmEnd(payload) {
    return this.runActivity("ActivityCompleted", "on_llm_end", payload);
  }
  async onLlmError(payload) {
    return this.runActivity("ActivityCompleted", "on_llm_error", payload);
  }
  async onChatModelStart(payload) {
    return this.runActivity("ActivityStarted", "on_chat_model_start", payload);
  }
  async onToolStart(payload) {
    return this.runActivity("ActivityStarted", toolActivityTypeFromPayload(payload), payload);
  }
  async onToolEnd(payload) {
    return this.runActivity("ActivityCompleted", toolActivityTypeFromPayload(payload), payload);
  }
  async onToolError(payload) {
    return this.runActivity("ActivityCompleted", "on_tool_error", payload);
  }
  async onChainStart(payload) {
    return this.runActivity("ActivityStarted", "on_chain_start", payload);
  }
  async onChainEnd(payload) {
    return this.runActivity("ActivityCompleted", "on_chain_end", payload);
  }
  async onAgentAction(payload) {
    return this.runActivity("ActivityCompleted", "on_agent_action", payload);
  }
  async onAgentFinish(payload) {
    return this.runActivity("ActivityCompleted", "on_agent_finish", payload);
  }
  async onRetrieverStart(payload) {
    return this.runActivity("ActivityStarted", "on_retriever_start", payload);
  }
  async onRetrieverEnd(payload) {
    return this.runActivity("ActivityCompleted", "on_retriever_end", payload);
  }
};
var LanggraphSession = class extends BaseGovernedSession {
  async nodeStart(payload) {
    return this.runActivity("ActivityStarted", "node_start", payload);
  }
  async nodeEnd(payload) {
    return this.runActivity("ActivityCompleted", "node_end", payload);
  }
  async interrupt(payload) {
    return this.runActivity("SignalReceived", "interrupt", payload);
  }
  async checkpoint(payload) {
    return this.runActivity("SignalReceived", "checkpoint", payload);
  }
  async taskStart(payload) {
    return this.runActivity("ActivityStarted", "task_start", payload);
  }
  async taskEnd(payload) {
    return this.runActivity("ActivityCompleted", "task_end", payload);
  }
  async customEvent(payload) {
    return this.runActivity("SignalReceived", "custom_event", payload);
  }
};
var LlamaindexSession = class extends BaseGovernedSession {
  async chunking(payload) {
    return this.runActivity("ActivityStarted", "CHUNKING", payload);
  }
  async llm(payload) {
    return this.runActivity("ActivityCompleted", "LLM", payload);
  }
  async query(payload) {
    return this.runActivity("ActivityStarted", "QUERY", payload);
  }
  async retrieve(payload) {
    return this.runActivity("ActivityStarted", "RETRIEVE", payload);
  }
  async synthesize(payload) {
    return this.runActivity("ActivityCompleted", "SYNTHESIZE", payload);
  }
  async embedding(payload) {
    return this.runActivity("ActivityStarted", "EMBEDDING", payload);
  }
  async functionCall(payload) {
    return this.runActivity("ActivityStarted", "FUNCTION_CALL", payload);
  }
  async agentStep(payload) {
    return this.runActivity("ActivityCompleted", "AGENT_STEP", payload);
  }
  async reranking(payload) {
    return this.runActivity("ActivityCompleted", "RERANKING", payload);
  }
  async subQuestion(payload) {
    return this.runActivity("ActivityStarted", "SUB_QUESTION", payload);
  }
  async exception(payload) {
    return this.runActivity("ActivityCompleted", "EXCEPTION", payload);
  }
};
var MastraSession = class extends BaseGovernedSession {
  async workflowStepStart(payload) {
    return this.runActivity("ActivityStarted", "workflow-step-start", payload);
  }
  async workflowStepFinish(payload) {
    return this.runActivity("ActivityCompleted", "workflow-step-finish", payload);
  }
  async workflowStepProgress(payload) {
    return this.runActivity("ActivityCompleted", "workflow-step-progress", payload);
  }
  async toolCall(payload) {
    return this.runActivity("ActivityStarted", "tool-call", payload);
  }
  async toolResult(payload) {
    return this.runActivity("ActivityCompleted", "tool-result", payload);
  }
  async error(payload) {
    return this.runActivity("ActivityCompleted", "error", payload);
  }
};
var ModernTreasurySession = class extends BaseGovernedSession {
  async paymentOrderApproved(payload) {
    return this.runActivity("ActivityStarted", "payment_order.approved", payload);
  }
  async paymentOrderBeginProcessing(payload) {
    return this.runActivity("ActivityStarted", "payment_order.begin_processing", payload);
  }
  async paymentOrderFailed(payload) {
    return this.runActivity("ActivityCompleted", "payment_order.failed", payload);
  }
  async paymentOrderReconciled(payload) {
    return this.runActivity("ActivityCompleted", "payment_order.reconciled", payload);
  }
  async paymentReferenceCreated(payload) {
    return this.runActivity("ActivityCompleted", "payment_reference.created", payload);
  }
};
var N8nSession = class extends BaseGovernedSession {
  async nodePreExecute(payload) {
    return this.runActivity("ActivityStarted", "node-pre-execute", payload);
  }
  async nodePostExecute(payload) {
    return this.runActivity("ActivityCompleted", "node-post-execute", payload);
  }
  async errorTrigger(payload) {
    return this.runActivity("ActivityCompleted", "error-trigger", payload);
  }
};
var PagerdutySession = class extends BaseGovernedSession {
  async incidentTriggered(payload) {
    return this.runActivity("ActivityStarted", "incident.triggered", payload);
  }
  async incidentAcknowledged(payload) {
    return this.runActivity("ActivityCompleted", "incident.acknowledged", payload);
  }
  async incidentEscalated(payload) {
    return this.runActivity("ActivityCompleted", "incident.escalated", payload);
  }
  async incidentReassigned(payload) {
    return this.runActivity("ActivityCompleted", "incident.reassigned", payload);
  }
  async incidentDelegated(payload) {
    return this.runActivity("ActivityCompleted", "incident.delegated", payload);
  }
  async incidentPriorityUpdated(payload) {
    return this.runActivity("ActivityCompleted", "incident.priority_updated", payload);
  }
  async incidentResolved(payload) {
    return this.runActivity("ActivityCompleted", "incident.resolved", payload);
  }
  async incidentReopened(payload) {
    return this.runActivity("ActivityCompleted", "incident.reopened", payload);
  }
  async incidentUnacknowledged(payload) {
    return this.runActivity("ActivityCompleted", "incident.unacknowledged", payload);
  }
  async incidentAnnotated(payload) {
    return this.runActivity("ActivityCompleted", "incident.annotated", payload);
  }
};
var PydanticAiSession = class extends BaseGovernedSession {
  async userPromptNode(payload) {
    return this.runActivity("ActivityStarted", "UserPromptNode", payload);
  }
  async modelRequestNode(payload) {
    return this.runActivity("ActivityStarted", "ModelRequestNode", payload);
  }
  async callToolsNode(payload) {
    return this.runActivity("ActivityCompleted", "CallToolsNode", payload);
  }
  async end(payload) {
    return this.runActivity("ActivityCompleted", "End", payload);
  }
  async outputValidator(payload) {
    return this.runActivity("ActivityCompleted", "output_validator", payload);
  }
  async toolRetry(payload) {
    return this.runActivity("ActivityCompleted", "tool_retry", payload);
  }
};
var SemanticKernelSession = class extends BaseGovernedSession {
  async functionInvocationPre(payload) {
    return this.runActivity("ActivityStarted", "function_invocation_pre", payload);
  }
  async functionInvocationPost(payload) {
    return this.runActivity("ActivityCompleted", "function_invocation_post", payload);
  }
  async promptRenderPre(payload) {
    return this.runActivity("ActivityStarted", "prompt_render_pre", payload);
  }
  async promptRenderPost(payload) {
    return this.runActivity("ActivityCompleted", "prompt_render_post", payload);
  }
  async autoFunctionInvocationPre(payload) {
    return this.runActivity("ActivityStarted", "auto_function_invocation_pre", payload);
  }
  async autoFunctionInvocationPost(payload) {
    return this.runActivity("ActivityCompleted", "auto_function_invocation_post", payload);
  }
};
var TemporalSession = class extends BaseGovernedSession {
  async activityTaskScheduled(payload) {
    return this.runActivity("ActivityStarted", "ActivityTaskScheduled", payload);
  }
  async activityTaskStarted(payload) {
    return this.runActivity("ActivityStarted", "ActivityTaskStarted", payload);
  }
  async activityTaskCompleted(payload) {
    return this.runActivity("ActivityCompleted", "ActivityTaskCompleted", payload);
  }
  async activityTaskFailed(payload) {
    return this.runActivity("ActivityCompleted", "ActivityTaskFailed", payload);
  }
  async activityTaskTimedOut(payload) {
    return this.runActivity("ActivityCompleted", "ActivityTaskTimedOut", payload);
  }
  async activityTaskCanceled(payload) {
    return this.runActivity("ActivityCompleted", "ActivityTaskCanceled", payload);
  }
  async childWorkflowExecutionInitiated(payload) {
    return this.runActivity("ActivityStarted", "ChildWorkflowExecutionInitiated", payload);
  }
  async childWorkflowExecutionCompleted(payload) {
    return this.runActivity("ActivityCompleted", "ChildWorkflowExecutionCompleted", payload);
  }
  async workflowExecutionSignaled(payload) {
    return this.runActivity("SignalReceived", "WorkflowExecutionSignaled", payload);
  }
  async markerRecorded(payload) {
    return this.runActivity("SignalReceived", "MarkerRecorded", payload);
  }
  async timerStarted(payload) {
    return this.runActivity("SignalReceived", "TimerStarted", payload);
  }
  async timerFired(payload) {
    return this.runActivity("SignalReceived", "TimerFired", payload);
  }
};
var VercelAiSession = class extends BaseGovernedSession {
  async onStepFinish(payload) {
    return this.runActivity("ActivityCompleted", "onStepFinish", payload);
  }
  async onFinish(payload) {
    return this.runActivity("ActivityCompleted", "onFinish", payload);
  }
  async onError(payload) {
    return this.runActivity("ActivityCompleted", "onError", payload);
  }
  async onAbort(payload) {
    return this.runActivity("ActivityCompleted", "onAbort", payload);
  }
};
var presets = {
  airflow: AirflowSession,
  argocd: ArgocdSession,
  autogen: AutogenSession,
  claudeCode: ClaudeCodeSession,
  cline: ClineSession,
  codex: CodexSession,
  copilot: CopilotSession,
  crewai: CrewaiSession,
  cursor: CursorSession,
  custom: CustomSession,
  default: DefaultSession,
  langchain: LangchainSession,
  langgraph: LanggraphSession,
  llamaindex: LlamaindexSession,
  mastra: MastraSession,
  modernTreasury: ModernTreasurySession,
  n8n: N8nSession,
  pagerduty: PagerdutySession,
  pydanticAi: PydanticAiSession,
  semanticKernel: SemanticKernelSession,
  temporal: TemporalSession,
  vercelAi: VercelAiSession
};
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
function mapVerdict(response) {
  return {
    arm: normalizeArm(response.verdict ?? response.action ?? "allow"),
    approvalId: response.approval_id,
    // Cross-reference key for matching this verdict against the
    // backend's persisted Approval row (whose `event_id` field equals
    // the response's `governance_event_id`). The backend currently
    // omits `approval_id` from /governance/evaluate responses, so this
    // is the one stable identifier consumers can use to dedup against
    // the dashboard's pending-approvals list.
    governanceEventId: response.governance_event_id,
    approvalExpiresAt: response.approval_expiration_time,
    reason: response.reason,
    riskScore: response.risk_score ?? 0,
    trustTier: response.trust_tier ?? void 0,
    guardrailsResult: mapGuardrailsResult(response.guardrails_result),
    ageResult: response.age_result
  };
}
function mapGuardrailsResult(raw) {
  if (!raw) return void 0;
  return {
    inputType: raw.input_type ?? "activity_input",
    redactedInput: raw.redacted_input,
    validationPassed: raw.validation_passed !== false,
    reasons: (raw.reasons ?? []).map((r) => ({
      type: String(r.type ?? ""),
      field: r.field,
      reason: String(r.reason ?? "")
    })),
    fieldResults: (raw.results ?? []).flatMap((g) => (g.results ?? []).map((fr) => ({
      field: String(fr.field ?? ""),
      status: normalizeGuardrailFieldStatus(fr.status),
      reason: fr.reason
    })))
  };
}
function normalizeGuardrailFieldStatus(value) {
  switch (value) {
    case "allowed":
    case "allow":
      return "allowed";
    case "blocked":
    case "block":
      return "blocked";
    case "redacted":
    case "transformed":
      return "redacted";
    case "skipped":
    default:
      return "skipped";
  }
}
function normalizeArm(value) {
  switch (value) {
    case "allow":
    case "continue":
      return "allow";
    case "constrain":
      return "constrain";
    case "require_approval":
    case "require-approval":
      return "require_approval";
    case "block":
      return "block";
    case "halt":
    case "stop":
      return "halt";
    default:
      return "allow";
  }
}
function verdictRank(arm) {
  switch (arm) {
    case "halt":
      return 4;
    case "block":
      return 3;
    case "require_approval":
      return 2;
    case "constrain":
      return 1;
    case "allow":
    default:
      return 0;
  }
}
function stricterVerdict(base, hook) {
  return verdictRank(hook.arm) >= verdictRank(base.arm) ? hook : base;
}
function isPersistableHookSpan(span) {
  if (!span || typeof span !== "object") return false;
  const record = span;
  if (typeof record.semantic_type === "string" && record.semantic_type !== "") {
    return true;
  }
  const attributes = record.attributes && typeof record.attributes === "object" ? record.attributes : {};
  return typeof attributes["openbox.tool.name"] === "string" || typeof attributes["tool.name"] === "string" || typeof attributes.tool_name === "string" || typeof attributes["gen_ai.system"] === "string";
}
function errorInfoFrom(value) {
  if (value == null) return void 0;
  if (value instanceof Error) {
    return { type: value.name || "Error", message: value.message };
  }
  return { type: typeof value, message: String(value) };
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function applyJitter(baseMs, fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  if (f === 0) return baseMs;
  const noise = (Math.random() * 2 - 1) * f;
  return baseMs * (1 + noise);
}

// ts/src/core-client/redaction.ts
function deepUpdateObject(target, source) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new Error("deepUpdateObject: target must be a plain object");
  }
  const t = target;
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === void 0) {
      t[key] = value;
      continue;
    }
    const existing = t[key];
    const bothArrays = Array.isArray(value) && Array.isArray(existing);
    if (bothArrays) {
      mergeArray(existing, value);
      continue;
    }
    const bothObjects = typeof value === "object" && !Array.isArray(value) && typeof existing === "object" && !Array.isArray(existing) && existing !== null;
    if (bothObjects) {
      deepUpdateObject(existing, value);
    } else {
      t[key] = value;
    }
  }
}
function mergeArray(target, source) {
  for (let i = 0; i < source.length; i++) {
    const value = source[i];
    const existing = target[i];
    if (typeof value === "object" && !Array.isArray(value) && value !== null && typeof existing === "object" && !Array.isArray(existing) && existing !== null) {
      deepUpdateObject(existing, value);
    } else {
      target[i] = value;
    }
  }
}
function applyInputRedaction(originalData, guardrails) {
  if (!guardrails || guardrails.inputType !== "activity_input") return originalData;
  let redacted = unwrapActivityInputRedaction(guardrails.redactedInput);
  if (redacted && typeof redacted === "object" && !Array.isArray(redacted)) {
    redacted = [redacted];
  }
  if (!Array.isArray(redacted)) return originalData;
  if (typeof originalData !== "object" || originalData === null) {
    return redacted.length > 0 ? redacted[0] : redacted;
  }
  if (!Array.isArray(originalData)) {
    if (redacted[0] && typeof redacted[0] === "object" && !Array.isArray(redacted[0])) {
      const out2 = cloneValue(originalData);
      deepUpdateObject(out2, redacted[0]);
      return out2;
    }
    return redacted[0];
  }
  const out = cloneValue(originalData);
  for (let i = 0; i < redacted.length && i < out.length; i++) {
    const r = redacted[i];
    const o = out[i];
    if (typeof o === "object" && !Array.isArray(o) && o !== null && typeof r === "object" && !Array.isArray(r) && r !== null) {
      deepUpdateObject(o, r);
    } else {
      out[i] = r;
    }
  }
  return out;
}
function applyOutputRedaction(originalOutput, guardrails) {
  if (!guardrails || guardrails.inputType !== "activity_output") return originalOutput;
  const redacted = unwrapActivityOutputRedaction(guardrails.redactedInput, originalOutput);
  if (redacted === null || redacted === void 0) return originalOutput;
  if (typeof originalOutput === "object" && !Array.isArray(originalOutput) && originalOutput !== null && typeof redacted === "object" && !Array.isArray(redacted)) {
    const out = cloneValue(originalOutput);
    deepUpdateObject(out, redacted);
    return out;
  }
  return redacted;
}
function unwrapActivityInputRedaction(redactedInput) {
  if (!isPlainObject(redactedInput)) return redactedInput;
  if (Array.isArray(redactedInput.input)) return redactedInput.input;
  if (Array.isArray(redactedInput.activity_input)) return redactedInput.activity_input;
  if (Array.isArray(redactedInput.activityInput)) return redactedInput.activityInput;
  return redactedInput;
}
function unwrapActivityOutputRedaction(redactedInput, originalOutput) {
  if (!isPlainObject(redactedInput) || hasOwnKey(originalOutput, "output")) {
    return redactedInput;
  }
  const redacted = redactedInput;
  if (Object.prototype.hasOwnProperty.call(redacted, "output")) return redacted.output;
  if (Object.prototype.hasOwnProperty.call(redacted, "activity_output")) return redacted.activity_output;
  if (Object.prototype.hasOwnProperty.call(redacted, "activityOutput")) return redacted.activityOutput;
  return redactedInput;
}
function hasGuardrailRedaction(guardrails) {
  return Boolean(
    guardrails?.redactedInput !== null && guardrails?.redactedInput !== void 0 && guardrails.fieldResults?.some((field) => isRedactedStatus(field.status))
  );
}
function summarizeGuardrailRedaction(guardrails, fallback = "OpenBox redacted sensitive fields.") {
  const fields = guardrails?.fieldResults?.filter((field) => isRedactedStatus(field.status)).map((field) => field.field).filter(Boolean);
  const uniqueFields = Array.from(new Set(fields));
  if (!uniqueFields.length) return fallback;
  return `OpenBox redacted ${uniqueFields.slice(0, 4).join(", ")}${uniqueFields.length > 4 ? ` and ${uniqueFields.length - 4} more ${uniqueFields.length - 4 === 1 ? "field" : "fields"}` : ""}.`;
}
function isRedactedStatus(status) {
  return status === "redacted" || status === "transformed";
}
function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function hasOwnKey(value, key) {
  return isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}
function cloneValue(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}
export {
  AirflowSession,
  ArgocdSession,
  AutogenSession,
  BaseGovernedSession,
  CANONICAL_ACTIVITY_LABELS,
  CANONICAL_ACTIVITY_TYPES,
  CANONICAL_EVENT_TYPES,
  ClaudeCodeSession,
  ClineSession,
  CodexSession,
  CopilotSession,
  CoreApiError,
  CrewaiSession,
  CursorSession,
  CustomSession,
  DefaultSession,
  LangchainSession,
  LanggraphSession,
  LlamaindexSession,
  MastraSession,
  ModernTreasurySession,
  N8nSession,
  OpenBoxCoreClient,
  PRESET_MANIFEST,
  PagerdutySession,
  PydanticAiSession,
  SemanticKernelSession,
  SessionAlreadyTerminatedError,
  TemporalSession,
  VercelAiSession,
  applyInputRedaction,
  applyOutputRedaction,
  deepUpdateObject,
  govern,
  hasGuardrailRedaction,
  presets,
  signAgentIdentityRequest,
  summarizeGuardrailRedaction
};
