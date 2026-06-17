// ts/src/runtime/mcp/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs2 from "fs";
import * as path5 from "path";

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
var ENV_VAR_BINDINGS = {
  apiUrl: { "name": "OPENBOX_API_URL" },
  coreUrl: { "name": "OPENBOX_CORE_URL" },
  platformUrl: { "name": "OPENBOX_PLATFORM_URL" },
  authUrl: { "name": "OPENBOX_AUTH_URL" },
  apiKey: { "name": "OPENBOX_API_KEY" }
};
var API_KEY_PATTERN = /^obx_(?:live|test)_[0-9a-f]{48}$/;
function validateApiKeyFormat(value) {
  if (!API_KEY_PATTERN.test(value)) {
    return "OPENBOX_API_KEY must match obx_(live|test)_<48hex>";
  }
  return true;
}
var CLIENT_VARIANT_PATTERN = /^[A-Za-z0-9._+-]+$/;

// ts/src/env/connection.ts
var resolveConnection = (opts = {}) => {
  const apiUrl = requireUrl(
    "OPENBOX_API_URL",
    opts.apiUrl ?? process.env[ENV_VAR_BINDINGS.apiUrl.name]
  );
  const coreUrl = requireUrl(
    "OPENBOX_CORE_URL",
    opts.coreUrl ?? process.env[ENV_VAR_BINDINGS.coreUrl.name]
  );
  const platformUrl = opts.platformUrl ?? process.env[ENV_VAR_BINDINGS.platformUrl.name];
  const authUrl = opts.authUrl ?? process.env[ENV_VAR_BINDINGS.authUrl.name];
  return {
    apiUrl,
    coreUrl,
    platformUrl,
    authUrl,
    source: "explicit"
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

// ts/src/env/agent-identity.ts
function resolveAgentIdentity(source = process.env) {
  const did = source.OPENBOX_AGENT_DID;
  const privateKey = source.OPENBOX_AGENT_PRIVATE_KEY;
  if (!did && !privateKey) return void 0;
  if (!did || !privateKey) {
    throw new Error(
      "OpenBox signed agent identity requires both OPENBOX_AGENT_DID and OPENBOX_AGENT_PRIVATE_KEY."
    );
  }
  return { did, privateKey };
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
    return new Promise((resolve3) => {
      setTimeout(() => {
        this.refill();
        this.tokens -= 1;
        resolve3();
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
  checkPathPermissions(verb, path6) {
    if (!this.permissions) return;
    const upperVerb = verb.toUpperCase();
    for (const rule of PATH_PERMISSION_RULES) {
      if (rule.verb !== upperVerb) continue;
      if (!rule.pattern.test(path6)) continue;
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
  async requestOperation(method, path6, options) {
    return this.request(method, path6, options);
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
    return new Promise((resolve3) => setTimeout(resolve3, ms));
  }
  // -------------------------------------------------------------------------
  // Core request pipeline
  // -------------------------------------------------------------------------
  /**
   * Generic request method using native fetch with retry and rate limiting.
   */
  async request(method, path6, options) {
    this.checkPathPermissions(method, path6);
    await this.ensureValidToken();
    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }
    let url = `${this.baseUrl}${path6}`;
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
  async httpGet(path6, params) {
    return this.request("GET", path6, { params });
  }
  async httpPost(path6, data) {
    return this.request("POST", path6, { data });
  }
  async httpPut(path6, data, params) {
    return this.request("PUT", path6, { data, params });
  }
  async httpPatch(path6, data) {
    return this.request("PATCH", path6, { data });
  }
  async httpDelete(path6, data) {
    return this.request("DELETE", path6, { data });
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
import { createHash, createPrivateKey, randomUUID, sign } from "crypto";

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
  async requestOperation(method, path6, options) {
    const renderedPath = appendQuery(path6, options?.params);
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
  async request(method, path6, options) {
    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }
    const url = `${this.baseUrl}${path6}`;
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
function appendQuery(path6, params) {
  if (!params) return path6;
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
  if (!query) return path6;
  return `${path6}${path6.includes("?") ? "&" : "?"}${query}`;
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

// ts/src/file-tokens/index.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "fs";
import { dirname, resolve as resolve2 } from "path";

// ts/src/env/os-paths.ts
import { join, resolve } from "path";
function openboxDataRoot() {
  const override = process.env.OPENBOX_HOME;
  if (override) return resolve(override);
  return resolve(process.cwd(), ".openbox");
}
var resolveOsPath = (scope) => {
  return join(openboxDataRoot(), scope);
};

// ts/src/file-tokens/agent-keys.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
function getPath() {
  return resolveOsPath("agent-keys");
}
function read() {
  const path6 = getPath();
  if (!existsSync(path6)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path6, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function recallAgentKey(agentId) {
  return read()[agentId] ?? null;
}

// ts/src/file-tokens/index.ts
function getTokenPath() {
  const projectTokens = resolve2(process.cwd(), ".tokens");
  if (existsSync2(projectTokens)) return projectTokens;
  return resolveOsPath("tokens");
}
function readTokenStore() {
  const path6 = getTokenPath();
  if (!existsSync2(path6)) return {};
  return parseTokenStore(readFileSync2(path6, "utf-8"));
}
function loadApiKey() {
  return process.env.OPENBOX_BACKEND_API_KEY ?? process.env.OPENBOX_API_KEY ?? readTokenStore().apiKey;
}

// ts/src/config/host-config.ts
import * as fs from "fs";
function loadJsonConfig(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k.toUpperCase().replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()] = String(v);
      out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}
function loadDotenv(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const out = {};
    for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

// ts/src/config/store.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync3, readFileSync as readFileSync4, writeFileSync as writeFileSync3 } from "fs";
var CONFIG_KEY = /^[A-Z][A-Z0-9_]*$/;
function getPath2() {
  return resolveOsPath("config");
}
function read2() {
  const path6 = getPath2();
  if (!existsSync4(path6)) return {};
  const out = {};
  for (const line of readFileSync4(path6, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (CONFIG_KEY.test(key)) out[key] = value;
  }
  return out;
}
function listConfig() {
  return read2();
}
function configStorePath() {
  return getPath2();
}

// ts/src/runtime/mcp/config.ts
var mcpCallerName;
function setMcpClientName(name) {
  mcpCallerName = name && name.length > 0 ? name : void 0;
}

// ts/src/approvals/source.ts
var SOURCE_INPUT_KEY = "_openbox_source";
function stampSource(payload, host) {
  return { ...payload, [SOURCE_INPUT_KEY]: host };
}

// ts/src/runtime/cursor/install.ts
import path2 from "path";

// ts/src/runtime/cursor/plugin.ts
import {
  cpSync,
  existsSync as existsSync5,
  lstatSync,
  mkdirSync as mkdirSync4,
  readFileSync as readFileSync5,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync as writeFileSync4
} from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

// ts/src/core-client/generated/runtime/cursor.ts
var HOOK_SPEC = {
  "file": ".cursor/hooks.json",
  "key": "hooks",
  "style": "cursor-keyed",
  "command": "openbox cursor hook",
  "configDir": ".cursor-hooks",
  "events": [
    {
      "name": "beforeSubmitPrompt",
      "timeout": 1800
    },
    {
      "name": "beforeReadFile",
      "timeout": 1800
    },
    {
      "name": "beforeShellExecution",
      "timeout": 1800
    },
    {
      "name": "beforeMCPExecution",
      "timeout": 1800
    },
    {
      "name": "preToolUse",
      "timeout": 1800
    },
    {
      "name": "afterAgentResponse"
    },
    {
      "name": "afterAgentThought"
    },
    {
      "name": "afterShellExecution"
    },
    {
      "name": "afterFileEdit"
    },
    {
      "name": "afterMCPExecution"
    },
    {
      "name": "postToolUse"
    },
    {
      "name": "postToolUseFailure"
    },
    {
      "name": "sessionStart"
    },
    {
      "name": "stop"
    },
    {
      "name": "beforeTabFileRead",
      "timeout": 1800
    },
    {
      "name": "afterTabFileEdit"
    },
    {
      "name": "sessionEnd"
    },
    {
      "name": "preCompact"
    },
    {
      "name": "subagentStart",
      "timeout": 1800
    },
    {
      "name": "subagentStop"
    }
  ]
};

// ts/src/runtime/cursor/plugin.ts
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var EXPECTED_COMMAND_FILES = [
  "openbox-check.md",
  "openbox-doctor.md",
  "openbox-list-agents.md",
  "openbox-pending.md",
  "openbox-status.md"
];
var EXPECTED_RULE_FILES = ["openbox.mdc"];
var EXPECTED_AGENT_FILES = ["openbox-reviewer.md"];
function cursorPluginTargetDir(cwd = process.cwd()) {
  return path.join(cwd, ".cursor", "plugins", "local", "openbox");
}
function readJson(file) {
  try {
    return JSON.parse(readFileSync5(file, "utf-8"));
  } catch {
    return void 0;
  }
}
function safeOutDir(out) {
  const resolved = path.resolve(out);
  const root = path.parse(resolved).root;
  if (resolved === root || resolved === os.homedir()) {
    throw new Error(`Refusing to overwrite unsafe plugin output path: ${resolved}`);
  }
  return resolved;
}
function checkFile(name, file) {
  return {
    name,
    status: existsSync5(file) ? "pass" : "fail",
    path: file,
    detail: existsSync5(file) ? "present" : "missing"
  };
}
function checkDirFiles(name, dir, expected) {
  if (!existsSync5(dir)) {
    return { name, status: "fail", path: dir, detail: "directory missing" };
  }
  const present = new Set(readdirSync(dir).filter((file) => expected.includes(file)));
  const missing = expected.filter((file) => !present.has(file));
  return {
    name,
    status: missing.length === 0 ? "pass" : "fail",
    path: dir,
    detail: missing.length === 0 ? `${expected.length} file(s)` : `missing: ${missing.join(", ")}`
  };
}
function checkHooks(file) {
  const hooksJson = readJson(file);
  const hooks = hooksJson?.[HOOK_SPEC.key];
  const problems = [];
  if (!hooks || typeof hooks !== "object") {
    problems.push("hooks block missing");
  } else {
    for (const event of HOOK_SPEC.events) {
      const value = hooks[event.name];
      if (!Array.isArray(value) || value.length === 0) {
        problems.push(`${event.name}: missing array entry`);
        continue;
      }
      const entry = value[0];
      if (entry.command !== HOOK_SPEC.command) {
        problems.push(`${event.name}: command drift`);
      }
      if (event.timeout !== void 0 && entry.timeout !== event.timeout) {
        problems.push(`${event.name}: timeout ${String(entry.timeout)} != ${event.timeout}`);
      }
    }
  }
  return {
    name: "plugin-hooks",
    status: problems.length === 0 ? "pass" : "fail",
    path: file,
    detail: problems.length === 0 ? `${HOOK_SPEC.events.length} event(s)` : problems.join("; ")
  };
}
function checkMcp(file) {
  const json = readJson(file);
  const openbox = json?.mcpServers?.openbox;
  const ok = openbox?.command === "openbox" && Array.isArray(openbox.args) && openbox.args[0] === "mcp" && openbox.args[1] === "serve";
  return {
    name: "plugin-mcp",
    status: ok ? "pass" : "fail",
    path: file,
    detail: ok ? "openbox mcp serve" : "openbox server entry missing or malformed"
  };
}
function verifyCursorPlugin(options = {}) {
  const target = safeOutDir(options.target ?? cursorPluginTargetDir(options.cwd));
  const checks = [];
  if (existsSync5(target)) {
    const stat = lstatSync(target);
    checks.push({
      name: "plugin",
      status: "pass",
      path: target,
      detail: stat.isSymbolicLink() ? "symlink installed" : "installed"
    });
  } else {
    checks.push({ name: "plugin", status: "fail", path: target, detail: "missing" });
  }
  checks.push(checkFile("plugin-manifest", path.join(target, ".cursor-plugin", "plugin.json")));
  checks.push(checkFile("plugin-marketplace", path.join(target, ".cursor-plugin", "marketplace.json")));
  checks.push(checkFile("plugin-skill", path.join(target, "skills", "openbox", "SKILL.md")));
  checks.push(checkDirFiles("plugin-commands", path.join(target, "commands"), EXPECTED_COMMAND_FILES));
  checks.push(checkDirFiles("plugin-rules", path.join(target, "rules"), EXPECTED_RULE_FILES));
  checks.push(checkDirFiles("plugin-agents", path.join(target, "agents"), EXPECTED_AGENT_FILES));
  checks.push(checkHooks(path.join(target, "hooks", "hooks.json")));
  checks.push(checkMcp(path.join(target, "mcp.json")));
  return checks;
}

// ts/src/runtime/cursor/install.ts
function truthy(value) {
  return value === "true" || value === "1";
}
function isPlaceholderKey(value) {
  if (!value) return false;
  return /YOUR_API_KEY|REPLACE_ME|placeholder/i.test(value);
}
function buildHookRuntimeEnv(cwd = process.cwd()) {
  const configDir = path2.join(cwd, ".cursor-hooks");
  const configFile = path2.join(configDir, "config.json");
  const envFile = path2.join(configDir, ".env");
  const values = {};
  const fill = (src) => {
    for (const [key, value] of Object.entries(src)) {
      if (process.env[key] !== void 0) values[key] = process.env[key];
      else if (values[key] === void 0) values[key] = value;
    }
  };
  fill(listConfig());
  const fileConfig = loadJsonConfig(configFile);
  const envConfig = loadDotenv(envFile);
  const get = (key) => process.env[key] ?? values[key] ?? fileConfig[key] ?? envConfig[key];
  const connection = resolveConnection({
    apiUrl: get("OPENBOX_API_URL"),
    coreUrl: get("OPENBOX_CORE_URL"),
    platformUrl: get("OPENBOX_PLATFORM_URL")
  });
  const coreUrl = connection.coreUrl;
  const apiKey = get("OPENBOX_API_KEY") ?? "";
  const agentIdentity = resolveAgentIdentity({
    OPENBOX_AGENT_DID: get("OPENBOX_AGENT_DID"),
    OPENBOX_AGENT_PRIVATE_KEY: get("OPENBOX_AGENT_PRIVATE_KEY")
  });
  return {
    configFile,
    envFile,
    cliConfigFile: configStorePath(),
    coreUrl,
    apiKey,
    agentIdentity,
    dryRun: truthy(get("DRY_RUN"))
  };
}
async function checkRuntimeReadiness(cwd, validateRuntime) {
  const runtime = buildHookRuntimeEnv(cwd);
  const details = [
    `config=${runtime.configFile}`,
    `cliConfig=${runtime.cliConfigFile}`,
    `core=${runtime.coreUrl}`,
    `dryRun=${runtime.dryRun}`
  ];
  if (runtime.dryRun) {
    return { name: "runtime", status: "fail", path: runtime.configFile, detail: `${details.join("; ")}; DRY_RUN=true` };
  }
  if (!runtime.apiKey) {
    return { name: "runtime", status: "fail", path: runtime.configFile, detail: `${details.join("; ")}; missing OPENBOX_API_KEY` };
  }
  if (isPlaceholderKey(runtime.apiKey)) {
    return { name: "runtime", status: "fail", path: runtime.configFile, detail: `${details.join("; ")}; placeholder OPENBOX_API_KEY` };
  }
  const format = validateApiKeyFormat(runtime.apiKey);
  if (format !== true) {
    return { name: "runtime", status: "fail", path: runtime.configFile, detail: `${details.join("; ")}; invalid OPENBOX_API_KEY format: ${format}` };
  }
  if (!validateRuntime) {
    return { name: "runtime", status: "pass", path: runtime.configFile, detail: `${details.join("; ")}; key=format-ok` };
  }
  try {
    const core = new OpenBoxCoreClient({
      apiKey: runtime.apiKey,
      apiUrl: runtime.coreUrl,
      agentIdentity: runtime.agentIdentity,
      timeoutMs: 5e3
    });
    const validation = await core.validateApiKey();
    const agent = validation?.agent_id ? `; agent=${validation.agent_id}` : "";
    return { name: "runtime", status: "pass", path: runtime.configFile, detail: `${details.join("; ")}; key=validated${agent}` };
  } catch (err) {
    return {
      name: "runtime",
      status: "fail",
      path: runtime.configFile,
      detail: `${details.join("; ")}; core validation failed: ${String(err?.message ?? err)}`
    };
  }
}
function verifyCursorInstall(opts = {}) {
  const checks = [
    ...verifyCursorPlugin({ cwd: opts.cwd, target: opts.pluginTarget })
  ];
  if (opts.includeRuntime || opts.validateRuntime) {
    return checkRuntimeReadiness(opts.cwd, Boolean(opts.validateRuntime)).then((runtime) => [...checks, runtime]);
  }
  return checks;
}

// ts/src/runtime/claude-code/doctor.ts
import { existsSync as existsSync7 } from "fs";
import path4 from "path";

// ts/src/runtime/claude-code/plugin.ts
import {
  chmodSync,
  cpSync as cpSync2,
  existsSync as existsSync6,
  lstatSync as lstatSync2,
  mkdirSync as mkdirSync5,
  readFileSync as readFileSync6,
  readdirSync as readdirSync2,
  rmSync as rmSync2,
  symlinkSync as symlinkSync2,
  writeFileSync as writeFileSync5
} from "fs";
import os2 from "os";
import path3 from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// ts/src/core-client/generated/runtime/claude-code.ts
var HOOK_SPEC2 = {
  "file": ".claude/settings.json",
  "key": "hooks",
  "style": "claude-array",
  "command": "openbox claude-code hook",
  "configDir": ".claude-hooks",
  "events": [
    {
      "name": "PreToolUse",
      "timeout": 86400
    },
    {
      "name": "PostToolUse"
    },
    {
      "name": "PostToolUseFailure"
    },
    {
      "name": "PostToolBatch"
    },
    {
      "name": "UserPromptSubmit",
      "timeout": 86400
    },
    {
      "name": "UserPromptExpansion",
      "timeout": 86400
    },
    {
      "name": "PermissionRequest",
      "timeout": 86400
    },
    {
      "name": "PermissionDenied"
    },
    {
      "name": "Setup"
    },
    {
      "name": "InstructionsLoaded"
    },
    {
      "name": "PreCompact"
    },
    {
      "name": "PostCompact"
    },
    {
      "name": "SessionStart"
    },
    {
      "name": "SessionEnd",
      "timeout": 86400,
      "installDefault": false
    },
    {
      "name": "SubagentStart"
    },
    {
      "name": "SubagentStop"
    },
    {
      "name": "TaskCreated"
    },
    {
      "name": "TaskCompleted"
    },
    {
      "name": "Stop"
    },
    {
      "name": "StopFailure"
    },
    {
      "name": "TeammateIdle"
    },
    {
      "name": "Notification"
    },
    {
      "name": "MessageDisplay"
    },
    {
      "name": "ConfigChange"
    },
    {
      "name": "CwdChanged"
    },
    {
      "name": "FileChanged"
    },
    {
      "name": "WorktreeRemove"
    },
    {
      "name": "Elicitation",
      "timeout": 86400
    },
    {
      "name": "ElicitationResult"
    }
  ]
};

// ts/src/runtime/claude-code/governance-matrix.ts
var CLAUDE_CODE_GOVERNANCE_AUDIT = {
  capturedAt: "2026-06-17",
  installedClaudeCodeVersion: "2.1.179 (Claude Code)",
  officialDocs: [
    "https://code.claude.com/docs/en/hooks",
    "https://code.claude.com/docs/en/plugins-reference",
    "https://code.claude.com/docs/en/plugins",
    "https://code.claude.com/docs/en/mcp",
    "https://code.claude.com/docs/en/skills",
    "https://code.claude.com/docs/en/commands",
    "https://code.claude.com/docs/en/agents",
    "https://code.claude.com/docs/en/settings",
    "https://code.claude.com/docs/en/tools-reference",
    "https://code.claude.com/docs/en/channels",
    "https://code.claude.com/docs/en/changelog"
  ],
  auditedSdkSurfaces: [
    "@openbox-ai/openbox-sdk/runtime/claude-code",
    "@openbox-ai/openbox-sdk/runtime/mcp",
    "@openbox-ai/openbox-sdk/runtime/cursor",
    "@openbox-ai/openbox-sdk/copilotkit",
    "@openbox-ai/openbox-sdk/copilotkit/react",
    "apps/extension",
    "skill",
    "example/n8n"
  ]
};
var CLAUDE_CODE_HOOK_MATRIX = [
  { event: "Setup", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "CI/init preparation signal." },
  { event: "SessionStart", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Starts OpenBox workflow/session lifecycle." },
  { event: "InstructionsLoaded", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Audits loaded instruction sources." },
  { event: "UserPromptSubmit", status: "implement_now", defaultInstall: true, decisionSurface: "decision-block", notes: "Prompt input gate." },
  { event: "UserPromptExpansion", status: "implement_now", defaultInstall: true, decisionSurface: "decision-block", notes: "Slash-command expansion gate." },
  { event: "MessageDisplay", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Display-only streaming text surface." },
  { event: "PreToolUse", status: "implement_now", defaultInstall: true, decisionSurface: "permission-decision", notes: "Primary pre-action tool gate." },
  { event: "PermissionRequest", status: "implement_now", defaultInstall: true, decisionSurface: "permission-request", notes: "Native Claude permission prompt gate." },
  { event: "PermissionDenied", status: "implement_now", defaultInstall: true, decisionSurface: "permission-denied-retry", notes: "Can request retry after auto-mode denial." },
  { event: "PostToolUse", status: "implement_now", defaultInstall: true, decisionSurface: "decision-block", notes: "Tool output governance, including non-error feedback and redacted output on constrain." },
  { event: "PostToolUseFailure", status: "implement_now", defaultInstall: true, decisionSurface: "additional-context", notes: "Feeds policy context after failed tool calls, including constrain feedback." },
  { event: "PostToolBatch", status: "implement_now", defaultInstall: true, decisionSurface: "decision-block", notes: "Parallel tool batch gate before next model call, including additional context on constrain." },
  { event: "SubagentStart", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Subagent lifecycle start telemetry." },
  { event: "SubagentStop", status: "implement_now", defaultInstall: true, decisionSurface: "decision-block", notes: "Subagent completion gate, including non-error feedback on constrain." },
  { event: "TaskCreated", status: "implement_now", defaultInstall: true, decisionSurface: "continue-block", notes: "Agent-team task creation criteria." },
  { event: "TaskCompleted", status: "implement_now", defaultInstall: true, decisionSurface: "continue-block", notes: "Agent-team task completion criteria." },
  { event: "Stop", status: "implement_now", defaultInstall: true, decisionSurface: "decision-block", notes: "Final assistant-output/session-stop gate, including non-error feedback on constrain." },
  { event: "StopFailure", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "API/session failure telemetry." },
  { event: "TeammateIdle", status: "implement_now", defaultInstall: true, decisionSurface: "continue-block", notes: "Agent-team idle/completion enforcement." },
  { event: "Notification", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Notification telemetry." },
  { event: "ConfigChange", status: "implement_now", defaultInstall: true, decisionSurface: "decision-block", notes: "Blocks non-managed config changes from applying." },
  { event: "CwdChanged", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Working-directory telemetry." },
  { event: "FileChanged", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Watched-file telemetry; cannot block the file change." },
  { event: "WorktreeCreate", status: "explicit_out_of_scope", defaultInstall: false, decisionSurface: "worktree-path", notes: "Invasive hook replaces Claude Code git worktree creation and must create/return a real path." },
  { event: "WorktreeRemove", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Worktree removal telemetry." },
  { event: "PreCompact", status: "implement_now", defaultInstall: true, decisionSurface: "decision-block", notes: "Blocks unsafe compaction requests before context rewrite." },
  { event: "PostCompact", status: "observe_only", defaultInstall: true, decisionSurface: "none", notes: "Compaction summary telemetry." },
  { event: "SessionEnd", status: "diagnose_only", defaultInstall: false, decisionSurface: "none", notes: "Supported by the handler but not default-installed because shutdown hooks can be cancelled before network telemetry reliably completes; Stop is the governed final hook." },
  { event: "Elicitation", status: "implement_now", defaultInstall: true, decisionSurface: "elicitation-response", notes: "MCP user-input request governance." },
  { event: "ElicitationResult", status: "implement_now", defaultInstall: true, decisionSurface: "elicitation-response", notes: "MCP elicitation response governance." }
];
var CLAUDE_CODE_SURFACE_MATRIX = [
  { surface: "hooks", status: "implement_now", notes: "Generated from TypeSpec and installed by the Claude Code plugin." },
  { surface: "skills", status: "implement_now", notes: "OpenBox skill ships under plugin skills/openbox." },
  { surface: "commands", status: "implement_now", notes: "Compatibility command markdown files remain for Claude slash entrypoints." },
  { surface: "agents", status: "implement_now", notes: "OpenBox reviewer agent ships in the plugin." },
  { surface: "MCP", status: "implement_now", notes: "OpenBox MCP server exposes status, doctor, approvals, agents, rules, policies, and governance checks." },
  { surface: "plugin settings", status: "diagnose_only", notes: "Only agent/subagentStatusLine are currently supported by Claude Code plugin settings." },
  { surface: "monitors", status: "diagnose_only", notes: "Documented as opt-in because monitors run unsandboxed and project-scope plugins do not load them." },
  { surface: "LSP", status: "explicit_out_of_scope", notes: "No OpenBox language server exists; official LSP plugins should be installed separately." },
  { surface: "bin", status: "implement_now", notes: "Plugin ships a project-local Node runner for hooks, MCP, and diagnostics; no global OpenBox binary is required." },
  { surface: "managed settings", status: "diagnose_only", notes: "Enterprise policy belongs to managed Claude Code deployment, not SDK mutation." },
  { surface: "channels", status: "diagnose_only", notes: "Research preview MCP push channel surface; standard MCP remains the connector path." },
  { surface: "built-in tool permissions", status: "implement_now", notes: "PreToolUse/PermissionRequest routing covers current built-in tool names and dynamic mcp__ tools." }
];
var CLAUDE_CODE_SDK_CAPABILITY_MATRIX = [
  {
    capability: "workflow lifecycle start",
    sdkSurface: "BaseGovernedSession.workflowStarted() / WorkflowStarted",
    claudeCodeTreatment: "implement_now",
    coverage: "SessionStart opens the workflow and records the Claude session boundary.",
    tests: ["tests/unit/runtime-claude-code-mappers.test.ts", "tests/hook-integration/claude-code-hook-events.test.ts"]
  },
  {
    capability: "workflow lifecycle complete",
    sdkSurface: "BaseGovernedSession.workflowCompleted() / WorkflowCompleted",
    claudeCodeTreatment: "implement_now",
    coverage: "Stop completes workflows with no background tasks; SessionEnd remains opt-in shutdown telemetry.",
    tests: ["tests/unit/runtime-claude-code-mappers.test.ts", "tests/hook-integration/claude-code-hook-stdin.test.ts"]
  },
  {
    capability: "workflow lifecycle failure",
    sdkSurface: "BaseGovernedSession.workflowFailed() / WorkflowFailed",
    claudeCodeTreatment: "implement_now",
    coverage: "StopFailure emits observe telemetry and then records WorkflowFailed best-effort.",
    tests: ["tests/unit/runtime-claude-code-mappers.test.ts", "tests/hook-integration/claude-code-hook-stdin.test.ts"]
  },
  {
    capability: "split-stage activity governance",
    sdkSurface: "BaseGovernedSession.openActivity().complete()",
    claudeCodeTreatment: "implement_now",
    coverage: "PreToolUse opens a stable activity and PostToolUse/PostToolUseFailure closes it with output/duration.",
    tests: ["tests/unit/runtime-claude-code-mappers.test.ts", "tests/unit/payload-shape.test.ts"]
  },
  {
    capability: "single-stage activity gates",
    sdkSurface: "BaseGovernedSession.activity(ActivityStarted|ActivityCompleted)",
    claudeCodeTreatment: "implement_now",
    coverage: "Prompts, permission requests, compaction, config changes, tasks, final output, subagents, and MCP elicitation map to activity gates.",
    tests: ["tests/unit/claude-hook-handler-coverage.test.ts", "tests/hook-integration/claude-code-hook-stdin.test.ts"]
  },
  {
    capability: "goal and signal telemetry",
    sdkSurface: "BaseGovernedSession.activity(SignalReceived)",
    claudeCodeTreatment: "implement_now",
    coverage: "UserPromptSubmit emits SignalReceived(user_prompt) with the prompt and an LLM span before the prompt gate.",
    tests: ["tests/unit/runtime-claude-code-mappers.test.ts", "tests/unit/payload-shape.test.ts"]
  },
  {
    capability: "approval lifecycle",
    sdkSurface: "WorkflowVerdict.arm=require_approval, pollApproval, inline/defer approval modes",
    claudeCodeTreatment: "implement_now",
    coverage: "Claude hook rendering supports remote polling, inline ask, defer, and fail-closed deny/block shapes for decision-capable hooks.",
    tests: ["tests/hook-integration/claude-code-hook-stdin.test.ts", "tests/unit/runtime-adapters-coverage.test.ts"]
  },
  {
    capability: "guardrail transforms and constrain verdicts",
    sdkSurface: "WorkflowVerdict.arm=constrain, guardrailsResult.redactedInput, updated output rendering",
    claudeCodeTreatment: "implement_now",
    coverage: "Claude verdict renderer preserves allow+updatedInput, additionalContext, updatedToolOutput, and elicitation accept content where Claude supports mutation.",
    tests: ["tests/unit/runtime-adapters-coverage.test.ts", "tests/unit/payload-shape.test.ts"]
  },
  {
    capability: "halt/block session state",
    sdkSurface: "WorkflowVerdict.arm=block|halt, session halted cache",
    claudeCodeTreatment: "implement_now",
    coverage: "Decision-capable hooks return Claude-native block/deny/continue=false responses and mark halted sessions for later hooks.",
    tests: ["tests/hook-integration/claude-code-hook-stdin.test.ts", "tests/unit/runtime-claude-code-mappers.test.ts"]
  },
  {
    capability: "behavior-rule spans and hook-trigger evaluation",
    sdkSurface: "GovernedPayload.spans, hook_trigger re-evaluation",
    claudeCodeTreatment: "implement_now",
    coverage: "Prompt, shell, file, HTTP, and MCP tool paths attach spans so behavior rules can match the same shapes used by other SDK adapters.",
    tests: ["tests/hook-integration/claude-code-span-content.test.ts", "tests/unit/runtime-claude-code-mappers.test.ts"]
  },
  {
    capability: "MCP connector and governance tools",
    sdkSurface: "@openbox-ai/openbox-sdk/runtime/mcp",
    claudeCodeTreatment: "implement_now",
    coverage: "Plugin .mcp.json points at the bundled project-local Node runner for mcp serve; MCP exposes status, doctor, approvals, agent/rule/policy reads, and check_governance.",
    tests: ["tests/unit/mcp-server-coverage.test.ts", "tests/hook-integration/mcp-protocol.test.ts"]
  },
  {
    capability: "plugin packaging and diagnostics",
    sdkSurface: "@openbox-ai/openbox-sdk/runtime/claude-code plugin helpers",
    claudeCodeTreatment: "implement_now",
    coverage: "Export/install packages skill, commands, agent, hooks, MCP, diagnostics, project-local bin runner/doctor shim, and explicit settings/monitor/LSP inventory.",
    tests: ["tests/unit/claude-code-plugin.test.ts", "tests/hook-integration/claude-code-install.test.ts"]
  },
  {
    capability: "project-scoped runtime configuration",
    sdkSurface: "Claude .claude-hooks config loader and plugin install",
    claudeCodeTreatment: "implement_now",
    coverage: "Claude hooks read only project .claude-hooks config/env plus process env; no global Claude config is mutated.",
    tests: ["tests/hook-integration/claude-code-install.test.ts", "tests/unit/logging-and-config-coverage.test.ts"]
  },
  {
    capability: "CopilotKit-specific UI/runtime wrappers",
    sdkSurface: "@openbox-ai/openbox-sdk/copilotkit and /copilotkit/react",
    claudeCodeTreatment: "explicit_out_of_scope",
    coverage: "Claude Code does not embed CopilotKit UI wrappers; it maps the same governance primitives through hooks and MCP instead.",
    tests: ["tests/unit/copilotkit-pure-coverage.test.ts", "tests/unit/runtime-claude-code-mappers.test.ts"]
  },
  {
    capability: "non-Claude presets",
    sdkSurface: "PRESET_MANIFEST presets for LangChain, Cursor, n8n, Temporal, etc.",
    claudeCodeTreatment: "diagnose_only",
    coverage: "SDK-wide presets are audited as broader SDK capability, but Claude Code only implements host-reachable Claude events.",
    tests: ["tests/unit/claude-code-governance-matrix.test.ts"]
  }
];
function defaultClaudeCodeHookEvents() {
  return CLAUDE_CODE_HOOK_MATRIX.filter((entry) => entry.defaultInstall && entry.status !== "diagnose_only" && entry.status !== "explicit_out_of_scope").map((entry) => entry.event);
}
function optInClaudeCodeHookEvents() {
  return CLAUDE_CODE_HOOK_MATRIX.filter((entry) => !entry.defaultInstall).map((entry) => entry.event);
}
function claudeCodeGovernanceSummary() {
  const byStatus = CLAUDE_CODE_HOOK_MATRIX.reduce(
    (acc, entry) => {
      acc[entry.status] += 1;
      return acc;
    },
    { implement_now: 0, observe_only: 0, diagnose_only: 0, explicit_out_of_scope: 0 }
  );
  return {
    audit: CLAUDE_CODE_GOVERNANCE_AUDIT,
    hookCount: CLAUDE_CODE_HOOK_MATRIX.length,
    defaultHookCount: defaultClaudeCodeHookEvents().length,
    optInHooks: optInClaudeCodeHookEvents(),
    byStatus,
    surfaces: CLAUDE_CODE_SURFACE_MATRIX,
    sdkCapabilities: CLAUDE_CODE_SDK_CAPABILITY_MATRIX
  };
}

// ts/src/runtime/claude-code/plugin.ts
var __dirname2 = path3.dirname(fileURLToPath2(import.meta.url));
var EXPECTED_COMMAND_FILES2 = [
  "openbox-check.md",
  "openbox-doctor.md",
  "openbox-list-agents.md",
  "openbox-pending.md",
  "openbox-status.md"
];
var EXPECTED_AGENT_FILES2 = ["openbox-reviewer.md"];
var EXPECTED_DIAGNOSTIC_FILES = [
  "component-inventory.json",
  "claude-code-governance.json",
  "monitors.opt-in.json"
];
var EXPECTED_BIN_FILES = ["openbox-cli.mjs", "openbox-plugin-doctor"];
var EXPECTED_COMPONENT_NAMES = [
  "skill",
  "commands",
  "agent",
  "hooks",
  "mcp",
  "diagnostics",
  "bin",
  "settings",
  "monitors",
  "lsp"
];
var PLUGIN_CLI_RUNNER = "bin/openbox-cli.mjs";
var PLUGIN_HOOK_HANDLER = {
  type: "command",
  command: "node",
  args: [`\${CLAUDE_PLUGIN_ROOT}/${PLUGIN_CLI_RUNNER}`, "claude-code", "hook"]
};
var PLUGIN_MCP_SERVER = {
  command: "node",
  args: [`\${CLAUDE_PLUGIN_ROOT}/${PLUGIN_CLI_RUNNER}`, "mcp", "serve"]
};
function claudeCodePluginTargetDir(cwd = process.cwd()) {
  return path3.join(cwd, ".claude", "skills", "openbox");
}
function readJson2(file) {
  try {
    return JSON.parse(readFileSync6(file, "utf-8"));
  } catch {
    return void 0;
  }
}
function safeOutDir2(out) {
  const resolved = path3.resolve(out);
  const root = path3.parse(resolved).root;
  if (resolved === root || resolved === os2.homedir()) {
    throw new Error(`Refusing to overwrite unsafe Claude Code plugin path: ${resolved}`);
  }
  return resolved;
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasLegacyClaudeCodeSettingsHooks(cwd = process.cwd()) {
  const settings = readJson2(path3.join(cwd, ".claude", "settings.json"));
  return JSON.stringify(settings ?? {}).includes("openbox claude-code hook");
}
function isLegacyOpenBoxMcpServer(value) {
  if (!isRecord(value) || value.command !== "openbox") return false;
  const args = Array.isArray(value.args) ? value.args : [];
  return args[0] === "mcp" && args[1] === "serve";
}
function hasLegacyOpenBoxProjectMcp(cwd = process.cwd()) {
  const mcp = readJson2(path3.join(cwd, ".mcp.json"));
  return isLegacyOpenBoxMcpServer(
    isRecord(mcp?.mcpServers) ? mcp.mcpServers.openbox : void 0
  );
}
function claudeCodeRuntimeConfigDir(cwd = process.cwd()) {
  return path3.join(cwd, ".claude-hooks");
}
function hookEvents(includeOptInHooks = false) {
  const defaultEvents = new Set(defaultClaudeCodeHookEvents());
  return HOOK_SPEC2.events.filter((event) => {
    if (event.installDefault === false) return includeOptInHooks;
    if (!defaultEvents.has(event.name)) return includeOptInHooks;
    return true;
  });
}
function checkFile2(name, file) {
  return {
    name,
    status: existsSync6(file) ? "pass" : "fail",
    path: file,
    detail: existsSync6(file) ? "present" : "missing"
  };
}
function checkDirFiles2(name, dir, expected) {
  if (!existsSync6(dir)) {
    return { name, status: "fail", path: dir, detail: "directory missing" };
  }
  const present = new Set(readdirSync2(dir).filter((file) => expected.includes(file)));
  const missing = expected.filter((file) => !present.has(file));
  return {
    name,
    status: missing.length === 0 ? "pass" : "fail",
    path: dir,
    detail: missing.length === 0 ? `${expected.length} file(s)` : `missing: ${missing.join(", ")}`
  };
}
function checkHooks2(file, includeOptInHooks = false) {
  const hooksJson = readJson2(file);
  const hooks = hooksJson?.[HOOK_SPEC2.key];
  const problems = [];
  if (!hooks || typeof hooks !== "object") {
    problems.push("hooks block missing");
  } else {
    for (const event of hookEvents(includeOptInHooks)) {
      const value = hooks[event.name];
      if (!Array.isArray(value) || value.length === 0) {
        problems.push(`${event.name}: missing array entry`);
        continue;
      }
      const entry = value[0];
      const hook = Array.isArray(entry.hooks) ? entry.hooks[0] : void 0;
      if (hook?.type !== "command") {
        problems.push(`${event.name}: hook type drift`);
      }
      if (hook?.command !== PLUGIN_HOOK_HANDLER.command) {
        problems.push(`${event.name}: command drift`);
      }
      if (JSON.stringify(hook?.args) !== JSON.stringify(PLUGIN_HOOK_HANDLER.args)) {
        problems.push(`${event.name}: args drift`);
      }
      if (event.timeout !== void 0 && hook?.timeout !== event.timeout) {
        problems.push(`${event.name}: timeout ${String(hook?.timeout)} != ${event.timeout}`);
      }
    }
    for (const entry of CLAUDE_CODE_HOOK_MATRIX.filter((item) => item.defaultInstall && item.status !== "explicit_out_of_scope")) {
      if (!hooks[entry.event]) {
        problems.push(`${entry.event}: missing from default governance matrix`);
      }
    }
    for (const entry of CLAUDE_CODE_HOOK_MATRIX.filter((item) => !item.defaultInstall)) {
      if (!includeOptInHooks && hooks[entry.event]) {
        problems.push(`${entry.event}: opt-in event installed by default`);
      }
    }
  }
  return {
    name: "plugin-hooks",
    status: problems.length === 0 ? "pass" : "fail",
    path: file,
    detail: problems.length === 0 ? `${hookEvents(includeOptInHooks).length} event(s)` : problems.join("; ")
  };
}
function checkMcp2(file) {
  const json = readJson2(file);
  const openbox = json?.mcpServers?.openbox;
  const ok = openbox?.command === PLUGIN_MCP_SERVER.command && Array.isArray(openbox.args) && JSON.stringify(openbox.args) === JSON.stringify(PLUGIN_MCP_SERVER.args);
  return {
    name: "plugin-mcp",
    status: ok ? "pass" : "fail",
    path: file,
    detail: ok ? "node bin/openbox-cli.mjs mcp serve" : "openbox server entry missing or malformed"
  };
}
function checkComponentInventory(file) {
  const json = readJson2(file);
  const components = json?.components;
  const missing = EXPECTED_COMPONENT_NAMES.filter((name) => !components?.[name]);
  return {
    name: "plugin-component-inventory",
    status: missing.length === 0 ? "pass" : "fail",
    path: file,
    detail: missing.length === 0 ? `${EXPECTED_COMPONENT_NAMES.length} component(s)` : `missing: ${missing.join(", ")}`
  };
}
function checkNoLegacySettingsHooks(cwd = process.cwd()) {
  const file = path3.join(cwd, ".claude", "settings.json");
  const stale = hasLegacyClaudeCodeSettingsHooks(cwd);
  return {
    name: "project-settings-legacy-hooks",
    status: stale ? "fail" : "pass",
    path: file,
    detail: stale ? "remove stale `openbox claude-code hook` project settings entries" : "no legacy project settings hooks"
  };
}
function checkNoLegacyProjectMcp(cwd = process.cwd()) {
  const file = path3.join(cwd, ".mcp.json");
  const stale = hasLegacyOpenBoxProjectMcp(cwd);
  return {
    name: "project-mcp-legacy-openbox",
    status: stale ? "fail" : "pass",
    path: file,
    detail: stale ? "remove stale project `.mcp.json` openbox command entry" : "no legacy project MCP openbox entry"
  };
}
function verifyClaudeCodePlugin(options = {}) {
  const target = safeOutDir2(
    options.target ?? claudeCodePluginTargetDir(options.cwd)
  );
  const checks = [];
  if (existsSync6(target)) {
    const stat = lstatSync2(target);
    checks.push({
      name: "plugin",
      status: "pass",
      path: target,
      detail: stat.isSymbolicLink() ? "symlink installed" : "installed"
    });
  } else {
    checks.push({ name: "plugin", status: "fail", path: target, detail: "missing" });
  }
  checks.push(checkFile2("plugin-manifest", path3.join(target, ".claude-plugin", "plugin.json")));
  checks.push(checkFile2("plugin-marketplace", path3.join(target, ".claude-plugin", "marketplace.json")));
  checks.push(checkFile2("plugin-skill", path3.join(target, "skills", "openbox", "SKILL.md")));
  checks.push(checkDirFiles2("plugin-commands", path3.join(target, "commands"), EXPECTED_COMMAND_FILES2));
  checks.push(checkDirFiles2("plugin-agents", path3.join(target, "agents"), EXPECTED_AGENT_FILES2));
  checks.push(checkHooks2(path3.join(target, "hooks", "hooks.json"), options.includeOptInHooks));
  checks.push(checkMcp2(path3.join(target, ".mcp.json")));
  checks.push(checkDirFiles2("plugin-diagnostics", path3.join(target, "diagnostics"), EXPECTED_DIAGNOSTIC_FILES));
  checks.push(checkComponentInventory(path3.join(target, "diagnostics", "component-inventory.json")));
  checks.push(checkDirFiles2("plugin-bin", path3.join(target, "bin"), EXPECTED_BIN_FILES));
  checks.push(checkNoLegacySettingsHooks(options.cwd));
  checks.push(checkNoLegacyProjectMcp(options.cwd));
  return checks;
}

// ts/src/runtime/claude-code/doctor.ts
function truthy2(value) {
  return value === "true" || value === "1";
}
function isPlaceholderKey2(value) {
  if (!value) return false;
  return /YOUR_API_KEY|REPLACE_ME|placeholder/i.test(value);
}
function parseApprovalMode(value) {
  const mode = (value ?? "remote").toLowerCase();
  if (mode === "inline" || mode === "defer") return mode;
  return "remote";
}
function parseFailMode(value) {
  return value === "fail_open" ? "fail_open" : "fail_closed";
}
function buildProjectRuntimeEnv(cwd = process.cwd()) {
  const configDir = claudeCodeRuntimeConfigDir(cwd);
  const configFile = path4.join(configDir, "config.json");
  const envFile = path4.join(configDir, ".env");
  const fileConfig = loadJsonConfig(configFile);
  const envConfig = loadDotenv(envFile);
  const get = (key) => process.env[key] ?? fileConfig[key] ?? envConfig[key];
  const agentIdentity = resolveAgentIdentity({
    OPENBOX_AGENT_DID: get("OPENBOX_AGENT_DID"),
    OPENBOX_AGENT_PRIVATE_KEY: get("OPENBOX_AGENT_PRIVATE_KEY")
  });
  return {
    configDir,
    configFile,
    envFile,
    projectConfigPresent: existsSync7(configFile),
    projectEnvPresent: existsSync7(envFile),
    coreUrl: get("OPENBOX_CORE_URL") ?? "",
    apiKey: get("OPENBOX_API_KEY") ?? "",
    governancePolicy: parseFailMode(get("GOVERNANCE_POLICY")),
    approvalMode: parseApprovalMode(get("APPROVAL_MODE")),
    dryRun: truthy2(get("DRY_RUN")),
    agentIdentity
  };
}
function claudeCodeRuntimeDiagnostics(cwd = process.cwd()) {
  const runtime = buildProjectRuntimeEnv(cwd);
  return {
    configDir: runtime.configDir,
    configFile: runtime.configFile,
    envFile: runtime.envFile,
    projectScoped: true,
    runtimeEnv: {
      projectConfigPresent: runtime.projectConfigPresent,
      projectEnvPresent: runtime.projectEnvPresent,
      runtimeApiKeyPresent: Boolean(runtime.apiKey),
      runtimeApiKeyPlaceholder: isPlaceholderKey2(runtime.apiKey),
      coreUrlPresent: Boolean(runtime.coreUrl),
      agentIdentityPresent: Boolean(runtime.agentIdentity)
    },
    failMode: runtime.governancePolicy,
    approvalMode: runtime.approvalMode,
    dryRun: runtime.dryRun,
    unsupportedOrOptInSurfaces: {
      worktreeCreate: "explicit_out_of_scope_replaces_default_git_behavior",
      sessionEnd: "opt_in_shutdown_telemetry",
      monitors: "opt_in_unsandboxed_not_project_scope",
      lsp: "out_of_scope_no_openbox_language_server",
      managedSettings: "enterprise_diagnose_only",
      channels: "diagnose_only_research_preview"
    }
  };
}
async function checkRuntimeReadiness2(cwd, validateRuntime) {
  const runtime = buildProjectRuntimeEnv(cwd);
  const details = [
    `config=${runtime.configFile}`,
    `core=${runtime.coreUrl || "(missing)"}`,
    `failMode=${runtime.governancePolicy}`,
    `approvalMode=${runtime.approvalMode}`,
    `dryRun=${runtime.dryRun}`
  ];
  if (runtime.dryRun) {
    return {
      name: "runtime",
      status: "fail",
      path: runtime.configFile,
      detail: `${details.join("; ")}; DRY_RUN=true`
    };
  }
  if (!runtime.coreUrl) {
    return {
      name: "runtime",
      status: "fail",
      path: runtime.configFile,
      detail: `${details.join("; ")}; missing OPENBOX_CORE_URL`
    };
  }
  if (!runtime.apiKey) {
    return {
      name: "runtime",
      status: "fail",
      path: runtime.configFile,
      detail: `${details.join("; ")}; missing OPENBOX_API_KEY`
    };
  }
  if (isPlaceholderKey2(runtime.apiKey)) {
    return {
      name: "runtime",
      status: "fail",
      path: runtime.configFile,
      detail: `${details.join("; ")}; placeholder OPENBOX_API_KEY`
    };
  }
  const format = validateApiKeyFormat(runtime.apiKey);
  if (format !== true) {
    return {
      name: "runtime",
      status: "fail",
      path: runtime.configFile,
      detail: `${details.join("; ")}; invalid OPENBOX_API_KEY format: ${format}`
    };
  }
  if (!validateRuntime) {
    return {
      name: "runtime",
      status: "pass",
      path: runtime.configFile,
      detail: `${details.join("; ")}; key=format-ok`
    };
  }
  try {
    const core = new OpenBoxCoreClient({
      apiKey: runtime.apiKey,
      apiUrl: runtime.coreUrl,
      agentIdentity: runtime.agentIdentity,
      timeoutMs: 5e3
    });
    const validation = await core.validateApiKey();
    const agent = validation?.agent_id ? `; agent=${validation.agent_id}` : "";
    return {
      name: "runtime",
      status: "pass",
      path: runtime.configFile,
      detail: `${details.join("; ")}; key=validated${agent}`
    };
  } catch (err) {
    return {
      name: "runtime",
      status: "fail",
      path: runtime.configFile,
      detail: `${details.join("; ")}; core validation failed: ${String(err?.message ?? err)}`
    };
  }
}
function summarizeClaudeCodeChecks(checks) {
  return checks.reduce(
    (acc, check) => {
      acc[check.status] += 1;
      return acc;
    },
    { pass: 0, skip: 0, fail: 0 }
  );
}
function verifyClaudeCodeInstall(opts = {}) {
  const target = opts.pluginTarget ?? opts.target ?? claudeCodePluginTargetDir(opts.cwd);
  const checks = verifyClaudeCodePlugin({
    cwd: opts.cwd,
    target,
    includeOptInHooks: opts.includeOptInHooks
  }).map((check) => ({
    name: check.name,
    status: check.status,
    path: check.path,
    detail: check.detail
  }));
  if (opts.includeRuntime || opts.validateRuntime) {
    return checkRuntimeReadiness2(opts.cwd, Boolean(opts.validateRuntime)).then((runtime) => [
      ...checks,
      runtime
    ]);
  }
  return checks;
}

// ts/src/runtime/mcp/governance-span.ts
function hex(len) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
function buildMcpGovernanceSpan(spanType, input) {
  const base = {
    span_id: hex(16),
    trace_id: hex(32),
    parent_span_id: null,
    kind: "CLIENT",
    span_type: "function",
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
        ...base,
        name: "llm.chat.completion",
        hook_type: "function_call",
        span_type: "function",
        semantic_type: "llm_completion",
        attributes: {
          "gen_ai.system": "openai",
          "http.method": "POST",
          "http.url": "https://api.openai.com/v1/chat/completions",
          "openbox.semantic_type": "llm_completion",
          "openbox.span_type": "function"
        },
        function: "LLMCall",
        module: "activity",
        args: input,
        result: null
      };
    case "file_read":
      return {
        ...base,
        name: "file.read",
        kind: "INTERNAL",
        hook_type: "file_operation",
        span_type: "file_io",
        semantic_type: "file_read",
        attributes: {
          "file.path": input.file_path || "",
          "file.operation": "read",
          "openbox.semantic_type": "file_read",
          "openbox.span_type": "file_io"
        },
        file_path: input.file_path || "",
        file_mode: "r",
        file_operation: "read"
      };
    case "file_write":
      return {
        ...base,
        name: "file.write",
        kind: "INTERNAL",
        hook_type: "file_operation",
        span_type: "file_io",
        semantic_type: "file_write",
        attributes: {
          "file.path": input.file_path || "",
          "file.operation": "write",
          "openbox.semantic_type": "file_write",
          "openbox.span_type": "file_io"
        },
        file_path: input.file_path || "",
        file_mode: "w",
        file_operation: "write"
      };
    case "shell":
      return {
        ...base,
        name: "ShellExecution",
        kind: "INTERNAL",
        hook_type: "function_call",
        span_type: "function",
        semantic_type: "internal",
        attributes: {
          "shell.command": input.command || "",
          "shell.cwd": input.cwd || "",
          "openbox.semantic_type": "internal",
          "openbox.span_type": "function"
        },
        function: "ShellExecution",
        module: "activity",
        args: input,
        result: null
      };
    case "http": {
      const method = (input.method || "POST").toUpperCase();
      const url = input.url || "https://api.example.com";
      return {
        ...base,
        name: `${method} ${url}`,
        hook_type: "http_request",
        span_type: "http",
        semantic_type: `http_${method.toLowerCase()}`,
        attributes: {
          "http.method": method,
          "http.url": url,
          "openbox.semantic_type": `http_${method.toLowerCase()}`,
          "openbox.span_type": "http"
        },
        http_method: method,
        http_url: url,
        request_body: null,
        response_body: null
      };
    }
    case "db": {
      const statement = input.statement || input.query || "";
      const dbOp = (input.operation || "QUERY").toUpperCase();
      return {
        ...base,
        name: `${dbOp}`,
        hook_type: "db_query",
        span_type: "database",
        semantic_type: `database_${dbOp.toLowerCase()}`,
        attributes: {
          "db.system": input.system || "postgresql",
          "db.operation": dbOp,
          "openbox.semantic_type": `database_${dbOp.toLowerCase()}`,
          "openbox.span_type": "database"
        },
        db_system: input.system || "postgresql",
        db_operation: dbOp,
        db_statement: statement
      };
    }
    case "mcp":
      return {
        ...base,
        name: `tool.${input.tool_name || "call"}`,
        hook_type: "function_call",
        span_type: "mcp_tool_call",
        semantic_type: "llm_tool_call",
        attributes: {
          "gen_ai.system": "mcp",
          "http.method": "POST",
          "http.url": "https://api.openai.com/v1/chat/completions",
          "openbox.semantic_type": "llm_tool_call",
          "openbox.span_type": "mcp_tool_call",
          "openbox.tool.name": input.tool_name || "call",
          "tool.name": input.tool_name || "call",
          tool_name: input.tool_name || "call"
        },
        function: `mcp.${input.tool_name || "call"}`,
        module: "activity",
        args: input,
        result: null
      };
    default:
      return {
        ...base,
        name: "unknown",
        kind: "INTERNAL",
        hook_type: "function_call",
        span_type: "function",
        attributes: {},
        function: "unknown",
        module: "activity",
        args: input,
        result: null
      };
  }
}
var MCP_ACTIVITY_TYPE_MAP = {
  llm: "PromptSubmission",
  file_read: "FileRead",
  file_write: "FileEdit",
  shell: "ShellExecution",
  http: "HTTPRequest",
  db: "DatabaseQuery",
  mcp: "MCPToolCall"
};

// ts/src/runtime/mcp/index.ts
async function runMcpServer() {
  const server = new McpServer({ name: "openbox", version: "0.1.0" });
  let callerName;
  function runtimeState() {
    const config = listConfig();
    const connection = resolveConnection({
      apiUrl: config.OPENBOX_API_URL,
      coreUrl: config.OPENBOX_CORE_URL,
      platformUrl: config.OPENBOX_PLATFORM_URL,
      authUrl: config.OPENBOX_AUTH_URL
    });
    const apiUrl = connection.apiUrl;
    const coreUrl = connection.coreUrl;
    const backendApiKey = loadApiKey();
    const runtimeApiKey = process.env.OPENBOX_API_KEY ?? config.OPENBOX_API_KEY ?? "";
    const agentIdentity = resolveAgentIdentity({
      OPENBOX_AGENT_DID: process.env.OPENBOX_AGENT_DID ?? config.OPENBOX_AGENT_DID,
      OPENBOX_AGENT_PRIVATE_KEY: process.env.OPENBOX_AGENT_PRIVATE_KEY ?? config.OPENBOX_AGENT_PRIVATE_KEY
    });
    return {
      apiUrl,
      coreUrl,
      backendApiKey,
      runtimeApiKey,
      agentIdentity,
      governancePolicy: process.env.GOVERNANCE_POLICY ?? config.GOVERNANCE_POLICY ?? "fail_closed",
      approvalMode: process.env.APPROVAL_MODE ?? config.APPROVAL_MODE ?? "remote"
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
        coreUrlPresent: Boolean(runtime.coreUrl)
      },
      failMode: runtime.governancePolicy,
      approvalMode: runtime.approvalMode,
      unsupportedOrOptInSurfaces: {
        worktreeCreate: "opt_in",
        monitors: "opt_in_unsandboxed",
        lsp: "out_of_scope_no_language_server",
        managedSettings: "enterprise_diagnose_only",
        channels: "diagnose_only_research_preview"
      }
    };
  }
  function resolveRuntime() {
    const runtime = runtimeState();
    if (!runtime.backendApiKey) {
      throw new Error(
        `OpenBox MCP: no X-API-Key for the active OpenBox connection. Run \`openbox connect --api-url <url> --core-url <url> --api-key <key>\` in this project or set OPENBOX_BACKEND_API_KEY.`
      );
    }
    return {
      coreUrl: runtime.coreUrl,
      agentIdentity: runtime.agentIdentity,
      client: new OpenBoxClient({
        apiUrl: runtime.apiUrl,
        apiKey: runtime.backendApiKey,
        clientName: "runtime/mcp"
      })
    };
  }
  function client() {
    return resolveRuntime().client;
  }
  function sourceLabel() {
    return callerName?.toLowerCase().includes("cursor") ? "cursor-mcp" : "mcp";
  }
  function approvalRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    const root = payload;
    return root.approvals?.data ?? root.data ?? [];
  }
  async function listPendingApprovals(orgId) {
    const perPage = 100;
    const maxPages = 10;
    const out = [];
    for (let page = 0; page < maxPages; page += 1) {
      const data = await client().getOrgApprovals(orgId, {
        status: "pending",
        page,
        perPage
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
          text: JSON.stringify({ status: "connected", health }, null, 2)
        }]
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ status: "not_reachable", error: err?.message ?? String(err) }, null, 2)
        }],
        isError: true
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
            claudeCodeGovernance: claudeCodeGovernanceSummary()
          }, null, 2)
        }]
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "not_reachable",
            error: err?.message ?? String(err),
            mcpReadiness: diagnostics,
            claudeCodeRuntimeReadiness: claudeCodeRuntimeDiagnostics(process.cwd()),
            claudeCodeGovernance: claudeCodeGovernanceSummary()
          }, null, 2)
        }],
        isError: true
      };
    }
  });
  server.tool("cursor_doctor", "Verify installed Cursor/OpenBox surfaces and runtime readiness without requiring Cursor chat to run shell commands", {
    cwd: z.string().optional().describe("Project root for project-local install."),
    plugin_target: z.string().optional().describe("Explicit project-local plugin folder to inspect."),
    surface_only: z.boolean().optional().describe("When true, skip runtime key/core validation and only inspect installed files."),
    validate_core: z.boolean().optional().describe("When false, validate runtime config/key format without calling core.")
  }, async ({ cwd, plugin_target, surface_only, validate_core }) => {
    const base = {
      cwd,
      pluginTarget: plugin_target
    };
    const checks = surface_only ? verifyCursorInstall(base) : await verifyCursorInstall({
      ...base,
      includeRuntime: true,
      validateRuntime: validate_core !== false
    });
    const summary = checks.reduce(
      (acc, check) => {
        acc[check.status] += 1;
        return acc;
      },
      { pass: 0, skip: 0, fail: 0 }
    );
    return { content: [{ type: "text", text: JSON.stringify({ checks, summary }, null, 2) }] };
  });
  server.tool("claude_code_doctor", "Verify installed Claude Code/OpenBox plugin surfaces and runtime readiness without requiring Claude Code chat to run shell commands", {
    cwd: z.string().optional().describe("Project root for project-local install."),
    plugin_target: z.string().optional().describe("Explicit project-local plugin folder to inspect."),
    target: z.string().optional().describe("Alias for plugin_target."),
    surface_only: z.boolean().optional().describe("When true, skip runtime key/core validation and only inspect installed files."),
    validate_core: z.boolean().optional().describe("When false, validate runtime config and key format without calling core."),
    include_opt_in_hooks: z.boolean().optional().describe("Validate an installation that intentionally includes opt-in hooks.")
  }, async ({ cwd, plugin_target, target, surface_only, validate_core, include_opt_in_hooks }) => {
    const checks = await Promise.resolve(
      surface_only ? verifyClaudeCodeInstall({
        cwd,
        pluginTarget: plugin_target,
        target,
        includeOptInHooks: include_opt_in_hooks
      }) : verifyClaudeCodeInstall({
        cwd,
        pluginTarget: plugin_target,
        target,
        includeOptInHooks: include_opt_in_hooks,
        includeRuntime: true,
        validateRuntime: validate_core !== false
      })
    );
    const summary = summarizeClaudeCodeChecks(checks);
    return { content: [{ type: "text", text: JSON.stringify({
      checks,
      summary,
      mcpReadiness: runtimeDiagnostics(),
      runtimeReadiness: claudeCodeRuntimeDiagnostics(cwd),
      claudeCodeGovernance: claudeCodeGovernanceSummary()
    }, null, 2) }] };
  });
  server.tool("list_agents", "List all agents in the organization", {}, async () => {
    const agents = await client().listAgents({ page: 0, perPage: 50 });
    return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
  });
  server.tool("get_agent", "Get agent details including trust score and tier", {
    agent_id: z.string().describe("Agent ID")
  }, async ({ agent_id }) => {
    const agent = await client().getAgent(agent_id);
    return { content: [{ type: "text", text: JSON.stringify(agent, null, 2) }] };
  });
  server.tool("list_pending_approvals", "List pending approval requests across all agents", {}, async () => {
    const profile = await client().getProfile();
    const orgId = profile.orgId;
    if (!orgId) return { content: [{ type: "text", text: "No organization found" }] };
    const approvals = await listPendingApprovals(orgId);
    return { content: [{ type: "text", text: JSON.stringify(approvals, null, 2) }] };
  });
  server.tool("decide_approval", "Approve or reject a pending approval", {
    agent_id: z.string().describe("Agent ID"),
    approval_id: z.string().describe("Approval ID"),
    action: z.enum(["approve", "reject"]).describe("Decision")
  }, async ({ agent_id, approval_id, action }) => {
    await client().decideApproval(agent_id, approval_id, { action });
    return { content: [{ type: "text", text: `${action}d` }] };
  });
  server.tool("list_guardrails", "List guardrails configured for an agent", {
    agent_id: z.string().describe("Agent ID")
  }, async ({ agent_id }) => {
    const data = await client().listGuardrails(agent_id, { page: 0, perPage: 50 });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });
  server.tool("list_policies", "List policies configured for an agent", {
    agent_id: z.string().describe("Agent ID")
  }, async ({ agent_id }) => {
    const data = await client().listPolicies(agent_id, { page: 0, perPage: 50 });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });
  server.tool("get_trust_score", "Get an agent's current trust score and tier", {
    agent_id: z.string().describe("Agent ID")
  }, async ({ agent_id }) => {
    const agent = await client().getAgent(agent_id);
    const ts = agent.agent_trust_score ?? null;
    return { content: [{ type: "text", text: JSON.stringify(ts, null, 2) }] };
  });
  async function coreEvaluate(apiKey, spanType, activityInput, coreUrl, source, agentIdentity) {
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
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      hook_trigger: true,
      spans: [span],
      span_count: 1,
      attempt: 1
    };
    const client2 = new OpenBoxCoreClient({
      apiUrl: coreUrl,
      apiKey,
      agentIdentity
    });
    return await client2.evaluate(payload);
  }
  async function resolveApiKey(agentId) {
    let apiKey = process.env.OPENBOX_API_KEY;
    if (!apiKey && agentId) {
      apiKey = recallAgentKey(agentId)?.runtimeKey;
    }
    if (!apiKey) {
      throw new Error(
        `No API key found for agent ${agentId ?? "(unset)"}. Set OPENBOX_API_KEY or mint/recover a runtime key from the dashboard/backend API.`
      );
    }
    if (!apiKey.startsWith("obx_live_") && !apiKey.startsWith("obx_test_")) {
      throw new Error(
        `Resolved key for agent ${agentId ?? ""} doesn't look like a runtime key. Expected format \`obx_live_*\` or \`obx_test_*\`. The agent record's \`token\` field is an attestation token, not the core API key.`
      );
    }
    return apiKey;
  }
  server.tool("check_governance", "Evaluate an action against governance rules. The tool builds the span shape required for behavioral rule matching. When the response carries verdict=require_approval, an approval row is materialized server-side. The expiration window comes from whichever surface produced the verdict. For behavior_rule-driven verdicts, the value is `behavior_rule.approval_timeout`, which is user-settable. For OPA-policy-driven verdicts, the value is the core server default of around 30 minutes; OPA policies have no `approval_timeout` field, so use a behavior_rule when the window matters.", {
    agent_id: z.string().optional().describe("Agent ID. Used to resolve the API key when OPENBOX_API_KEY is unset."),
    span_type: z.enum(["llm", "file_read", "file_write", "shell", "http", "db", "mcp"]).describe("Type of action to evaluate."),
    activity_input: z.any().describe("Action input payload. Examples: { prompt: '...' }, { file_path: '...' }, { command: '...' }.")
  }, async ({ agent_id, span_type, activity_input }) => {
    try {
      const runtime = resolveRuntime();
      const apiKey = await resolveApiKey(agent_id);
      const input = typeof activity_input === "object" && activity_input ? activity_input : { value: activity_input };
      const result = await coreEvaluate(
        apiKey,
        span_type,
        input,
        runtime.coreUrl,
        sourceLabel(),
        runtime.agentIdentity
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  });
  const SKILL_PATHS = [
    { name: "governance-flow", path: "references/governance-flow.md", desc: "Event protocol, wire format, verdicts, approval polling, spec-vs-implementation mismatches" },
    { name: "guardrails", path: "references/guardrails.md", desc: "Guardrail configuration: numeric IDs, stage gating, settings.activities[] shape, per-field status, backend validation gaps" },
    { name: "behaviors", path: "references/behaviors.md", desc: "Behavior rules: trigger/states enum, time_window, priority, active toggle, shell-as-internal" },
    { name: "backend-api", path: "references/backend-api.md", desc: "Backend conventions: {status,data} envelope, X-Openbox-Client header, /auth/refresh caveats, OpenAPI availability" },
    { name: "rego-reference", path: "references/rego-reference.md", desc: "Rego policy syntax, input fields, example policies, policy lifecycle gotchas" },
    { name: "span-reference", path: "references/span-reference.md", desc: "Span types, gate attributes, semantic type detection" },
    { name: "commands", path: "references/commands.md", desc: "Full CLI command reference" },
    { name: "claude-code-governance", path: "references/claude-code-governance.md", desc: "Claude Code hook/plugin/MCP governance surface audit and coverage matrix" },
    { name: "existing-sdks", path: "references/existing-sdks.md", desc: "Available SDKs and installation" }
  ];
  function findSkillDir() {
    const candidates = [
      path5.join(process.cwd(), ".claude", "skills", "openbox", "skills", "openbox"),
      path5.join(process.cwd(), ".cursor", "plugins", "local", "openbox", "skills", "openbox")
    ];
    return candidates.find((p) => fs2.existsSync(p)) || null;
  }
  for (const ref of SKILL_PATHS) {
    server.resource(ref.name, `openbox://skill/${ref.name}`, { description: ref.desc }, async () => {
      const skillDir = findSkillDir();
      if (!skillDir) return { contents: [{ uri: `openbox://skill/${ref.name}`, text: "Skill not installed. Run a project-local install: openbox install cursor or openbox install claude-code", mimeType: "text/plain" }] };
      const filePath = path5.join(skillDir, ref.path);
      if (!fs2.existsSync(filePath)) return { contents: [{ uri: `openbox://skill/${ref.name}`, text: `File not found: ${ref.path}`, mimeType: "text/plain" }] };
      const text = fs2.readFileSync(filePath, "utf-8");
      return { contents: [{ uri: `openbox://skill/${ref.name}`, text, mimeType: "text/markdown" }] };
    });
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  callerName = server.server.getClientVersion()?.name;
  setMcpClientName(callerName);
}
export {
  runMcpServer
};
