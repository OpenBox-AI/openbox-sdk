// ts/src/copilotkit/runtime.ts
import { randomUUID as randomUUID4 } from "crypto";

// ts/src/copilotkit/constants.ts
var DEFAULT_WORKFLOW_TYPE = "CopilotKitGovernedAction";
var DEFAULT_AGENT_WORKFLOW_TYPE = "CopilotKitAgent";
var DEFAULT_TASK_QUEUE = "copilotkit";
var OPENBOX_RUNTIME_KEY_PATTERN = /^obx_(live|test)_/;
var OPENBOX_BACKEND_API_KEY_PATTERN = /^obx_key_/;
var OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY = "__openboxRuntimePromptGoverned";
var MAX_RUNTIME_MESSAGES = 10;
var MAX_RUNTIME_SYSTEM_CHARS = 400;
var MAX_RUNTIME_MESSAGE_CHARS = 1200;
var MAX_RUNTIME_TOOL_DESCRIPTION_CHARS = 500;
var MAX_RUNTIME_TOOL_CALLS = 6;
var MAX_RUNTIME_COLLECTION_ITEMS = 8;
var MAX_RUNTIME_OBJECT_KEYS = 12;
var OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION = "openbox.copilotkit.result.v1";

// ts/src/copilotkit/internal-utils.ts
function shouldStopForGate(gate, governanceMode) {
  return governanceMode === "enforce" && gate.rawBlocked;
}
function modelInput(request) {
  return {
    systemPrompt: typeof request.systemPrompt === "string" ? truncate(request.systemPrompt, MAX_RUNTIME_SYSTEM_CHARS) : void 0,
    messages: summarizeMessages(request.messages),
    tools: Array.isArray(request.tools) ? request.tools.map((tool) => {
      const value = objectRecord(tool);
      return {
        name: value.name,
        description: typeof value.description === "string" ? truncate(
          value.description,
          MAX_RUNTIME_TOOL_DESCRIPTION_CHARS
        ) : void 0
      };
    }).slice(0, 30) : []
  };
}
function toolCallInput(request) {
  return {
    id: request.toolCall?.id,
    name: request.toolCall?.name,
    args: toPlain(request.toolCall?.args),
    description: request.tool?.description
  };
}
function withGovernedModelInput(request, safe, changed = true) {
  if (!changed) return request;
  const safeRecord = objectRecord(safe);
  if (Array.isArray(safeRecord.messages)) {
    return {
      ...request,
      messages: mergeMessageContent(request.messages, safeRecord.messages)
    };
  }
  return request;
}
function mergeMessageContent(originalMessages, safeMessages) {
  if (!Array.isArray(originalMessages)) return originalMessages;
  const safeByIndex = /* @__PURE__ */ new Map();
  safeMessages.forEach((message, positionIndex) => {
    const safe = objectRecord(message);
    const numericIndex = typeof safe.index === "number" ? safe.index : typeof safe.index === "string" && safe.index.trim() !== "" ? Number(safe.index) : positionIndex;
    if (Number.isInteger(numericIndex)) {
      safeByIndex.set(numericIndex, safe);
    }
  });
  return originalMessages.map((message, index) => {
    const safe = safeByIndex.get(index) ?? {};
    if (!("content" in safe)) return message;
    const original = objectRecord(message);
    if (typeof original.lc_kwargs === "object" && original.lc_kwargs !== null) {
      return {
        ...original,
        content: safe.content,
        lc_kwargs: {
          ...original.lc_kwargs,
          content: safe.content
        }
      };
    }
    return {
      ...original,
      content: safe.content
    };
  });
}
function withGovernedToolInput(request, safe) {
  const safeRecord = objectRecord(safe);
  const args = safeRecord.args ?? objectRecord(safeRecord.toolCall).args;
  if (args === void 0) return request;
  return {
    ...request,
    toolCall: {
      ...request.toolCall,
      args
    }
  };
}
function withGovernedAssistantOutput(response, safe) {
  if (response === safe) return response;
  if (!response || typeof response !== "object") return safe;
  const safeRecord = objectRecord(safe);
  if (Object.keys(safeRecord).length === 0) return response;
  return {
    ...response,
    ...safeRecord
  };
}
function parseToolResult(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return objectRecord(parsed);
    } catch {
      return {};
    }
  }
  return objectRecord(value);
}
function summarizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const start = Math.max(0, messages.length - MAX_RUNTIME_MESSAGES);
  return messages.slice(start).map((message, offset) => {
    const index = start + offset;
    const value = objectRecord(message);
    const type = typeof value.getType === "function" ? value.getType() : value._getType && typeof value._getType === "function" ? value._getType() : value.type;
    const contentLimit = type === "system" || type === "SystemMessage" ? MAX_RUNTIME_SYSTEM_CHARS : MAX_RUNTIME_MESSAGE_CHARS;
    return {
      index,
      type,
      name: value.name,
      id: value.id,
      content: compactRuntimeValue(value.content, contentLimit),
      toolCalls: compactRuntimeValue(value.tool_calls ?? value.toolCalls)
    };
  });
}
function compactRuntimeValue(value, maxStringLength = MAX_RUNTIME_MESSAGE_CHARS, depth = 0) {
  if (value === null || value === void 0) return value;
  if (typeof value === "string") return truncate(value, maxStringLength);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[Function]";
  if (depth > 3) return "[MaxDepth]";
  if (Array.isArray(value)) {
    return value.slice(
      0,
      depth === 0 ? MAX_RUNTIME_TOOL_CALLS : MAX_RUNTIME_COLLECTION_ITEMS
    ).map((item) => compactRuntimeValue(item, maxStringLength, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([key]) => !key.startsWith("_")).slice(0, MAX_RUNTIME_OBJECT_KEYS).map(([key, item]) => [
        key,
        compactRuntimeValue(item, maxStringLength, depth + 1)
      ])
    );
  }
  return truncate(String(value), maxStringLength);
}
function toPlain(value, depth = 0) {
  if (value === null || value === void 0) return value;
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[Function]";
  if (depth > 4) return "[MaxDepth]";
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => toPlain(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([key]) => !key.startsWith("_")).slice(0, 50).map(([key, item]) => [key, toPlain(item, depth + 1)])
    );
  }
  return String(value);
}
function objectRecord(value) {
  return value && typeof value === "object" ? value : {};
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function errorOutput(error) {
  return error instanceof Error ? { errorName: error.name, message: error.message } : { message: String(error) };
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function truncate(value, maxLength = 4e3) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...[truncated]` : value;
}
function sessionKeyFromConfig(config) {
  const value = objectRecord(config);
  const configurable = objectRecord(value.configurable);
  return String(
    configurable.thread_id ?? configurable.threadId ?? value.thread_id ?? "default"
  );
}
function workflowIdFromState(state) {
  const value = objectRecord(state);
  const openboxSession = objectRecord(value.openboxSession);
  if (typeof openboxSession.workflowId === "string")
    return openboxSession.workflowId;
  return typeof value.openboxWorkflowId === "string" ? value.openboxWorkflowId : void 0;
}
function runIdFromState(state) {
  const value = objectRecord(state);
  const openboxSession = objectRecord(value.openboxSession);
  if (typeof openboxSession.runId === "string") return openboxSession.runId;
  return typeof value.openboxRunId === "string" ? value.openboxRunId : void 0;
}
function sameJson(a, b) {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
function cloneValue(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
async function swallow(fn) {
  try {
    await fn();
  } catch {
  }
}

// ts/src/copilotkit/types.ts
var OpenBoxCopilotKitError = class extends Error {
  verdict;
  constructor(message, verdict) {
    super(message);
    this.name = "OpenBoxCopilotKitError";
    this.verdict = verdict;
  }
};

// ts/src/copilotkit/workflow-session.ts
import { randomBytes, randomUUID as randomUUID3 } from "crypto";

// ts/src/core-client/core-client.ts
import { createHash, createPrivateKey, randomUUID, sign } from "crypto";

// ts/src/types/auth.ts
function decodeJwtExpiry(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }
    const payload = parts[1];
    const decoded = Buffer.from(payload, "base64url").toString("utf-8");
    const parsed = JSON.parse(decoded);
    if (typeof parsed.exp === "number") {
      return parsed.exp * 1e3;
    }
    return null;
  } catch {
    return null;
  }
}
function isTokenExpired(token, bufferMs = 6e4) {
  const expiry = decodeJwtExpiry(token);
  if (expiry === null) {
    return true;
  }
  return Date.now() + bufferMs >= expiry;
}

// ts/src/env/generated/env-bindings.ts
var CLIENT_VARIANT_PATTERN = /^[A-Za-z0-9._+-]+$/;

// ts/src/env/client-name.ts
var resolveClientName = (base, variant) => {
  const raw = variant ?? process.env.OPENBOX_CLIENT_VARIANT;
  if (!raw) return base;
  const trimmed = raw.trim();
  if (!trimmed) return base;
  if (!CLIENT_VARIANT_PATTERN.test(trimmed)) {
    console.error(
      `[openbox] OPENBOX_CLIENT_VARIANT='${trimmed}' contains invalid characters; ignoring. Allowed: letters, digits, '.', '_', '+', '-'.`
    );
    return base;
  }
  return `${base}/${trimmed}`;
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

// ts/src/client/generated/wrapper-methods.ts
var PATH_PERMISSION_RULES = [
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/dashboard\/trust-drift-lanes$/,
    methodName: "getTrustDriftLanes",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/dashboard\/violation-heatcal$/,
    methodName: "getViolationHeatcal",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/audit-logs\/export\/[^\/]+\/download$/,
    methodName: "downloadExport",
    perms: ["read:org"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/dashboard\/governance-feed$/,
    methodName: "getGovernanceFeed",
    perms: ["read:agent"]
  },
  {
    verb: "POST",
    pattern: /^\/organization\/audit-logs\/export\/preview$/,
    methodName: "previewAuditExport",
    perms: ["read:org"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/dashboard\/governance-slo$/,
    methodName: "getGovernanceSlo",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/sessions\/[^\/]+\/goal-alignment-stats$/,
    methodName: "getSessionGoalAlignmentStats",
    perms: ["read:agent_session"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/goal-alignment\/recent-drifts$/,
    methodName: "getGoalAlignmentRecentDrifts",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/dashboard\/tier-trends$/,
    methodName: "getDashboardTierTrends",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/behavior-rule\/semantic-types$/,
    methodName: "getSemanticTypes",
    perms: ["read:agent_behavior_rule"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/guardrails\/violation-logs$/,
    methodName: "getGuardrailViolationLogs",
    perms: ["read:agent_guardrail"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/sessions\/[^\/]+\/reasoning-trace$/,
    methodName: "getSessionReasoningTrace",
    perms: ["read:agent_session"]
  },
  {
    verb: "POST",
    pattern: /^\/organization\/[^\/]+\/send-welcome-email$/,
    methodName: "sendWelcomeEmail",
    perms: ["create:user"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/audit-logs\/exports$/,
    methodName: "getExportHistory",
    perms: ["read:org"]
  },
  {
    verb: "DELETE",
    pattern: /^\/organization\/audit-logs\/export\/[^\/]+$/,
    methodName: "deleteExport",
    perms: ["read:org"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/audit-logs\/export\/[^\/]+$/,
    methodName: "getExport",
    perms: ["read:org"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/approvals\/metrics$/,
    methodName: "getOrgApprovalMetrics",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/approvals\/history$/,
    methodName: "getOrgApprovalHistory",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/behavior-rule\/[^\/]+\/versions$/,
    methodName: "getBehaviorRuleVersions",
    perms: ["read:agent_behavior_rule"]
  },
  {
    verb: "POST",
    pattern: /^\/organization\/audit-logs\/export$/,
    methodName: "exportAuditLogs",
    perms: ["read:org"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/policies\/[^\/]+\/evaluations$/,
    methodName: "getPolicyEvaluations",
    perms: ["read:agent_policy"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/behavior-rule\/current$/,
    methodName: "getCurrentBehaviorRules",
    perms: ["read:agent_behavior_rule"]
  },
  {
    verb: "PUT",
    pattern: /^\/agent\/[^\/]+\/behavior-rule\/[^\/]+\/status$/,
    methodName: "toggleBehaviorRuleStatus",
    perms: ["update:agent_behavior_rule"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/trust\/recovery-status$/,
    methodName: "getTrustRecoveryStatus",
    perms: ["read:agent"]
  },
  {
    verb: "DELETE",
    pattern: /^\/organization\/[^\/]+\/members\/[^\/]+\/roles$/,
    methodName: "removeRoles",
    perms: ["update:user"]
  },
  {
    verb: "POST",
    pattern: /^\/organization\/[^\/]+\/members\/[^\/]+\/roles$/,
    methodName: "assignRoles",
    perms: ["update:user"]
  },
  {
    verb: "DELETE",
    pattern: /^\/organization\/[^\/]+\/teams\/[^\/]+\/members$/,
    methodName: "removeTeamMembers",
    perms: ["update:team"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/teams\/[^\/]+\/members$/,
    methodName: "getTeamMembers",
    perms: ["read:team"]
  },
  {
    verb: "POST",
    pattern: /^\/organization\/[^\/]+\/teams\/[^\/]+\/members$/,
    methodName: "addTeamMembers",
    perms: ["update:team"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/goal-alignment\/trend$/,
    methodName: "getGoalAlignmentTrend",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/approvals\/sla$/,
    methodName: "getOrgApprovalSla",
    perms: ["read:agent"]
  },
  {
    verb: "PATCH",
    pattern: /^\/agent\/[^\/]+\/guardrails\/[^\/]+\/reorder$/,
    methodName: "reorderGuardrail",
    perms: ["update:agent_guardrail"]
  },
  {
    verb: "PATCH",
    pattern: /^\/agent\/[^\/]+\/sessions\/[^\/]+\/terminate$/,
    methodName: "terminateSession",
    perms: ["manage:agent_session"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/behavior\/violations$/,
    methodName: "getBehaviorViolations",
    perms: ["read:agent_behavior_rule"]
  },
  {
    verb: "POST",
    pattern: /^\/webhook\/[^\/]+\/regenerate-secret$/,
    methodName: "regenerateWebhookSecret",
    perms: ["update:webhook"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/guardrails\/metrics$/,
    methodName: "getGuardrailMetrics",
    perms: ["read:agent_guardrail"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/trust-tier-changes$/,
    methodName: "getTrustTierChanges",
    perms: ["read:agent"]
  },
  {
    verb: "POST",
    pattern: /^\/organization\/[^\/]+\/invitations$/,
    methodName: "inviteUser",
    perms: ["create:user"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/teams\/stats$/,
    methodName: "getTeamStats",
    perms: ["read:team"]
  },
  {
    verb: "POST",
    pattern: /^\/agent\/[^\/]+\/aivss\/recalculate$/,
    methodName: "recalculateAivss",
    perms: ["update:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/approvals\/metrics$/,
    methodName: "getApprovalMetrics",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/approvals\/pending$/,
    methodName: "getPendingApprovals",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/approvals\/history$/,
    methodName: "getApprovalHistory",
    perms: ["read:agent"]
  },
  {
    verb: "PUT",
    pattern: /^\/agent\/[^\/]+\/approvals\/[^\/]+\/decide$/,
    methodName: "decideApproval",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/audit-logs\/[^\/]+$/,
    methodName: "getAuditLog",
    perms: ["read:org"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/policies\/metrics$/,
    methodName: "getPolicyMetrics",
    perms: ["read:agent_policy"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/policies\/current$/,
    methodName: "getCurrentPolicies",
    perms: ["read:agent_policy"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/behavior\/metrics$/,
    methodName: "getBehaviorMetrics",
    perms: ["read:agent_behavior_rule"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/insights\/metrics$/,
    methodName: "getInsightsMetrics",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/audit-logs$/,
    methodName: "getAuditLogs",
    perms: ["read:org"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/dashboard$/,
    methodName: "getDashboard",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/approvals$/,
    methodName: "getOrgApprovals",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/active-sessions$/,
    methodName: "getActiveSessions",
    perms: ["read:agent_session"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/trust\/histories$/,
    methodName: "getTrustHistories",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/settings$/,
    methodName: "getOrgSettings",
    perms: ["read:org"]
  },
  {
    verb: "PUT",
    pattern: /^\/organization\/[^\/]+\/settings$/,
    methodName: "updateOrgSettings",
    perms: ["write:org"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/features$/,
    methodName: "getOrgFeatures",
    perms: ["read:org"]
  },
  {
    verb: "PUT",
    pattern: /^\/organization\/[^\/]+\/members\/[^\/]+$/,
    methodName: "updateMember",
    perms: ["update:user"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/sessions$/,
    methodName: "getOrgSessions",
    perms: ["read:agent"]
  },
  {
    verb: "PUT",
    pattern: /^\/agent\/[^\/]+\/goal-alignment$/,
    methodName: "updateGoalAlignment",
    perms: ["update:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/sessions\/[^\/]+\/logs$/,
    methodName: "getSessionLogs",
    perms: ["read:agent_log"]
  },
  {
    verb: "POST",
    pattern: /^\/agent\/[^\/]+\/rotate-api-key$/,
    methodName: "rotateApiKey",
    perms: ["update:agent"]
  },
  {
    verb: "POST",
    pattern: /^\/agent\/[^\/]+\/revoke-api-key$/,
    methodName: "revokeApiKey",
    perms: ["update:agent"]
  },
  {
    verb: "DELETE",
    pattern: /^\/agent\/[^\/]+\/behavior-rule\/[^\/]+$/,
    methodName: "deleteBehaviorRule",
    perms: ["delete:agent_behavior_rule"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/behavior-rule\/[^\/]+$/,
    methodName: "getBehaviorRule",
    perms: ["read:agent_behavior_rule"]
  },
  {
    verb: "POST",
    pattern: /^\/agent\/[^\/]+\/behavior-rule\/[^\/]+$/,
    methodName: "restoreBehaviorRule",
    perms: ["update:agent_behavior_rule"]
  },
  {
    verb: "PUT",
    pattern: /^\/agent\/[^\/]+\/behavior-rule\/[^\/]+$/,
    methodName: "updateBehaviorRule",
    perms: ["update:agent_behavior_rule"]
  },
  {
    verb: "DELETE",
    pattern: /^\/organization\/[^\/]+\/members$/,
    methodName: "removeMembers",
    perms: ["delete:user"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/members$/,
    methodName: "listMembers",
    perms: ["read:user"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/observability$/,
    methodName: "getObservability",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/behavior-rule$/,
    methodName: "listBehaviorRules",
    perms: ["read:agent_behavior_rule"]
  },
  {
    verb: "POST",
    pattern: /^\/agent\/[^\/]+\/behavior-rule$/,
    methodName: "createBehaviorRule",
    perms: ["create:agent_behavior_rule"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/teams\/[^\/]+$/,
    methodName: "getTeam",
    perms: ["read:team"]
  },
  {
    verb: "PUT",
    pattern: /^\/organization\/[^\/]+\/teams\/[^\/]+$/,
    methodName: "updateTeam",
    perms: ["update:team"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/trust\/events$/,
    methodName: "getTrustEvents",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/webhook\/[^\/]+\/deliveries$/,
    methodName: "getWebhookDeliveries",
    perms: ["read:webhook"]
  },
  {
    verb: "POST",
    pattern: /^\/organization\/[^\/]+\/users$/,
    methodName: "createUser",
    perms: ["create:user"]
  },
  {
    verb: "DELETE",
    pattern: /^\/organization\/[^\/]+\/teams$/,
    methodName: "deleteTeams",
    perms: ["delete:team"]
  },
  {
    verb: "GET",
    pattern: /^\/organization\/[^\/]+\/teams$/,
    methodName: "listTeams",
    perms: ["read:team"]
  },
  {
    verb: "POST",
    pattern: /^\/organization\/[^\/]+\/teams$/,
    methodName: "createTeam",
    perms: ["create:team"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/assessments$/,
    methodName: "getAssessments",
    perms: ["read:agent"]
  },
  {
    verb: "DELETE",
    pattern: /^\/agent\/[^\/]+\/guardrails\/[^\/]+$/,
    methodName: "deleteGuardrail",
    perms: ["delete:agent_guardrail"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/guardrails\/[^\/]+$/,
    methodName: "getGuardrail",
    perms: ["read:agent_guardrail"]
  },
  {
    verb: "PUT",
    pattern: /^\/agent\/[^\/]+\/guardrails\/[^\/]+$/,
    methodName: "updateGuardrail",
    perms: ["update:agent_guardrail"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/violations$/,
    methodName: "getAgentViolations",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/logs\/drift$/,
    methodName: "getDriftLogs",
    perms: ["read:agent_log"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/guardrails$/,
    methodName: "listGuardrails",
    perms: ["read:agent_guardrail"]
  },
  {
    verb: "POST",
    pattern: /^\/agent\/[^\/]+\/guardrails$/,
    methodName: "createGuardrail",
    perms: ["create:agent_guardrail"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/violations$/,
    methodName: "getAllViolations",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/policies\/[^\/]+$/,
    methodName: "getPolicy",
    perms: ["read:agent_policy"]
  },
  {
    verb: "PUT",
    pattern: /^\/agent\/[^\/]+\/policies\/[^\/]+$/,
    methodName: "updatePolicy",
    perms: ["update:agent_policy"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/sessions\/[^\/]+$/,
    methodName: "getSession",
    perms: ["read:agent_session"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/policies$/,
    methodName: "listPolicies",
    perms: ["read:agent_policy"]
  },
  {
    verb: "POST",
    pattern: /^\/agent\/[^\/]+\/policies$/,
    methodName: "createPolicy",
    perms: ["create:agent_policy"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/sessions$/,
    methodName: "listSessions",
    perms: ["read:agent_session"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/metrics$/,
    methodName: "getAgentMetrics",
    perms: ["read:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/issues$/,
    methodName: "getIssues",
    perms: ["read:agent"]
  },
  {
    verb: "POST",
    pattern: /^\/webhook\/[^\/]+\/test$/,
    methodName: "testWebhook",
    perms: ["update:webhook"]
  },
  {
    verb: "POST",
    pattern: /^\/agent\/create$/,
    methodName: "createAgent",
    perms: ["create:agent"]
  },
  {
    verb: "PUT",
    pattern: /^\/agent\/[^\/]+\/aivss$/,
    methodName: "updateAivssConfig",
    perms: ["update:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/sso\/metadata$/,
    methodName: "getSsoMetadata",
    perms: ["manage:sso"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+\/logs$/,
    methodName: "getAgentLogs",
    perms: ["read:agent_log"]
  },
  {
    verb: "PUT",
    pattern: /^\/sso\/enforce$/,
    methodName: "enforceSso",
    perms: ["manage:sso"]
  },
  {
    verb: "GET",
    pattern: /^\/user\/roles$/,
    methodName: "getUserRoles",
    perms: ["read:user"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/list$/,
    methodName: "listAgents",
    perms: ["read:agent"]
  },
  {
    verb: "POST",
    pattern: /^\/sso\/verify$/,
    methodName: "verifySsoConfig",
    perms: ["manage:sso"]
  },
  {
    verb: "DELETE",
    pattern: /^\/webhook\/[^\/]+$/,
    methodName: "deleteWebhook",
    perms: ["delete:webhook"]
  },
  {
    verb: "GET",
    pattern: /^\/webhook\/[^\/]+$/,
    methodName: "getWebhook",
    perms: ["read:webhook"]
  },
  {
    verb: "PATCH",
    pattern: /^\/webhook\/[^\/]+$/,
    methodName: "updateWebhook",
    perms: ["update:webhook"]
  },
  {
    verb: "DELETE",
    pattern: /^\/api-key\/[^\/]+$/,
    methodName: "deleteApiKey",
    perms: ["delete:api_key"]
  },
  {
    verb: "GET",
    pattern: /^\/api-key\/[^\/]+$/,
    methodName: "getApiKey",
    perms: ["read:api_key"]
  },
  {
    verb: "PATCH",
    pattern: /^\/api-key\/[^\/]+$/,
    methodName: "updateApiKey",
    perms: ["update:api_key"]
  },
  {
    verb: "POST",
    pattern: /^\/sso\/saml$/,
    methodName: "configureSsoSaml",
    perms: ["manage:sso"]
  },
  {
    verb: "POST",
    pattern: /^\/sso\/oidc$/,
    methodName: "configureSsoOidc",
    perms: ["manage:sso"]
  },
  {
    verb: "GET",
    pattern: /^\/webhook$/,
    methodName: "listWebhooks",
    perms: ["read:webhook"]
  },
  {
    verb: "POST",
    pattern: /^\/webhook$/,
    methodName: "createWebhook",
    perms: ["create:webhook"]
  },
  {
    verb: "GET",
    pattern: /^\/api-key$/,
    methodName: "listApiKeys",
    perms: ["read:api_key"]
  },
  {
    verb: "POST",
    pattern: /^\/api-key$/,
    methodName: "createApiKey",
    perms: ["create:api_key"]
  },
  {
    verb: "DELETE",
    pattern: /^\/agent\/[^\/]+$/,
    methodName: "deleteAgent",
    perms: ["delete:agent"]
  },
  {
    verb: "GET",
    pattern: /^\/agent\/[^\/]+$/,
    methodName: "getAgent",
    perms: ["read:agent"]
  },
  {
    verb: "PUT",
    pattern: /^\/agent\/[^\/]+$/,
    methodName: "updateAgent",
    perms: ["create:agent"]
  },
  {
    verb: "DELETE",
    pattern: /^\/sso$/,
    methodName: "deleteSsoConfig",
    perms: ["manage:sso"]
  },
  {
    verb: "GET",
    pattern: /^\/sso$/,
    methodName: "getSsoConfig",
    perms: ["manage:sso"]
  }
];
var MissingPermissionError = class extends Error {
  constructor(methodName, missing, have) {
    super(
      `[${methodName}] missing permissions: ${missing.join(", ")}. Have: ${have.length ? have.join(", ") : "(none)"}. Run \`openbox auth refresh\` if your token was just upgraded.`
    );
    this.methodName = methodName;
    this.missing = missing;
    this.have = have;
    this.name = "MissingPermissionError";
  }
  methodName;
  missing;
  have;
};
var OpenBoxClientWrapperBase = class {
  /**
   * Cached permission set. When undefined, pre-flight checks are
   * skipped; the SDK behaves as before, deferring to the server's
   * 403 response. The hand-written wrapper populates this from
   * `BackendClientConfig.permissions` if the caller provides it.
   */
  permissions;
  /**
   * Pre-flight permission check. Called by the hand-written
   * `request()` impl on every outbound HTTP; covers both generated
   * method bodies AND any hand-written shadow that calls http* directly.
   * No-op when `permissions` is undefined or no rule matches the path.
   */
  checkPathPermissions(verb, path3) {
    if (!this.permissions) return;
    const upperVerb = verb.toUpperCase();
    for (const rule of PATH_PERMISSION_RULES) {
      if (rule.verb !== upperVerb) continue;
      if (!rule.pattern.test(path3)) continue;
      const missing = rule.perms.filter((p) => !this.permissions.has(p));
      if (missing.length > 0) {
        throw new MissingPermissionError(rule.methodName, missing, [...this.permissions]);
      }
      return;
    }
  }
  async health() {
    return this.httpGet(`/health`);
  }
  async getProfile() {
    return this.httpGet(`/auth/profile`);
  }
  async getCsrfToken() {
    return this.httpGet(`/auth/csrf`);
  }
  async login(body) {
    return this.httpPost(`/auth/login`, body);
  }
  async logout(body) {
    return this.httpPost(`/auth/logout`, body);
  }
  async forgotPassword(body) {
    return this.httpPost(`/auth/forgot-password`, body);
  }
  async resetPassword(body) {
    return this.httpPost(`/auth/reset-password`, body);
  }
  async changePassword(body) {
    return this.httpPost(`/auth/change-password`, body);
  }
  async refreshTokens(body) {
    return this.httpPost(`/auth/refresh`, body);
  }
  async getUserRoles() {
    return this.httpGet(`/user/roles`);
  }
  async getAllViolations() {
    return this.httpGet(`/agent/violations`);
  }
  async getAgentMetrics() {
    return this.httpGet(`/agent/metrics`);
  }
  async listAgents(query) {
    return this.httpGet(`/agent/list`, query);
  }
  async calculateAivss(body) {
    return this.httpPost(`/agent/aivss`, body);
  }
  async createAgent(body) {
    return this.httpPost(`/agent/create`, body);
  }
  async deleteAgent(agentId) {
    return this.httpDelete(`/agent/${agentId}`);
  }
  async getAgent(agentId) {
    return this.httpGet(`/agent/${agentId}`);
  }
  async updateAgent(agentId, body) {
    return this.httpPut(`/agent/${agentId}`, body);
  }
  async getAgentViolations(agentId, body) {
    return this.httpGet(`/agent/${agentId}/violations`);
  }
  async markFalsePositive(agentId, violationId, body) {
    return this.httpPatch(`/agent/${agentId}/violations/${violationId}/false-positive`, body);
  }
  async getAgentLogs(agentId, query) {
    return this.httpGet(`/agent/${agentId}/logs`, query);
  }
  async getDriftLogs(agentId, query) {
    return this.httpGet(`/agent/${agentId}/logs/drift`, query);
  }
  async getAssessments(agentId, query) {
    return this.httpGet(`/agent/${agentId}/assessments`, query);
  }
  async updateAivssConfig(agentId, body) {
    return this.httpPut(`/agent/${agentId}/aivss`, body);
  }
  async updateGoalAlignment(agentId, body) {
    return this.httpPut(`/agent/${agentId}/goal-alignment`, body);
  }
  async recalculateAivss(agentId) {
    return this.httpPost(`/agent/${agentId}/aivss/recalculate`);
  }
  async listGuardrails(agentId, query) {
    return this.httpGet(`/agent/${agentId}/guardrails`, query);
  }
  async createGuardrail(agentId, body) {
    return this.httpPost(`/agent/${agentId}/guardrails`, body);
  }
  async getGuardrailMetrics(agentId, query) {
    return this.httpGet(`/agent/${agentId}/guardrails/metrics`, query);
  }
  async getGuardrailViolationLogs(agentId, query) {
    return this.httpGet(`/agent/${agentId}/guardrails/violation-logs`, query);
  }
  async deleteGuardrail(agentId, guardrailId) {
    return this.httpDelete(`/agent/${agentId}/guardrails/${guardrailId}`);
  }
  async getGuardrail(agentId, guardrailId) {
    return this.httpGet(`/agent/${agentId}/guardrails/${guardrailId}`);
  }
  async updateGuardrail(agentId, guardrailId, body) {
    return this.httpPut(`/agent/${agentId}/guardrails/${guardrailId}`, body);
  }
  async reorderGuardrail(agentId, guardrailId, body) {
    return this.httpPatch(`/agent/${agentId}/guardrails/${guardrailId}/reorder`, body);
  }
  async listPolicies(agentId, query) {
    return this.httpGet(`/agent/${agentId}/policies`, query);
  }
  async createPolicy(agentId, body) {
    return this.httpPost(`/agent/${agentId}/policies`, body);
  }
  async getPolicyMetrics(agentId, query) {
    return this.httpGet(`/agent/${agentId}/policies/metrics`, query);
  }
  async getCurrentPolicies(agentId) {
    return this.httpGet(`/agent/${agentId}/policies/current`);
  }
  async getPolicy(agentId, policyId) {
    return this.httpGet(`/agent/${agentId}/policies/${policyId}`);
  }
  async updatePolicy(agentId, policyId, body) {
    return this.httpPut(`/agent/${agentId}/policies/${policyId}`, body);
  }
  async getPolicyEvaluations(agentId, policyId, query) {
    return this.httpGet(`/agent/${agentId}/policies/${policyId}/evaluations`, query);
  }
  async listSessions(agentId, query) {
    return this.httpGet(`/agent/${agentId}/sessions`, query);
  }
  async getActiveSessions(agentId) {
    return this.httpGet(`/agent/${agentId}/active-sessions`);
  }
  async getSession(agentId, sessionId) {
    return this.httpGet(`/agent/${agentId}/sessions/${sessionId}`);
  }
  async getSessionLogs(agentId, sessionId, query) {
    return this.httpGet(`/agent/${agentId}/sessions/${sessionId}/logs`, query);
  }
  async getSessionGoalAlignmentStats(agentId, sessionId) {
    return this.httpGet(`/agent/${agentId}/sessions/${sessionId}/goal-alignment-stats`);
  }
  async getSessionReasoningTrace(agentId, sessionId) {
    return this.httpGet(`/agent/${agentId}/sessions/${sessionId}/reasoning-trace`);
  }
  async terminateSession(agentId, sessionId) {
    return this.httpPatch(`/agent/${agentId}/sessions/${sessionId}/terminate`);
  }
  async getGoalAlignmentTrend(agentId, query) {
    return this.httpGet(`/agent/${agentId}/goal-alignment/trend`, query);
  }
  async getGoalAlignmentRecentDrifts(agentId, query) {
    return this.httpGet(`/agent/${agentId}/goal-alignment/recent-drifts`, query);
  }
  async rotateApiKey(agentId) {
    return this.httpPost(`/agent/${agentId}/rotate-api-key`);
  }
  async revokeApiKey(agentId) {
    return this.httpPost(`/agent/${agentId}/revoke-api-key`);
  }
  async getObservability(agentId, query) {
    return this.httpGet(`/agent/${agentId}/observability`, query);
  }
  async getIssues(agentId, query) {
    return this.httpGet(`/agent/${agentId}/issues`, query);
  }
  async getSemanticTypes() {
    return this.httpGet(`/agent/behavior-rule/semantic-types`);
  }
  async listBehaviorRules(agentId, query) {
    return this.httpGet(`/agent/${agentId}/behavior-rule`, query);
  }
  async createBehaviorRule(agentId, body) {
    return this.httpPost(`/agent/${agentId}/behavior-rule`, body);
  }
  async getCurrentBehaviorRules(agentId) {
    return this.httpGet(`/agent/${agentId}/behavior-rule/current`);
  }
  async deleteBehaviorRule(agentId, behaviorRuleId) {
    return this.httpDelete(`/agent/${agentId}/behavior-rule/${behaviorRuleId}`);
  }
  async getBehaviorRule(agentId, behaviorRuleId) {
    return this.httpGet(`/agent/${agentId}/behavior-rule/${behaviorRuleId}`);
  }
  async restoreBehaviorRule(agentId, behaviorRuleId) {
    return this.httpPost(`/agent/${agentId}/behavior-rule/${behaviorRuleId}`);
  }
  async updateBehaviorRule(agentId, behaviorRuleId, body) {
    return this.httpPut(`/agent/${agentId}/behavior-rule/${behaviorRuleId}`, body);
  }
  async toggleBehaviorRuleStatus(agentId, behaviorRuleId, body) {
    return this.httpPut(`/agent/${agentId}/behavior-rule/${behaviorRuleId}/status`, body);
  }
  async getBehaviorRuleVersions(agentId, behaviorGroupdId, query) {
    return this.httpGet(`/agent/${agentId}/behavior-rule/${behaviorGroupdId}/versions`, query);
  }
  async getBehaviorMetrics(agentId, query) {
    return this.httpGet(`/agent/${agentId}/behavior/metrics`, query);
  }
  async getTrustHistories(agentId, query) {
    return this.httpGet(`/agent/${agentId}/trust/histories`, query);
  }
  async getTrustEvents(agentId, query) {
    return this.httpGet(`/agent/${agentId}/trust/events`, query);
  }
  async getTrustRecoveryStatus(agentId) {
    return this.httpGet(`/agent/${agentId}/trust/recovery-status`);
  }
  async getApprovalMetrics(agentId, query) {
    return this.httpGet(`/agent/${agentId}/approvals/metrics`, query);
  }
  async getPendingApprovals(agentId, query) {
    return this.httpGet(`/agent/${agentId}/approvals/pending`, query);
  }
  async getApprovalHistory(agentId, query) {
    return this.httpGet(`/agent/${agentId}/approvals/history`, query);
  }
  async decideApproval(agentId, eventId, query) {
    return this.httpPut(`/agent/${agentId}/approvals/${eventId}/decide`, void 0, query);
  }
  async getInsightsMetrics(agentId, query) {
    return this.httpGet(`/agent/${agentId}/insights/metrics`, query);
  }
  async getBehaviorViolations(agentId, query) {
    return this.httpGet(`/agent/${agentId}/behavior/violations`, query);
  }
  async getTrustTierChanges(agentId, query) {
    return this.httpGet(`/agent/${agentId}/trust-tier-changes`, query);
  }
  async runGuardrailTest(body) {
    return this.httpPost(`/guardrails/run-test`, body);
  }
  async evaluateRego(body) {
    return this.httpPost(`/policy/evaluate`, body);
  }
  async listWebhooks(query) {
    return this.httpGet(`/webhook`, query);
  }
  async createWebhook(body) {
    return this.httpPost(`/webhook`, body);
  }
  async deleteWebhook(id) {
    return this.httpDelete(`/webhook/${id}`);
  }
  async getWebhook(id) {
    return this.httpGet(`/webhook/${id}`);
  }
  async updateWebhook(id, body) {
    return this.httpPatch(`/webhook/${id}`, body);
  }
  async getWebhookDeliveries(id, query) {
    return this.httpGet(`/webhook/${id}/deliveries`, query);
  }
  async testWebhook(id) {
    return this.httpPost(`/webhook/${id}/test`);
  }
  async regenerateWebhookSecret(id) {
    return this.httpPost(`/webhook/${id}/regenerate-secret`);
  }
  async registerOrganization(body) {
    return this.httpPost(`/organization/register`, body);
  }
  async getDemoSetupStatus() {
    return this.httpGet(`/organization/demo-setup-status`);
  }
  async getOrgSettings(organizationId) {
    return this.httpGet(`/organization/${organizationId}/settings`);
  }
  async updateOrgSettings(organizationId, body) {
    return this.httpPut(`/organization/${organizationId}/settings`, body);
  }
  async getOrgFeatures(organizationId) {
    return this.httpGet(`/organization/${organizationId}/features`);
  }
  async removeMembers(organizationId, body) {
    return this.httpDelete(`/organization/${organizationId}/members`, body);
  }
  async listMembers(organizationId, query) {
    return this.httpGet(`/organization/${organizationId}/members`, query);
  }
  async createUser(organizationId, body) {
    return this.httpPost(`/organization/${organizationId}/users`, body);
  }
  async sendWelcomeEmail(organizationId, body) {
    return this.httpPost(`/organization/${organizationId}/send-welcome-email`, body);
  }
  async inviteUser(organizationId, body) {
    return this.httpPost(`/organization/${organizationId}/invitations`, body);
  }
  async removeRoles(organizationId, userId, body) {
    return this.httpDelete(`/organization/${organizationId}/members/${userId}/roles`, body);
  }
  async assignRoles(organizationId, userId, body) {
    return this.httpPost(`/organization/${organizationId}/members/${userId}/roles`, body);
  }
  async updateMember(organizationId, userId, body) {
    return this.httpPut(`/organization/${organizationId}/members/${userId}`, body);
  }
  async deleteTeams(organizationId, body) {
    return this.httpDelete(`/organization/${organizationId}/teams`, body);
  }
  async listTeams(organizationId, query) {
    return this.httpGet(`/organization/${organizationId}/teams`, query);
  }
  async createTeam(organizationId, body) {
    return this.httpPost(`/organization/${organizationId}/teams`, body);
  }
  async getTeamStats(organizationId) {
    return this.httpGet(`/organization/${organizationId}/teams/stats`);
  }
  async getTeam(organizationId, teamId) {
    return this.httpGet(`/organization/${organizationId}/teams/${teamId}`);
  }
  async updateTeam(organizationId, teamId, body) {
    return this.httpPut(`/organization/${organizationId}/teams/${teamId}`, body);
  }
  async removeTeamMembers(organizationId, teamId, body) {
    return this.httpDelete(`/organization/${organizationId}/teams/${teamId}/members`, body);
  }
  async getTeamMembers(organizationId, teamId, query) {
    return this.httpGet(`/organization/${organizationId}/teams/${teamId}/members`, query);
  }
  async addTeamMembers(organizationId, teamId, body) {
    return this.httpPost(`/organization/${organizationId}/teams/${teamId}/members`, body);
  }
  async getAuditLogs(query) {
    return this.httpGet(`/organization/audit-logs`, query);
  }
  async previewAuditExport(body) {
    return this.httpPost(`/organization/audit-logs/export/preview`, body);
  }
  async exportAuditLogs(body) {
    return this.httpPost(`/organization/audit-logs/export`, body);
  }
  async getExportHistory(query) {
    return this.httpGet(`/organization/audit-logs/exports`, query);
  }
  async deleteExport(exportId) {
    return this.httpDelete(`/organization/audit-logs/export/${exportId}`);
  }
  async getExport(exportId) {
    return this.httpGet(`/organization/audit-logs/export/${exportId}`);
  }
  async downloadExport(exportId) {
    return this.httpGet(`/organization/audit-logs/export/${exportId}/download`);
  }
  async getAuditLog(logId) {
    return this.httpGet(`/organization/audit-logs/${logId}`);
  }
  async getDashboard(organizationId, query) {
    return this.httpGet(`/organization/${organizationId}/dashboard`, query);
  }
  async getOrgApprovalMetrics(organizationId, query) {
    return this.httpGet(`/organization/${organizationId}/approvals/metrics`, query);
  }
  async getOrgApprovalSla(organizationId) {
    return this.httpGet(`/organization/${organizationId}/approvals/sla`);
  }
  async getOrgApprovals(organizationId, query) {
    return this.httpGet(`/organization/${organizationId}/approvals`, query);
  }
  async getOrgApprovalHistory(organizationId, query) {
    return this.httpGet(`/organization/${organizationId}/approvals/history`, query);
  }
  async getDashboardTierTrends(organizationId) {
    return this.httpGet(`/organization/${organizationId}/dashboard/tier-trends`);
  }
  async getGovernanceFeed(organizationId, query) {
    return this.httpGet(`/organization/${organizationId}/dashboard/governance-feed`, query);
  }
  async getTrustDriftLanes(organizationId, query) {
    return this.httpGet(`/organization/${organizationId}/dashboard/trust-drift-lanes`, query);
  }
  async getGovernanceSlo(organizationId, query) {
    return this.httpGet(`/organization/${organizationId}/dashboard/governance-slo`, query);
  }
  async getViolationHeatcal(organizationId, query) {
    return this.httpGet(`/organization/${organizationId}/dashboard/violation-heatcal`, query);
  }
  async getOrgSessions(organizationId, query) {
    return this.httpGet(`/organization/${organizationId}/sessions`, query);
  }
  async getOrganization(organizationId) {
    return this.httpGet(`/organization/${organizationId}`);
  }
  async listApiKeys(query) {
    return this.httpGet(`/api-key`, query);
  }
  async createApiKey(body) {
    return this.httpPost(`/api-key`, body);
  }
  async deleteApiKey(id) {
    return this.httpDelete(`/api-key/${id}`);
  }
  async getApiKey(id) {
    return this.httpGet(`/api-key/${id}`);
  }
  async updateApiKey(id, body) {
    return this.httpPatch(`/api-key/${id}`, body);
  }
  async deleteSsoConfig() {
    return this.httpDelete(`/sso`);
  }
  async getSsoConfig() {
    return this.httpGet(`/sso`);
  }
  async configureSsoSaml(body) {
    return this.httpPost(`/sso/saml`, body);
  }
  async configureSsoOidc(body) {
    return this.httpPost(`/sso/oidc`, body);
  }
  async enforceSso(body) {
    return this.httpPut(`/sso/enforce`, body);
  }
  async getSsoMetadata() {
    return this.httpGet(`/sso/metadata`);
  }
  async verifySsoConfig() {
    return this.httpPost(`/sso/verify`);
  }
  async getSsoStatus(query) {
    return this.httpGet(`/sso/status`, query);
  }
};

// ts/src/client/client.ts
var OpenBoxApiError = class extends Error {
  status;
  body;
  constructor(message, status, body) {
    super(message);
    this.name = "OpenBoxApiError";
    this.status = status;
    this.body = body;
  }
};
var OpenBoxClient = class _OpenBoxClient extends OpenBoxClientWrapperBase {
  baseUrl;
  config;
  clientName;
  refreshPromise = null;
  rateLimiter = null;
  // Auto-refresh is currently DISABLED. The upstream `/auth/refresh`
  // endpoint has known compatibility gaps with the dashboard's snake_case
  // payload and Keycloak realm resolution. Flip to true once both fixes
  // ship. The capture path in the CLI continues to save refresh tokens
  // so no re-login is needed after re-enabling.
  static REFRESH_ENABLED = false;
  /**
   * Fetch a service's `/version` payload. Public endpoint; no auth, no
   * client construction. Works for any OpenBox HTTP service that exposes
   * `/version` (backend, core, future services). Backend wraps as
   * { status, data: {...} }; core returns flat; both shapes are normalized.
   *
   * Returns null on any error (timeout, network, non-OK, malformed body).
   * Callers fall through to whatever fallback they have.
   */
  static async getVersion(baseUrl, options) {
    if (!baseUrl) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 5e3);
    try {
      const res = await fetch(`${baseUrl}/version`, {
        method: "GET",
        credentials: "omit",
        signal: controller.signal
      });
      if (!res.ok) return null;
      const raw = await res.json();
      const payload = raw.data && typeof raw.data === "object" ? raw.data : raw;
      const commit = typeof payload.commit === "string" ? payload.commit : void 0;
      const version = typeof payload.version === "string" ? payload.version : void 0;
      const builtAt = typeof payload.builtAt === "string" ? payload.builtAt : typeof payload.built_at === "string" ? payload.built_at : void 0;
      if (!commit && !version && !builtAt) return null;
      return { commit, version, builtAt };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  constructor(config) {
    super();
    this.config = { ...config };
    this.baseUrl = requireApiUrl(this.config.apiUrl ?? process.env.OPENBOX_API_URL);
    this.clientName = resolveClientName(this.config.clientName ?? "openbox-cli");
    if (config.permissions) {
      this.permissions = new Set(config.permissions);
    }
    if (config.rateLimit) {
      this.rateLimiter = new TokenBucket(
        config.rateLimit.requestsPerSecond,
        config.rateLimit.burst
      );
    }
  }
  /**
   * Dynamic operation request used by compact API-first tooling.
   * Generated wrapper methods remain the preferred typed surface; this
   * method exists for operationId-driven callers that already resolved
   * a generated endpoint manifest entry.
   */
  async requestOperation(method, path3, options) {
    return this.request(method, path3, options);
  }
  /**
   * Update the cached permission set. Call this after a token refresh
   * that returned new claims, or after `getProfile()` if the consumer
   * didn't pre-load permissions at construction time. Pass `undefined`
   * to disable the pre-flight check entirely.
   */
  setPermissions(permissions) {
    this.permissions = permissions ? new Set(permissions) : void 0;
  }
  // =========================================================================
  // Auth
  // =========================================================================
  /**
    // =========================================================================
    // Agent CRUD
    // =========================================================================
  
    // listAgents / registerOrganization come from the generated base.
  
  
    // Every backend operation comes from the spec-emitted
    // OpenBoxClientWrapperBase. The hand-written wrappers below are gone
    // per the no-legacy-support rule; callers reach for the generated
    // method directly. Where the spec under-declares a response (the
    // generated method returns `unknown`), the call site casts through
    // the wire-shape it depends on so the drift is visible at the use,
    // not hidden in a hand-typed return.
  
  
  
    // ---- removed: every method here was a hand-written wrapper around
    // the generated typed method on OpenBoxClientWrapperBase. After the
    // ResponseOf<> emitter fix the generated methods carry the real
    // response types; the legacy wrappers are gone.
    // =========================================================================
    // User
    // =========================================================================
  
  
    // =========================================================================
    // Pagination helpers
    // =========================================================================
  
    /**
     * Async generator that yields pages from a paginated endpoint.
     * The `fetcher` receives `{ page, perPage }` and must return a `PaginatedResponse<T>`.
     *
     * @example
     * for await (const page of client.paginate((q) => client.listAgents(q))) {
     *   console.log(page); // Agent[]
     * }
     */
  async *paginate(fetcher, perPage = 50) {
    let page = 0;
    while (true) {
      const result = await fetcher({ page, perPage });
      const items = result.data ?? [];
      if (items.length === 0) break;
      yield items;
      if (items.length < perPage) break;
      page++;
    }
  }
  /**
   * Fetches all items from a paginated endpoint by auto-paginating.
   *
   * @example
   * const allAgents = await client.paginateAll((q) => client.listAgents(q));
   */
  async paginateAll(fetcher, perPage = 50) {
    const all = [];
    for await (const page of this.paginate(fetcher, perPage)) {
      all.push(...page);
    }
    return all;
  }
  // =========================================================================
  // API keys; live backend, org-scoped, gated on create/read/update/delete:api_key
  // =========================================================================
  // =========================================================================
  // Webhooks; live backend, gated on create/read/update/delete:webhook
  // =========================================================================
  // =========================================================================
  // =========================================================================
  // Private helpers
  // =========================================================================
  /**
   * Ensures the access token is still valid. If it is expired (or will be
   * within 60 s) and a refresh token is available, performs an automatic
   * token refresh. Multiple concurrent callers share the same refresh promise
   * to avoid redundant refresh requests.
   */
  async ensureValidToken() {
    if (!_OpenBoxClient.REFRESH_ENABLED) {
      return;
    }
    if (!this.config.accessToken) {
      return;
    }
    if (!isTokenExpired(this.config.accessToken)) {
      return;
    }
    if (!this.config.refreshToken) {
      throw new OpenBoxApiError(
        "Access token is expired and no refresh token was provided",
        401,
        null
      );
    }
    if (!this.refreshPromise) {
      this.refreshPromise = this.performTokenRefresh();
    }
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }
  async performTokenRefresh() {
    try {
      const url = `${this.baseUrl}/auth/refresh`;
      const response = await fetch(url, {
        method: "POST",
        // See request() above for the credentials: 'omit' rationale .
        // same CSRF-cookie-leak applies to the refresh endpoint.
        credentials: "omit",
        headers: {
          "Content-Type": "application/json",
          "X-Openbox-Client": this.clientName,
          Authorization: `Bearer ${this.config.accessToken}`
        },
        body: JSON.stringify({ refreshToken: this.config.refreshToken })
      });
      if (!response.ok) {
        const body2 = await response.json().catch(() => null);
        throw new OpenBoxApiError(
          `Token refresh failed: ${response.status} ${response.statusText}`,
          response.status,
          body2
        );
      }
      const body = await response.json();
      const data = body?.data ?? body ?? {};
      const newAccess = data.accessToken ?? data.access_token;
      const newRefresh = data.refreshToken ?? data.refresh_token;
      if (!newAccess) {
        throw new OpenBoxApiError(
          `Token refresh returned no access token (keys: ${Object.keys(data).join(",")})`,
          500,
          body
        );
      }
      this.config.accessToken = newAccess;
      if (newRefresh) this.config.refreshToken = newRefresh;
      if (this.config.onTokenRefresh) {
        this.config.onTokenRefresh({
          accessToken: this.config.accessToken,
          refreshToken: this.config.refreshToken
        });
      }
    } catch (err) {
      if (err instanceof OpenBoxApiError) throw err;
      const message = err instanceof Error ? `Token refresh failed: ${err.message}` : "Token refresh failed";
      throw new OpenBoxApiError(message, 401, err);
    }
  }
  // -------------------------------------------------------------------------
  // Retry helpers
  // -------------------------------------------------------------------------
  static RETRYABLE_STATUSES = /* @__PURE__ */ new Set([429, 500, 502, 503, 504]);
  async executeWithRetry(url, fetchOptions) {
    const maxRetries = this.config.retry?.maxRetries ?? 3;
    const initialDelay = this.config.retry?.initialDelayMs ?? 500;
    const maxDelay = this.config.retry?.maxDelayMs ?? 3e4;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, fetchOptions);
        if (response.ok || !_OpenBoxClient.RETRYABLE_STATUSES.has(response.status)) {
          return response;
        }
        if (attempt === maxRetries) {
          return response;
        }
        const delay = this.getRetryDelay(response, attempt, initialDelay, maxDelay);
        await this.sleep(delay);
      } catch (err) {
        if (attempt === maxRetries || !(err instanceof TypeError)) {
          throw err;
        }
        const delay = this.calculateBackoff(attempt, initialDelay, maxDelay);
        await this.sleep(delay);
      }
    }
    throw new Error("Retry loop exited unexpectedly");
  }
  getRetryDelay(response, attempt, initialDelay, maxDelay) {
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) {
        const seconds = Number(retryAfter);
        if (!isNaN(seconds)) {
          return Math.min(seconds * 1e3, maxDelay);
        }
        const date = Date.parse(retryAfter);
        if (!isNaN(date)) {
          return Math.min(Math.max(date - Date.now(), 0), maxDelay);
        }
      }
    }
    return this.calculateBackoff(attempt, initialDelay, maxDelay);
  }
  calculateBackoff(attempt, initialDelay, maxDelay) {
    const exponential = initialDelay * Math.pow(2, attempt);
    const jitter = Math.random() * initialDelay * 0.5;
    return Math.min(exponential + jitter, maxDelay);
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  // -------------------------------------------------------------------------
  // Core request pipeline
  // -------------------------------------------------------------------------
  /**
   * Generic request method using native fetch with retry and rate limiting.
   */
  async request(method, path3, options) {
    this.checkPathPermissions(method, path3);
    await this.ensureValidToken();
    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }
    let url = `${this.baseUrl}${path3}`;
    if (options?.params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(options.params)) {
        if (value === void 0 || value === null) continue;
        if (Array.isArray(value)) {
          for (const v of value) {
            if (v !== void 0 && v !== null) searchParams.append(key, String(v));
          }
        } else {
          searchParams.append(key, String(value));
        }
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }
    const timeoutMs = this.config.timeoutMs ?? 3e4;
    const buildOptions = () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const authHeader = buildAuthHeader({
        apiKey: this.config.apiKey,
        accessToken: this.config.accessToken
      });
      return {
        init: {
          method,
          // credentials: 'omit' prevents RN/iOS from auto-sending cookies
          // leaked from a WKWebView via sharedCookiesEnabled. The backend's
          // CSRF guard (jwt-auth.guard.ts) fires when an XSRF-TOKEN cookie
          // is present without a matching X-XSRF-TOKEN header; JWT-only
          // clients (CLI, mobile SDK) don't have the header, so they 401.
          // Omitting cookies entirely is the right behavior for a Bearer-auth
          // API client; cookies should never affect SDK requests.
          credentials: "omit",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
            // Required by the backend's auth guard; presence-only check, value is arbitrary.
            // Each consumer sets its own via ClientConfig.clientName.
            "X-Openbox-Client": this.clientName
          },
          signal: controller.signal,
          body: options?.data !== void 0 ? JSON.stringify(options.data) : void 0
        },
        cancel: () => clearTimeout(timer)
      };
    };
    const first = buildOptions();
    let response;
    try {
      response = await this.executeWithRetry(url, first.init);
    } finally {
      first.cancel();
    }
    if (_OpenBoxClient.REFRESH_ENABLED && response.status === 401 && this.config.accessToken && this.config.refreshToken) {
      try {
        await this.performTokenRefresh();
        const retry = buildOptions();
        try {
          response = await this.executeWithRetry(url, retry.init);
        } finally {
          retry.cancel();
        }
      } catch {
      }
    }
    const contentType = response.headers.get("content-type");
    const isJson = contentType?.includes("application/json");
    if (!response.ok) {
      const body = isJson ? await response.json() : await response.text();
      throw new OpenBoxApiError(
        `Request failed: ${response.status} ${response.statusText}`,
        response.status,
        body
      );
    }
    if (!isJson) {
      const text = await response.text();
      return text;
    }
    const json = await response.json();
    return this.unwrap(json);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // HTTP helpers exposed to the generated wrapper base class (and to
  // hand-written overrides for endpoints that need bespoke logic). The
  // `http` prefix avoids name clashes with wire methods like
  // `getProfile` / `postEvent` that TypeScript would otherwise read as
  // overloads of an unprefixed `get` / `post`.
  async httpGet(path3, params) {
    return this.request("GET", path3, { params });
  }
  async httpPost(path3, data) {
    return this.request("POST", path3, { data });
  }
  async httpPut(path3, data, params) {
    return this.request("PUT", path3, { data, params });
  }
  async httpPatch(path3, data) {
    return this.request("PATCH", path3, { data });
  }
  async httpDelete(path3, data) {
    return this.request("DELETE", path3, { data });
  }
  /**
   * Unwraps the standard `{ status, data }` response envelope used by the
   * OpenBox API. If the response does not match the envelope shape, it is
   * returned as-is.
   */
  unwrap(response) {
    if (response !== null && typeof response === "object" && "data" in response) {
      return response.data;
    }
    return response;
  }
};
function requireApiUrl(value) {
  if (!value) throw new Error("OPENBOX_API_URL is required. Set the backend API URL explicitly.");
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

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
    if (this.finalized) return;
    this.finalized = true;
    await this.emit({ event_type: "WorkflowCompleted", status: "completed" });
    this.cleanupExitHandlers();
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
    if (this.finalized) return;
    this.finalized = true;
    await this.emit({
      event_type: "WorkflowFailed",
      status: "failed",
      error: errorInfoFrom(error)
    });
    this.cleanupExitHandlers();
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
    this.inFlight.add(activityId);
    try {
      const verdict = await this.emit({
        event_type: "ActivityStarted",
        activity_id: activityId,
        activity_type: activityType,
        activity_input: payload.input,
        spans: payload.spans
      });
      verdict.activityId = activityId;
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
        const startedVerdict = await this.emit({
          event_type: "ActivityStarted",
          activity_id: activityId,
          activity_type: activityType,
          activity_input: payload.input,
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
    const completedVerdict = await this.emit({
      event_type: "ActivityCompleted",
      activity_id: activityId,
      activity_type: activityType,
      activity_input: payload.input,
      activity_output: payload.output,
      spans: payload.spans
    });
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
    return this.runActivity("ActivityStarted", "on_tool_start", payload);
  }
  async onToolEnd(payload) {
    return this.runActivity("ActivityCompleted", "on_tool_end", payload);
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
    guardrailsResult: mapGuardrailsResult(response.guardrails_result)
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
      const out2 = cloneValue2(originalData);
      deepUpdateObject(out2, redacted[0]);
      return out2;
    }
    return redacted[0];
  }
  const out = cloneValue2(originalData);
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
    const out = cloneValue2(originalOutput);
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
function cloneValue2(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

// ts/src/copilotkit/results.ts
function applyOpenBoxTransform(original, verdict) {
  if (!hasGuardrailRedaction(verdict.guardrailsResult)) return original;
  const inputType = verdict.guardrailsResult?.inputType;
  if (inputType === "activity_output") {
    return applyOutputRedaction(cloneValue(original), verdict.guardrailsResult);
  }
  return applyInputRedaction(cloneValue(original), verdict.guardrailsResult);
}
function safePayload(safe, original, verdict, ids, changed) {
  const redactionSummary = hasGuardrailRedaction(verdict.guardrailsResult) ? summarizeGuardrailRedaction(verdict.guardrailsResult) : void 0;
  const status = isGovernanceAvailabilityFailure(verdict.reason) ? "error" : verdict.arm === "allow" && (redactionSummary || changed) ? "constrained" : statusForVerdict(verdict);
  const haltedAt = (/* @__PURE__ */ new Date()).toISOString();
  const session = status === "halted" ? {
    status: "halted",
    reason: verdict.reason || "OpenBox halted this CopilotKit session.",
    haltedAt,
    ...ids
  } : { status: "active" };
  return {
    safe,
    verdict,
    status,
    changed,
    rawBlocked: !isAllowed(verdict.arm),
    reason: verdict.reason || defaultReasonForVerdict(verdict.arm),
    message: verdict.reason || defaultReasonForVerdict(verdict.arm),
    redactionSummary,
    workflowId: ids.workflowId,
    runId: ids.runId,
    activityId: ids.activityId,
    session
  };
}
function safePayloadToCopilotResult(verdict, safePayload2) {
  return {
    schemaVersion: OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION,
    status: safePayload2.status,
    // Availability failures are not governance arms; never report them as
    // a policy block.
    verdict: safePayload2.status === "error" ? "error" : verdict.arm,
    executed: false,
    action: "copilotkit_runtime_gate",
    request: "CopilotKit runtime governance gate",
    destination: null,
    amountUsd: null,
    fields: null,
    audience: null,
    sensitivity: null,
    reason: safePayload2.reason,
    message: safePayload2.message,
    artifact: safePayload2.rawBlocked ? void 0 : safePayload2.safe,
    workflowId: safePayload2.workflowId,
    runId: safePayload2.runId,
    activityId: safePayload2.activityId,
    session: safePayload2.session,
    timings: safePayload2.timings,
    ...verdictMetadata(verdict, safePayload2.redactionSummary)
  };
}
function baseResult(input, ids) {
  const passthrough = Object.fromEntries(
    Object.entries(input).filter(
      ([key]) => !(/* @__PURE__ */ new Set([
        "action",
        "request",
        "destination",
        "amountUsd",
        "fields",
        "audience",
        "sensitivity",
        "workflowId",
        "runId",
        "activityId",
        "approvalId",
        "governanceEventId",
        "approved"
      ])).has(key)
    )
  );
  return {
    ...passthrough,
    schemaVersion: OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION,
    action: input.action,
    request: input.request,
    destination: typeof input.destination === "string" ? input.destination : null,
    amountUsd: typeof input.amountUsd === "number" ? input.amountUsd : null,
    fields: Array.isArray(input.fields) ? input.fields : null,
    audience: typeof input.audience === "string" ? input.audience : null,
    sensitivity: typeof input.sensitivity === "string" ? input.sensitivity : null,
    workflowId: ids?.workflowId,
    runId: ids?.runId,
    activityId: ids?.activityId
  };
}
function approvalRequiredResult(input, ids, verdict) {
  return {
    ...baseResult(input, ids),
    status: "approval_required",
    verdict: "require_approval",
    executed: false,
    approvalId: verdict.approvalId,
    governanceEventId: verdict.governanceEventId,
    expiresAt: verdict.approvalExpiresAt,
    reason: verdict.reason || "OpenBox requires human approval.",
    message: "OpenBox requires human approval before this action can continue.",
    ...verdictMetadata(verdict)
  };
}
function stoppedResult(input, ids, verdict, executed = false) {
  if (isGovernanceAvailabilityFailure(verdict.reason)) {
    return {
      ...baseResult(input, ids),
      status: "error",
      verdict: "error",
      executed,
      reason: verdict.reason || "OpenBox governance evaluation was unavailable.",
      message: "OpenBox could not evaluate this action, so it was not executed (failed closed). This is an availability failure, not a policy decision.",
      session: { status: "active" },
      ...verdictMetadata(verdict)
    };
  }
  const status = verdict.arm === "halt" ? "halted" : "blocked";
  const haltedAt = (/* @__PURE__ */ new Date()).toISOString();
  return {
    ...baseResult(input, ids),
    status,
    verdict: verdict.arm,
    executed,
    reason: verdict.reason || "OpenBox stopped this action.",
    message: verdict.reason || "OpenBox stopped this action.",
    session: status === "halted" ? {
      status: "halted",
      reason: verdict.reason || "OpenBox halted this conversation.",
      haltedAt,
      ...ids
    } : { status: "active" },
    ...verdictMetadata(verdict)
  };
}
function rejectedResult(input, ids, verdict) {
  return {
    ...baseResult(input, ids),
    status: "rejected",
    verdict: "block",
    executed: false,
    reason: verdict.reason || "OpenBox approval was rejected.",
    message: verdict.reason || "OpenBox approval was rejected.",
    ...verdictMetadata(verdict)
  };
}
function isGovernanceAvailabilityFailure(reason) {
  if (typeof reason !== "string") return false;
  return /\b(?:opa|policy|guardrail|governance)\b[\s\S]*\bunavailable\b|\bunavailable\b[\s\S]*\b(?:opa|policy|guardrail|governance)\b/i.test(
    reason
  );
}
function executedResult(input, ids, artifact, reason, verdict, redactionSummary) {
  return {
    ...baseResult(input, ids),
    status: "executed",
    verdict: "allow",
    executed: true,
    reason,
    message: `Governed action '${input.action}' executed.`,
    artifact,
    session: { status: "active" },
    ...verdictMetadata(verdict, redactionSummary)
  };
}
function resultForAllowedVerdict(input, ids, verdict, artifact, reason, redactionSummary) {
  const result = executedResult(
    input,
    ids,
    artifact,
    reason,
    verdict,
    redactionSummary
  );
  if (verdict.arm !== "constrain") {
    if (redactionSummary) {
      return {
        ...result,
        status: "constrained",
        verdict: "constrain"
      };
    }
    return result;
  }
  return {
    ...result,
    status: "constrained",
    verdict: "constrain",
    reason: verdict.reason || "OpenBox constrained this output.",
    message: "OpenBox allowed the action with constrained output."
  };
}
function errorResult(input, ids, error) {
  const message = errorMessage(error);
  const governanceUnavailable = /request failed|fetch failed|timeout|econnreset|etimedout|und_err|operation was aborted/i.test(
    message
  );
  return {
    ...baseResult(input, ids),
    status: "error",
    verdict: "error",
    executed: false,
    reason: message,
    message: governanceUnavailable ? "OpenBox could not evaluate this action, so it was not executed (failed closed). This is an availability failure, not a policy decision." : "The governed action failed before a business result was produced. No business result was released.",
    session: { status: "active" }
  };
}
function applyStartedRedaction(definition, input, verdict) {
  if (!hasGuardrailRedaction(verdict.guardrailsResult)) return { input };
  const redactedTools = applyInputRedaction(
    cloneValue([toolInputForRedaction(definition, input)]),
    verdict.guardrailsResult
  );
  const redactedArgs = redactedTools?.[0]?.args;
  return {
    input: redactedArgs && typeof redactedArgs === "object" ? { ...input, ...redactedArgs, action: input.action } : input,
    summary: summarizeGuardrailRedaction(
      verdict.guardrailsResult,
      "Input redacted by OpenBox guardrails."
    )
  };
}
function applyCompletedRedaction(definition, result, verdict, existingSummary) {
  const coreRedacted = hasGuardrailRedaction(verdict.guardrailsResult);
  const redactedResult = coreRedacted ? applyOutputRedaction(
    cloneValue(result),
    verdict.guardrailsResult
  ) : result;
  const visibleRedaction = definition.isArtifactRedacted?.(redactedResult.artifact) ?? false;
  const finalResult = coreRedacted && redactedResult.artifact && definition.markArtifactRedacted ? {
    ...redactedResult,
    artifact: definition.markArtifactRedacted(redactedResult.artifact)
  } : redactedResult;
  const summary = [
    existingSummary,
    coreRedacted ? summarizeGuardrailRedaction(
      verdict.guardrailsResult,
      "Output redacted by OpenBox guardrails."
    ) : void 0
  ].filter(Boolean).join(" ");
  if (verdict.arm === "constrain" || coreRedacted || visibleRedaction) {
    return {
      ...finalResult,
      status: "constrained",
      verdict: "constrain",
      reason: verdict.reason || "OpenBox allowed the action with constrained output for sensitive fields.",
      message: "OpenBox allowed the action with constrained output.",
      ...mergedVerdictMetadata(finalResult, verdict, summary || void 0)
    };
  }
  return {
    ...finalResult,
    ...mergedVerdictMetadata(finalResult, verdict, summary || void 0)
  };
}
function verdictMetadata(verdict, redactionSummary) {
  return {
    riskScore: verdict?.riskScore,
    trustTier: verdict?.trustTier,
    guardrailsResult: verdict?.guardrailsResult,
    redactionSummary
  };
}
function mergedVerdictMetadata(result, verdict, redactionSummary) {
  return {
    riskScore: verdict.riskScore ?? result.riskScore,
    trustTier: verdict.trustTier ?? result.trustTier,
    guardrailsResult: verdict.guardrailsResult ?? result.guardrailsResult,
    redactionSummary: redactionSummary || result.redactionSummary
  };
}
function mapGuardrailsResult2(value) {
  if (!value || typeof value !== "object") return void 0;
  const raw = value;
  const inputType = raw.inputType ?? raw.input_type;
  return {
    inputType: inputType === "activity_output" ? "activity_output" : "activity_input",
    redactedInput: raw.redactedInput ?? raw.redacted_input,
    validationPassed: raw.validationPassed ?? raw.validation_passed ?? true,
    reasons: (raw.reasons ?? []).map((reason) => ({
      type: String(reason.type ?? ""),
      field: typeof reason.field === "string" ? reason.field : void 0,
      reason: String(reason.reason ?? "")
    })),
    fieldResults: [
      ...raw.fieldResults ?? [],
      ...(raw.results ?? []).flatMap((group) => group.results ?? [])
    ].map((field) => ({
      field: String(field.field ?? ""),
      status: normalizeGuardrailStatus(field.status),
      reason: typeof field.reason === "string" ? field.reason : void 0
    }))
  };
}
function normalizeArm2(value) {
  if (value === "allow" || value === "constrain" || value === "require_approval" || value === "block" || value === "halt") {
    return value;
  }
  if (value === "continue") return "allow";
  if (value === "stop") return "block";
  return "block";
}
function isAllowed(arm) {
  return arm === "allow" || arm === "constrain";
}
function toolInputForRedaction(definition, input) {
  return {
    id: void 0,
    name: definition.toolName,
    args: input,
    description: definition.description
  };
}
function normalizeGuardrailStatus(value) {
  if (value === "blocked" || value === "block") return "blocked";
  if (value === "redacted" || value === "transformed") return "redacted";
  if (value === "allowed" || value === "allow") return "allowed";
  return "skipped";
}
function statusForVerdict(verdict) {
  if (verdict.arm === "allow") return "executed";
  if (verdict.arm === "constrain") return "constrained";
  if (verdict.arm === "require_approval") return "approval_required";
  if (verdict.arm === "halt") return "halted";
  return "blocked";
}
function defaultReasonForVerdict(arm) {
  if (arm === "allow") return "OpenBox allowed this CopilotKit runtime event.";
  if (arm === "constrain")
    return "OpenBox constrained this CopilotKit runtime event.";
  if (arm === "require_approval") return "OpenBox requires human approval.";
  if (arm === "halt") return "OpenBox halted this CopilotKit session.";
  return "OpenBox blocked this CopilotKit runtime event.";
}

// ts/src/copilotkit/workflow-session.ts
var startedWorkflowRuns = /* @__PURE__ */ new Set();
var TERMINAL_EVENT_TIMEOUT_MS = 5e3;
var activeWorkflows = /* @__PURE__ */ new WeakMap();
var LAST_WORKFLOW_KEY = "__openbox_last_workflow__";
function registerActiveWorkflow(adapter, sessionKey, entry) {
  let map = activeWorkflows.get(adapter);
  if (!map) {
    map = /* @__PURE__ */ new Map();
    activeWorkflows.set(adapter, map);
  }
  map.set(sessionKey, entry);
  map.set(LAST_WORKFLOW_KEY, entry);
}
function activeWorkflowFor(adapter, sessionKey) {
  const map = activeWorkflows.get(adapter);
  return map?.get(sessionKey) ?? map?.get(LAST_WORKFLOW_KEY);
}
function clearActiveWorkflow(adapter, sessionKey, workflowId) {
  const map = activeWorkflows.get(adapter);
  if (!map) return;
  const entry = map.get(sessionKey);
  if (!workflowId || entry?.workflowId === workflowId) map.delete(sessionKey);
  const last = map.get(LAST_WORKFLOW_KEY);
  if (last && (!workflowId || last.workflowId === workflowId)) {
    map.delete(LAST_WORKFLOW_KEY);
  }
}
function clearAllActiveWorkflows(adapter) {
  activeWorkflows.get(adapter)?.clear();
}
function createWorkflowIds() {
  return {
    workflowId: randomUUID3(),
    runId: randomUUID3(),
    activityId: randomUUID3()
  };
}
function createWorkflowSession(adapter, ids, workflowType, taskQueue, options = {}) {
  return new presets.langchain({
    core: adapter.getCoreClient(),
    workflowId: ids.workflowId,
    runId: ids.runId,
    workflowType,
    taskQueue,
    registerExitHandlers: false,
    attached: options.attached,
    inlineApproval: options.inlineApproval
  });
}
async function pollApproval(adapter, ids) {
  const deadline = Date.now() + 1e4;
  let last;
  while (Date.now() < deadline) {
    const response = await adapter.getCoreClient().pollApproval({
      workflow_id: ids.workflowId,
      run_id: ids.runId,
      activity_id: ids.activityId
    });
    const extra = response;
    last = {
      arm: normalizeArm2(response.action),
      reason: response.reason,
      approvalExpiresAt: response.approval_expiration_time,
      riskScore: 0,
      trustTier: typeof extra.trust_tier === "number" ? extra.trust_tier : void 0,
      guardrailsResult: mapGuardrailsResult2(extra.guardrails_result)
    };
    if (last && last.arm !== "require_approval") return last;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return last ?? {
    arm: "require_approval",
    reason: "OpenBox approval is still pending.",
    riskScore: 0
  };
}
async function completeWorkflow(adapter, ids, workflowType, taskQueue) {
  await bestEffortTerminalEvent(
    () => createWorkflowSession(
      adapter,
      ids,
      workflowType,
      taskQueue
    ).workflowCompleted()
  );
}
async function finishStoppedWorkflow(adapter, ids, workflowType, taskQueue, verdict) {
  await failWorkflow(adapter, ids, workflowType, taskQueue, verdict.reason);
}
async function ensureWorkflowStarted(adapter, ids, workflowType, taskQueue) {
  const key = `${ids.workflowId}:${ids.runId}`;
  if (startedWorkflowRuns.has(key)) {
    return;
  }
  startedWorkflowRuns.add(key);
  try {
    await createWorkflowSession(
      adapter,
      ids,
      workflowType,
      taskQueue
    ).workflowStarted();
  } catch (error) {
    const message = errorMessage(error);
    if (message.includes("UQ_SESSIONS_WORKFLOW_RUN") || message.includes("duplicate key value violates unique constraint")) {
      return;
    }
    startedWorkflowRuns.delete(key);
    throw error;
  }
}
async function emitUserPromptSignal(adapter, ids, workflowType, taskQueue, prompt) {
  const signalArgs = prompt?.trim();
  if (!signalArgs) return;
  await createWorkflowSession(adapter, ids, workflowType, taskQueue, {
    attached: true
  }).activity("SignalReceived", "user_prompt", {
    signalName: "user_prompt",
    signalArgs,
    spans: [userPromptSpan(signalArgs)]
  });
}
async function failWorkflow(adapter, ids, workflowType, taskQueue, reason) {
  await bestEffortTerminalEvent(
    () => createWorkflowSession(
      adapter,
      ids,
      workflowType,
      taskQueue
    ).workflowFailed(typeof reason === "string" ? new Error(reason) : reason)
  );
}
async function bestEffortTerminalEvent(fn) {
  const terminalEvent = fn().catch(() => void 0);
  await swallow(
    () => Promise.race([
      terminalEvent,
      new Promise(
        (resolve) => setTimeout(resolve, TERMINAL_EVENT_TIMEOUT_MS)
      )
    ])
  );
}
function toolInput(definition, input) {
  return {
    id: void 0,
    name: definition.toolName,
    args: input,
    description: definition.description
  };
}
function toolSpan(definition, input, stage) {
  const now = Date.now();
  const profile = definition.spanProfile?.(input, stage);
  const base = {
    span_id: randomBytes(8).toString("hex"),
    trace_id: randomBytes(16).toString("hex"),
    name: definition.toolName,
    kind: "tool",
    start_time: now,
    end_time: now,
    duration_ns: 0,
    stage,
    attributes: {
      "openbox.tool.name": definition.toolName,
      "openbox.action": input.action,
      "tool.name": definition.toolName
    },
    data: input
  };
  if (!profile) return base;
  return {
    ...base,
    ...profile,
    attributes: {
      ...base.attributes,
      ...profile.attributes ?? {}
    },
    data: profile.data ?? base.data
  };
}
function userPromptSpan(prompt) {
  const now = Date.now();
  return {
    span_id: randomBytes(8).toString("hex"),
    trace_id: randomBytes(16).toString("hex"),
    name: "user_prompt",
    kind: "internal",
    start_time: now,
    end_time: now,
    duration_ns: 0,
    stage: "started",
    attributes: {
      "openbox.signal.name": "user_prompt"
    },
    data: { prompt }
  };
}

// ts/src/copilotkit/runtime.ts
function createOpenBoxCopilotRuntime(config, defaultAdapter) {
  const adapter = config.adapter ?? defaultAdapter();
  const baseRunner = config.runner ?? config.runtime.runner;
  if (!baseRunner?.run) {
    throw new OpenBoxCopilotKitError(
      "CopilotKit runtime runner is required for OpenBox native runtime governance."
    );
  }
  const governedRunner = createOpenBoxGovernedRunner(
    baseRunner,
    {
      adapter,
      agents: config.agents,
      sessionKey: config.sessionKey
    },
    defaultAdapter
  );
  const runtime = Object.create(config.runtime);
  Object.defineProperty(runtime, "runner", {
    value: governedRunner,
    enumerable: true,
    configurable: true
  });
  return {
    runtime,
    runner: governedRunner,
    hooks: createOpenBoxRuntimeHooks(
      {
        adapter,
        agents: config.agents
      },
      defaultAdapter
    )
  };
}
function createOpenBoxGovernedRunner(runner, config = {}, defaultAdapter) {
  const adapter = config.adapter ?? defaultAdapter();
  const agentSet = config.agents ? new Set(config.agents) : void 0;
  const sessionKeyForInput = config.sessionKey ?? ((input) => input.threadId || "default");
  const governedRunner = Object.create(Object.getPrototypeOf(runner));
  Object.defineProperties(governedRunner, {
    run: {
      value(request) {
        const agentRecord = objectRecord(request.agent);
        const agentId = typeof request.agentId === "string" ? request.agentId : typeof agentRecord.agentId === "string" ? agentRecord.agentId : typeof agentRecord.name === "string" ? agentRecord.name : typeof agentRecord.id === "string" ? agentRecord.id : void 0;
        if (agentSet && agentId && !agentSet.has(agentId)) {
          return runner.run(request);
        }
        return createDeferredObservable(runner, async (subscriber) => {
          const sessionKey = sessionKeyForInput(request.input);
          const governedInput = isRuntimePromptGoverned(request.input) ? request.input : await governRunPrompt(
            adapter,
            request.input,
            sessionKey,
            subscriber
          );
          if (!governedInput) return;
          const source = runner.run({ ...request, input: governedInput });
          pipeGovernedEvents(
            source,
            subscriber,
            adapter,
            sessionKey,
            governedInput,
            runtimeWorkflowConfig(adapter)
          );
        });
      },
      writable: true,
      enumerable: true,
      configurable: true
    },
    connect: {
      value: runner.connect?.bind(runner),
      writable: true,
      enumerable: true,
      configurable: true
    },
    isRunning: {
      value: runner.isRunning?.bind(runner),
      writable: true,
      enumerable: true,
      configurable: true
    },
    stop: {
      value: runner.stop?.bind(runner),
      writable: true,
      enumerable: true,
      configurable: true
    }
  });
  return governedRunner;
}
function createOpenBoxRuntimeHooks(config = {}, defaultAdapter) {
  const adapter = config.adapter ?? defaultAdapter();
  const agentSet = config.agents ? new Set(config.agents) : void 0;
  return {
    async onBeforeHandler(ctx) {
      if (ctx.route?.method !== "agent/run") return;
      const agentId = typeof ctx.route.agentId === "string" ? ctx.route.agentId : void 0;
      if (agentSet && (!agentId || !agentSet.has(agentId))) return;
      if (!adapter.isEnabled()) return;
      const body = await readJsonRequestBody(ctx.request);
      if (!isRecord(body)) return;
      const input = body;
      const sessionKey = input.threadId || "default";
      const ids = freshRuntimeWorkflowIdsFromInput(input);
      const promptGate = await adapter.governPrompt({
        payload: { messages: summarizeMessages(input.messages ?? []) },
        sessionKey,
        workflowId: ids.workflowId,
        runId: ids.runId,
        activityType: "on_chat_model_start",
        ensureWorkflowStarted: true
      });
      if (shouldStopForGate(promptGate, "enforce")) {
        throw openBoxSseResponse(
          input,
          adapter.toOpenBoxCopilotResult(promptGate.verdict, promptGate)
        );
      }
      const governedInput = markRuntimePromptGoverned(
        withOpenBoxRuntimeIds(
          withGovernedRunInput(input, promptGate.safe, promptGate.changed),
          ids
        )
      );
      return jsonRequestWithBody(ctx.request, governedInput);
    },
    async onResponse(ctx) {
      if (ctx.route?.method !== "agent/run") return;
      return void 0;
    },
    async onError(ctx) {
      if (ctx.error instanceof OpenBoxCopilotKitError) {
        return new Response(JSON.stringify({ error: ctx.error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
      return void 0;
    }
  };
}
async function readJsonRequestBody(request) {
  try {
    return await request.clone().json();
  } catch {
    return void 0;
  }
}
function jsonRequestWithBody(request, body) {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(body),
    redirect: request.redirect,
    credentials: request.credentials,
    cache: request.cache,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
    keepalive: request.keepalive,
    signal: request.signal
  });
}
function createDeferredObservable(runner, start) {
  return {
    subscribe(observerOrNext, error, complete) {
      const subscriber = normalizeSubscriber(observerOrNext, error, complete);
      start(subscriber).catch((err) => subscriber.error?.(err));
      return { unsubscribe() {
      } };
    }
  };
}
async function governRunPrompt(adapter, input, sessionKey, subscriber) {
  const promptGate = await adapter.governPrompt({
    payload: { messages: summarizeMessages(input.messages ?? []) },
    sessionKey,
    ...freshRuntimeWorkflowIdsFromInput(input),
    activityType: "on_chat_model_start",
    ensureWorkflowStarted: true
  });
  if (shouldStopForGate(promptGate, "enforce")) {
    emitOpenBoxRunResult(
      subscriber,
      input,
      adapter.toOpenBoxCopilotResult(promptGate.verdict, promptGate)
    );
    return void 0;
  }
  return withOpenBoxRuntimeIds(
    withGovernedRunInput(input, promptGate.safe, promptGate.changed),
    { workflowId: promptGate.workflowId, runId: promptGate.runId }
  );
}
function normalizeSubscriber(observerOrNext, error, complete) {
  if (typeof observerOrNext === "function") {
    return {
      next: observerOrNext,
      error: typeof error === "function" ? error : void 0,
      complete: typeof complete === "function" ? complete : void 0
    };
  }
  if (isRecord(observerOrNext)) {
    return observerOrNext;
  }
  return {};
}
function pipeGovernedEvents(source, subscriber, adapter, sessionKey, input, workflowConfig) {
  const pending = [];
  const ids = runtimeWorkflowIdsFromInput(input);
  let terminalized = false;
  let pendingError;
  let queuedTerminalEvent;
  let terminalFlushScheduled = false;
  const markCompleted = async () => {
    if (terminalized) return;
    terminalized = true;
    await completeWorkflow(
      adapter,
      ids,
      workflowConfig.workflowType,
      workflowConfig.taskQueue
    );
  };
  const markFailed = async (error) => {
    if (terminalized) return;
    terminalized = true;
    await failWorkflow(
      adapter,
      ids,
      workflowConfig.workflowType,
      workflowConfig.taskQueue,
      error
    );
  };
  const queuePending = (promise) => {
    pending.push(
      promise.catch(async (error) => {
        pendingError = error;
        await markFailed(error);
        subscriber.error?.(error);
      })
    );
  };
  const queueTerminalEvent = (event, kind, error) => {
    queuedTerminalEvent = { event, kind, error };
    if (terminalFlushScheduled) return;
    terminalFlushScheduled = true;
    setTimeout(() => {
      terminalFlushScheduled = false;
      void flushQueuedTerminalEvent().catch(async (flushError) => {
        pendingError = flushError;
        await markFailed(flushError);
        subscriber.error?.(flushError);
      });
    }, 0);
  };
  const waitForPendingGates = async () => {
    let settled = 0;
    while (settled < pending.length) {
      const snapshot = pending.slice(settled);
      settled = pending.length;
      await Promise.allSettled(snapshot);
    }
  };
  const flushQueuedTerminalEvent = async () => {
    if (!queuedTerminalEvent) return;
    const terminal = queuedTerminalEvent;
    queuedTerminalEvent = void 0;
    await waitForPendingGates();
    if (terminal.kind === "failed") {
      emit(terminal.event);
      await markFailed(terminal.error);
      return;
    }
    if (!pendingError) {
      emit(terminal.event);
      await markCompleted();
    }
  };
  const assistantBuffers = /* @__PURE__ */ new Map();
  const emit = (event) => subscriber.next?.(event);
  const subscription = source.subscribe({
    next(event) {
      if (!isRecord(event)) {
        emit(event);
        return;
      }
      const agEvent = event;
      const type = String(agEvent.type);
      if (isAssistantTextStart(agEvent)) {
        assistantBuffers.set(messageIdForEvent(agEvent), {
          start: agEvent,
          content: ""
        });
        return;
      }
      if (isAssistantTextContent(agEvent)) {
        const messageId = messageIdForEvent(agEvent);
        const buffer = assistantBuffers.get(messageId);
        if (!buffer) {
          emit(agEvent);
          return;
        }
        buffer.content += String(agEvent.delta ?? agEvent.content ?? "");
        return;
      }
      if (isToolResultEvent(agEvent) && governedResultEndsWorkflow(agEvent)) {
        terminalized = true;
        emit(agEvent);
        return;
      }
      if (isAssistantTextEnd(agEvent)) {
        const messageId = messageIdForEvent(agEvent);
        const buffer = assistantBuffers.get(messageId);
        if (!buffer) {
          emit(agEvent);
          return;
        }
        buffer.end = agEvent;
        assistantBuffers.delete(messageId);
        if (terminalized) {
          emit(buffer.start);
          emit({
            ...contentEventFromStart(buffer.start, buffer.content),
            type: contentEventType(type)
          });
          emit(buffer.end);
          return;
        }
        queuePending(
          (async () => {
            const gate = await adapter.governAssistantOutput({
              payload: { content: buffer.content },
              sessionKey,
              ...ids,
              activityType: "on_llm_end"
            });
            if (shouldStopForGate(gate, "enforce")) {
              terminalized = true;
              emitOpenBoxMessageEvents(
                subscriber,
                input,
                adapter.toOpenBoxCopilotResult(gate.verdict, gate),
                messageId
              );
              return;
            }
            const safeContent = contentFromSafePayload(
              gate.safe,
              buffer.content
            );
            emit(buffer.start);
            emit({
              ...contentEventFromStart(buffer.start, safeContent),
              type: contentEventType(type)
            });
            emit(buffer.end);
          })()
        );
        return;
      }
      const finalPayload = finalPayloadLocationForEvent(agEvent);
      if (finalPayload) {
        queuePending(
          (async () => {
            const gate = await adapter.governAssistantOutput({
              payload: finalPayload.payload,
              sessionKey,
              ...ids,
              activityType: "on_llm_end"
            });
            if (shouldStopForGate(gate, "enforce")) {
              terminalized = true;
              emitOpenBoxMessageEvents(
                subscriber,
                input,
                adapter.toOpenBoxCopilotResult(gate.verdict, gate)
              );
              if (isRunFinishedEvent(agEvent)) {
                queueTerminalEvent(
                  runFinishedWithoutFinalPayload(agEvent, finalPayload),
                  "completed"
                );
              }
              return;
            }
            const safeEvent = eventWithSafeFinalPayload(
              agEvent,
              finalPayload,
              gate.safe
            );
            if (isRunFinishedEvent(agEvent)) {
              queueTerminalEvent(safeEvent, "completed");
              return;
            }
            emit(safeEvent);
          })()
        );
        return;
      }
      if (isRunFinishedEvent(agEvent)) {
        queueTerminalEvent(agEvent, "completed");
        return;
      }
      if (isRunErrorEvent(agEvent)) {
        queueTerminalEvent(
          agEvent,
          "failed",
          new Error(
            typeof agEvent.message === "string" ? agEvent.message : "CopilotKit run error"
          )
        );
        return;
      }
      emit(agEvent);
    },
    error(error) {
      Promise.allSettled(pending).then(() => markFailed(error)).then(
        () => subscriber.error?.(error),
        () => subscriber.error?.(error)
      );
    },
    complete() {
      waitForPendingGates().then(
        async () => {
          if (pendingError) return;
          await flushQueuedTerminalEvent();
          if (pendingError) return;
          await markCompleted();
          subscriber.complete?.();
        },
        (error) => subscriber.error?.(error)
      );
    }
  });
  return subscription;
}
function runtimeWorkflowConfig(adapter) {
  const config = adapter.__openboxCopilotRuntimeConfig;
  return {
    workflowType: typeof config?.workflowType === "string" ? config.workflowType : DEFAULT_AGENT_WORKFLOW_TYPE,
    taskQueue: typeof config?.taskQueue === "string" ? config.taskQueue : DEFAULT_TASK_QUEUE
  };
}
function isAssistantTextStart(event) {
  const type = String(event.type);
  return (type === "TEXT_MESSAGE_START" || type === "TextMessageStart") && String(event.role ?? "assistant") === "assistant";
}
function isAssistantTextContent(event) {
  const type = String(event.type);
  return type === "TEXT_MESSAGE_CONTENT" || type === "TEXT_MESSAGE_CHUNK" || type === "TextMessageContent" || type === "TextMessageChunk";
}
function isAssistantTextEnd(event) {
  const type = String(event.type);
  return type === "TEXT_MESSAGE_END" || type === "TextMessageEnd";
}
function isRunFinishedEvent(event) {
  const type = String(event.type);
  return type === "RUN_FINISHED" || type === "RunFinished";
}
function isRunErrorEvent(event) {
  const type = String(event.type);
  return type === "RUN_ERROR" || type === "RunError";
}
function isToolResultEvent(event) {
  const type = String(event.type);
  return type === "TOOL_CALL_RESULT" || type === "ToolCallResult";
}
var WORKFLOW_ENDING_RESULT_STATUSES = /* @__PURE__ */ new Set([
  "blocked",
  "halted",
  "rejected",
  "error",
  "approval_required",
  "approval_pending"
]);
function governedResultEndsWorkflow(event) {
  const content = event.content;
  if (typeof content !== "string") return false;
  try {
    const parsed = JSON.parse(content);
    return isRecord(parsed) && parsed.schemaVersion === OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION && WORKFLOW_ENDING_RESULT_STATUSES.has(String(parsed.status));
  } catch {
    return false;
  }
}
function finalPayloadLocationForEvent(event) {
  if (!isFinalOutputEvent(event)) return void 0;
  for (const field of ["output", "result", "data", "payload", "message"]) {
    if (event[field] !== void 0 && event[field] !== null) {
      return { field, payload: event[field] };
    }
  }
  return void 0;
}
function isFinalOutputEvent(event) {
  const type = String(event.type);
  if (type === "RUN_FINISHED" || type === "RunFinished") {
    return true;
  }
  if (type !== "CUSTOM" && type !== "CUSTOM_EVENT" && type !== "CustomEvent") {
    return false;
  }
  if (event.final === true || event.isFinal === true) return true;
  const name = String(event.name ?? event.event ?? "").toLowerCase();
  return name.includes("assistant_final") || name.includes("final_output");
}
function eventWithSafeFinalPayload(event, location, safe) {
  return {
    ...event,
    [location.field]: finalPayloadFromSafe(safe, location.payload)
  };
}
function runFinishedWithoutFinalPayload(event, location) {
  const safeEvent = { ...event };
  delete safeEvent[location.field];
  return safeEvent;
}
function finalPayloadFromSafe(safe, original) {
  if (typeof original === "string" && isRecord(safe) && typeof safe.content === "string") {
    return safe.content;
  }
  return safe;
}
function messageIdForEvent(event) {
  return String(event.messageId ?? event.id ?? "openbox-message");
}
function contentEventType(endType) {
  return endType.startsWith("Text") ? "TextMessageContent" : "TEXT_MESSAGE_CONTENT";
}
function contentEventFromStart(start, content) {
  return {
    messageId: start?.messageId ?? start?.id ?? `openbox_message_${randomUUID4()}`,
    delta: content
  };
}
function contentFromSafePayload(safe, defaultContent) {
  if (typeof safe === "string") return safe;
  if (isRecord(safe) && typeof safe.content === "string") return safe.content;
  return defaultContent;
}
function withGovernedRunInput(input, safe, changed = true) {
  if (!changed) return input;
  if (isRecord(safe) && Array.isArray(safe.messages)) {
    return {
      ...input,
      messages: mergeMessageContent(input.messages, safe.messages)
    };
  }
  return input;
}
function isRuntimePromptGoverned(input) {
  return isRecord(input.state) && input.state[OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY] === true;
}
function markRuntimePromptGoverned(input) {
  const state = isRecord(input.state) ? input.state : {};
  return {
    ...input,
    state: {
      ...state,
      [OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY]: true
    }
  };
}
function runtimeWorkflowIdsFromInput(input) {
  const state = isRecord(input.state) ? input.state : {};
  const openboxSession = isRecord(state.openboxSession) ? state.openboxSession : {};
  const workflowId = typeof openboxSession.workflowId === "string" ? openboxSession.workflowId : typeof state.openboxWorkflowId === "string" ? state.openboxWorkflowId : randomUUID4();
  const candidateRunId = typeof openboxSession.runId === "string" ? openboxSession.runId : typeof state.openboxRunId === "string" ? state.openboxRunId : typeof input.runId === "string" ? input.runId : randomUUID4();
  return {
    workflowId,
    runId: candidateRunId === workflowId ? randomUUID4() : candidateRunId
  };
}
function freshRuntimeWorkflowIdsFromInput(input) {
  const workflowId = randomUUID4();
  const runId = typeof input.runId === "string" && input.runId !== workflowId ? input.runId : randomUUID4();
  return { workflowId, runId };
}
function withOpenBoxRuntimeIds(input, ids) {
  const state = isRecord(input.state) ? input.state : {};
  const openboxSession = isRecord(state.openboxSession) ? state.openboxSession : {};
  const forwardedProps = objectRecord(input.forwardedProps);
  const forwardedConfig = objectRecord(forwardedProps.config);
  const forwardedConfigurable = objectRecord(forwardedConfig.configurable);
  return {
    ...input,
    forwardedProps: {
      ...forwardedProps,
      config: {
        ...forwardedConfig,
        configurable: {
          ...forwardedConfigurable,
          openboxWorkflowId: ids.workflowId,
          openboxRunId: ids.runId,
          openboxPromptGoverned: true
        }
      }
    },
    state: {
      ...state,
      openboxWorkflowId: ids.workflowId,
      openboxRunId: ids.runId,
      openboxSession: {
        status: typeof openboxSession.status === "string" ? openboxSession.status : "active",
        ...openboxSession,
        workflowId: ids.workflowId,
        runId: ids.runId
      }
    }
  };
}
function emitOpenBoxRunResult(subscriber, input, result) {
  const runId = input.runId ?? randomUUID4();
  subscriber.next?.({
    type: "RUN_STARTED",
    threadId: input.threadId,
    runId,
    input
  });
  emitOpenBoxMessageEvents(subscriber, input, result);
  subscriber.next?.({
    type: "RUN_FINISHED",
    threadId: input.threadId,
    runId
  });
  subscriber.complete?.();
}
function emitOpenBoxMessageEvents(subscriber, _input, result, messageId = `openbox_message_${randomUUID4()}`) {
  const toolCallId = `openbox_runtime_gate_${randomUUID4().replace(/-/g, "")}`;
  const content = JSON.stringify(result);
  subscriber.next?.({
    type: "TOOL_CALL_START",
    toolCallId,
    toolCallName: "openbox_governed_action"
  });
  subscriber.next?.({
    type: "TOOL_CALL_ARGS",
    toolCallId,
    delta: JSON.stringify({
      action: result.action,
      request: result.request,
      destination: result.destination,
      amountUsd: result.amountUsd,
      fields: result.fields,
      audience: result.audience,
      sensitivity: result.sensitivity
    })
  });
  subscriber.next?.({
    type: "TOOL_CALL_END",
    toolCallId
  });
  subscriber.next?.({
    type: "TOOL_CALL_RESULT",
    messageId,
    toolCallId,
    content,
    role: "tool"
  });
}
function openBoxSseResponse(input, result) {
  const events = [];
  const subscriber = {
    next: (event) => events.push(event)
  };
  emitOpenBoxRunResult(subscriber, input, result);
  const body = events.map((event) => `data: ${JSON.stringify(event)}

`).join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

// ts/src/copilotkit/config-utils.ts
function getRuntimeApiKey(config) {
  return config.apiKey ?? process.env.OPENBOX_API_KEY;
}
function getApprovalBackendApiKey(config) {
  return config.backendApiKey ?? process.env.OPENBOX_BACKEND_API_KEY;
}
function createCoreClientResolver(config) {
  let coreClient = config.core;
  let coreClientCacheKey;
  return () => {
    if (config.core) return config.core;
    const apiKey = getRuntimeApiKey(config);
    const coreUrl = config.coreUrl ?? process.env.OPENBOX_CORE_URL;
    if (!apiKey) {
      throw new OpenBoxCopilotKitError(
        "OpenBox is enabled but the runtime API key is not configured."
      );
    }
    if (OPENBOX_BACKEND_API_KEY_PATTERN.test(apiKey)) {
      throw new OpenBoxCopilotKitError(
        "OpenBox CopilotKit runtime expected an agent runtime key in OPENBOX_API_KEY (obx_live_* or obx_test_*), but received an org/backend key (obx_key_*). Put org keys in OPENBOX_BACKEND_API_KEY."
      );
    }
    if (!OPENBOX_RUNTIME_KEY_PATTERN.test(apiKey)) {
      throw new OpenBoxCopilotKitError(
        "OpenBox is enabled but the runtime API key must be an obx_live_* or obx_test_* key."
      );
    }
    if (!coreUrl) {
      throw new OpenBoxCopilotKitError(
        "OpenBox is enabled but the Core URL is not configured."
      );
    }
    const agentIdentity = getAgentIdentity(config);
    const cacheKey = `${coreUrl}:${apiKey}:${agentIdentity?.did ?? ""}:${config.coreTimeoutMs ?? ""}`;
    if (!coreClient || coreClientCacheKey !== cacheKey) {
      coreClient = new OpenBoxCoreClient({
        apiKey,
        apiUrl: coreUrl,
        agentIdentity,
        timeoutMs: config.coreTimeoutMs
      });
      coreClientCacheKey = cacheKey;
    }
    return coreClient;
  };
}
function getAgentIdentity(config) {
  if (config.agentIdentity) return config.agentIdentity;
  const did = process.env.OPENBOX_AGENT_DID;
  const privateKey = process.env.OPENBOX_AGENT_PRIVATE_KEY;
  if (!did && !privateKey) return void 0;
  if (!did || !privateKey) {
    throw new OpenBoxCopilotKitError(
      "OpenBox signed agent identity requires both OPENBOX_AGENT_DID and OPENBOX_AGENT_PRIVATE_KEY."
    );
  }
  return { did, privateKey };
}

// ts/src/approvals/socket-client.ts
import * as net from "net";
import * as path from "path";
import * as os from "os";
var APPROVAL_SOCKET_PATH = path.join(
  os.homedir(),
  ".openbox",
  "run",
  "openbox.sock"
);

// ts/src/approvals/socket-server.ts
import * as net2 from "net";
import * as fs from "fs";
import * as path2 from "path";
import * as os2 from "os";
var RUN_DIR = path2.join(os2.homedir(), ".openbox", "run");
var SOCKET_PATH = path2.join(RUN_DIR, "openbox.sock");

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

// ts/src/copilotkit/approval-route.ts
function createOpenBoxApprovalRoute(config = {}) {
  return {
    async decide(request) {
      if (!request.governanceEventId && (!request.workflowId || !request.runId || !request.activityId)) {
        throw new Error(
          "OpenBox approval decision requires governanceEventId or workflowId, runId, and activityId."
        );
      }
      return decideViaBackend(config, request);
    }
  };
}
async function decideViaBackend(config, request) {
  const apiUrl = config.apiUrl ?? process.env.OPENBOX_API_URL;
  const apiKey = getApprovalBackendApiKey(config);
  const agentId = config.agentId ?? process.env.OPENBOX_AGENT_ID;
  if (!apiUrl) throw new Error("OpenBox API URL is not configured.");
  if (!apiKey) throw new Error("OpenBox backend API key is not configured.");
  if (!request.governanceEventId) {
    throw new Error(
      "OpenBox backend approval decision requires governanceEventId."
    );
  }
  const client = new OpenBoxClient({
    apiUrl: apiUrl.replace(/\/+$/, ""),
    apiKey,
    clientName: config.clientName ?? "openbox-copilotkit",
    timeoutMs: config.backendTimeoutMs
  });
  const resolved = await decideApproval(
    client,
    { governanceEventId: request.governanceEventId, agentId },
    request.decision
  );
  return {
    ok: true,
    decision: request.decision,
    eventId: resolved.eventId
  };
}

// ts/src/copilotkit/governed-tool.ts
import { randomUUID as randomUUID5 } from "crypto";
function createGovernedCopilotTool(definition) {
  const haltedSessions = /* @__PURE__ */ new Map();
  const workflowType = DEFAULT_WORKFLOW_TYPE;
  const taskQueue = DEFAULT_TASK_QUEUE;
  const normalize = (input) => definition.normalizeInput ? definition.normalizeInput(input) : input;
  const sessionKey = (config) => definition.sessionKey ? definition.sessionKey(config) : sessionKeyFromConfig(config);
  async function execute(input, runtimeConfig) {
    const normalizedInput = normalize(input);
    const timings = createTimingCollector(
      (event) => definition.onTimingEvent?.(event, { input: normalizedInput, runtimeConfig })
    );
    const key = sessionKey(runtimeConfig);
    const haltedSession = haltedSessions.get(key);
    if (haltedSession)
      return evaluateHaltedWorkflow(
        normalizedInput,
        key,
        haltedSession,
        runtimeConfig
      );
    const shared = sharedWorkflowFromConfig(runtimeConfig) ?? activeWorkflowFor(definition.adapter, key);
    if (process.env.OPENBOX_COPILOTKIT_DEBUG === "true") {
      console.error(
        `[openbox:governed-tool] key=${key} shared=${JSON.stringify(shared ?? null)} action=${String(normalizedInput.action ?? "")}`
      );
    }
    const ids = shared ? { ...createWorkflowIds(), workflowId: shared.workflowId, runId: shared.runId } : createWorkflowIds();
    const ridesSharedWorkflow = Boolean(shared);
    if (!definition.adapter.isEnabled()) {
      const artifact = await timings.measure(
        "tool_execution",
        "Business action",
        "tool",
        () => definition.execute(normalizedInput)
      );
      return withTimings(
        executedResult(
          normalizedInput,
          ids,
          artifact,
          "OpenBox disabled for local development."
        ),
        timings.finish()
      );
    }
    try {
      const session = createWorkflowSession(
        definition.adapter,
        ids,
        workflowType,
        taskQueue,
        { attached: true }
      );
      if (!ridesSharedWorkflow) {
        await timings.measure(
          "workflow_start",
          "Start governance workflow",
          "openbox",
          async () => {
            await session.workflowStarted();
            await emitUserPromptSignal(
              definition.adapter,
              ids,
              workflowType,
              taskQueue,
              normalizedInput.request
            );
          }
        );
      }
      const openedActivity = await timings.measure(
        "tool_input_gate",
        "Input policy check",
        "openbox",
        () => session.openActivity("on_tool_start", {
          activityId: ids.activityId,
          input: [toolInput(definition, normalizedInput)],
          spans: [toolSpan(definition, normalizedInput, "started")]
        })
      );
      const started = openedActivity.verdict;
      if (started.arm === "require_approval") {
        return withTimings(
          approvalRequiredResult(
            normalizedInput,
            ids,
            started
          ),
          timings.finish()
        );
      }
      if (!isAllowed(started.arm)) {
        await timings.measure(
          "workflow_stop",
          "Stop governance workflow",
          "openbox",
          () => finishStoppedWorkflow(
            definition.adapter,
            ids,
            workflowType,
            taskQueue,
            started
          )
        );
        if (ridesSharedWorkflow)
          clearActiveWorkflow(definition.adapter, key, ids.workflowId);
        const result2 = stoppedResult(normalizedInput, ids, started);
        if (result2.status === "halted")
          haltedSessions.set(key, result2.session);
        return withTimings(
          result2,
          timings.finish()
        );
      }
      const startedRedaction = applyStartedRedaction(
        definition,
        normalizedInput,
        started
      );
      const artifact = await timings.measure(
        "tool_execution",
        "Business action",
        "tool",
        () => definition.execute(startedRedaction.input)
      );
      const provisional = resultForAllowedVerdict(
        startedRedaction.input,
        ids,
        started,
        artifact,
        "OpenBox allowed this action.",
        startedRedaction.summary
      );
      const completed = await timings.measure(
        "tool_output_gate",
        "Output policy check",
        "openbox",
        () => openedActivity.complete(
          {
            input: [toolInput(definition, startedRedaction.input)],
            output: toolOutputForGovernance(provisional),
            spans: [toolSpan(definition, startedRedaction.input, "completed")]
          },
          "on_tool_end"
        )
      );
      if (!isAllowed(completed.arm)) {
        await timings.measure(
          "workflow_stop",
          "Stop governance workflow",
          "openbox",
          () => finishStoppedWorkflow(
            definition.adapter,
            ids,
            workflowType,
            taskQueue,
            completed
          )
        );
        if (ridesSharedWorkflow)
          clearActiveWorkflow(definition.adapter, key, ids.workflowId);
        const stopped = stoppedResult(
          startedRedaction.input,
          ids,
          completed,
          provisional.executed
        );
        if (stopped.status === "halted")
          haltedSessions.set(key, stopped.session);
        return withTimings(
          stopped,
          timings.finish()
        );
      }
      const result = applyCompletedRedaction(
        definition,
        provisional,
        completed,
        startedRedaction.summary
      );
      if (!ridesSharedWorkflow) {
        await timings.measure(
          "workflow_complete",
          "Complete governance workflow",
          "openbox",
          () => session.workflowCompleted()
        );
      }
      return withTimings(result, timings.finish());
    } catch (error) {
      await timings.measure(
        "workflow_fail",
        "Record governance failure",
        "openbox",
        () => failWorkflow(
          definition.adapter,
          ids,
          workflowType,
          taskQueue,
          error
        )
      );
      if (ridesSharedWorkflow)
        clearActiveWorkflow(definition.adapter, key, ids.workflowId);
      return withTimings(
        errorResult(
          normalizedInput,
          ids,
          error
        ),
        timings.finish()
      );
    }
  }
  async function resume(input, runtimeConfig) {
    const normalizedInput = normalize(input);
    const timings = createTimingCollector(
      (event) => definition.onTimingEvent?.(event, { input: normalizedInput, runtimeConfig })
    );
    const key = sessionKey(runtimeConfig);
    const haltedSession = haltedSessions.get(key);
    if (haltedSession)
      return evaluateHaltedWorkflow(
        normalizedInput,
        key,
        haltedSession,
        runtimeConfig
      );
    const ids = {
      workflowId: normalizedInput.workflowId,
      runId: normalizedInput.runId,
      activityId: normalizedInput.activityId
    };
    if (!definition.adapter.isEnabled()) {
      const artifact = await timings.measure(
        "tool_execution",
        "Business action",
        "tool",
        () => definition.execute(normalizedInput)
      );
      return withTimings(
        executedResult(
          normalizedInput,
          ids,
          artifact,
          "OpenBox disabled for local development."
        ),
        timings.finish()
      );
    }
    try {
      const polled = await timings.measure(
        "approval_poll",
        "Approval decision check",
        "openbox",
        () => pollApproval(definition.adapter, ids)
      );
      if (!isAllowed(polled.arm)) {
        await timings.measure(
          "workflow_stop",
          "Stop governance workflow",
          "openbox",
          () => finishStoppedWorkflow(
            definition.adapter,
            ids,
            workflowType,
            taskQueue,
            polled
          )
        );
        if (normalizedInput.approved === false)
          return withTimings(
            rejectedResult(
              normalizedInput,
              ids,
              polled
            ),
            timings.finish()
          );
        const stopped = stoppedResult(normalizedInput, ids, polled);
        if (stopped.status === "halted")
          haltedSessions.set(key, stopped.session);
        return withTimings(
          stopped,
          timings.finish()
        );
      }
      const artifact = await timings.measure(
        "tool_execution",
        "Business action",
        "tool",
        () => definition.execute(normalizedInput)
      );
      const result = resultForAllowedVerdict(
        normalizedInput,
        ids,
        polled,
        artifact,
        "OpenBox approval was granted."
      );
      const completed = await timings.measure(
        "tool_output_gate",
        "Output policy check",
        "openbox",
        () => createWorkflowSession(
          definition.adapter,
          ids,
          workflowType,
          taskQueue,
          { attached: true, inlineApproval: true }
        ).activity("ActivityCompleted", "on_tool_end", {
          activityId: ids.activityId,
          input: [approvalResumeToolInput(definition, normalizedInput)],
          output: toolOutputForGovernance(result),
          spans: [approvalResumeSpan(definition, normalizedInput)]
        })
      );
      const alreadyApprovedAgain = completed.arm === "require_approval" && normalizedInput.approved === true;
      if (!isAllowed(completed.arm) && !alreadyApprovedAgain) {
        await timings.measure(
          "workflow_stop",
          "Stop governance workflow",
          "openbox",
          () => finishStoppedWorkflow(
            definition.adapter,
            ids,
            workflowType,
            taskQueue,
            completed
          )
        );
        const stopped = stoppedResult(
          normalizedInput,
          ids,
          completed,
          result.executed
        );
        if (stopped.status === "halted")
          haltedSessions.set(key, stopped.session);
        return withTimings(
          stopped,
          timings.finish()
        );
      }
      await timings.measure(
        "workflow_complete",
        "Complete governance workflow",
        "openbox",
        () => completeWorkflow(definition.adapter, ids, workflowType, taskQueue)
      );
      return withTimings(
        applyCompletedRedaction(definition, result, completed),
        timings.finish()
      );
    } catch (error) {
      await timings.measure(
        "workflow_fail",
        "Record governance failure",
        "openbox",
        () => failWorkflow(
          definition.adapter,
          ids,
          workflowType,
          taskQueue,
          error
        )
      );
      return withTimings(
        errorResult(
          normalizedInput,
          ids,
          error
        ),
        timings.finish()
      );
    }
  }
  async function evaluateHaltedWorkflow(input, key, haltedSession, runtimeConfig) {
    const timings = createTimingCollector(
      (event) => definition.onTimingEvent?.(event, { input, runtimeConfig })
    );
    const generatedIds = createWorkflowIds();
    const ids = {
      workflowId: haltedSession.workflowId ?? generatedIds.workflowId,
      runId: haltedSession.runId ?? generatedIds.runId,
      activityId: generatedIds.activityId
    };
    if (!definition.adapter.isEnabled()) {
      return withTimings(
        stoppedResult(input, ids, {
          arm: "halt",
          reason: haltedSession.reason,
          riskScore: 0
        }),
        timings.finish()
      );
    }
    try {
      const { verdict } = await timings.measure(
        "halted_session_gate",
        "Halted session check",
        "openbox",
        () => createWorkflowSession(
          definition.adapter,
          { workflowId: ids.workflowId, runId: ids.runId },
          workflowType,
          taskQueue,
          { attached: true, inlineApproval: true }
        ).openActivity("on_tool_start", {
          activityId: ids.activityId,
          input: [toolInput(definition, input)],
          spans: [toolSpan(definition, input, "started")]
        })
      );
      if (isAllowed(verdict.arm)) {
        return withTimings(
          errorResult(
            input,
            ids,
            new Error(
              "OpenBox allowed an action on a previously halted CopilotKit workflow."
            )
          ),
          timings.finish()
        );
      }
      await timings.measure(
        "workflow_stop",
        "Stop governance workflow",
        "openbox",
        () => finishStoppedWorkflow(
          definition.adapter,
          ids,
          workflowType,
          taskQueue,
          verdict
        )
      );
      const stopped = stoppedResult(input, ids, verdict);
      if (stopped.status === "halted")
        haltedSessions.set(key, stopped.session);
      return withTimings(
        stopped,
        timings.finish()
      );
    } catch (error) {
      return withTimings(
        errorResult(
          input,
          ids,
          error
        ),
        timings.finish()
      );
    }
  }
  return { execute, resume };
}
function toolOutputForGovernance(result) {
  return { artifact: result.artifact };
}
function approvalResumeToolInput(definition, input) {
  return {
    id: void 0,
    name: definition.toolName,
    args: approvalResumeMetadata(input),
    description: definition.description
  };
}
function approvalResumeSpan(definition, input) {
  const now = Date.now();
  return {
    span_id: `approval-${randomUUID5().replaceAll("-", "").slice(0, 8)}`,
    trace_id: randomUUID5().replaceAll("-", ""),
    name: `${definition.toolName}.approval_resume`,
    kind: "internal",
    start_time: now,
    end_time: now,
    duration_ns: 0,
    stage: "completed",
    attributes: {
      "openbox.tool.name": definition.toolName,
      "openbox.approval.resume": true,
      "tool.name": definition.toolName
    },
    data: approvalResumeMetadata(input)
  };
}
function approvalResumeMetadata(input) {
  return {
    approved: input.approved === true,
    approvalId: input.approvalId,
    governanceEventId: input.governanceEventId,
    workflowId: input.workflowId,
    runId: input.runId,
    activityId: input.activityId
  };
}
function createTimingCollector(onTimingEvent) {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps = [];
  const emit = async (event) => {
    if (!onTimingEvent) return;
    try {
      await onTimingEvent(event);
    } catch (error) {
      console.warn(
        `[openbox:copilotkit] timing event observer failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
  return {
    async measure(key, label, kind, operation) {
      const stepStartedAt = Date.now();
      const stepStartedAtIso = new Date(stepStartedAt).toISOString();
      await emit({
        phase: "started",
        key,
        label,
        kind,
        startedAt: stepStartedAtIso
      });
      try {
        return await operation();
      } finally {
        const completedAtMs = Date.now();
        const ms = Math.max(0, completedAtMs - stepStartedAt);
        steps.push({
          key,
          label,
          kind,
          ms
        });
        await emit({
          phase: "finished",
          key,
          label,
          kind,
          startedAt: stepStartedAtIso,
          completedAt: new Date(completedAtMs).toISOString(),
          ms
        });
      }
    },
    finish() {
      const completedAtMs = Date.now();
      return {
        startedAt,
        completedAt: new Date(completedAtMs).toISOString(),
        totalMs: Math.max(0, completedAtMs - startedAtMs),
        steps: [...steps]
      };
    }
  };
}
function withTimings(result, timings) {
  return { ...result, timings };
}
function sharedWorkflowFromConfig(runtimeConfig) {
  if (!runtimeConfig || typeof runtimeConfig !== "object") return void 0;
  const configurable = runtimeConfig.configurable;
  if (!configurable || typeof configurable !== "object") return void 0;
  const workflowId = configurable.openboxWorkflowId;
  const runId = configurable.openboxRunId;
  if (typeof workflowId !== "string" || typeof runId !== "string")
    return void 0;
  return { workflowId, runId, owned: false };
}

// ts/src/copilotkit/langchain-middleware.ts
import { randomUUID as randomUUID6 } from "crypto";
function createOpenBoxLangChainMiddleware({
  adapter,
  deps,
  workflowType,
  taskQueue,
  selfGovernedToolNames,
  strict,
  governanceMode,
  failClosed
}) {
  const workflowKey = (...candidates) => {
    for (const candidate of candidates) {
      const key = sessionKeyFromConfig(candidate);
      if (key !== "default") return key;
    }
    return "default";
  };
  const workflowIdsFor = (key, state) => {
    const registered = activeWorkflowFor(adapter, key);
    return {
      workflowId: workflowIdFromState(state) ?? registered?.workflowId,
      runId: runIdFromState(state) ?? registered?.runId
    };
  };
  const debugState = (hook, state) => {
    if (process.env.OPENBOX_COPILOTKIT_DEBUG !== "true") return;
    const record = isRecord(state) ? state : {};
    console.error(
      `[openbox:${hook}] stateKeys=${JSON.stringify(Object.keys(record))} openboxSession=${JSON.stringify(record.openboxSession ?? null)} workflowId=${String(record.openboxWorkflowId ?? "")}`
    );
  };
  const contextIds = (runtimeLike) => {
    const record = objectRecord(runtimeLike);
    const context = objectRecord(record.context);
    const configurable = objectRecord(record.configurable);
    const pick = (key) => typeof context[key] === "string" ? context[key] : typeof configurable[key] === "string" ? configurable[key] : void 0;
    return {
      workflowId: pick("openboxWorkflowId"),
      runId: pick("openboxRunId"),
      promptGoverned: context.openboxPromptGoverned === true || configurable.openboxPromptGoverned === true
    };
  };
  const ensureTaskWorkflow = async (key, state, runtimeLike) => {
    const fromContext = contextIds(runtimeLike);
    if (process.env.OPENBOX_COPILOTKIT_DEBUG === "true") {
      console.error(
        `[openbox:ensure] key=${key} fromContext=${JSON.stringify(fromContext)} stateWorkflowId=${String(workflowIdFromState(state) ?? "")}`
      );
    }
    if (fromContext.workflowId && fromContext.runId) {
      const adopted = {
        workflowId: fromContext.workflowId,
        runId: fromContext.runId,
        owned: false
      };
      registerActiveWorkflow(adapter, key, adopted);
      return adopted;
    }
    const existing = activeWorkflowFor(adapter, key);
    if (existing) return existing;
    const runtimeWorkflowId = workflowIdFromState(state);
    const runtimeRunId = runIdFromState(state);
    if (runtimeWorkflowId && runtimeRunId) {
      const adopted = {
        workflowId: runtimeWorkflowId,
        runId: runtimeRunId,
        owned: false
      };
      registerActiveWorkflow(adapter, key, adopted);
      return adopted;
    }
    const owned = {
      workflowId: randomUUID6(),
      runId: randomUUID6(),
      owned: true
    };
    registerActiveWorkflow(adapter, key, owned);
    const session = createWorkflowSession(
      adapter,
      { workflowId: owned.workflowId, runId: owned.runId },
      workflowType,
      taskQueue
    );
    await swallow(() => session.workflowStarted());
    await swallow(
      () => session.onChainStart({
        input: [{ runtime: "copilotkit", framework: "langchain" }]
      })
    );
    return owned;
  };
  return deps.createMiddleware({
    name: "openbox_copilotkit",
    stateSchema: deps.stateSchema,
    contextSchema: deps.contextSchema,
    wrapModelCall: async (request, handler) => {
      if (!adapter.isEnabled()) return handler(request);
      debugState("wrapModelCall", request.state);
      const key = sessionKeyFromConfig(request);
      const gateIds = await ensureTaskWorkflow(
        key,
        request.state,
        request.runtime
      );
      const session = createWorkflowSession(
        adapter,
        { workflowId: gateIds.workflowId, runId: gateIds.runId },
        workflowType,
        taskQueue
      );
      const runtimePromptGoverned = isRecord(request.state) && request.state[OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY] === true || contextIds(request.runtime).promptGoverned;
      if (!runtimePromptGoverned) {
        const promptGate = await adapter.governPrompt({
          payload: modelInput(request),
          sessionKey: key,
          workflowId: gateIds.workflowId,
          runId: gateIds.runId,
          activityType: "on_chat_model_start"
        });
        if (shouldStopForGate(promptGate, governanceMode)) {
          return new deps.AIMessage({
            content: JSON.stringify(
              adapter.toOpenBoxCopilotResult(promptGate.verdict, promptGate)
            )
          });
        }
        request = withGovernedModelInput(
          request,
          promptGate.safe,
          promptGate.changed
        );
      }
      const governedRoute = deps.routeLatestUserPrompt?.(request.messages);
      if (governedRoute) {
        return new deps.AIMessage({
          content: "",
          tool_calls: [
            {
              id: `openbox_preflight_${randomUUID6().replace(/-/g, "")}`,
              name: governedRoute.toolName,
              args: governedRoute.args
            }
          ]
        });
      }
      try {
        const response = await handler(request);
        if (runtimePromptGoverned) return response;
        const responseGate = await adapter.governAssistantOutput({
          payload: toPlain(response),
          sessionKey: key,
          workflowId: gateIds.workflowId,
          runId: gateIds.runId,
          activityType: "on_llm_end"
        });
        if (shouldStopForGate(responseGate, governanceMode)) {
          return new deps.AIMessage({
            content: JSON.stringify(
              adapter.toOpenBoxCopilotResult(
                responseGate.verdict,
                responseGate
              )
            )
          });
        }
        return withGovernedAssistantOutput(response, responseGate.safe);
      } catch (error) {
        await swallow(
          () => session.onLlmError({ output: errorOutput(error) })
        );
        await swallow(() => session.workflowFailed(error));
        if (!failClosed) throw error;
        throw error;
      }
    },
    wrapToolCall: async (request, handler) => {
      if (!adapter.isEnabled()) return handler(request);
      if (selfGovernedToolNames.has(String(request.toolCall?.name)))
        return handler(request);
      const key = sessionKeyFromConfig(request);
      const gateIds = await ensureTaskWorkflow(
        key,
        request.state,
        request.runtime
      );
      const session = createWorkflowSession(
        adapter,
        { workflowId: gateIds.workflowId, runId: gateIds.runId },
        workflowType,
        taskQueue
      );
      const inputGate = await adapter.governToolInput({
        payload: toolCallInput(request),
        sessionKey: key,
        workflowId: gateIds.workflowId,
        runId: gateIds.runId,
        activityType: "on_tool_start"
      });
      if (shouldStopForGate(inputGate, governanceMode)) {
        return JSON.stringify(
          adapter.toOpenBoxCopilotResult(inputGate.verdict, inputGate)
        );
      }
      request = withGovernedToolInput(request, inputGate.safe);
      try {
        const response = await handler(request);
        const outputGate = await adapter.governToolOutput({
          payload: toPlain(response),
          sessionKey: key,
          workflowId: gateIds.workflowId,
          runId: gateIds.runId,
          activityType: "on_tool_end"
        });
        if (shouldStopForGate(outputGate, governanceMode)) {
          return JSON.stringify(
            adapter.toOpenBoxCopilotResult(outputGate.verdict, outputGate)
          );
        }
        return outputGate.safe;
      } catch (error) {
        await swallow(
          () => session.onToolError({
            output: { toolName: request.toolCall?.name, ...errorOutput(error) }
          })
        );
        await swallow(() => session.workflowFailed(error));
        throw error;
      }
    },
    afterAgent: async (state, runtime) => {
      if (!adapter.isEnabled()) return;
      const key = workflowKey(runtime?.config, runtime, state);
      const fromContext = contextIds(runtime);
      const ids = workflowIdsFor(key, state);
      const workflowId = fromContext.workflowId ?? ids.workflowId;
      const runId = fromContext.runId ?? ids.runId;
      const active = activeWorkflowFor(adapter, key);
      const runtimeOwned = active !== void 0 && active.workflowId === workflowId && active.owned === false || fromContext.promptGoverned || isRecord(state) && state[OPENBOX_RUNTIME_PROMPT_GOVERNED_KEY] === true;
      clearAllActiveWorkflows(adapter);
      if (!workflowId || !runId) return;
      if (runtimeOwned) return;
      const session = createWorkflowSession(
        adapter,
        { workflowId, runId },
        workflowType,
        taskQueue
      );
      const finishGate = await adapter.governAssistantOutput({
        payload: {
          messages: summarizeMessages(state?.messages),
          structuredResponse: toPlain(state?.structuredResponse)
        },
        sessionKey: sessionKeyFromConfig(state),
        workflowId,
        runId,
        activityType: "on_agent_finish"
      });
      if (shouldStopForGate(finishGate, governanceMode) && strict) {
        await swallow(
          () => finishStoppedWorkflow(
            adapter,
            { workflowId, runId },
            workflowType,
            taskQueue,
            finishGate.verdict
          )
        );
        return;
      }
      await swallow(() => session.workflowCompleted());
    }
  });
}

// ts/src/copilotkit/pipeline.ts
import { randomBytes as randomBytes2, randomUUID as randomUUID7 } from "crypto";
function gateSession(adapter, ids, workflowType, taskQueue) {
  return createWorkflowSession(adapter, ids, workflowType, taskQueue, {
    attached: true,
    inlineApproval: true
  });
}
async function evaluateGate(adapter, input, ids) {
  const completed = input.kind === "tool_output" || input.kind === "assistant_output";
  const activityType = input.activityType ?? activityTypeForGate(input.kind);
  const session = gateSession(
    adapter,
    { workflowId: ids.workflowId, runId: ids.runId },
    input.workflowType,
    input.taskQueue
  );
  return session.activity(
    completed ? "ActivityCompleted" : "ActivityStarted",
    activityType,
    completed ? {
      activityId: ids.activityId,
      output: input.payload,
      spans: [pipelineSpan(input.kind, activityType, input.payload)]
    } : {
      activityId: ids.activityId,
      input: [input.payload],
      spans: [pipelineSpan(input.kind, activityType, input.payload)]
    }
  );
}
async function governPipelineGate(adapter, input) {
  const key = input.sessionKey ?? "default";
  const halted = input.haltedSessions.get(key);
  const ids = {
    workflowId: halted?.workflowId ?? input.workflowId ?? randomUUID7(),
    runId: halted?.runId ?? input.runId ?? randomUUID7(),
    activityId: input.activityId ?? randomUUID7()
  };
  if (halted) return governHaltedPipelineGate(adapter, input, ids, key, halted);
  if (!adapter.isEnabled()) {
    const verdict = {
      arm: "allow",
      reason: "OpenBox disabled for local development.",
      riskScore: 0
    };
    return safePayload(input.payload, input.payload, verdict, ids, false);
  }
  let workflowKnown = Boolean(input.workflowId && input.runId);
  try {
    const needsWorkflowStart = input.ensureWorkflowStarted || !input.workflowId || !input.runId || input.workflowId === input.runId;
    if (needsWorkflowStart) {
      await ensureWorkflowStarted(
        adapter,
        { workflowId: ids.workflowId, runId: ids.runId },
        input.workflowType,
        input.taskQueue
      );
    }
    workflowKnown = true;
    if (input.kind === "prompt") {
      await emitUserPromptSignal(
        adapter,
        { workflowId: ids.workflowId, runId: ids.runId },
        input.workflowType,
        input.taskQueue,
        promptTextFromPayload(input.payload)
      );
    }
    const verdict = await evaluateGate(adapter, input, ids);
    const safe = isAllowed(verdict.arm) ? applyOpenBoxTransform(input.payload, verdict) : input.payload;
    const changed = !sameJson(safe, input.payload);
    const payload = safePayload(safe, input.payload, verdict, ids, changed);
    if (payload.status === "blocked" || payload.status === "halted") {
      await swallow(
        () => finishStoppedWorkflow(
          adapter,
          { workflowId: ids.workflowId, runId: ids.runId },
          input.workflowType,
          input.taskQueue,
          verdict
        )
      );
    }
    if (payload.status === "halted") {
      input.haltedSessions.set(
        key,
        payload.session
      );
    }
    return payload;
  } catch (error) {
    if (!input.failClosed || input.governanceMode === "observe") {
      const verdict2 = {
        arm: "allow",
        reason: errorMessage(error),
        riskScore: 0
      };
      return safePayload(input.payload, input.payload, verdict2, ids, false);
    }
    if (workflowKnown) {
      await swallow(
        () => failWorkflow(
          adapter,
          { workflowId: ids.workflowId, runId: ids.runId },
          input.workflowType,
          input.taskQueue,
          error
        )
      );
    }
    const verdict = {
      arm: "block",
      reason: `OpenBox could not be reached; the action was not executed (failed closed). ${errorMessage(error)}`,
      riskScore: 0
    };
    return { ...safePayload(input.payload, input.payload, verdict, ids, false), status: "error" };
  }
}
async function governHaltedPipelineGate(adapter, input, ids, key, halted) {
  if (!adapter.isEnabled()) {
    const verdict = {
      arm: "halt",
      reason: halted.reason,
      riskScore: 0
    };
    return safePayload(input.payload, input.payload, verdict, ids, false);
  }
  let workflowKnown = Boolean(input.workflowId && input.runId);
  try {
    if (input.kind === "prompt") {
      workflowKnown = true;
      await emitUserPromptSignal(
        adapter,
        { workflowId: ids.workflowId, runId: ids.runId },
        input.workflowType,
        input.taskQueue,
        promptTextFromPayload(input.payload)
      );
    }
    const verdict = await evaluateGate(adapter, input, ids);
    if (isAllowed(verdict.arm)) {
      const failClosedVerdict = {
        ...verdict,
        arm: "block",
        reason: "OpenBox allowed a gate on a previously halted CopilotKit workflow.",
        riskScore: verdict.riskScore ?? 0
      };
      return safePayload(
        input.payload,
        input.payload,
        failClosedVerdict,
        ids,
        false
      );
    }
    const payload = safePayload(input.payload, input.payload, verdict, ids, false);
    if (payload.status === "blocked" || payload.status === "halted") {
      await swallow(
        () => finishStoppedWorkflow(
          adapter,
          { workflowId: ids.workflowId, runId: ids.runId },
          input.workflowType,
          input.taskQueue,
          verdict
        )
      );
    }
    if (payload.status === "halted") {
      input.haltedSessions.set(
        key,
        payload.session
      );
    }
    return payload;
  } catch (error) {
    if (!input.failClosed || input.governanceMode === "observe") {
      const verdict2 = {
        arm: "allow",
        reason: errorMessage(error),
        riskScore: 0
      };
      return safePayload(input.payload, input.payload, verdict2, ids, false);
    }
    if (workflowKnown) {
      await swallow(
        () => failWorkflow(
          adapter,
          { workflowId: ids.workflowId, runId: ids.runId },
          input.workflowType,
          input.taskQueue,
          error
        )
      );
    }
    const verdict = {
      arm: "block",
      reason: `OpenBox could not be reached; the action was not executed (failed closed). ${errorMessage(error)}`,
      riskScore: 0
    };
    return { ...safePayload(input.payload, input.payload, verdict, ids, false), status: "error" };
  }
}
function promptTextFromPayload(payload) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return void 0;
  const record = payload;
  if (typeof record.prompt === "string") return record.prompt;
  if (typeof record.request === "string") return record.request;
  if (Array.isArray(record.messages)) {
    const latestUser = [...record.messages].reverse().find(
      (message) => Boolean(message) && typeof message === "object" && ["user", "human"].includes(
        String(message.role ?? message.type ?? "")
      )
    );
    const latestContent = [...record.messages].reverse().find(
      (message) => Boolean(message) && typeof message === "object" && typeof message.content === "string" && !["system", "assistant", "ai", "tool"].includes(
        String(message.role ?? message.type ?? "")
      )
    );
    const content = latestUser?.content ?? latestContent?.content;
    if (typeof content === "string") return content;
  }
  return void 0;
}
function activityTypeForGate(kind) {
  switch (kind) {
    case "prompt":
      return "UserPromptSubmit";
    case "tool_input":
      return "on_tool_start";
    case "tool_output":
      return "on_tool_end";
    case "assistant_output":
      return "on_llm_end";
  }
}
function pipelineSpan(kind, activityType, payload) {
  const now = Date.now();
  const span = {
    span_id: randomBytes2(8).toString("hex"),
    trace_id: randomBytes2(16).toString("hex"),
    name: activityType,
    kind: "internal",
    start_time: now,
    end_time: now,
    duration_ns: 0,
    stage: kind === "prompt" || kind === "tool_input" ? "started" : "completed",
    attributes: {
      "openbox.copilotkit.gate": kind,
      "openbox.activity_type": activityType
    },
    data: payload
  };
  if (kind !== "assistant_output") return span;
  const assistantContent = assistantContentFromPayload(payload);
  if (!assistantContent) return span;
  return {
    ...span,
    name: "openbox.copilotkit.assistant_output",
    semantic_type: "llm_completion",
    response_body: JSON.stringify({
      choices: [{ message: { content: assistantContent } }]
    })
  };
}
function assistantContentFromPayload(payload) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return void 0;
  const record = payload;
  for (const key of ["content", "text", "summary", "body"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  const message = record.message;
  if (message && typeof message === "object") {
    const content = message.content;
    if (typeof content === "string" && content.trim()) return content;
  }
  if (Array.isArray(record.messages)) {
    const latestAssistant = [...record.messages].reverse().find(
      (message2) => Boolean(message2) && typeof message2 === "object" && ["assistant", "ai"].includes(
        String(
          message2.role ?? message2.type ?? ""
        )
      ) && typeof message2.content === "string"
    );
    if (typeof latestAssistant?.content === "string" && latestAssistant.content.trim()) {
      return latestAssistant.content;
    }
  }
  return void 0;
}

// ts/src/copilotkit/adapter.ts
function createOpenBoxCopilotKitAdapter(config = {}) {
  const getCoreClient = createCoreClientResolver(config);
  const strict = config.strict ?? true;
  const governanceMode = config.governanceMode ?? "enforce";
  const failClosed = config.failClosed ?? true;
  const redactionMode = config.redactionMode ?? "transformed-only";
  const workflowType = config.agentWorkflowType ?? DEFAULT_AGENT_WORKFLOW_TYPE;
  const taskQueue = config.taskQueue ?? DEFAULT_TASK_QUEUE;
  const haltedSessions = /* @__PURE__ */ new Map();
  const selfGovernedToolNames = /* @__PURE__ */ new Set([
    "openbox_governed_action",
    "openbox_governed_approval_action",
    "openbox_resume_governed_action",
    ...config.selfGovernedToolNames ?? []
  ]);
  const adapter = {
    isEnabled: () => config.enabled ?? (Boolean(config.core) || process.env.OPENBOX_ENABLED === "true"),
    getCoreClient,
    wrapAgent: (agent) => agent,
    createLangChainMiddleware: (deps) => createOpenBoxLangChainMiddleware({
      adapter,
      deps,
      workflowType,
      taskQueue,
      selfGovernedToolNames,
      strict,
      governanceMode,
      failClosed
    }),
    governPrompt: (input) => governPipelineGate(adapter, {
      kind: "prompt",
      workflowType,
      taskQueue,
      haltedSessions,
      strict,
      governanceMode,
      failClosed,
      redactionMode,
      ...input
    }),
    governToolInput: (input) => governPipelineGate(adapter, {
      kind: "tool_input",
      workflowType,
      taskQueue,
      haltedSessions,
      strict,
      governanceMode,
      failClosed,
      redactionMode,
      ...input
    }),
    governToolOutput: (input) => governPipelineGate(adapter, {
      kind: "tool_output",
      workflowType,
      taskQueue,
      haltedSessions,
      strict,
      governanceMode,
      failClosed,
      redactionMode,
      ...input
    }),
    governAssistantOutput: (input) => governPipelineGate(adapter, {
      kind: "assistant_output",
      workflowType,
      taskQueue,
      haltedSessions,
      strict,
      governanceMode,
      failClosed,
      redactionMode,
      ...input
    }),
    applyOpenBoxTransform: (original, verdict) => applyOpenBoxTransform(original, verdict),
    toOpenBoxCopilotResult: (verdict, safePayload2) => safePayloadToCopilotResult(verdict, safePayload2),
    haltSession: (sessionKey, session) => {
      haltedSessions.set(sessionKey, session);
    },
    isSessionHalted: (sessionKey) => haltedSessions.get(sessionKey),
    governTool: (definition) => createGovernedCopilotTool({
      adapter,
      ...definition
    }),
    approvalRoute: createOpenBoxApprovalRoute(config),
    rendering: {
      governedToolNames: [
        "openbox_governed_action",
        "openbox_governed_approval_action",
        "openbox_resume_governed_action"
      ],
      approvalToolName: "openboxApprovalReview",
      interactiveToolName: "openboxInteractiveReview",
      isGovernedToolResult: (value) => {
        const parsed = parseToolResult(value);
        return typeof parsed.status === "string" && typeof parsed.verdict === "string";
      },
      parseToolResult
    }
  };
  Object.defineProperty(adapter, "__openboxCopilotRuntimeConfig", {
    value: { workflowType, taskQueue },
    enumerable: false,
    configurable: false
  });
  return adapter;
}

// ts/src/copilotkit/readiness.ts
function createOpenBoxReadinessCheck(config = {}) {
  return {
    async check() {
      const errors = [];
      const warnings = [];
      const mode = {
        enabled: config.enabled ?? process.env.OPENBOX_ENABLED !== "false",
        strict: config.strict ?? true,
        governanceMode: config.governanceMode ?? "enforce",
        failClosed: config.failClosed ?? true
      };
      const apiUrl = config.apiUrl ?? process.env.OPENBOX_API_URL;
      const apiKey = getApprovalBackendApiKey(config);
      const agentId = config.agentId ?? process.env.OPENBOX_AGENT_ID;
      const core = await readinessStep(errors, "core", async () => {
        createCoreClientResolver(config)();
      });
      if (!apiUrl || !apiKey || !agentId) {
        const missing = [
          !apiUrl ? "OPENBOX_API_URL" : void 0,
          !apiKey ? "OPENBOX_BACKEND_API_KEY" : void 0,
          !agentId ? "OPENBOX_AGENT_ID" : void 0
        ].filter(Boolean).join(", ");
        warnings.push(`backend inventory not checked: missing ${missing}`);
        return {
          ok: core,
          mode,
          core,
          guardrails: false,
          policies: false,
          behaviorRules: false,
          approvals: false,
          capabilities: {
            promptGovernance: core,
            toolInputGovernance: core,
            toolOutputGovernance: core,
            finalOutputGovernance: core,
            approvals: false,
            guardrails: core,
            policies: core,
            behaviorRules: core
          },
          errors,
          warnings
        };
      }
      const client = new OpenBoxClient({
        apiUrl: apiUrl.replace(/\/+$/, ""),
        apiKey,
        clientName: config.clientName ?? "openbox-copilotkit"
      });
      const guardrails = await readinessStep(
        errors,
        "guardrails",
        () => client.listGuardrails(agentId)
      );
      const policies = await readinessStep(
        errors,
        "policies",
        () => client.getCurrentPolicies(agentId)
      );
      const behaviorRules = await readinessStep(
        errors,
        "behavior rules",
        () => client.getCurrentBehaviorRules(agentId)
      );
      const approvals = await readinessStep(
        errors,
        "approvals",
        () => client.getPendingApprovals(agentId)
      );
      return {
        ok: core && guardrails && policies && behaviorRules && approvals,
        mode,
        core,
        guardrails,
        policies,
        behaviorRules,
        approvals,
        capabilities: {
          promptGovernance: core,
          toolInputGovernance: core,
          toolOutputGovernance: core,
          finalOutputGovernance: core,
          approvals,
          guardrails,
          policies,
          behaviorRules
        },
        errors,
        warnings
      };
    }
  };
}
async function readinessStep(errors, name, fn) {
  try {
    await fn();
    return true;
  } catch (error) {
    errors.push(`${name}: ${errorMessage(error)}`);
    return false;
  }
}

// ts/src/copilotkit/index.ts
function createOpenBoxCopilotRuntime2(config) {
  return createOpenBoxCopilotRuntime(
    config,
    () => createOpenBoxCopilotKitAdapter()
  );
}
function createOpenBoxGovernedRunner2(runner, config = {}) {
  return createOpenBoxGovernedRunner(
    runner,
    config,
    () => createOpenBoxCopilotKitAdapter()
  );
}
function createOpenBoxRuntimeHooks2(config = {}) {
  return createOpenBoxRuntimeHooks(
    config,
    () => createOpenBoxCopilotKitAdapter()
  );
}
export {
  OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION,
  OpenBoxCopilotKitError,
  createGovernedCopilotTool,
  createOpenBoxApprovalRoute,
  createOpenBoxCopilotKitAdapter,
  createOpenBoxCopilotRuntime2 as createOpenBoxCopilotRuntime,
  createOpenBoxGovernedRunner2 as createOpenBoxGovernedRunner,
  createOpenBoxReadinessCheck,
  createOpenBoxRuntimeHooks2 as createOpenBoxRuntimeHooks,
  parseToolResult
};
