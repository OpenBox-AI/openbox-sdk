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

// ts/src/types/generated/backend.ts
var backend_exports = {};

// ts/src/types/generated/core.ts
var core_exports = {};

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
var API_KEY_PATTERN = /^obx_(?:live|test)_[0-9a-f]{48}$/;
function validateApiKeyFormat(value) {
  if (!API_KEY_PATTERN.test(value)) {
    return "OPENBOX_API_KEY must match obx_(live|test)_<48hex>";
  }
  return true;
}
var OS_PATH_FIELDS = ["path"];
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
var serializeTokenStore = (store) => {
  const lines = [];
  if (store.accessToken) {
    lines.push(`ACCESS_TOKEN=${store.accessToken}`);
    lines.push(`REFRESH_TOKEN=${store.refreshToken ?? ""}`);
  }
  if (store.apiKey) lines.push(`API_KEY=${store.apiKey}`);
  if (store.accessToken || store.apiKey) lines.push(`UPDATED_AT=${store.updatedAt ?? ""}`);
  if (store.permissions && store.permissions.length > 0) {
    lines.push(`PERMISSIONS=${store.permissions.join(",")}`);
  }
  if (store.features && Object.keys(store.features).length > 0) {
    const pairs = Object.entries(store.features).map(([key, value]) => `${key}:${value}`);
    lines.push(`FEATURES=${pairs.join(",")}`);
  }
  return lines.length > 0 ? `${lines.join("\n")}
` : "";
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
var METHOD_PERMISSIONS = {
  "addTeamMembers": ["update:team"],
  "assignRoles": ["update:user"],
  "configureSsoOidc": ["manage:sso"],
  "configureSsoSaml": ["manage:sso"],
  "createAgent": ["create:agent"],
  "createApiKey": ["create:api_key"],
  "createBehaviorRule": ["create:agent_behavior_rule"],
  "createGuardrail": ["create:agent_guardrail"],
  "createPolicy": ["create:agent_policy"],
  "createTeam": ["create:team"],
  "createUser": ["create:user"],
  "createWebhook": ["create:webhook"],
  "decideApproval": ["read:agent"],
  "deleteAgent": ["delete:agent"],
  "deleteApiKey": ["delete:api_key"],
  "deleteBehaviorRule": ["delete:agent_behavior_rule"],
  "deleteExport": ["read:org"],
  "deleteGuardrail": ["delete:agent_guardrail"],
  "deleteSsoConfig": ["manage:sso"],
  "deleteTeams": ["delete:team"],
  "deleteWebhook": ["delete:webhook"],
  "downloadExport": ["read:org"],
  "enforceSso": ["manage:sso"],
  "exportAuditLogs": ["read:org"],
  "getActiveSessions": ["read:agent_session"],
  "getAgent": ["read:agent"],
  "getAgentLogs": ["read:agent_log"],
  "getAgentMetrics": ["read:agent"],
  "getAgentViolations": ["read:agent"],
  "getAllViolations": ["read:agent"],
  "getApiKey": ["read:api_key"],
  "getApprovalHistory": ["read:agent"],
  "getApprovalMetrics": ["read:agent"],
  "getAssessments": ["read:agent"],
  "getAuditLog": ["read:org"],
  "getAuditLogs": ["read:org"],
  "getBehaviorMetrics": ["read:agent_behavior_rule"],
  "getBehaviorRule": ["read:agent_behavior_rule"],
  "getBehaviorRuleVersions": ["read:agent_behavior_rule"],
  "getBehaviorViolations": ["read:agent_behavior_rule"],
  "getCurrentBehaviorRules": ["read:agent_behavior_rule"],
  "getCurrentPolicies": ["read:agent_policy"],
  "getDashboard": ["read:agent"],
  "getDashboardTierTrends": ["read:agent"],
  "getDriftLogs": ["read:agent_log"],
  "getExport": ["read:org"],
  "getExportHistory": ["read:org"],
  "getGoalAlignmentRecentDrifts": ["read:agent"],
  "getGoalAlignmentTrend": ["read:agent"],
  "getGovernanceFeed": ["read:agent"],
  "getGovernanceSlo": ["read:agent"],
  "getGuardrail": ["read:agent_guardrail"],
  "getGuardrailMetrics": ["read:agent_guardrail"],
  "getGuardrailViolationLogs": ["read:agent_guardrail"],
  "getInsightsMetrics": ["read:agent"],
  "getIssues": ["read:agent"],
  "getObservability": ["read:agent"],
  "getOrgApprovalHistory": ["read:agent"],
  "getOrgApprovalMetrics": ["read:agent"],
  "getOrgApprovals": ["read:agent"],
  "getOrgApprovalSla": ["read:agent"],
  "getOrgFeatures": ["read:org"],
  "getOrgSessions": ["read:agent"],
  "getOrgSettings": ["read:org"],
  "getPendingApprovals": ["read:agent"],
  "getPolicy": ["read:agent_policy"],
  "getPolicyEvaluations": ["read:agent_policy"],
  "getPolicyMetrics": ["read:agent_policy"],
  "getSemanticTypes": ["read:agent_behavior_rule"],
  "getSession": ["read:agent_session"],
  "getSessionGoalAlignmentStats": ["read:agent_session"],
  "getSessionLogs": ["read:agent_log"],
  "getSessionReasoningTrace": ["read:agent_session"],
  "getSsoConfig": ["manage:sso"],
  "getSsoMetadata": ["manage:sso"],
  "getTeam": ["read:team"],
  "getTeamMembers": ["read:team"],
  "getTeamStats": ["read:team"],
  "getTrustDriftLanes": ["read:agent"],
  "getTrustEvents": ["read:agent"],
  "getTrustHistories": ["read:agent"],
  "getTrustRecoveryStatus": ["read:agent"],
  "getTrustTierChanges": ["read:agent"],
  "getUserRoles": ["read:user"],
  "getViolationHeatcal": ["read:agent"],
  "getWebhook": ["read:webhook"],
  "getWebhookDeliveries": ["read:webhook"],
  "inviteUser": ["create:user"],
  "listAgents": ["read:agent"],
  "listApiKeys": ["read:api_key"],
  "listBehaviorRules": ["read:agent_behavior_rule"],
  "listGuardrails": ["read:agent_guardrail"],
  "listMembers": ["read:user"],
  "listPolicies": ["read:agent_policy"],
  "listSessions": ["read:agent_session"],
  "listTeams": ["read:team"],
  "listWebhooks": ["read:webhook"],
  "previewAuditExport": ["read:org"],
  "recalculateAivss": ["update:agent"],
  "regenerateWebhookSecret": ["update:webhook"],
  "removeMembers": ["delete:user"],
  "removeRoles": ["update:user"],
  "removeTeamMembers": ["update:team"],
  "reorderGuardrail": ["update:agent_guardrail"],
  "restoreBehaviorRule": ["update:agent_behavior_rule"],
  "revokeApiKey": ["update:agent"],
  "rotateApiKey": ["update:agent"],
  "sendWelcomeEmail": ["create:user"],
  "terminateSession": ["manage:agent_session"],
  "testWebhook": ["update:webhook"],
  "toggleBehaviorRuleStatus": ["update:agent_behavior_rule"],
  "updateAgent": ["create:agent"],
  "updateAivssConfig": ["update:agent"],
  "updateApiKey": ["update:api_key"],
  "updateBehaviorRule": ["update:agent_behavior_rule"],
  "updateGoalAlignment": ["update:agent"],
  "updateGuardrail": ["update:agent_guardrail"],
  "updateMember": ["update:user"],
  "updateOrgSettings": ["write:org"],
  "updatePolicy": ["update:agent_policy"],
  "updateTeam": ["update:team"],
  "updateWebhook": ["update:webhook"],
  "verifySsoConfig": ["manage:sso"]
};
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
  checkPathPermissions(verb, path) {
    if (!this.permissions) return;
    const upperVerb = verb.toUpperCase();
    for (const rule of PATH_PERMISSION_RULES) {
      if (rule.verb !== upperVerb) continue;
      if (!rule.pattern.test(path)) continue;
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
  async requestOperation(method, path, options) {
    return this.request(method, path, options);
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
  async request(method, path, options) {
    this.checkPathPermissions(method, path);
    await this.ensureValidToken();
    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }
    let url = `${this.baseUrl}${path}`;
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
  async httpGet(path, params) {
    return this.request("GET", path, { params });
  }
  async httpPost(path, data) {
    return this.request("POST", path, { data });
  }
  async httpPut(path, data, params) {
    return this.request("PUT", path, { data, params });
  }
  async httpPatch(path, data) {
    return this.request("PATCH", path, { data });
  }
  async httpDelete(path, data) {
    return this.request("DELETE", path, { data });
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
      status: activityCompletionStatus(activityType),
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
function activityCompletionStatus(activityType) {
  return /(error|fail|failed|failure|timeout|timedout|cancel|abort)/i.test(activityType) ? "failed" : "completed";
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
export {
  backend_exports as Backend,
  BaseGovernedSession,
  CLIENT_VARIANT_PATTERN,
  core_exports as Core,
  CoreApiError,
  ENV_VAR_BINDINGS,
  METHOD_PERMISSIONS,
  MissingPermissionError,
  OS_PATH_FIELDS,
  OpenBoxApiError,
  OpenBoxClient,
  OpenBoxCoreClient,
  PRESET_MANIFEST,
  SessionAlreadyTerminatedError,
  TokenBucket,
  buildAuthHeader,
  decodeJwtExpiry,
  endpointsFromStackUrl,
  govern,
  isTokenExpired,
  normalizeStackUrl,
  parseTokenStore,
  presets,
  resolveClientName,
  resolveConnection,
  serializeTokenStore,
  validateApiKeyFormat
};
