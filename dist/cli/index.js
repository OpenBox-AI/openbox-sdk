#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ts/src/types/requests.ts
var init_requests = __esm({
  "ts/src/types/requests.ts"() {
    "use strict";
  }
});

// ts/src/types/responses.ts
var init_responses = __esm({
  "ts/src/types/responses.ts"() {
    "use strict";
  }
});

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
var init_auth = __esm({
  "ts/src/types/auth.ts"() {
    "use strict";
  }
});

// ts/src/types/generated/backend.ts
var init_backend = __esm({
  "ts/src/types/generated/backend.ts"() {
    "use strict";
  }
});

// ts/src/types/generated/core.ts
var init_core = __esm({
  "ts/src/types/generated/core.ts"() {
    "use strict";
  }
});

// ts/src/types/index.ts
var init_types = __esm({
  "ts/src/types/index.ts"() {
    "use strict";
    init_requests();
    init_responses();
    init_auth();
    init_backend();
    init_core();
  }
});

// ts/src/env/generated/env-bindings.ts
function validateApiKeyFormat(value) {
  if (!API_KEY_PATTERN.test(value)) {
    return "OPENBOX_API_KEY must match obx_(live|test)_<48hex>";
  }
  return true;
}
var ENV_VAR_BINDINGS, API_KEY_PATTERN, CLIENT_VARIANT_PATTERN;
var init_env_bindings = __esm({
  "ts/src/env/generated/env-bindings.ts"() {
    "use strict";
    ENV_VAR_BINDINGS = {
      apiUrl: { "name": "OPENBOX_API_URL" },
      coreUrl: { "name": "OPENBOX_CORE_URL" },
      platformUrl: { "name": "OPENBOX_PLATFORM_URL" },
      authUrl: { "name": "OPENBOX_AUTH_URL" },
      apiKey: { "name": "OPENBOX_API_KEY" }
    };
    API_KEY_PATTERN = /^obx_(?:live|test)_[0-9a-f]{48}$/;
    CLIENT_VARIANT_PATTERN = /^[A-Za-z0-9._+-]+$/;
  }
});

// ts/src/env/connection.ts
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
var resolveConnection;
var init_connection = __esm({
  "ts/src/env/connection.ts"() {
    "use strict";
    init_env_bindings();
    resolveConnection = (opts = {}) => {
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
  }
});

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
var parseTokenStore, serializeTokenStore;
var init_token_codec = __esm({
  "ts/src/env/token-codec.ts"() {
    "use strict";
    parseTokenStore = (content) => {
      let store = {};
      for (const line of content.split("\n")) {
        const match = line.match(/^(\w+)=(.*)$/);
        if (!match) continue;
        store = applyField(store, match[1], match[2]);
      }
      return store;
    };
    serializeTokenStore = (store) => {
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
  }
});

// ts/src/env/client-name.ts
var resolveClientName;
var init_client_name = __esm({
  "ts/src/env/client-name.ts"() {
    "use strict";
    init_env_bindings();
    resolveClientName = (base2, variant) => {
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
  }
});

// ts/src/env/auth-header.ts
function buildAuthHeader(creds) {
  if (creds.apiKey) return { "X-API-Key": creds.apiKey };
  if (creds.accessToken) return { Authorization: `Bearer ${creds.accessToken}` };
  return {};
}
var init_auth_header = __esm({
  "ts/src/env/auth-header.ts"() {
    "use strict";
  }
});

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
var init_agent_identity = __esm({
  "ts/src/env/agent-identity.ts"() {
    "use strict";
  }
});

// ts/src/env/index.ts
var init_env = __esm({
  "ts/src/env/index.ts"() {
    "use strict";
    init_connection();
    init_token_codec();
    init_client_name();
    init_auth_header();
    init_agent_identity();
    init_env_bindings();
  }
});

// ts/src/client/rate-limiter.ts
var TokenBucket;
var init_rate_limiter = __esm({
  "ts/src/client/rate-limiter.ts"() {
    "use strict";
    TokenBucket = class {
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
  }
});

// ts/src/client/generated/wrapper-methods.ts
var PATH_PERMISSION_RULES, MissingPermissionError, OpenBoxClientWrapperBase;
var init_wrapper_methods = __esm({
  "ts/src/client/generated/wrapper-methods.ts"() {
    "use strict";
    PATH_PERMISSION_RULES = [
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
    MissingPermissionError = class extends Error {
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
    OpenBoxClientWrapperBase = class {
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
      checkPathPermissions(verb, path16) {
        if (!this.permissions) return;
        const upperVerb = verb.toUpperCase();
        for (const rule of PATH_PERMISSION_RULES) {
          if (rule.verb !== upperVerb) continue;
          if (!rule.pattern.test(path16)) continue;
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
  }
});

// ts/src/client/client.ts
function requireApiUrl(value) {
  if (!value) throw new Error("OPENBOX_API_URL is required. Set the backend API URL explicitly.");
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}
var OpenBoxApiError, OpenBoxClient;
var init_client = __esm({
  "ts/src/client/client.ts"() {
    "use strict";
    init_types();
    init_env();
    init_rate_limiter();
    init_wrapper_methods();
    OpenBoxApiError = class extends Error {
      status;
      body;
      constructor(message, status, body) {
        super(message);
        this.name = "OpenBoxApiError";
        this.status = status;
        this.body = body;
      }
    };
    OpenBoxClient = class _OpenBoxClient extends OpenBoxClientWrapperBase {
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
      async requestOperation(method, path16, options) {
        return this.request(method, path16, options);
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
      async request(method, path16, options) {
        this.checkPathPermissions(method, path16);
        await this.ensureValidToken();
        if (this.rateLimiter) {
          await this.rateLimiter.acquire();
        }
        let url = `${this.baseUrl}${path16}`;
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
      async httpGet(path16, params) {
        return this.request("GET", path16, { params });
      }
      async httpPost(path16, data) {
        return this.request("POST", path16, { data });
      }
      async httpPut(path16, data, params) {
        return this.request("PUT", path16, { data, params });
      }
      async httpPatch(path16, data) {
        return this.request("PATCH", path16, { data });
      }
      async httpDelete(path16, data) {
        return this.request("DELETE", path16, { data });
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
  }
});

// ts/src/client/index.ts
var init_client2 = __esm({
  "ts/src/client/index.ts"() {
    "use strict";
    init_client();
    init_rate_limiter();
    init_wrapper_methods();
  }
});

// ts/src/version.ts
var OPENBOX_SDK_VERSION;
var init_version = __esm({
  "ts/src/version.ts"() {
    "use strict";
    OPENBOX_SDK_VERSION = "0.1.0";
  }
});

// ts/src/core-client/core-client.ts
import { createHash, createPrivateKey, randomUUID, sign } from "crypto";
function requireCoreUrl(value) {
  if (!value) throw new Error("OPENBOX_CORE_URL is required. Set the core API URL explicitly.");
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}
function appendQuery(path16, params) {
  if (!params) return path16;
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
  if (!query) return path16;
  return `${path16}${path16.includes("?") ? "&" : "?"}${query}`;
}
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
var CoreApiError, OpenBoxCoreClient, ED25519_PKCS8_PREFIX;
var init_core_client = __esm({
  "ts/src/core-client/core-client.ts"() {
    "use strict";
    init_client2();
    init_version();
    CoreApiError = class extends Error {
      status;
      body;
      constructor(message, status, body) {
        super(message);
        this.name = "CoreApiError";
        this.status = status;
        this.body = body;
      }
    };
    OpenBoxCoreClient = class _OpenBoxCoreClient {
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
      async requestOperation(method, path16, options) {
        const renderedPath = appendQuery(path16, options?.params);
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
      async request(method, path16, options) {
        if (this.rateLimiter) {
          await this.rateLimiter.acquire();
        }
        const url = `${this.baseUrl}${path16}`;
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
    ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
  }
});

// ts/src/core-client/generated/govern.ts
function randomUUID2() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : r & 3 | 8).toString(16);
  });
}
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
function stricterVerdict(base2, hook) {
  return verdictRank(hook.arm) >= verdictRank(base2.arm) ? hook : base2;
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
  return new Promise((resolve3) => setTimeout(resolve3, ms));
}
function applyJitter(baseMs, fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  if (f === 0) return baseMs;
  const noise = (Math.random() * 2 - 1) * f;
  return baseMs * (1 + noise);
}
var CANONICAL_EVENT_TYPES, CANONICAL_ACTIVITY_LABELS, SessionAlreadyTerminatedError, BaseGovernedSession, AirflowSession, ArgocdSession, AutogenSession, ClaudeCodeSession, ClineSession, CodexSession, CopilotSession, CrewaiSession, CursorSession, CustomSession, DefaultSession, LangchainSession, LanggraphSession, LlamaindexSession, MastraSession, ModernTreasurySession, N8nSession, PagerdutySession, PydanticAiSession, SemanticKernelSession, TemporalSession, VercelAiSession, presets;
var init_govern = __esm({
  "ts/src/core-client/generated/govern.ts"() {
    "use strict";
    CANONICAL_EVENT_TYPES = /* @__PURE__ */ new Set(["ActivityCompleted", "ActivityStarted", "SignalReceived", "WorkflowCompleted", "WorkflowFailed", "WorkflowStarted"]);
    CANONICAL_ACTIVITY_LABELS = Object.freeze({ "AGENT_STEP": "Agent Step", "ActivityTaskCanceled": "Activity Task Canceled", "ActivityTaskCompleted": "Activity Task Completed", "ActivityTaskFailed": "Activity Task Failed", "ActivityTaskScheduled": "Activity Task Scheduled", "ActivityTaskStarted": "Activity Task Started", "ActivityTaskTimedOut": "Activity Task Timed Out", "AgentAction": "Agent Action", "AgentExecutionCompleted": "Agent Execution Completed", "AgentExecutionStarted": "Agent Execution Started", "AgentSpawn": "Agent Spawn", "CHUNKING": "Chunking", "CallToolsNode": "Call Tools Node", "ChildWorkflowExecutionCompleted": "Child Workflow Execution Completed", "ChildWorkflowExecutionInitiated": "Child Workflow Execution Initiated", "CrewKickoffCompleted": "Crew Kickoff Completed", "CrewKickoffStarted": "Crew Kickoff Started", "EMBEDDING": "Embedding", "EXCEPTION": "Exception", "End": "End", "FUNCTION_CALL": "Function Call", "FileDelete": "File Delete", "FileEdit": "File Edit", "FileRead": "File Read", "HTTPRequest": "HTTP Request", "HandoffMessage": "Handoff Message", "LLM": "LLM", "LLMCallCompleted": "LLM Call Completed", "LLMCallStarted": "LLM Call Started", "LLMCompleted": "LLM Completed", "MCPToolCall": "MCP Tool Call", "MarkerRecorded": "Marker Recorded", "MemoryQueryEvent": "Memory Query", "ModelRequestNode": "Model Request Node", "MultiModalMessage": "Multi-Modal Message", "Notification": "Notification", "OperationCompleted": "Operation Completed", "OperationStarted": "Operation Started", "PermissionRequest": "Permission Request", "PostToolUse": "Post-Tool Use", "PreCompact": "Pre-Compact", "PreSyncHookStarted": "Pre-Sync Hook Started", "PreSyncHookSucceeded": "Pre-Sync Hook Succeeded", "PreToolUse": "Pre-Tool Use", "PromptSubmission": "Prompt Submission", "QUERY": "Query", "RERANKING": "Reranking", "RETRIEVE": "Retrieve", "ResourceUpdated": "Resource Updated", "SUB_QUESTION": "Sub-Question", "SYNTHESIZE": "Synthesize", "ShellExecution": "Shell Execution", "Stop": "Stop", "StopMessage": "Stop Message", "SubagentStart": "Subagent Start", "SubagentStop": "Subagent Stop", "SyncStatusChanged": "Sync Status Changed", "TaskCompleted": "Task Completed", "TaskStart": "Task Start", "TaskStarted": "Task Started", "TextMessage": "Text Message", "TimerFired": "Timer Fired", "TimerStarted": "Timer Started", "ToolCallExecutionEvent": "Tool Call Execution", "ToolCallRequestEvent": "Tool Call Request", "ToolCompleted": "Tool Completed", "ToolStarted": "Tool Started", "ToolUsageError": "Tool Usage Error", "ToolUsageFinished": "Tool Usage Finished", "ToolUsageStarted": "Tool Usage Started", "UserInputRequestedEvent": "User Input Requested", "UserPromptNode": "User Prompt Node", "UserPromptSubmit": "User Prompt Submit", "WorkflowExecutionSignaled": "Workflow Execution Signaled", "afterAgentResponse": "After Agent Response", "afterAgentThought": "After Agent Thought", "afterFileEdit": "After File Edit", "afterMCPExecution": "After MCP Execution", "afterShellExecution": "After Shell Execution", "agentStop": "Agent Stop", "auto_function_invocation_post": "Auto Function Invocation Post", "auto_function_invocation_pre": "Auto Function Invocation Pre", "beforeMCPExecution": "Before MCP Execution", "beforeReadFile": "Before Read File", "beforeShellExecution": "Before Shell Execution", "beforeSubmitPrompt": "Before Submit Prompt", "checkpoint": "Checkpoint", "custom_event": "Custom Event", "error": "Error", "error-trigger": "Error Trigger", "errorOccurred": "Error Occurred", "function_invocation_post": "Function Invocation Post", "function_invocation_pre": "Function Invocation Pre", "incident.acknowledged": "Incident Acknowledged", "incident.annotated": "Incident Annotated", "incident.delegated": "Incident Delegated", "incident.escalated": "Incident Escalated", "incident.priority_updated": "Incident Priority Updated", "incident.reassigned": "Incident Reassigned", "incident.reopened": "Incident Reopened", "incident.resolved": "Incident Resolved", "incident.triggered": "Incident Triggered", "incident.unacknowledged": "Incident Unacknowledged", "interrupt": "Interrupt", "node-post-execute": "Node Post-Execute", "node-pre-execute": "Node Pre-Execute", "node_end": "Node End", "node_start": "Node Start", "onAbort": "Abort", "onError": "Error", "onFinish": "Finish", "onStepFinish": "Step Finish", "on_agent_action": "Agent Action", "on_agent_finish": "Agent Finish", "on_chain_end": "Chain End", "on_chain_start": "Chain Start", "on_chat_model_start": "Chat Model Start", "on_execute_callback": "Execute Callback", "on_failure_callback": "Failure Callback", "on_llm_end": "LLM End", "on_llm_error": "LLM Error", "on_llm_start": "LLM Start", "on_retriever_end": "Retriever End", "on_retriever_start": "Retriever Start", "on_retry_callback": "Retry Callback", "on_skipped_callback": "Skipped Callback", "on_success_callback": "Success Callback", "on_tool_end": "Tool End", "on_tool_error": "Tool Error", "on_tool_start": "Tool Start", "output_validator": "Output Validator", "payment_order.approved": "Payment Order Approved", "payment_order.begin_processing": "Payment Order Begin Processing", "payment_order.failed": "Payment Order Failed", "payment_order.reconciled": "Payment Order Reconciled", "payment_reference.created": "Payment Reference Created", "postToolUse": "Post-Tool Use", "preToolUse": "Pre-Tool Use", "prompt_render_post": "Prompt Render Post", "prompt_render_pre": "Prompt Render Pre", "sla_miss_callback": "SLA Miss Callback", "subagentStop": "Subagent Stop", "task_end": "Task End", "task_start": "Task Start", "tool-call": "Tool Call", "tool-result": "Tool Result", "tool_retry": "Tool Retry", "userPromptSubmitted": "User Prompt Submitted", "workflow-step-finish": "Workflow Step Finish", "workflow-step-progress": "Workflow Step Progress", "workflow-step-start": "Workflow Step Start" });
    SessionAlreadyTerminatedError = class extends Error {
      constructor() {
        super("[govern] session already terminated; create a new govern() scope to continue.");
        this.name = "SessionAlreadyTerminatedError";
      }
    };
    BaseGovernedSession = class {
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
      async workflowFailed(error2) {
        if (this.finalized) return void 0;
        this.finalized = true;
        try {
          return await this.emit({
            event_type: "WorkflowFailed",
            status: "failed",
            error: errorInfoFrom(error2)
          });
        } finally {
          this.cleanupExitHandlers();
        }
      }
      /** @deprecated use `workflowFailed()`; same behavior. */
      async fail(error2) {
        return this.workflowFailed(error2);
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
    AirflowSession = class extends BaseGovernedSession {
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
    ArgocdSession = class extends BaseGovernedSession {
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
    AutogenSession = class extends BaseGovernedSession {
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
    ClaudeCodeSession = class extends BaseGovernedSession {
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
    ClineSession = class extends BaseGovernedSession {
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
    CodexSession = class extends BaseGovernedSession {
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
    CopilotSession = class extends BaseGovernedSession {
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
    CrewaiSession = class extends BaseGovernedSession {
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
    CursorSession = class extends BaseGovernedSession {
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
    CustomSession = class extends BaseGovernedSession {
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
    DefaultSession = class extends BaseGovernedSession {
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
    LangchainSession = class extends BaseGovernedSession {
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
    LanggraphSession = class extends BaseGovernedSession {
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
    LlamaindexSession = class extends BaseGovernedSession {
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
    MastraSession = class extends BaseGovernedSession {
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
    ModernTreasurySession = class extends BaseGovernedSession {
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
    N8nSession = class extends BaseGovernedSession {
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
    PagerdutySession = class extends BaseGovernedSession {
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
    PydanticAiSession = class extends BaseGovernedSession {
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
    SemanticKernelSession = class extends BaseGovernedSession {
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
    TemporalSession = class extends BaseGovernedSession {
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
    VercelAiSession = class extends BaseGovernedSession {
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
    presets = {
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
    ((govern2) => {
      govern2.attach = governAttach;
    })(govern || (govern = {}));
  }
});

// ts/src/core-client/redaction.ts
var init_redaction = __esm({
  "ts/src/core-client/redaction.ts"() {
    "use strict";
  }
});

// ts/src/core-client/index.ts
var init_core_client2 = __esm({
  "ts/src/core-client/index.ts"() {
    "use strict";
    init_core_client();
    init_govern();
    init_govern();
    init_govern();
    init_govern();
    init_redaction();
  }
});

// ts/src/cli/non-interactive.ts
function argv() {
  return argvOverride ?? process.argv;
}
function isNonInteractive() {
  if (process.env.OPENBOX_NONINTERACTIVE && process.env.OPENBOX_NONINTERACTIVE !== "0") {
    return true;
  }
  if (process.env.CI && process.env.CI !== "0" && process.env.CI !== "false") {
    return true;
  }
  const a = argv();
  if (a.includes("--yes") || a.includes("-y") || a.includes("--non-interactive")) {
    return true;
  }
  if (process.stdin && process.stdin.isTTY === false) {
    return true;
  }
  return false;
}
function useColor() {
  if (process.env.NO_COLOR && process.env.NO_COLOR !== "") return false;
  if (process.env.OPENBOX_NO_COLOR && process.env.OPENBOX_NO_COLOR !== "0") return false;
  const a = argv();
  if (a.includes("--no-color")) return false;
  if (process.env.CI && process.env.CI !== "0" && process.env.CI !== "false") return false;
  return process.stdout.isTTY === true;
}
function isJsonMode() {
  const a = argv();
  return a.includes("--json");
}
function isMachineMode() {
  if (isJsonMode()) return true;
  return !process.stdout.isTTY;
}
var argvOverride;
var init_non_interactive = __esm({
  "ts/src/cli/non-interactive.ts"() {
    "use strict";
    argvOverride = null;
  }
});

// ts/src/cli/colors.ts
function wrap(code, s) {
  if (!useColor()) return s;
  return `\x1B[${code}m${s}\x1B[0m`;
}
var CODES, color;
var init_colors = __esm({
  "ts/src/cli/colors.ts"() {
    "use strict";
    init_non_interactive();
    CODES = {
      red: "31",
      green: "32",
      yellow: "33",
      blue: "34",
      magenta: "35",
      cyan: "36",
      bold: "1",
      dim: "2"
    };
    color = {
      red: (s) => wrap(CODES.red, s),
      green: (s) => wrap(CODES.green, s),
      yellow: (s) => wrap(CODES.yellow, s),
      blue: (s) => wrap(CODES.blue, s),
      magenta: (s) => wrap(CODES.magenta, s),
      cyan: (s) => wrap(CODES.cyan, s),
      bold: (s) => wrap(CODES.bold, s),
      dim: (s) => wrap(CODES.dim, s)
    };
  }
});

// ts/src/cli/output.ts
function output(data) {
  console.log(JSON.stringify(data, null, 2));
}
function outputList(data, label = "items") {
  const obj = data;
  const machine = isMachineMode();
  if (obj?.data && Array.isArray(obj.data)) {
    if (!machine) {
      console.error(`${obj.total ?? obj.data.length} ${label}`);
    }
    console.log(JSON.stringify(obj.data, null, 2));
  } else if (Array.isArray(data)) {
    if (!machine) {
      console.error(`${data.length} ${label}`);
    }
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}
function emitTrailer(label, value) {
  const lines = value.split("\n");
  const head = `${label}: ${lines[0]}`;
  console.error(head);
  for (let i = 1; i < lines.length; i++) {
    console.error(`${TRAILER_INDENT}${lines[i]}`);
  }
}
function error(message, opts = {}) {
  const msg = message.replace(/\.\s*$/, "");
  if (isMachineMode()) {
    const payload = { message: msg };
    if (opts.detail) payload.detail = opts.detail;
    if (opts.help) payload.help = opts.help;
    if (opts.hint) payload.hint = opts.hint;
    if (opts.see) payload.see = opts.see;
    console.error(JSON.stringify({ error: payload }));
    return;
  }
  console.error(`${color.red("error:")} ${msg}`);
  if (opts.detail || opts.help || opts.hint || opts.see) {
    console.error("");
  }
  if (opts.detail) emitTrailer("detail", opts.detail);
  if (opts.help) emitTrailer("help", opts.help);
  if (opts.hint) emitTrailer("hint", opts.hint);
  if (opts.see) emitTrailer("see", opts.see);
}
function warn(message, reference) {
  if (isMachineMode()) return;
  const msg = message.replace(/\.\s*$/, "");
  console.error(`${color.yellow("warn:")} ${msg}`);
  if (reference) console.error(`see: ${reference}`);
}
function info(message) {
  if (isMachineMode()) return;
  console.log(message);
}
function success(message) {
  if (isMachineMode()) return;
  console.log(`${color.green("ok:")} ${message}`);
}
function row(target, status, detail) {
  if (isMachineMode()) return;
  const colorize = STATUS_COLORS[status] ?? ((s) => s);
  const left = target.padEnd(TARGET_COL);
  if (detail) {
    console.log(`${left}${colorize(status.padEnd(STATUS_COL))}${detail}`);
  } else {
    console.log(`${left}${colorize(status)}`);
  }
}
function summary(counts) {
  if (isMachineMode()) return;
  const order = [
    "installed",
    "removed",
    "unchanged",
    "pass",
    "skipped",
    "warn",
    "fail",
    "failed"
  ];
  const parts = [];
  for (const k of order) {
    const v = counts[k];
    if (typeof v === "number") parts.push(`${k}=${v}`);
  }
  const tail = parts.length > 0 ? " " + parts.join(" ") : "";
  console.log(`done.${tail}`);
}
var TRAILER_INDENT, STATUS_COLORS, TARGET_COL, STATUS_COL;
var init_output = __esm({
  "ts/src/cli/output.ts"() {
    "use strict";
    init_colors();
    init_non_interactive();
    TRAILER_INDENT = "      ";
    STATUS_COLORS = {
      ok: color.green,
      installed: color.green,
      skipped: color.yellow,
      failed: color.red,
      "would-install": color.cyan,
      "would-remove": color.cyan,
      unchanged: color.dim,
      pass: color.green,
      warn: color.yellow,
      fail: color.red,
      removed: color.green
    };
    TARGET_COL = 14;
    STATUS_COL = 14;
  }
});

// ts/src/env/os-paths.ts
import { join, resolve } from "path";
function openboxDataRoot() {
  const override = process.env.OPENBOX_HOME;
  if (override) return resolve(override);
  return resolve(process.cwd(), ".openbox");
}
var resolveOsPath;
var init_os_paths = __esm({
  "ts/src/env/os-paths.ts"() {
    "use strict";
    resolveOsPath = (scope) => {
      return join(openboxDataRoot(), scope);
    };
  }
});

// ts/src/file-tokens/agent-keys.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
function getPath() {
  return resolveOsPath("agent-keys");
}
function read() {
  const path16 = getPath();
  if (!existsSync(path16)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path16, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function recallAgentKey(agentId) {
  return read()[agentId] ?? null;
}
var init_agent_keys = __esm({
  "ts/src/file-tokens/agent-keys.ts"() {
    "use strict";
    init_os_paths();
  }
});

// ts/src/file-tokens/index.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "fs";
import { dirname, resolve as resolve2 } from "path";
function getTokenPath() {
  const projectTokens = resolve2(process.cwd(), ".tokens");
  if (existsSync2(projectTokens)) return projectTokens;
  return resolveOsPath("tokens");
}
function readTokenStore() {
  const path16 = getTokenPath();
  if (!existsSync2(path16)) return {};
  return parseTokenStore(readFileSync2(path16, "utf-8"));
}
function loadApiKey() {
  return process.env.OPENBOX_BACKEND_API_KEY ?? process.env.OPENBOX_API_KEY ?? readTokenStore().apiKey;
}
function saveApiKey(apiKey) {
  const path16 = getTokenPath();
  const store = readTokenStore();
  const {
    permissions: _permissions,
    features: _features,
    ...storeWithoutPrincipalMetadata
  } = store;
  const dir = dirname(path16);
  if (!existsSync2(dir)) mkdirSync2(dir, { recursive: true });
  writeFileSync2(
    path16,
    serializeTokenStore({
      ...storeWithoutPrincipalMetadata,
      apiKey,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }),
    { mode: 384 }
  );
}
function clearApiKey() {
  const path16 = getTokenPath();
  const store = readTokenStore();
  if (!store.apiKey) return false;
  const { apiKey: _apiKey, ...next } = store;
  const dir = dirname(path16);
  if (!existsSync2(dir)) mkdirSync2(dir, { recursive: true });
  writeFileSync2(path16, serializeTokenStore(next), { mode: 384 });
  return true;
}
var init_file_tokens = __esm({
  "ts/src/file-tokens/index.ts"() {
    "use strict";
    init_env();
    init_os_paths();
    init_agent_keys();
  }
});

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
var init_host_config = __esm({
  "ts/src/config/host-config.ts"() {
    "use strict";
  }
});

// ts/src/config/store.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync3, readFileSync as readFileSync4, writeFileSync as writeFileSync3 } from "fs";
import { dirname as dirname2 } from "path";
function getPath2() {
  return resolveOsPath("config");
}
function read2() {
  const path16 = getPath2();
  if (!existsSync4(path16)) return {};
  const out = {};
  for (const line of readFileSync4(path16, "utf-8").split("\n")) {
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
function write(store) {
  const lines = ["# OpenBox CLI config; managed by `openbox config set/get/unset/list`."];
  for (const key of Object.keys(store).sort()) lines.push(`${key}=${store[key]}`);
  const path16 = getPath2();
  const dir = dirname2(path16);
  if (!existsSync4(dir)) mkdirSync3(dir, { recursive: true });
  writeFileSync3(path16, `${lines.join("\n")}
`, { mode: 384 });
}
function setConfig(key, value) {
  if (!key) throw new Error("config key cannot be empty");
  if (!CONFIG_KEY.test(key)) throw new Error(`invalid config key: ${key}`);
  write({ ...read2(), [key]: value });
  return { scope: "project", purged: 0 };
}
function getConfig(key) {
  return read2()[key];
}
function unsetConfig(key) {
  const store = read2();
  if (!(key in store)) return { scope: "project", removed: false };
  const { [key]: _removed, ...next } = store;
  write(next);
  return { scope: "project", removed: true };
}
function listConfig() {
  return read2();
}
function configStorePath() {
  return getPath2();
}
function applyConfigToProcessEnv() {
  for (const [key, value] of Object.entries(listConfig())) {
    if (process.env[key] === void 0) process.env[key] = value;
  }
}
var CONFIG_KEY;
var init_store = __esm({
  "ts/src/config/store.ts"() {
    "use strict";
    init_os_paths();
    CONFIG_KEY = /^[A-Z][A-Z0-9_]*$/;
  }
});

// ts/src/config/index.ts
var init_config = __esm({
  "ts/src/config/index.ts"() {
    "use strict";
    init_host_config();
    init_store();
  }
});

// ts/src/runtime/mcp/config.ts
function setMcpClientName(name) {
  mcpCallerName = name && name.length > 0 ? name : void 0;
}
var mcpCallerName;
var init_config2 = __esm({
  "ts/src/runtime/mcp/config.ts"() {
    "use strict";
    init_env();
    init_os_paths();
  }
});

// ts/src/approvals/source.ts
function stampSource(payload, host) {
  return { ...payload, [SOURCE_INPUT_KEY]: host };
}
var SOURCE_INPUT_KEY;
var init_source = __esm({
  "ts/src/approvals/source.ts"() {
    "use strict";
    SOURCE_INPUT_KEY = "_openbox_source";
  }
});

// ts/src/core-client/generated/runtime/cursor.ts
function applyActivityVariant(table, toolName, env) {
  for (const v of table) {
    if (v.tool !== toolName) continue;
    const value = String((function getPath5(e, p) {
      if (e == null || typeof e !== "object") return void 0;
      let cur = e;
      for (const seg of p.split(".")) {
        if (cur == null || typeof cur !== "object") return void 0;
        cur = cur[seg];
      }
      return cur;
    })(env, v.field) ?? "");
    if (new RegExp(v.pattern).test(value)) return v;
  }
  return void 0;
}
function getPath3(env, path16) {
  if (env == null || typeof env !== "object") return void 0;
  let cur = env;
  for (const seg of path16.split(".")) {
    if (cur == null || typeof cur !== "object") return void 0;
    cur = cur[seg];
  }
  return cur;
}
function buildBeforeSubmitPromptPayload(env) {
  return {
    "prompt": getPath3(env, "prompt"),
    "generation_id": getPath3(env, "generation_id"),
    "event_category": "llm_prompt"
  };
}
function buildBeforeReadFilePayload(env) {
  return {
    "file_path": getPath3(env, "file_path"),
    "content": getPath3(env, "content"),
    "generation_id": getPath3(env, "generation_id"),
    "event_category": "file_read"
  };
}
function buildBeforeShellExecutionPayload(env) {
  return {
    "command": getPath3(env, "command"),
    "cwd": getPath3(env, "cwd"),
    "generation_id": getPath3(env, "generation_id"),
    "event_category": "agent_action"
  };
}
function buildBeforeMCPExecutionPayload(env, sideEffects3 = {}) {
  return {
    "tool_name": getPath3(env, "tool_name"),
    "tool_input": sideEffects3.stringify?.(getPath3(env, "tool_input")) ?? "",
    "generation_id": getPath3(env, "generation_id"),
    "event_category": "api_call"
  };
}
function buildPreToolUsePayload(env, toolName, sideEffects3 = {}) {
  switch (toolName) {
    case "Read":
      return {
        "file_path": getPath3(env, "tool_input.file_path") ?? getPath3(env, "tool_input.filePath"),
        "content": sideEffects3.readFile?.(getPath3(env, "tool_input.file_path")) ?? "",
        "event_category": "file_read"
      };
    case "Write":
      return {
        "file_path": getPath3(env, "tool_input.file_path") ?? getPath3(env, "tool_input.filePath"),
        "content": getPath3(env, "tool_input.content") ?? getPath3(env, "tool_input.new_string"),
        "event_category": "file_write"
      };
    case "Shell":
      return {
        "command": getPath3(env, "tool_input.command"),
        "cwd": getPath3(env, "tool_input.cwd") ?? getPath3(env, "cwd"),
        "event_category": "agent_action"
      };
    default:
      return {};
  }
}
function buildBeforeTabFileReadPayload(env) {
  return {
    "file_path": getPath3(env, "file_path"),
    "content": getPath3(env, "content"),
    "generation_id": getPath3(env, "generation_id"),
    "event_category": "file_read"
  };
}
function buildSubagentStartPayload(env) {
  return {
    "subagent_id": getPath3(env, "subagent_id"),
    "subagent_type": getPath3(env, "subagent_type"),
    "subagent_model": getPath3(env, "subagent_model"),
    "task": getPath3(env, "task"),
    "tool_call_id": getPath3(env, "tool_call_id"),
    "parent_conversation_id": getPath3(env, "parent_conversation_id"),
    "is_parallel_worker": getPath3(env, "is_parallel_worker"),
    "git_branch": getPath3(env, "git_branch"),
    "generation_id": getPath3(env, "generation_id"),
    "event_category": "agent_action"
  };
}
function createCursorAdapter(config) {
  const readStdin = config.readStdin ?? defaultReadStdin;
  const write2 = config.writeStdout ?? ((data) => process.stdout.write(data));
  const exit = config.exit ?? ((code) => process.exit(code));
  function writeFallback(shape, _v, env) {
    const json = renderVerdictOutput(shape, void 0, env, config.deferApproval === true);
    if (json !== void 0) write2(JSON.stringify(json));
  }
  function writeVerdict(shape, v, env) {
    const json = renderVerdictOutput(shape, v ?? void 0, env, config.deferApproval === true);
    if (json !== void 0) write2(JSON.stringify(json));
  }
  return {
    async run() {
      const raw = (await readStdin()).trim();
      if (!raw) return exit(0);
      let env;
      try {
        env = JSON.parse(raw);
      } catch {
        return exit(0);
      }
      const eventName = env["hook_event_name"];
      if (typeof eventName !== "string" || !eventName) return exit(0);
      const { workflowId, runId } = await config.resolveSession(env);
      const session = govern.attach({
        core: config.core,
        preset: presets.cursor,
        workflowId,
        runId,
        approvalPollIntervalMs: 500,
        approvalMaxWaitMs: config.approvalMaxWaitMs,
        inlineApproval: config.inlineApproval,
        onPendingApproval: config.onPendingApproval ? (info2) => config.onPendingApproval(info2, env) : void 0,
        onApprovalResolved: config.onApprovalResolved ? (info2) => config.onApprovalResolved(info2, env) : void 0,
        awaitExternalDecision: config.awaitExternalDecision ? (info2) => config.awaitExternalDecision(info2, env) : void 0
      });
      const handlers = config.handlers;
      try {
        await dispatch(eventName, env, session, handlers, writeFallback, writeVerdict);
      } finally {
        return exit(0);
      }
    }
  };
}
async function dispatch(eventName, env, session, handlers, writeFallback, writeVerdict) {
  switch (eventName) {
    case "beforeSubmitPrompt": {
      if (!handlers.beforeSubmitPrompt) {
        writeFallback("cursor-continue", void 0, env);
        return;
      }
      const verdict = await handlers.beforeSubmitPrompt(env, session);
      writeVerdict("cursor-continue", verdict, env);
      return;
    }
    case "beforeReadFile": {
      if (!handlers.beforeReadFile) {
        writeFallback("cursor-permission", void 0, env);
        return;
      }
      const verdict = await handlers.beforeReadFile(env, session);
      writeVerdict("cursor-permission", verdict, env);
      return;
    }
    case "beforeShellExecution": {
      if (!handlers.beforeShellExecution) {
        writeFallback("cursor-permission", void 0, env);
        return;
      }
      const verdict = await handlers.beforeShellExecution(env, session);
      writeVerdict("cursor-permission", verdict, env);
      return;
    }
    case "beforeMCPExecution": {
      if (!handlers.beforeMCPExecution) {
        writeFallback("cursor-permission", void 0, env);
        return;
      }
      const verdict = await handlers.beforeMCPExecution(env, session);
      writeVerdict("cursor-permission", verdict, env);
      return;
    }
    case "preToolUse": {
      if (!handlers.preToolUse) {
        writeFallback("cursor-permission", void 0, env);
        return;
      }
      const verdict = await handlers.preToolUse(env, session);
      writeVerdict("cursor-permission", verdict, env);
      return;
    }
    case "afterAgentResponse": {
      if (!handlers.afterAgentResponse) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.afterAgentResponse(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "afterAgentThought": {
      if (!handlers.afterAgentThought) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.afterAgentThought(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "afterShellExecution": {
      if (!handlers.afterShellExecution) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.afterShellExecution(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "afterFileEdit": {
      if (!handlers.afterFileEdit) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.afterFileEdit(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "afterMCPExecution": {
      if (!handlers.afterMCPExecution) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.afterMCPExecution(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "postToolUse": {
      if (!handlers.postToolUse) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.postToolUse(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "postToolUseFailure": {
      if (!handlers.postToolUseFailure) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.postToolUseFailure(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "sessionStart": {
      if (!handlers.sessionStart) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.sessionStart(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "stop": {
      if (!handlers.stop) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.stop(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "beforeTabFileRead": {
      if (!handlers.beforeTabFileRead) {
        writeFallback("cursor-permission", void 0, env);
        return;
      }
      const verdict = await handlers.beforeTabFileRead(env, session);
      writeVerdict("cursor-permission", verdict, env);
      return;
    }
    case "afterTabFileEdit": {
      if (!handlers.afterTabFileEdit) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.afterTabFileEdit(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "sessionEnd": {
      if (!handlers.sessionEnd) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.sessionEnd(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "preCompact": {
      if (!handlers.preCompact) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.preCompact(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    case "subagentStart": {
      if (!handlers.subagentStart) {
        writeFallback("cursor-permission", void 0, env);
        return;
      }
      const verdict = await handlers.subagentStart(env, session);
      writeVerdict("cursor-permission", verdict, env);
      return;
    }
    case "subagentStop": {
      if (!handlers.subagentStop) {
        writeFallback("cursor-observe", void 0, env);
        return;
      }
      const verdict = await handlers.subagentStop(env, session);
      writeVerdict("cursor-observe", verdict, env);
      return;
    }
    default:
      return;
  }
}
async function defaultReadStdin() {
  const MAX_BYTES2 = 10 * 1024 * 1024;
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buf = chunk;
    total += buf.length;
    if (total > MAX_BYTES2) {
      throw new Error(
        `hook stdin exceeded ${MAX_BYTES2.toLocaleString()} bytes; refusing to buffer further (likely runaway pipe or hostile input)`
      );
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
function brand(raw) {
  const sanitized = raw.replace(/[\u2014\u2013]/g, " - ").replace(/ {2,}/g, " ").trim();
  if (!sanitized) return "";
  return sanitized.startsWith("[OpenBox]") ? sanitized : "[OpenBox] " + sanitized;
}
function redactedInput(v) {
  return v?.guardrailsResult?.redactedInput;
}
function objectRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  return value;
}
function addIfDefined(target, key, value) {
  if (value !== void 0) target[key] = value;
}
function renderVerdictOutput(shape, v, env, deferApproval = false) {
  const arm = v?.arm ?? "allow";
  const reason = brand(v?.reason ?? "");
  switch (shape) {
    case "permission-decision": {
      const eventName = env.hook_event_name ?? "PreToolUse";
      if (arm === "allow" || arm === "constrain") {
        const hookSpecificOutput = {
          hookEventName: eventName,
          permissionDecision: "allow"
        };
        if (arm === "constrain") {
          addIfDefined(hookSpecificOutput, "updatedInput", objectRecord(redactedInput(v)));
          if (reason) hookSpecificOutput.additionalContext = reason;
        }
        return {
          hookSpecificOutput
        };
      }
      if (arm === "require_approval") {
        return {
          hookSpecificOutput: {
            hookEventName: eventName,
            permissionDecision: deferApproval ? "defer" : "ask",
            permissionDecisionReason: reason || "[OpenBox] approval required"
          }
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          permissionDecision: "deny",
          permissionDecisionReason: reason || "[OpenBox] blocked by policy"
        }
      };
    }
    case "decision-block": {
      if (arm === "block" || arm === "halt") {
        return {
          decision: "block",
          reason: reason || "[OpenBox] blocked by policy"
        };
      }
      if (arm === "constrain" && reason) {
        const hookSpecificOutput = {
          hookEventName: env.hook_event_name ?? "ClaudeCode",
          additionalContext: reason
        };
        addIfDefined(hookSpecificOutput, "updatedToolOutput", redactedInput(v));
        return { hookSpecificOutput };
      }
      return {};
    }
    case "permission-request": {
      const eventName = env.hook_event_name ?? "PermissionRequest";
      if (arm === "allow" || arm === "constrain") {
        const decision = { behavior: "allow" };
        if (arm === "constrain") {
          addIfDefined(decision, "updatedInput", objectRecord(redactedInput(v)));
        }
        return {
          hookSpecificOutput: {
            hookEventName: eventName,
            decision
          }
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          decision: {
            behavior: "deny",
            message: reason || "[OpenBox] blocked by policy"
          }
        }
      };
    }
    case "permission-denied-retry": {
      const eventName = env.hook_event_name ?? "PermissionDenied";
      if (arm === "allow" || arm === "constrain") {
        return {
          hookSpecificOutput: {
            hookEventName: eventName,
            retry: true
          }
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          retry: false
        }
      };
    }
    case "elicitation-response": {
      const eventName = env.hook_event_name ?? "Elicitation";
      if (arm === "allow") return {};
      if (arm === "constrain") {
        return {
          hookSpecificOutput: {
            hookEventName: eventName,
            action: "accept",
            content: redactedInput(v) ?? env.response ?? env.content ?? {}
          }
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          action: arm === "halt" ? "cancel" : "decline",
          content: {}
        }
      };
    }
    case "continue-block": {
      if (arm === "allow" || arm === "constrain") return {};
      return {
        continue: false,
        stopReason: reason || "[OpenBox] blocked by policy"
      };
    }
    case "additional-context": {
      if (arm === "allow") return {};
      return {
        hookSpecificOutput: {
          hookEventName: env.hook_event_name ?? "PostToolUseFailure",
          additionalContext: reason || "[OpenBox] blocked by policy"
        }
      };
    }
    case "cursor-permission": {
      if (arm === "allow" || arm === "constrain") return { permission: "allow" };
      if (arm === "require_approval") {
        const r = reason.replace(/^\[OpenBox\] /, "").trim();
        return {
          permission: "deny",
          user_message: "[OpenBox] approval pending" + (r ? ": " + r : "") + ". Click Approve in the OpenBox notification, then ask the agent to retry.",
          // Direct LLM instruction. (a) Force the brand into the
          // chat text the LLM will write so the user sees who
          // gated the action; Cursor's chat doesn't insert that
          // for us on most events (only subagentStart has the
          // hardcoded "Subagent creation blocked by hook:" prefix).
          // (b) Hard-stop the LLM's tendency to promise auto-retry,
          // which it can't deliver because Cursor's hook protocol
          // is one-shot.
          agent_message: "[OpenBox] blocked this action. Tell the user verbatim: 'OpenBox is gating this action. Approve it in the OpenBox notification, then ask me to retry.' Then STOP. Do NOT retry on your own. Do NOT speculate, describe, or invent what the blocked command WOULD have produced; you didn't run it, you don't know. Do NOT show 'expected output' or 'if you run it locally'. Just relay the gate message and wait for approval."
        };
      }
      if (arm === "halt") {
        return {
          permission: "deny",
          user_message: "[OpenBox] HALT: " + (reason.replace(/^\[OpenBox\] /, "") || "session halted"),
          agent_message: "[OpenBox] HALT: do not proceed"
        };
      }
      return {
        permission: "deny",
        user_message: reason || "[OpenBox] blocked by policy"
      };
    }
    case "cursor-continue": {
      if (arm === "allow" || arm === "constrain") return { continue: true };
      if (arm === "require_approval") {
        const r = reason.replace(/^\[OpenBox\] /, "").trim();
        return {
          continue: false,
          user_message: "[OpenBox] approval needed" + (r ? ": " + r : "") + ". Approve in the OpenBox notification, then resubmit your prompt (Cursor cannot resume a submitted prompt)."
        };
      }
      if (arm === "halt") {
        return {
          continue: false,
          user_message: "[OpenBox] HALT: " + (reason.replace(/^\[OpenBox\] /, "") || "session halted")
        };
      }
      return {
        continue: false,
        user_message: reason || "[OpenBox] blocked by policy"
      };
    }
    case "cursor-observe":
      return {};
    case "none":
      return void 0;
  }
}
var PRE_TOOL_USE_ROUTING, BEFORE_SUBMIT_PROMPT_ACTIVITY_TYPE, BEFORE_READ_FILE_ACTIVITY_TYPE, BEFORE_SHELL_EXECUTION_ACTIVITY_TYPE, BEFORE_MCPEXECUTION_ACTIVITY_TYPE, BEFORE_TAB_FILE_READ_ACTIVITY_TYPE, SUBAGENT_START_ACTIVITY_TYPE, HOOK_SPEC, PRE_TOOL_USE_VARIANTS;
var init_cursor = __esm({
  "ts/src/core-client/generated/runtime/cursor.ts"() {
    "use strict";
    init_govern();
    PRE_TOOL_USE_ROUTING = {
      "Read": "FileRead",
      "Write": "FileEdit",
      "Shell": "ShellExecution"
    };
    BEFORE_SUBMIT_PROMPT_ACTIVITY_TYPE = "PromptSubmission";
    BEFORE_READ_FILE_ACTIVITY_TYPE = "FileRead";
    BEFORE_SHELL_EXECUTION_ACTIVITY_TYPE = "ShellExecution";
    BEFORE_MCPEXECUTION_ACTIVITY_TYPE = "MCPToolCall";
    BEFORE_TAB_FILE_READ_ACTIVITY_TYPE = "FileRead";
    SUBAGENT_START_ACTIVITY_TYPE = "SubagentStart";
    HOOK_SPEC = {
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
    PRE_TOOL_USE_VARIANTS = [
      {
        "tool": "Shell",
        "field": "tool_input.command",
        "pattern": "\\b(rm|unlink|rmdir|shred)\\b",
        "activityType": "FileDelete",
        "eventCategory": "file_delete"
      }
    ];
  }
});

// ts/src/runtime/cursor/plugin.ts
import {
  cpSync,
  existsSync as existsSync5,
  lstatSync,
  mkdirSync as mkdirSync4,
  readFileSync as readFileSync6,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync as writeFileSync4
} from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
function cursorPluginTargetDir(cwd = process.cwd()) {
  return path.join(cwd, ".cursor", "plugins", "local", "openbox");
}
function cursorRuntimeConfigDir(cwd = process.cwd()) {
  return path.join(cwd, ".cursor-hooks");
}
function readJson(file) {
  try {
    return JSON.parse(readFileSync6(file, "utf-8"));
  } catch {
    return void 0;
  }
}
function packageVersion() {
  const candidates = [
    path.resolve(__dirname, "../../package.json"),
    path.resolve(__dirname, "../../../package.json"),
    path.resolve(__dirname, "../../../../package.json"),
    path.resolve(process.cwd(), "package.json")
  ];
  for (const candidate of candidates) {
    const pkg = readJson(candidate);
    if (typeof pkg?.version === "string" && pkg.version.length > 0) {
      return pkg.version;
    }
  }
  return "0.1.0";
}
function findExistingDir(label, candidates) {
  for (const candidate of candidates) {
    if (existsSync5(candidate)) return candidate;
  }
  throw new Error(
    `Could not find ${label} in any of:
${candidates.map((c) => `  - ${c}`).join("\n")}`
  );
}
function findTemplateDir(kind) {
  return findExistingDir(`Cursor template directory '${kind}'`, [
    path.resolve(__dirname, "templates", kind),
    path.resolve(__dirname, "../runtime/cursor/templates", kind),
    path.resolve(__dirname, "../../ts/src/runtime/cursor/templates", kind),
    path.resolve(__dirname, "../../../ts/src/runtime/cursor/templates", kind),
    path.resolve(process.cwd(), "ts/src/runtime/cursor/templates", kind)
  ]);
}
function findSkillDir() {
  return findExistingDir("OpenBox skill directory", [
    path.resolve(__dirname, "../../skill"),
    path.resolve(__dirname, "../../../skill"),
    path.resolve(__dirname, "../../../../skill"),
    path.resolve(process.cwd(), "skill")
  ]);
}
function safeOutDir(out) {
  const resolved = path.resolve(out);
  const root = path.parse(resolved).root;
  if (resolved === root || resolved === os.homedir()) {
    throw new Error(`Refusing to overwrite unsafe plugin output path: ${resolved}`);
  }
  return resolved;
}
function assertProjectTarget(target, cwd) {
  const resolvedTarget = safeOutDir(target);
  const resolvedProject = path.resolve(cwd);
  const rel = path.relative(resolvedProject, resolvedTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Cursor plugin install target must be inside the project: ${resolvedProject}`);
  }
  return resolvedTarget;
}
function writeJson(file, value) {
  mkdirSync4(path.dirname(file), { recursive: true });
  writeFileSync4(file, JSON.stringify(value, null, 2) + "\n", "utf-8");
}
function writeRuntimeConfigTemplate(configDir) {
  mkdirSync4(configDir, { recursive: true });
  const file = path.join(configDir, "config.json");
  if (existsSync5(file)) return;
  const example = {
    OPENBOX_API_KEY: "obx_live_YOUR_API_KEY_HERE",
    OPENBOX_CORE_URL: "https://core.example/ob",
    GOVERNANCE_POLICY: "fail_open",
    HITL_ENABLED: true,
    HITL_MAX_WAIT: 300,
    VERBOSE: false,
    DRY_RUN: true
  };
  writeFileSync4(file, JSON.stringify(example, null, 2) + "\n", {
    mode: 384,
    encoding: "utf-8"
  });
}
function cursorHooksJson(matchers) {
  const hooks = {};
  for (const event of HOOK_SPEC.events) {
    const entry = { command: HOOK_SPEC.command };
    if (event.timeout !== void 0) entry.timeout = event.timeout;
    const matcher = matchers?.[event.name];
    if (matcher) entry.matcher = matcher;
    hooks[event.name] = [entry];
  }
  return { [HOOK_SPEC.key]: hooks };
}
function mcpJson() {
  return {
    mcpServers: {
      openbox: {
        command: "openbox",
        args: ["mcp", "serve"]
      }
    }
  };
}
function pluginManifest(version) {
  return {
    name: "openbox",
    displayName: "OpenBox AI Governance",
    version,
    description: "Active governance for AI coding agents in Cursor: policy gates, guardrails, approvals, MCP, slash commands, rules, and agent templates.",
    author: {
      name: "OpenBox AI",
      email: "team@openbox.ai"
    },
    license: "MIT",
    keywords: [
      "openbox",
      "ai-governance",
      "guardrails",
      "policy",
      "opa",
      "approvals",
      "hitl",
      "agent-trace",
      "behavior-rules",
      "cursor",
      "skill",
      "mcp",
      "rules",
      "agents",
      "commands"
    ]
  };
}
function marketplaceManifest(version) {
  return {
    name: "openbox",
    owner: {
      name: "OpenBox AI",
      email: "team@openbox.ai"
    },
    metadata: {
      description: "OpenBox governance bundle for Cursor: gates, approvals, slash commands, MCP server, rules, agent templates, and the OpenBox skill.",
      version
    },
    plugins: [
      {
        name: "openbox",
        source: ".",
        description: "Active governance for AI coding agents through pre-action gates, approval UI, agent-trace emission, slash commands, rules, and the OpenBox skill."
      }
    ]
  };
}
function copyDir(src, dst) {
  rmSync(dst, { recursive: true, force: true });
  mkdirSync4(path.dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
}
function exportCursorPlugin(options) {
  const out = safeOutDir(options.out);
  if (existsSync5(out)) {
    if (options.force === false) {
      throw new Error(`Cursor plugin output already exists: ${out}`);
    }
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync4(out, { recursive: true });
  const version = packageVersion();
  writeJson(path.join(out, ".cursor-plugin", "plugin.json"), pluginManifest(version));
  writeJson(path.join(out, ".cursor-plugin", "marketplace.json"), marketplaceManifest(version));
  copyDir(findSkillDir(), path.join(out, "skills", "openbox"));
  copyDir(findTemplateDir("commands"), path.join(out, "commands"));
  copyDir(findTemplateDir("rules"), path.join(out, "rules"));
  copyDir(findTemplateDir("agents"), path.join(out, "agents"));
  writeJson(path.join(out, "hooks", "hooks.json"), cursorHooksJson(options.matchers));
  writeJson(path.join(out, "mcp.json"), mcpJson());
  return out;
}
function installCursorPlugin(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const target = assertProjectTarget(options.target ?? cursorPluginTargetDir(cwd), cwd);
  if (options.symlink) {
    const source = safeOutDir(options.symlink);
    if (!existsSync5(source)) {
      throw new Error(`Cursor plugin symlink source does not exist: ${source}`);
    }
    rmSync(target, { recursive: true, force: true });
    mkdirSync4(path.dirname(target), { recursive: true });
    symlinkSync(source, target, "dir");
    if (!options.skipRuntimeConfig) {
      writeRuntimeConfigTemplate(cursorRuntimeConfigDir(cwd));
    }
    return target;
  }
  const out = exportCursorPlugin({
    out: target,
    matchers: options.matchers
  });
  if (!options.skipRuntimeConfig) {
    writeRuntimeConfigTemplate(cursorRuntimeConfigDir(cwd));
  }
  return out;
}
function uninstallCursorPlugin(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const target = assertProjectTarget(options.target ?? cursorPluginTargetDir(cwd), cwd);
  rmSync(target, { recursive: true, force: true });
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
var __dirname, EXPECTED_COMMAND_FILES, EXPECTED_RULE_FILES, EXPECTED_AGENT_FILES;
var init_plugin = __esm({
  "ts/src/runtime/cursor/plugin.ts"() {
    "use strict";
    init_cursor();
    __dirname = path.dirname(fileURLToPath(import.meta.url));
    EXPECTED_COMMAND_FILES = [
      "openbox-check.md",
      "openbox-doctor.md",
      "openbox-list-agents.md",
      "openbox-pending.md",
      "openbox-status.md"
    ];
    EXPECTED_RULE_FILES = ["openbox.mdc"];
    EXPECTED_AGENT_FILES = ["openbox-reviewer.md"];
  }
});

// ts/src/runtime/cursor/install.ts
var install_exports = {};
__export(install_exports, {
  verifyCursorInstall: () => verifyCursorInstall
});
import path2 from "path";
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
var init_install = __esm({
  "ts/src/runtime/cursor/install.ts"() {
    "use strict";
    init_host_config();
    init_config();
    init_env();
    init_core_client2();
    init_plugin();
  }
});

// ts/src/core-client/generated/runtime/claude-code.ts
function getPath4(env, path16) {
  if (env == null || typeof env !== "object") return void 0;
  let cur = env;
  for (const seg of path16.split(".")) {
    if (cur == null || typeof cur !== "object") return void 0;
    cur = cur[seg];
  }
  return cur;
}
function buildPreToolUsePayload2(env, toolName, sideEffects3 = {}) {
  switch (toolName) {
    case "Read":
      return {
        "text": sideEffects3.readFile?.(getPath4(env, "tool_input.file_path")) ?? "",
        "file_path": getPath4(env, "tool_input.file_path") ?? getPath4(env, "tool_input.filePath"),
        "content": sideEffects3.readFile?.(getPath4(env, "tool_input.file_path")) ?? "",
        "event_category": "file_read"
      };
    case "Delete":
      return {
        "text": getPath4(env, "tool_input.path") ?? getPath4(env, "tool_input.file_path"),
        "file_path": getPath4(env, "tool_input.path") ?? getPath4(env, "tool_input.file_path"),
        "event_category": "file_delete"
      };
    case "Write":
      return {
        "text": getPath4(env, "tool_input.content") ?? getPath4(env, "tool_input.new_string"),
        "file_path": getPath4(env, "tool_input.file_path") ?? getPath4(env, "tool_input.filePath"),
        "content": getPath4(env, "tool_input.content") ?? getPath4(env, "tool_input.new_string"),
        "event_category": "file_write"
      };
    case "Edit":
      return {
        "text": getPath4(env, "tool_input.content") ?? getPath4(env, "tool_input.new_string"),
        "file_path": getPath4(env, "tool_input.file_path") ?? getPath4(env, "tool_input.filePath"),
        "content": getPath4(env, "tool_input.content") ?? getPath4(env, "tool_input.new_string"),
        "event_category": "file_write"
      };
    case "MultiEdit":
      return {
        "text": getPath4(env, "tool_input.edits") ?? getPath4(env, "tool_input.content"),
        "file_path": getPath4(env, "tool_input.file_path") ?? getPath4(env, "tool_input.filePath"),
        "content": getPath4(env, "tool_input.edits") ?? getPath4(env, "tool_input.content"),
        "event_category": "file_write"
      };
    case "NotebookEdit":
      return {
        "text": getPath4(env, "tool_input.new_source") ?? getPath4(env, "tool_input.content"),
        "file_path": getPath4(env, "tool_input.notebook_path") ?? getPath4(env, "tool_input.file_path"),
        "content": getPath4(env, "tool_input.new_source") ?? getPath4(env, "tool_input.content"),
        "event_category": "file_write"
      };
    case "NotebookRead":
      return {
        "text": sideEffects3.readFile?.(getPath4(env, "tool_input.notebook_path")) ?? "",
        "file_path": getPath4(env, "tool_input.notebook_path") ?? getPath4(env, "tool_input.file_path"),
        "content": sideEffects3.readFile?.(getPath4(env, "tool_input.notebook_path")) ?? "",
        "event_category": "file_read"
      };
    case "Glob":
      return {
        "text": getPath4(env, "tool_input.pattern"),
        "file_path": getPath4(env, "tool_input.path") ?? getPath4(env, "cwd"),
        "event_category": "file_read"
      };
    case "Grep":
      return {
        "text": getPath4(env, "tool_input.pattern"),
        "file_path": getPath4(env, "tool_input.path") ?? getPath4(env, "cwd"),
        "event_category": "file_read"
      };
    case "Bash":
      return {
        "text": getPath4(env, "tool_input.command"),
        "command": getPath4(env, "tool_input.command"),
        "cwd": getPath4(env, "tool_input.cwd") ?? getPath4(env, "cwd"),
        "event_category": "agent_action"
      };
    case "PowerShell":
      return {
        "text": getPath4(env, "tool_input.command"),
        "command": getPath4(env, "tool_input.command"),
        "cwd": getPath4(env, "tool_input.cwd") ?? getPath4(env, "cwd"),
        "event_category": "agent_action"
      };
    case "WebFetch":
      return {
        "url": getPath4(env, "tool_input.url") ?? getPath4(env, "tool_input.query"),
        "http_method": "GET",
        "event_category": "http_request"
      };
    case "WebSearch":
      return {
        "url": getPath4(env, "tool_input.url") ?? getPath4(env, "tool_input.query"),
        "http_method": "GET",
        "event_category": "http_request"
      };
    case "Agent":
      return {
        "agent_type": getPath4(env, "tool_input.subagent_type") ?? getPath4(env, "tool_input.description"),
        "prompt": getPath4(env, "tool_input.prompt"),
        "event_category": "agent_action"
      };
    case "AskUserQuestion":
      return {
        "text": getPath4(env, "tool_input.question") ?? getPath4(env, "tool_input.message"),
        "event_category": "agent_action"
      };
    case "ExitPlanMode":
      return {
        "text": getPath4(env, "tool_input.plan"),
        "event_category": "agent_action"
      };
    case "Skill":
      return {
        "tool_name": getPath4(env, "tool_name"),
        "tool_input": getPath4(env, "tool_input"),
        "event_category": "agent_action"
      };
    default:
      return {
        "tool_name": getPath4(env, "tool_name"),
        "tool_input": getPath4(env, "tool_input"),
        "event_category": "mcp_tool_call"
      };
  }
}
function buildPostToolUsePayload(env, sideEffects3 = {}) {
  return {
    "tool_name": getPath4(env, "tool_name"),
    "output": sideEffects3.stringifyTruncate?.(getPath4(env, "tool_response")) ?? "",
    "event_category": "agent_observation"
  };
}
function buildPostToolUseFailurePayload(env) {
  return {
    "tool_name": getPath4(env, "tool_name"),
    "tool_input": getPath4(env, "tool_input"),
    "error": getPath4(env, "error") ?? getPath4(env, "reason"),
    "event_category": "agent_observation"
  };
}
function buildPostToolBatchPayload(env, sideEffects3 = {}) {
  return {
    "tool_calls": getPath4(env, "tool_calls"),
    "output": sideEffects3.stringifyTruncate?.(getPath4(env, "tool_calls")) ?? "",
    "event_category": "agent_observation"
  };
}
function buildUserPromptSubmitPayload(env) {
  return {
    "text": getPath4(env, "prompt"),
    "prompt": getPath4(env, "prompt"),
    "model": getPath4(env, "model"),
    "event_category": "llm_prompt"
  };
}
function buildUserPromptExpansionPayload(env) {
  return {
    "text": getPath4(env, "expanded_prompt") ?? getPath4(env, "prompt"),
    "prompt": getPath4(env, "expanded_prompt") ?? getPath4(env, "prompt"),
    "command_name": getPath4(env, "command_name"),
    "command_args": getPath4(env, "command_args"),
    "event_category": "llm_prompt"
  };
}
function buildPermissionRequestPayload(env, toolName) {
  switch (toolName) {
    case "Read":
      return {
        "tool_name": getPath4(env, "tool_name"),
        "tool_input": getPath4(env, "tool_input"),
        "file_path": getPath4(env, "tool_input.file_path") ?? getPath4(env, "tool_input.filePath"),
        "event_category": "file_read"
      };
    case "Delete":
      return {
        "tool_name": getPath4(env, "tool_name"),
        "tool_input": getPath4(env, "tool_input"),
        "file_path": getPath4(env, "tool_input.path") ?? getPath4(env, "tool_input.file_path"),
        "event_category": "file_delete"
      };
    case "Write":
      return {
        "tool_name": getPath4(env, "tool_name"),
        "tool_input": getPath4(env, "tool_input"),
        "text": getPath4(env, "tool_input.content") ?? getPath4(env, "tool_input.new_string"),
        "file_path": getPath4(env, "tool_input.file_path") ?? getPath4(env, "tool_input.filePath"),
        "content": getPath4(env, "tool_input.content") ?? getPath4(env, "tool_input.new_string"),
        "event_category": "file_write"
      };
    case "Edit":
      return {
        "tool_name": getPath4(env, "tool_name"),
        "tool_input": getPath4(env, "tool_input"),
        "text": getPath4(env, "tool_input.content") ?? getPath4(env, "tool_input.new_string"),
        "file_path": getPath4(env, "tool_input.file_path") ?? getPath4(env, "tool_input.filePath"),
        "content": getPath4(env, "tool_input.content") ?? getPath4(env, "tool_input.new_string"),
        "event_category": "file_write"
      };
    case "Bash":
      return {
        "tool_name": getPath4(env, "tool_name"),
        "tool_input": getPath4(env, "tool_input"),
        "text": getPath4(env, "tool_input.command"),
        "command": getPath4(env, "tool_input.command"),
        "cwd": getPath4(env, "tool_input.cwd") ?? getPath4(env, "cwd"),
        "event_category": "agent_action"
      };
    case "WebFetch":
      return {
        "tool_name": getPath4(env, "tool_name"),
        "tool_input": getPath4(env, "tool_input"),
        "url": getPath4(env, "tool_input.url") ?? getPath4(env, "tool_input.query"),
        "http_method": "GET",
        "event_category": "http_request"
      };
    case "WebSearch":
      return {
        "tool_name": getPath4(env, "tool_name"),
        "tool_input": getPath4(env, "tool_input"),
        "url": getPath4(env, "tool_input.url") ?? getPath4(env, "tool_input.query"),
        "http_method": "GET",
        "event_category": "http_request"
      };
    case "Agent":
      return {
        "tool_name": getPath4(env, "tool_name"),
        "tool_input": getPath4(env, "tool_input"),
        "event_category": "agent_action"
      };
    default:
      return {
        "tool_name": getPath4(env, "tool_name"),
        "tool_input": getPath4(env, "tool_input"),
        "event_category": "mcp_tool_call"
      };
  }
}
function buildPermissionDeniedPayload(env) {
  return {
    "tool_name": getPath4(env, "tool_name"),
    "tool_input": getPath4(env, "tool_input"),
    "reason": getPath4(env, "reason"),
    "event_category": "agent_action"
  };
}
function buildSetupPayload(env) {
  return {
    "trigger": getPath4(env, "trigger"),
    "event_category": "workflow_start"
  };
}
function buildPreCompactPayload(env) {
  return {
    "trigger": getPath4(env, "trigger"),
    "custom_instructions": getPath4(env, "custom_instructions"),
    "event_category": "workflow_compact"
  };
}
function buildPostCompactPayload(env) {
  return {
    "compact_summary": getPath4(env, "compact_summary"),
    "event_category": "workflow_compact"
  };
}
function buildSessionStartPayload(env) {
  return {
    "status": "started",
    "cwd": getPath4(env, "cwd"),
    "event_category": "workflow_start"
  };
}
function buildSessionEndPayload(env) {
  return {
    "status": "completed",
    "event_category": "workflow_complete"
  };
}
function buildSubagentStartPayload2(env) {
  return {
    "agent_id": getPath4(env, "agent_id"),
    "agent_type": getPath4(env, "agent_type"),
    "event_category": "agent_action"
  };
}
function buildSubagentStopPayload(env) {
  return {
    "agent_id": getPath4(env, "agent_id"),
    "agent_type": getPath4(env, "agent_type"),
    "status": "completed",
    "event_category": "agent_observation"
  };
}
function buildTaskCreatedPayload(env) {
  return {
    "task_id": getPath4(env, "task_id"),
    "task_subject": getPath4(env, "task_subject"),
    "task_description": getPath4(env, "task_description"),
    "teammate_name": getPath4(env, "teammate_name"),
    "team_name": getPath4(env, "team_name"),
    "event_category": "agent_action"
  };
}
function buildTaskCompletedPayload(env) {
  return {
    "task_id": getPath4(env, "task_id"),
    "task_subject": getPath4(env, "task_subject"),
    "task_description": getPath4(env, "task_description"),
    "teammate_name": getPath4(env, "teammate_name"),
    "team_name": getPath4(env, "team_name"),
    "event_category": "agent_observation"
  };
}
function buildStopPayload(env) {
  return {
    "cwd": getPath4(env, "cwd"),
    "stop_hook_active": getPath4(env, "stop_hook_active"),
    "last_assistant_message": getPath4(env, "last_assistant_message"),
    "background_tasks": getPath4(env, "background_tasks"),
    "session_crons": getPath4(env, "session_crons"),
    "event_category": "workflow_stop_request"
  };
}
function buildStopFailurePayload(env) {
  return {
    "error": getPath4(env, "error") ?? getPath4(env, "reason"),
    "event_category": "workflow_failed"
  };
}
function buildTeammateIdlePayload(env) {
  return {
    "teammate_name": getPath4(env, "teammate_name"),
    "team_name": getPath4(env, "team_name"),
    "event_category": "agent_observation"
  };
}
function createClaudeCodeAdapter(config) {
  const readStdin = config.readStdin ?? defaultReadStdin2;
  const write2 = config.writeStdout ?? ((data) => process.stdout.write(data));
  const exit = config.exit ?? ((code) => process.exit(code));
  function writeFallback(shape, _v, env) {
    const json = renderVerdictOutput2(shape, void 0, env, config.deferApproval === true);
    if (json !== void 0) write2(JSON.stringify(json));
  }
  function writeVerdict(shape, v, env) {
    const json = renderVerdictOutput2(shape, v ?? void 0, env, config.deferApproval === true);
    if (json !== void 0) write2(JSON.stringify(json));
  }
  return {
    async run() {
      const raw = (await readStdin()).trim();
      if (!raw) return exit(0);
      let env;
      try {
        env = JSON.parse(raw);
      } catch {
        return exit(0);
      }
      const eventName = env["hook_event_name"];
      if (typeof eventName !== "string" || !eventName) return exit(0);
      const { workflowId, runId } = await config.resolveSession(env);
      const session = govern.attach({
        core: config.core,
        preset: presets.claudeCode,
        workflowId,
        runId,
        approvalPollIntervalMs: 500,
        approvalMaxWaitMs: config.approvalMaxWaitMs,
        inlineApproval: config.inlineApproval,
        onPendingApproval: config.onPendingApproval ? (info2) => config.onPendingApproval(info2, env) : void 0,
        onApprovalResolved: config.onApprovalResolved ? (info2) => config.onApprovalResolved(info2, env) : void 0,
        awaitExternalDecision: config.awaitExternalDecision ? (info2) => config.awaitExternalDecision(info2, env) : void 0
      });
      const handlers = config.handlers;
      try {
        await dispatch2(eventName, env, session, handlers, writeFallback, writeVerdict);
      } finally {
        return exit(0);
      }
    }
  };
}
async function dispatch2(eventName, env, session, handlers, writeFallback, writeVerdict) {
  switch (eventName) {
    case "PreToolUse": {
      if (!handlers.preToolUse) {
        writeFallback("permission-decision", void 0, env);
        return;
      }
      const verdict = await handlers.preToolUse(env, session);
      writeVerdict("permission-decision", verdict, env);
      return;
    }
    case "PostToolUse": {
      if (!handlers.postToolUse) {
        writeFallback("decision-block", void 0, env);
        return;
      }
      const verdict = await handlers.postToolUse(env, session);
      writeVerdict("decision-block", verdict, env);
      return;
    }
    case "PostToolUseFailure": {
      if (!handlers.postToolUseFailure) {
        writeFallback("additional-context", void 0, env);
        return;
      }
      const verdict = await handlers.postToolUseFailure(env, session);
      writeVerdict("additional-context", verdict, env);
      return;
    }
    case "PostToolBatch": {
      if (!handlers.postToolBatch) {
        writeFallback("decision-block", void 0, env);
        return;
      }
      const verdict = await handlers.postToolBatch(env, session);
      writeVerdict("decision-block", verdict, env);
      return;
    }
    case "UserPromptSubmit": {
      if (!handlers.userPromptSubmit) {
        writeFallback("decision-block", void 0, env);
        return;
      }
      const verdict = await handlers.userPromptSubmit(env, session);
      writeVerdict("decision-block", verdict, env);
      return;
    }
    case "UserPromptExpansion": {
      if (!handlers.userPromptExpansion) {
        writeFallback("decision-block", void 0, env);
        return;
      }
      const verdict = await handlers.userPromptExpansion(env, session);
      writeVerdict("decision-block", verdict, env);
      return;
    }
    case "PermissionRequest": {
      if (!handlers.permissionRequest) {
        writeFallback("permission-request", void 0, env);
        return;
      }
      const verdict = await handlers.permissionRequest(env, session);
      writeVerdict("permission-request", verdict, env);
      return;
    }
    case "PermissionDenied": {
      if (!handlers.permissionDenied) {
        writeFallback("permission-denied-retry", void 0, env);
        return;
      }
      const verdict = await handlers.permissionDenied(env, session);
      writeVerdict("permission-denied-retry", verdict, env);
      return;
    }
    case "Setup": {
      if (!handlers.setup) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.setup(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "InstructionsLoaded": {
      if (!handlers.instructionsLoaded) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.instructionsLoaded(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "PreCompact": {
      if (!handlers.preCompact) {
        writeFallback("decision-block", void 0, env);
        return;
      }
      const verdict = await handlers.preCompact(env, session);
      writeVerdict("decision-block", verdict, env);
      return;
    }
    case "PostCompact": {
      if (!handlers.postCompact) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.postCompact(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "SessionStart": {
      if (!handlers.sessionStart) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.sessionStart(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "SessionEnd": {
      if (!handlers.sessionEnd) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.sessionEnd(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "SubagentStart": {
      if (!handlers.subagentStart) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.subagentStart(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "SubagentStop": {
      if (!handlers.subagentStop) {
        writeFallback("decision-block", void 0, env);
        return;
      }
      const verdict = await handlers.subagentStop(env, session);
      writeVerdict("decision-block", verdict, env);
      return;
    }
    case "TaskCreated": {
      if (!handlers.taskCreated) {
        writeFallback("continue-block", void 0, env);
        return;
      }
      const verdict = await handlers.taskCreated(env, session);
      writeVerdict("continue-block", verdict, env);
      return;
    }
    case "TaskCompleted": {
      if (!handlers.taskCompleted) {
        writeFallback("continue-block", void 0, env);
        return;
      }
      const verdict = await handlers.taskCompleted(env, session);
      writeVerdict("continue-block", verdict, env);
      return;
    }
    case "Stop": {
      if (!handlers.stop) {
        writeFallback("decision-block", void 0, env);
        return;
      }
      const verdict = await handlers.stop(env, session);
      writeVerdict("decision-block", verdict, env);
      return;
    }
    case "StopFailure": {
      if (!handlers.stopFailure) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.stopFailure(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "TeammateIdle": {
      if (!handlers.teammateIdle) {
        writeFallback("continue-block", void 0, env);
        return;
      }
      const verdict = await handlers.teammateIdle(env, session);
      writeVerdict("continue-block", verdict, env);
      return;
    }
    case "Notification": {
      if (!handlers.notification) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.notification(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "MessageDisplay": {
      if (!handlers.messageDisplay) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.messageDisplay(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "ConfigChange": {
      if (!handlers.configChange) {
        writeFallback("decision-block", void 0, env);
        return;
      }
      const verdict = await handlers.configChange(env, session);
      writeVerdict("decision-block", verdict, env);
      return;
    }
    case "CwdChanged": {
      if (!handlers.cwdChanged) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.cwdChanged(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "FileChanged": {
      if (!handlers.fileChanged) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.fileChanged(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "WorktreeRemove": {
      if (!handlers.worktreeRemove) {
        writeFallback("none", void 0, env);
        return;
      }
      const verdict = await handlers.worktreeRemove(env, session);
      writeVerdict("none", verdict, env);
      return;
    }
    case "Elicitation": {
      if (!handlers.elicitation) {
        writeFallback("elicitation-response", void 0, env);
        return;
      }
      const verdict = await handlers.elicitation(env, session);
      writeVerdict("elicitation-response", verdict, env);
      return;
    }
    case "ElicitationResult": {
      if (!handlers.elicitationResult) {
        writeFallback("elicitation-response", void 0, env);
        return;
      }
      const verdict = await handlers.elicitationResult(env, session);
      writeVerdict("elicitation-response", verdict, env);
      return;
    }
    default:
      return;
  }
}
async function defaultReadStdin2() {
  const MAX_BYTES2 = 10 * 1024 * 1024;
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buf = chunk;
    total += buf.length;
    if (total > MAX_BYTES2) {
      throw new Error(
        `hook stdin exceeded ${MAX_BYTES2.toLocaleString()} bytes; refusing to buffer further (likely runaway pipe or hostile input)`
      );
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
function brand2(raw) {
  const sanitized = raw.replace(/[\u2014\u2013]/g, " - ").replace(/ {2,}/g, " ").trim();
  if (!sanitized) return "";
  return sanitized.startsWith("[OpenBox]") ? sanitized : "[OpenBox] " + sanitized;
}
function redactedInput2(v) {
  return v?.guardrailsResult?.redactedInput;
}
function objectRecord2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  return value;
}
function addIfDefined2(target, key, value) {
  if (value !== void 0) target[key] = value;
}
function renderVerdictOutput2(shape, v, env, deferApproval = false) {
  const arm = v?.arm ?? "allow";
  const reason = brand2(v?.reason ?? "");
  switch (shape) {
    case "permission-decision": {
      const eventName = env.hook_event_name ?? "PreToolUse";
      if (arm === "allow" || arm === "constrain") {
        const hookSpecificOutput = {
          hookEventName: eventName,
          permissionDecision: "allow"
        };
        if (arm === "constrain") {
          addIfDefined2(hookSpecificOutput, "updatedInput", objectRecord2(redactedInput2(v)));
          if (reason) hookSpecificOutput.additionalContext = reason;
        }
        return {
          hookSpecificOutput
        };
      }
      if (arm === "require_approval") {
        return {
          hookSpecificOutput: {
            hookEventName: eventName,
            permissionDecision: deferApproval ? "defer" : "ask",
            permissionDecisionReason: reason || "[OpenBox] approval required"
          }
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          permissionDecision: "deny",
          permissionDecisionReason: reason || "[OpenBox] blocked by policy"
        }
      };
    }
    case "decision-block": {
      if (arm === "block" || arm === "halt") {
        return {
          decision: "block",
          reason: reason || "[OpenBox] blocked by policy"
        };
      }
      if (arm === "constrain" && reason) {
        const hookSpecificOutput = {
          hookEventName: env.hook_event_name ?? "ClaudeCode",
          additionalContext: reason
        };
        addIfDefined2(hookSpecificOutput, "updatedToolOutput", redactedInput2(v));
        return { hookSpecificOutput };
      }
      return {};
    }
    case "permission-request": {
      const eventName = env.hook_event_name ?? "PermissionRequest";
      if (arm === "allow" || arm === "constrain") {
        const decision = { behavior: "allow" };
        if (arm === "constrain") {
          addIfDefined2(decision, "updatedInput", objectRecord2(redactedInput2(v)));
        }
        return {
          hookSpecificOutput: {
            hookEventName: eventName,
            decision
          }
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          decision: {
            behavior: "deny",
            message: reason || "[OpenBox] blocked by policy"
          }
        }
      };
    }
    case "permission-denied-retry": {
      const eventName = env.hook_event_name ?? "PermissionDenied";
      if (arm === "allow" || arm === "constrain") {
        return {
          hookSpecificOutput: {
            hookEventName: eventName,
            retry: true
          }
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          retry: false
        }
      };
    }
    case "elicitation-response": {
      const eventName = env.hook_event_name ?? "Elicitation";
      if (arm === "allow") return {};
      if (arm === "constrain") {
        return {
          hookSpecificOutput: {
            hookEventName: eventName,
            action: "accept",
            content: redactedInput2(v) ?? env.response ?? env.content ?? {}
          }
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          action: arm === "halt" ? "cancel" : "decline",
          content: {}
        }
      };
    }
    case "continue-block": {
      if (arm === "allow" || arm === "constrain") return {};
      return {
        continue: false,
        stopReason: reason || "[OpenBox] blocked by policy"
      };
    }
    case "additional-context": {
      if (arm === "allow") return {};
      return {
        hookSpecificOutput: {
          hookEventName: env.hook_event_name ?? "PostToolUseFailure",
          additionalContext: reason || "[OpenBox] blocked by policy"
        }
      };
    }
    case "cursor-permission": {
      if (arm === "allow" || arm === "constrain") return { permission: "allow" };
      if (arm === "require_approval") {
        const r = reason.replace(/^\[OpenBox\] /, "").trim();
        return {
          permission: "deny",
          user_message: "[OpenBox] approval pending" + (r ? ": " + r : "") + ". Click Approve in the OpenBox notification, then ask the agent to retry.",
          // Direct LLM instruction. (a) Force the brand into the
          // chat text the LLM will write so the user sees who
          // gated the action; Cursor's chat doesn't insert that
          // for us on most events (only subagentStart has the
          // hardcoded "Subagent creation blocked by hook:" prefix).
          // (b) Hard-stop the LLM's tendency to promise auto-retry,
          // which it can't deliver because Cursor's hook protocol
          // is one-shot.
          agent_message: "[OpenBox] blocked this action. Tell the user verbatim: 'OpenBox is gating this action. Approve it in the OpenBox notification, then ask me to retry.' Then STOP. Do NOT retry on your own. Do NOT speculate, describe, or invent what the blocked command WOULD have produced; you didn't run it, you don't know. Do NOT show 'expected output' or 'if you run it locally'. Just relay the gate message and wait for approval."
        };
      }
      if (arm === "halt") {
        return {
          permission: "deny",
          user_message: "[OpenBox] HALT: " + (reason.replace(/^\[OpenBox\] /, "") || "session halted"),
          agent_message: "[OpenBox] HALT: do not proceed"
        };
      }
      return {
        permission: "deny",
        user_message: reason || "[OpenBox] blocked by policy"
      };
    }
    case "cursor-continue": {
      if (arm === "allow" || arm === "constrain") return { continue: true };
      if (arm === "require_approval") {
        const r = reason.replace(/^\[OpenBox\] /, "").trim();
        return {
          continue: false,
          user_message: "[OpenBox] approval needed" + (r ? ": " + r : "") + ". Approve in the OpenBox notification, then resubmit your prompt (Cursor cannot resume a submitted prompt)."
        };
      }
      if (arm === "halt") {
        return {
          continue: false,
          user_message: "[OpenBox] HALT: " + (reason.replace(/^\[OpenBox\] /, "") || "session halted")
        };
      }
      return {
        continue: false,
        user_message: reason || "[OpenBox] blocked by policy"
      };
    }
    case "cursor-observe":
      return {};
    case "none":
      return void 0;
  }
}
var PRE_TOOL_USE_ROUTING2, POST_TOOL_USE_ROUTING, PERMISSION_REQUEST_ROUTING, HOOK_SPEC2;
var init_claude_code = __esm({
  "ts/src/core-client/generated/runtime/claude-code.ts"() {
    "use strict";
    init_govern();
    PRE_TOOL_USE_ROUTING2 = {
      "Read": "FileRead",
      "Write": "FileEdit",
      "Edit": "FileEdit",
      "Delete": "FileDelete",
      "MultiEdit": "FileEdit",
      "NotebookEdit": "FileEdit",
      "NotebookRead": "FileRead",
      "Glob": "FileRead",
      "Grep": "FileRead",
      "Bash": "ShellExecution",
      "PowerShell": "ShellExecution",
      "WebFetch": "HTTPRequest",
      "WebSearch": "HTTPRequest",
      "Agent": "AgentSpawn",
      "Skill": "AgentAction",
      "TodoWrite": "AgentAction",
      "AskUserQuestion": "AgentAction",
      "EnterPlanMode": "AgentAction",
      "ExitPlanMode": "AgentAction",
      "EnterWorktree": "AgentAction",
      "CronCreate": "AgentAction",
      "CronDelete": "AgentAction",
      "CronList": "AgentAction"
    };
    POST_TOOL_USE_ROUTING = {
      "Read": "FileRead",
      "Write": "FileEdit",
      "Edit": "FileEdit",
      "Delete": "FileDelete",
      "MultiEdit": "FileEdit",
      "NotebookEdit": "FileEdit",
      "NotebookRead": "FileRead",
      "Glob": "FileRead",
      "Grep": "FileRead",
      "Bash": "ShellExecution",
      "PowerShell": "ShellExecution",
      "WebFetch": "HTTPRequest",
      "WebSearch": "HTTPRequest",
      "Agent": "AgentSpawn",
      "Skill": "AgentAction",
      "TodoWrite": "AgentAction",
      "AskUserQuestion": "AgentAction",
      "EnterPlanMode": "AgentAction",
      "ExitPlanMode": "AgentAction",
      "EnterWorktree": "AgentAction",
      "CronCreate": "AgentAction",
      "CronDelete": "AgentAction",
      "CronList": "AgentAction"
    };
    PERMISSION_REQUEST_ROUTING = {
      "Read": "FileRead",
      "Write": "FileEdit",
      "Edit": "FileEdit",
      "Delete": "FileDelete",
      "MultiEdit": "FileEdit",
      "NotebookEdit": "FileEdit",
      "NotebookRead": "FileRead",
      "Glob": "FileRead",
      "Grep": "FileRead",
      "Bash": "ShellExecution",
      "PowerShell": "ShellExecution",
      "WebFetch": "HTTPRequest",
      "WebSearch": "HTTPRequest",
      "Agent": "AgentSpawn",
      "Skill": "AgentAction",
      "TodoWrite": "AgentAction",
      "AskUserQuestion": "AgentAction",
      "EnterPlanMode": "AgentAction",
      "ExitPlanMode": "AgentAction",
      "EnterWorktree": "AgentAction",
      "CronCreate": "AgentAction",
      "CronDelete": "AgentAction",
      "CronList": "AgentAction"
    };
    HOOK_SPEC2 = {
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
  }
});

// ts/src/runtime/claude-code/governance-matrix.ts
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
var CLAUDE_CODE_GOVERNANCE_AUDIT, CLAUDE_CODE_HOOK_MATRIX, CLAUDE_CODE_SURFACE_MATRIX, CLAUDE_CODE_SDK_CAPABILITY_MATRIX;
var init_governance_matrix = __esm({
  "ts/src/runtime/claude-code/governance-matrix.ts"() {
    "use strict";
    CLAUDE_CODE_GOVERNANCE_AUDIT = {
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
    CLAUDE_CODE_HOOK_MATRIX = [
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
    CLAUDE_CODE_SURFACE_MATRIX = [
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
    CLAUDE_CODE_SDK_CAPABILITY_MATRIX = [
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
  }
});

// ts/src/runtime/claude-code/plugin.ts
import {
  chmodSync,
  cpSync as cpSync2,
  existsSync as existsSync6,
  lstatSync as lstatSync2,
  mkdirSync as mkdirSync5,
  readFileSync as readFileSync7,
  readdirSync as readdirSync2,
  rmSync as rmSync2,
  symlinkSync as symlinkSync2,
  writeFileSync as writeFileSync5
} from "fs";
import os2 from "os";
import path3 from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
function claudeCodePluginTargetDir(cwd = process.cwd()) {
  return path3.join(cwd, ".claude", "skills", "openbox");
}
function readJson2(file) {
  try {
    return JSON.parse(readFileSync7(file, "utf-8"));
  } catch {
    return void 0;
  }
}
function packageVersion2() {
  const candidates = [
    path3.resolve(__dirname2, "../../package.json"),
    path3.resolve(__dirname2, "../../../package.json"),
    path3.resolve(__dirname2, "../../../../package.json"),
    path3.resolve(process.cwd(), "package.json")
  ];
  for (const candidate of candidates) {
    const pkg = readJson2(candidate);
    if (typeof pkg?.version === "string" && pkg.version.length > 0) {
      return pkg.version;
    }
  }
  return "0.1.0";
}
function findExistingDir2(label, candidates) {
  for (const candidate of candidates) {
    if (existsSync6(candidate)) return candidate;
  }
  throw new Error(
    `Could not find ${label} in any of:
${candidates.map((c) => `  - ${c}`).join("\n")}`
  );
}
function findTemplateDir2(kind) {
  return findExistingDir2(`Claude Code template directory '${kind}'`, [
    path3.resolve(__dirname2, "templates", kind),
    path3.resolve(__dirname2, "../runtime/claude-code/templates", kind),
    path3.resolve(__dirname2, "../../ts/src/runtime/claude-code/templates", kind),
    path3.resolve(__dirname2, "../../../ts/src/runtime/claude-code/templates", kind),
    path3.resolve(process.cwd(), "ts/src/runtime/claude-code/templates", kind)
  ]);
}
function findSkillDir2() {
  return findExistingDir2("OpenBox skill directory", [
    path3.resolve(__dirname2, "../../skill"),
    path3.resolve(__dirname2, "../../../skill"),
    path3.resolve(__dirname2, "../../../../skill"),
    path3.resolve(process.cwd(), "skill")
  ]);
}
function safeOutDir2(out) {
  const resolved = path3.resolve(out);
  const root = path3.parse(resolved).root;
  if (resolved === root || resolved === os2.homedir()) {
    throw new Error(`Refusing to overwrite unsafe Claude Code plugin path: ${resolved}`);
  }
  return resolved;
}
function assertProjectTarget2(target, cwd) {
  const resolvedTarget = safeOutDir2(target);
  const resolvedProject = path3.resolve(cwd);
  const rel = path3.relative(resolvedProject, resolvedTarget);
  if (rel.startsWith("..") || path3.isAbsolute(rel)) {
    throw new Error(`Claude Code plugin install target must be inside the project: ${resolvedProject}`);
  }
  return resolvedTarget;
}
function writeJson2(file, value) {
  mkdirSync5(path3.dirname(file), { recursive: true });
  writeFileSync5(file, JSON.stringify(value, null, 2) + "\n", "utf-8");
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isLegacyClaudeCodeHook(value) {
  return isRecord(value) && typeof value.command === "string" && /\bopenbox\s+claude-code\s+hook\b/.test(value.command);
}
function scrubLegacyClaudeCodeSettingsHooks(cwd) {
  const settingsFile = path3.join(cwd, ".claude", "settings.json");
  const settings = readJson2(settingsFile);
  if (!settings || !isRecord(settings.hooks)) return;
  let changed = false;
  const nextHooks = {};
  for (const [eventName, entries] of Object.entries(settings.hooks)) {
    if (!Array.isArray(entries)) {
      nextHooks[eventName] = entries;
      continue;
    }
    const nextEntries = entries.map((entry) => {
      if (!isRecord(entry)) return entry;
      if (isLegacyClaudeCodeHook(entry)) {
        changed = true;
        return void 0;
      }
      if (!Array.isArray(entry.hooks)) return entry;
      const nextInnerHooks = entry.hooks.filter((hook) => !isLegacyClaudeCodeHook(hook));
      if (nextInnerHooks.length !== entry.hooks.length) changed = true;
      if (nextInnerHooks.length === 0) return void 0;
      return { ...entry, hooks: nextInnerHooks };
    }).filter((entry) => entry !== void 0);
    if (nextEntries.length === 0) {
      changed = true;
      continue;
    }
    nextHooks[eventName] = nextEntries;
  }
  if (!changed) return;
  const nextSettings = { ...settings };
  if (Object.keys(nextHooks).length > 0) {
    nextSettings.hooks = nextHooks;
  } else {
    delete nextSettings.hooks;
  }
  if (Object.keys(nextSettings).length === 0) {
    rmSync2(settingsFile, { force: true });
    return;
  }
  writeJson2(settingsFile, nextSettings);
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
function scrubLegacyOpenBoxProjectMcp(cwd) {
  const mcpFile = path3.join(cwd, ".mcp.json");
  const mcp = readJson2(mcpFile);
  if (!mcp || !isRecord(mcp.mcpServers)) return;
  if (!isLegacyOpenBoxMcpServer(mcp.mcpServers.openbox)) return;
  const nextServers = { ...mcp.mcpServers };
  delete nextServers.openbox;
  const nextMcp = { ...mcp };
  if (Object.keys(nextServers).length > 0) {
    nextMcp.mcpServers = nextServers;
  } else {
    delete nextMcp.mcpServers;
  }
  if (Object.keys(nextMcp).length === 0) {
    rmSync2(mcpFile, { force: true });
    return;
  }
  writeJson2(mcpFile, nextMcp);
}
function hasLegacyOpenBoxProjectMcp(cwd = process.cwd()) {
  const mcp = readJson2(path3.join(cwd, ".mcp.json"));
  return isLegacyOpenBoxMcpServer(
    isRecord(mcp?.mcpServers) ? mcp.mcpServers.openbox : void 0
  );
}
function writeRuntimeConfigTemplate2(configDir) {
  mkdirSync5(configDir, { recursive: true });
  const file = path3.join(configDir, "config.json");
  if (existsSync6(file)) return;
  const example = {
    OPENBOX_API_KEY: "obx_live_YOUR_API_KEY_HERE",
    OPENBOX_CORE_URL: "https://core.example/ob",
    GOVERNANCE_POLICY: "fail_open",
    HITL_ENABLED: true,
    HITL_MAX_WAIT: 300,
    VERBOSE: false,
    DRY_RUN: true
  };
  writeFileSync5(file, JSON.stringify(example, null, 2) + "\n", {
    mode: 384,
    encoding: "utf-8"
  });
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
function claudeHooksJson(matchers, includeOptInHooks = false) {
  const hooks = {};
  for (const event of hookEvents(includeOptInHooks)) {
    const hook = {
      ...PLUGIN_HOOK_HANDLER
    };
    if (event.timeout !== void 0) hook.timeout = event.timeout;
    const entry = {
      hooks: [hook]
    };
    const matcher = matchers?.[event.name];
    if (matcher) entry.matcher = matcher;
    hooks[event.name] = [entry];
  }
  return { [HOOK_SPEC2.key]: hooks };
}
function mcpJson2() {
  return {
    mcpServers: {
      openbox: { ...PLUGIN_MCP_SERVER }
    }
  };
}
function componentInventory(version) {
  const defaultEvents = hookEvents(false).map((event) => event.name);
  return {
    name: "openbox",
    version,
    capturedAt: CLAUDE_CODE_GOVERNANCE_AUDIT.capturedAt,
    installedClaudeCodeVersion: CLAUDE_CODE_GOVERNANCE_AUDIT.installedClaudeCodeVersion,
    components: {
      skill: {
        status: "installed",
        path: "skills/openbox/SKILL.md"
      },
      commands: {
        status: "installed",
        path: "commands/",
        files: [...EXPECTED_COMMAND_FILES2]
      },
      agent: {
        status: "installed",
        path: "agents/openbox-reviewer.md"
      },
      hooks: {
        status: "installed",
        path: "hooks/hooks.json",
        defaultEvents,
        optInEvents: optInClaudeCodeHookEvents()
      },
      mcp: {
        status: "installed",
        path: ".mcp.json",
        command: "node ${CLAUDE_PLUGIN_ROOT}/bin/openbox-cli.mjs mcp serve"
      },
      settings: {
        status: "diagnose_only",
        path: "settings.json",
        emitted: false,
        notes: "OpenBox does not emit plugin settings; agent/subagentStatusLine and strictPluginOnlyCustomization remain deployment policy diagnostics."
      },
      diagnostics: {
        status: "installed",
        path: "diagnostics/",
        files: [...EXPECTED_DIAGNOSTIC_FILES]
      },
      bin: {
        status: "installed",
        path: "bin/openbox-plugin-doctor",
        files: [...EXPECTED_BIN_FILES],
        command: "node ${CLAUDE_PLUGIN_ROOT}/bin/openbox-cli.mjs claude-code doctor"
      },
      monitors: {
        status: "opt_in_metadata",
        activeByDefault: false,
        path: "diagnostics/monitors.opt-in.json",
        notes: "Copy to monitors/monitors.json only after accepting unsandboxed monitor execution."
      },
      lsp: {
        status: "not_included",
        notes: "No OpenBox language-server use case was found in the Claude Code governance audit."
      }
    },
    surfaces: CLAUDE_CODE_SURFACE_MATRIX
  };
}
function governanceDiagnostic(version) {
  return {
    version,
    audit: CLAUDE_CODE_GOVERNANCE_AUDIT,
    hooks: CLAUDE_CODE_HOOK_MATRIX,
    defaultHookEvents: defaultClaudeCodeHookEvents(),
    optInHookEvents: optInClaudeCodeHookEvents(),
    generatedHookSpecEvents: HOOK_SPEC2.events.map((event) => event.name),
    surfaces: CLAUDE_CODE_SURFACE_MATRIX,
    sdkCapabilities: CLAUDE_CODE_SDK_CAPABILITY_MATRIX
  };
}
function optInMonitorMetadata() {
  return [
    {
      name: "openbox-status",
      command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/openbox-cli.mjs" status --json',
      description: "OpenBox runtime status and approval readiness notifications.",
      when: "on-skill-invoke:openbox",
      activeByDefault: false
    }
  ];
}
function writePluginCliRunner(file) {
  mkdirSync5(path3.dirname(file), { recursive: true });
  writeFileSync5(
    file,
    [
      "#!/usr/bin/env node",
      "import { existsSync } from 'node:fs';",
      "import path from 'node:path';",
      "import { spawnSync } from 'node:child_process';",
      "",
      "const args = process.argv.slice(2);",
      "",
      "function candidateFromEnv() {",
      "  const value = process.env.OPENBOX_CLI;",
      "  if (!value) return undefined;",
      "  const resolved = path.resolve(value);",
      "  return existsSync(resolved) ? resolved : undefined;",
      "}",
      "",
      "function projectRoots() {",
      "  const roots = [];",
      "  if (process.env.CLAUDE_PROJECT_DIR) roots.push(process.env.CLAUDE_PROJECT_DIR);",
      "  roots.push(process.cwd());",
      "  const out = [];",
      "  for (const root of roots) {",
      "    let cur = path.resolve(root);",
      "    for (let i = 0; i < 8; i += 1) {",
      "      if (!out.includes(cur)) out.push(cur);",
      "      const parent = path.dirname(cur);",
      "      if (parent === cur) break;",
      "      cur = parent;",
      "    }",
      "  }",
      "  return out;",
      "}",
      "",
      "function candidateFromProjectNodeModules() {",
      "  for (const root of projectRoots()) {",
      "    const candidate = path.join(root, 'node_modules', '@openbox-ai', 'openbox-sdk', 'dist', 'cli', 'index.js');",
      "    if (existsSync(candidate)) return candidate;",
      "  }",
      "  return undefined;",
      "}",
      "",
      "const cli = candidateFromEnv() ?? candidateFromProjectNodeModules();",
      "if (!cli) {",
      "  console.error('OpenBox SDK CLI not found for project-scoped Claude Code plugin. Set OPENBOX_CLI to this project\\'s SDK dist/cli/index.js, or install @openbox-ai/openbox-sdk in the project.');",
      "  process.exit(127);",
      "}",
      "",
      "const result = spawnSync(process.execPath, [cli, ...args], {",
      "  stdio: 'inherit',",
      "  env: process.env,",
      "});",
      "",
      "if (result.error) {",
      "  console.error(result.error.message);",
      "  process.exit(127);",
      "}",
      "process.exit(result.status ?? 1);",
      ""
    ].join("\n"),
    "utf-8"
  );
  chmodSync(file, 493);
}
function writePluginDoctorShim(file) {
  mkdirSync5(path3.dirname(file), { recursive: true });
  writeFileSync5(
    file,
    [
      "#!/usr/bin/env sh",
      "set -eu",
      'DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
      'exec node "$DIR/openbox-cli.mjs" claude-code doctor "$@"',
      ""
    ].join("\n"),
    "utf-8"
  );
  chmodSync(file, 493);
}
function pluginManifest2(version) {
  return {
    name: "openbox",
    displayName: "OpenBox AI Governance",
    version,
    description: "Active governance for Claude Code: prompt gates, tool gates, policy checks, guardrails, approvals, MCP tools, skills, and agent templates.",
    author: {
      name: "OpenBox AI",
      email: "team@openbox.ai"
    },
    license: "MIT",
    homepage: "https://github.com/OpenBox-AI/openbox-sdk#readme",
    repository: "https://github.com/OpenBox-AI/openbox-sdk",
    keywords: [
      "openbox",
      "ai-governance",
      "claude-code",
      "guardrails",
      "policy",
      "opa",
      "approvals",
      "hitl",
      "agent-trace",
      "behavior-rules",
      "skill",
      "mcp",
      "hooks",
      "agents",
      "commands"
    ]
  };
}
function marketplaceManifest2(version) {
  return {
    name: "openbox",
    description: "OpenBox governance plugin marketplace for Claude Code.",
    owner: {
      name: "OpenBox AI",
      email: "team@openbox.ai"
    },
    plugins: [
      {
        name: "openbox",
        source: "./",
        description: "Active governance for Claude Code through prompt/tool hooks, OpenBox Core verdicts, approvals, MCP tools, skills, and agent templates.",
        version,
        author: {
          name: "OpenBox AI",
          email: "team@openbox.ai"
        },
        homepage: "https://github.com/OpenBox-AI/openbox-sdk#readme",
        repository: "https://github.com/OpenBox-AI/openbox-sdk",
        license: "MIT",
        keywords: ["openbox", "claude-code", "ai-governance", "guardrails", "approvals"]
      }
    ]
  };
}
function copyDir2(src, dst) {
  rmSync2(dst, { recursive: true, force: true });
  mkdirSync5(path3.dirname(dst), { recursive: true });
  cpSync2(src, dst, { recursive: true });
}
function exportClaudeCodePlugin(options) {
  const out = safeOutDir2(options.out);
  if (existsSync6(out)) {
    if (options.force === false) {
      throw new Error(`Claude Code plugin output already exists: ${out}`);
    }
    rmSync2(out, { recursive: true, force: true });
  }
  mkdirSync5(out, { recursive: true });
  const version = packageVersion2();
  writeJson2(path3.join(out, ".claude-plugin", "plugin.json"), pluginManifest2(version));
  writeJson2(path3.join(out, ".claude-plugin", "marketplace.json"), marketplaceManifest2(version));
  copyDir2(findSkillDir2(), path3.join(out, "skills", "openbox"));
  copyDir2(findTemplateDir2("commands"), path3.join(out, "commands"));
  copyDir2(findTemplateDir2("agents"), path3.join(out, "agents"));
  writeJson2(path3.join(out, "hooks", "hooks.json"), claudeHooksJson(options.matchers, options.includeOptInHooks));
  writeJson2(path3.join(out, ".mcp.json"), mcpJson2());
  writeJson2(path3.join(out, "diagnostics", "component-inventory.json"), componentInventory(version));
  writeJson2(path3.join(out, "diagnostics", "claude-code-governance.json"), governanceDiagnostic(version));
  writeJson2(path3.join(out, "diagnostics", "monitors.opt-in.json"), optInMonitorMetadata());
  writePluginCliRunner(path3.join(out, PLUGIN_CLI_RUNNER));
  writePluginDoctorShim(path3.join(out, "bin", "openbox-plugin-doctor"));
  return out;
}
function installClaudeCodePlugin(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const target = assertProjectTarget2(options.target ?? claudeCodePluginTargetDir(cwd), cwd);
  if (options.symlink) {
    const source = safeOutDir2(options.symlink);
    if (!existsSync6(source)) {
      throw new Error(`Claude Code plugin symlink source does not exist: ${source}`);
    }
    rmSync2(target, { recursive: true, force: true });
    mkdirSync5(path3.dirname(target), { recursive: true });
    symlinkSync2(source, target, "dir");
    if (!options.skipRuntimeConfig) {
      writeRuntimeConfigTemplate2(claudeCodeRuntimeConfigDir(cwd));
    }
    scrubLegacyClaudeCodeSettingsHooks(cwd);
    scrubLegacyOpenBoxProjectMcp(cwd);
    return target;
  }
  const out = exportClaudeCodePlugin({
    out: target,
    matchers: options.matchers,
    includeOptInHooks: options.includeOptInHooks
  });
  if (!options.skipRuntimeConfig) {
    writeRuntimeConfigTemplate2(claudeCodeRuntimeConfigDir(cwd));
  }
  scrubLegacyClaudeCodeSettingsHooks(cwd);
  scrubLegacyOpenBoxProjectMcp(cwd);
  return out;
}
function uninstallClaudeCodePlugin(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const target = assertProjectTarget2(options.target ?? claudeCodePluginTargetDir(cwd), cwd);
  rmSync2(target, { recursive: true, force: true });
  scrubLegacyClaudeCodeSettingsHooks(cwd);
  scrubLegacyOpenBoxProjectMcp(cwd);
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
var __dirname2, EXPECTED_COMMAND_FILES2, EXPECTED_AGENT_FILES2, EXPECTED_DIAGNOSTIC_FILES, EXPECTED_BIN_FILES, EXPECTED_COMPONENT_NAMES, PLUGIN_CLI_RUNNER, PLUGIN_HOOK_HANDLER, PLUGIN_MCP_SERVER;
var init_plugin2 = __esm({
  "ts/src/runtime/claude-code/plugin.ts"() {
    "use strict";
    init_claude_code();
    init_governance_matrix();
    __dirname2 = path3.dirname(fileURLToPath2(import.meta.url));
    EXPECTED_COMMAND_FILES2 = [
      "openbox-check.md",
      "openbox-doctor.md",
      "openbox-list-agents.md",
      "openbox-pending.md",
      "openbox-status.md"
    ];
    EXPECTED_AGENT_FILES2 = ["openbox-reviewer.md"];
    EXPECTED_DIAGNOSTIC_FILES = [
      "component-inventory.json",
      "claude-code-governance.json",
      "monitors.opt-in.json"
    ];
    EXPECTED_BIN_FILES = ["openbox-cli.mjs", "openbox-plugin-doctor"];
    EXPECTED_COMPONENT_NAMES = [
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
    PLUGIN_CLI_RUNNER = "bin/openbox-cli.mjs";
    PLUGIN_HOOK_HANDLER = {
      type: "command",
      command: "node",
      args: [`\${CLAUDE_PLUGIN_ROOT}/${PLUGIN_CLI_RUNNER}`, "claude-code", "hook"]
    };
    PLUGIN_MCP_SERVER = {
      command: "node",
      args: [`\${CLAUDE_PLUGIN_ROOT}/${PLUGIN_CLI_RUNNER}`, "mcp", "serve"]
    };
  }
});

// ts/src/runtime/claude-code/doctor.ts
import { existsSync as existsSync7 } from "fs";
import path4 from "path";
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
  return value === "fail_closed" ? "fail_closed" : "fail_open";
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
var init_doctor = __esm({
  "ts/src/runtime/claude-code/doctor.ts"() {
    "use strict";
    init_host_config();
    init_core_client2();
    init_env();
    init_plugin2();
  }
});

// ts/src/runtime/mcp/governance-span.ts
function hex(len) {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
function buildMcpGovernanceSpan(spanType, input) {
  const base2 = {
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
        ...base2,
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
        ...base2,
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
        ...base2,
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
        ...base2,
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
        ...base2,
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
      const dbOp = (input.operation || "SELECT").toUpperCase();
      return {
        ...base2,
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
        db_statement: input.statement || ""
      };
    }
    case "mcp":
      return {
        ...base2,
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
        ...base2,
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
var MCP_ACTIVITY_TYPE_MAP;
var init_governance_span = __esm({
  "ts/src/runtime/mcp/governance-span.ts"() {
    "use strict";
    MCP_ACTIVITY_TYPE_MAP = {
      llm: "PromptSubmission",
      file_read: "FileRead",
      file_write: "FileEdit",
      shell: "ShellExecution",
      http: "HTTPRequest",
      db: "DatabaseQuery",
      mcp: "MCPToolCall"
    };
  }
});

// ts/src/runtime/mcp/index.ts
var mcp_exports = {};
__export(mcp_exports, {
  runMcpServer: () => runMcpServer
});
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs2 from "fs";
import * as path5 from "path";
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
      governancePolicy: process.env.GOVERNANCE_POLICY ?? config.GOVERNANCE_POLICY ?? "fail_open",
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
    const base2 = {
      cwd,
      pluginTarget: plugin_target
    };
    const checks = surface_only ? verifyCursorInstall(base2) : await verifyCursorInstall({
      ...base2,
      includeRuntime: true,
      validateRuntime: validate_core !== false
    });
    const summary2 = checks.reduce(
      (acc, check) => {
        acc[check.status] += 1;
        return acc;
      },
      { pass: 0, skip: 0, fail: 0 }
    );
    return { content: [{ type: "text", text: JSON.stringify({ checks, summary: summary2 }, null, 2) }] };
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
    const summary2 = summarizeClaudeCodeChecks(checks);
    return { content: [{ type: "text", text: JSON.stringify({
      checks,
      summary: summary2,
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
    { name: "backend-api", path: "references/backend-api.md", desc: "Backend conventions: {status,data} envelope, X-Openbox-Client header, /auth/refresh caveats, swagger availability" },
    { name: "rego-reference", path: "references/rego-reference.md", desc: "Rego policy syntax, input fields, example policies, policy lifecycle gotchas" },
    { name: "span-reference", path: "references/span-reference.md", desc: "Span types, gate attributes, semantic type detection" },
    { name: "commands", path: "references/commands.md", desc: "Full CLI command reference" },
    { name: "claude-code-governance", path: "references/claude-code-governance.md", desc: "Claude Code hook/plugin/MCP governance surface audit and coverage matrix" },
    { name: "existing-sdks", path: "references/existing-sdks.md", desc: "Available SDKs and installation" }
  ];
  function findSkillDir3() {
    const candidates = [
      path5.join(process.cwd(), ".claude", "skills", "openbox", "skills", "openbox"),
      path5.join(process.cwd(), ".cursor", "plugins", "local", "openbox", "skills", "openbox")
    ];
    return candidates.find((p) => fs2.existsSync(p)) || null;
  }
  for (const ref of SKILL_PATHS) {
    server.resource(ref.name, `openbox://skill/${ref.name}`, { description: ref.desc }, async () => {
      const skillDir = findSkillDir3();
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
var init_mcp = __esm({
  "ts/src/runtime/mcp/index.ts"() {
    "use strict";
    init_client2();
    init_core_client2();
    init_file_tokens();
    init_config();
    init_config2();
    init_env();
    init_agent_keys();
    init_source();
    init_install();
    init_doctor();
    init_governance_span();
    init_governance_matrix();
  }
});

// ts/src/runtime/claude-code/config.ts
import fs3 from "fs";
import path6 from "path";
function resolveConfigDir(startDir = process.cwd()) {
  let cur = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path6.join(cur, ".claude-hooks");
    if (fs3.existsSync(path6.join(candidate, "config.json"))) {
      return candidate;
    }
    const parent = path6.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path6.join(startDir, ".claude-hooks");
}
function loadConfig() {
  const fileConfig = loadConfigFile();
  const envConfig = loadEnvFile();
  const get = (key, fileFallback) => {
    if (process.env[key] !== void 0) return process.env[key];
    if (fileConfig[key] !== void 0) return fileConfig[key];
    if (envConfig[key] !== void 0) return envConfig[key];
    return fileFallback ?? "";
  };
  const skipToolsRaw = get("SKIP_TOOLS", "Glob,Grep");
  const skipTools = skipToolsRaw ? skipToolsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const skipActivityRaw = get("SKIP_ACTIVITY_TYPES");
  const skipActivityTypes = skipActivityRaw ? skipActivityRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const coreUrl = process.env.OPENBOX_CORE_URL ?? fileConfig.OPENBOX_CORE_URL ?? envConfig.OPENBOX_CORE_URL ?? "";
  return {
    openboxApiKey: get("OPENBOX_API_KEY"),
    openboxEndpoint: coreUrl,
    agentIdentity: resolveAgentIdentity({
      OPENBOX_AGENT_DID: get("OPENBOX_AGENT_DID") || void 0,
      OPENBOX_AGENT_PRIVATE_KEY: get("OPENBOX_AGENT_PRIVATE_KEY") || void 0
    }),
    governancePolicy: get("GOVERNANCE_POLICY", "fail_open"),
    governanceTimeout: parseInt(get("GOVERNANCE_TIMEOUT", "15"), 10) || 15,
    sessionDir: get("SESSION_DIR", path6.join(CONFIG_DIR, "sessions")),
    logFile: get("LOG_FILE", path6.join(CONFIG_DIR, "hook.log")) || null,
    verbose: get("VERBOSE") === "true" || get("VERBOSE") === "1",
    dryRun: get("DRY_RUN") === "true" || get("DRY_RUN") === "1",
    hitlEnabled: get("HITL_ENABLED", "true") !== "false",
    hitlPollInterval: parseInt(get("HITL_POLL_INTERVAL", "5"), 10) || 5,
    hitlMaxWait: parseInt(get("HITL_MAX_WAIT", "300"), 10) || 300,
    approvalMode: parseApprovalMode2(get("APPROVAL_MODE", "remote")),
    taskQueue: get("TASK_QUEUE", "claude-code"),
    sendStartEvent: get("SEND_START_EVENT", "true") !== "false",
    sendActivityStartEvent: get("SEND_ACTIVITY_START_EVENT", "true") !== "false",
    maxBodySize: get("MAX_BODY_SIZE") ? parseInt(get("MAX_BODY_SIZE"), 10) || null : null,
    skipTools,
    skipActivityTypes
  };
}
function getConfigDir() {
  return CONFIG_DIR;
}
function parseApprovalMode2(value) {
  const mode = value.toLowerCase();
  if (mode === "inline" || mode === "defer") return mode;
  return "remote";
}
var CONFIG_DIR, CONFIG_FILE, ENV_FILE, loadConfigFile, loadEnvFile;
var init_config3 = __esm({
  "ts/src/runtime/claude-code/config.ts"() {
    "use strict";
    init_host_config();
    init_agent_identity();
    CONFIG_DIR = resolveConfigDir();
    CONFIG_FILE = path6.join(CONFIG_DIR, "config.json");
    ENV_FILE = path6.join(CONFIG_DIR, ".env");
    loadConfigFile = () => loadJsonConfig(CONFIG_FILE);
    loadEnvFile = () => loadDotenv(ENV_FILE);
  }
});

// ts/src/logging/logger.ts
import fs4 from "fs";
import path7 from "path";
function createLogger(adapterName) {
  let logPath = null;
  function summarize(data) {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "string" && v.length > 200) {
        out[k] = v.slice(0, 200) + `... (${v.length} chars)`;
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return {
    initLogger(cfg) {
      logPath = cfg.logFile;
      if (logPath) fs4.mkdirSync(path7.dirname(logPath), { recursive: true });
    },
    log(hookEvent, data, response) {
      const entry = {
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        hook: hookEvent,
        input: summarize(data),
        response: response ?? null
      };
      const line = JSON.stringify(entry);
      if (logPath) {
        try {
          fs4.appendFileSync(logPath, line + "\n");
        } catch {
        }
      }
      console.error(`[openbox ${adapterName}] ${hookEvent} | ${JSON.stringify(entry.input)}`);
      if (response) {
        console.error(`[openbox ${adapterName}] -> ${JSON.stringify(response)}`);
      }
    }
  };
}
var init_logger = __esm({
  "ts/src/logging/logger.ts"() {
    "use strict";
  }
});

// ts/src/session/store.ts
import fs5 from "fs";
import path8 from "path";
var SessionStore;
var init_store2 = __esm({
  "ts/src/session/store.ts"() {
    "use strict";
    SessionStore = class {
      dir;
      constructor(sessionDir) {
        this.dir = sessionDir;
        fs5.mkdirSync(this.dir, { recursive: true });
      }
      filePath(key) {
        const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_");
        return path8.join(this.dir, `${safe}.json`);
      }
      save(key, session) {
        fs5.writeFileSync(this.filePath(key), JSON.stringify(session), { mode: 384, encoding: "utf-8" });
      }
      load(key) {
        const fp = this.filePath(key);
        if (!fs5.existsSync(fp)) return null;
        try {
          return JSON.parse(fs5.readFileSync(fp, "utf-8"));
        } catch {
          return null;
        }
      }
      delete(key) {
        const fp = this.filePath(key);
        try {
          fs5.unlinkSync(fp);
        } catch {
        }
      }
      cleanup(maxAgeMs = 864e5) {
        try {
          const now = Date.now();
          for (const f of fs5.readdirSync(this.dir)) {
            const fp = path8.join(this.dir, f);
            const stat = fs5.statSync(fp);
            if (now - stat.mtimeMs > maxAgeMs) {
              fs5.unlinkSync(fp);
            }
          }
        } catch {
        }
      }
    };
  }
});

// ts/src/session/resolver.ts
import { randomUUID as randomUUID3 } from "crypto";
function getStore(cfg) {
  let s = stores.get(cfg);
  if (!s) {
    s = new SessionStore(cfg.sessionDir);
    stores.set(cfg, s);
  }
  return s;
}
function resolveSessionByKey(key, cfg) {
  const store = getStore(cfg);
  const existing = store.load(key);
  if (existing && !existing.halted) {
    return { workflowId: existing.workflowId, runId: existing.runId };
  }
  const workflowId = randomUUID3();
  const runId = randomUUID3();
  store.save(key, { workflowId, runId });
  return { workflowId, runId };
}
function peekSessionByKey(key, cfg) {
  const existing = getStore(cfg).load(key);
  if (!existing) return null;
  return {
    workflowId: existing.workflowId,
    runId: existing.runId,
    halted: existing.halted ?? false
  };
}
function markHaltedByKey(key, cfg) {
  const store = getStore(cfg);
  const existing = store.load(key);
  if (existing) store.save(key, { ...existing, halted: true });
}
function clearSessionByKey(key, cfg) {
  getStore(cfg).delete(key);
}
var stores;
var init_resolver = __esm({
  "ts/src/session/resolver.ts"() {
    "use strict";
    init_store2();
    stores = /* @__PURE__ */ new WeakMap();
  }
});

// ts/src/runtime/claude-code/session-resolver.ts
async function resolveSession(env, cfg) {
  const prior = peekSessionByKey(env.session_id, cfg);
  resolveCreatedFreshSession = !prior || prior.halted;
  return resolveSessionByKey(env.session_id, cfg);
}
function lastResolveCreatedFreshSession() {
  return resolveCreatedFreshSession;
}
function markHalted(sessionId, cfg) {
  markHaltedByKey(sessionId, cfg);
}
function clearSession(sessionId, cfg) {
  clearSessionByKey(sessionId, cfg);
}
var resolveCreatedFreshSession;
var init_session_resolver = __esm({
  "ts/src/runtime/claude-code/session-resolver.ts"() {
    "use strict";
    init_resolver();
    resolveCreatedFreshSession = false;
  }
});

// ts/src/logging/hook-log.ts
import * as fs6 from "fs";
import * as path9 from "path";
function logDir() {
  return path9.join(openboxDataRoot(), "log");
}
function ensureDir(dir) {
  if (!fs6.existsSync(dir)) fs6.mkdirSync(dir, { recursive: true, mode: 448 });
}
function rotateIfNeeded(file) {
  try {
    const st = fs6.statSync(file);
    if (st.size < MAX_BYTES) return;
  } catch {
    return;
  }
  try {
    fs6.renameSync(file, `${file}.1`);
  } catch {
  }
}
function makeHookLog(host) {
  const initialDir = logDir();
  const initialFile = path9.join(initialDir, `${host}-hook.jsonl`);
  return {
    path: initialFile,
    record(line) {
      try {
        const dir = logDir();
        const file = path9.join(dir, `${host}-hook.jsonl`);
        ensureDir(dir);
        rotateIfNeeded(file);
        fs6.appendFileSync(file, JSON.stringify(line) + "\n", { mode: 384 });
      } catch {
      }
    }
  };
}
var MAX_BYTES;
var init_hook_log = __esm({
  "ts/src/logging/hook-log.ts"() {
    "use strict";
    init_os_paths();
    MAX_BYTES = 5 * 1024 * 1024;
  }
});

// ts/src/governance/events.ts
var EVENT;
var init_events = __esm({
  "ts/src/governance/events.ts"() {
    "use strict";
    EVENT = {
      START: "ActivityStarted",
      COMPLETE: "ActivityCompleted",
      SIGNAL: "SignalReceived"
    };
  }
});

// ts/src/runtime/claude-code/activity-types.ts
var ACTIVITY_TYPES;
var init_activity_types = __esm({
  "ts/src/runtime/claude-code/activity-types.ts"() {
    "use strict";
    init_events();
    ACTIVITY_TYPES = {
      PROMPT: "PromptSubmission",
      FILE_READ: "FileRead",
      FILE_EDIT: "FileEdit",
      FILE_DELETE: "FileDelete",
      SHELL: "ShellExecution",
      HTTP_REQUEST: "HTTPRequest",
      MCP_CALL: "MCPToolCall",
      AGENT_SPAWN: "AgentSpawn",
      AGENT_ACTION: "AgentAction",
      SESSION: "ClaudeCodeSession",
      CONFIG_CHANGE: "ClaudeCodeConfigChange",
      WORKSPACE_CHANGE: "ClaudeCodeWorkspaceChange",
      MCP_ELICITATION: "MCPElicitation",
      TASK: "ClaudeCodeTask",
      MESSAGE: "ClaudeCodeMessage"
    };
  }
});

// ts/src/governance/skip-patterns.ts
import path10 from "path";
function isSkipped(filePath) {
  return SKIP_PATTERNS.some((p) => p.test(filePath));
}
function isSensitivePath(filePath) {
  return SENSITIVE_PATH_PATTERNS.some((p) => p.test(filePath));
}
function isInsideAnyRoot(filePath, roots, cwd) {
  if (!filePath || !roots || roots.length === 0) return false;
  const norm = (p) => p.replace(/\/+$/, "");
  const f = norm(path10.resolve(cwd ?? roots[0] ?? process.cwd(), filePath));
  return roots.some((r) => {
    const root = norm(path10.resolve(r));
    return f === root || f.startsWith(root + "/");
  });
}
var SKIP_PATTERNS, SENSITIVE_PATH_PATTERNS;
var init_skip_patterns = __esm({
  "ts/src/governance/skip-patterns.ts"() {
    "use strict";
    SKIP_PATTERNS = [
      /\.cursor\//,
      /\.claude\//,
      /\/mcps\//,
      /\/node_modules\//,
      /\.git\//,
      /INSTRUCTIONS\.md$/,
      /SERVER_METADATA\.json$/,
      /SKILL\.md$/
    ];
    SENSITIVE_PATH_PATTERNS = [
      /(^|\/)\.env($|[./-])/,
      /(^|\/)\.env\.[^/]+$/,
      /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.pub)?$/,
      /(^|\/)(credentials|secrets?|token|tokens)\.(json|ya?ml|toml|ini|env|txt)$/,
      /(^|\/)(credentials|config)$/,
      /\.(pem|key|p12|pfx|crt)$/i,
      /(^|\/)\.aws\/credentials$/,
      /(^|\/)\.openbox\/tokens$/
    ];
  }
});

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
    span_type: "function",
    stage: "started",
    start_time: Date.now() * 1e6,
    end_time: null,
    duration_ns: null,
    status: { code: "OK", description: null },
    events: [],
    error: null
  };
}
function objectRecord3(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function parseJsonRecord(value) {
  if (typeof value === "string") {
    try {
      return objectRecord3(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return objectRecord3(value);
}
function stringifyBody(value) {
  if (value === void 0) return void 0;
  return typeof value === "string" ? value : JSON.stringify(value);
}
function toPositiveInteger(value) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : void 0;
  if (numberValue === void 0 || !Number.isFinite(numberValue) || numberValue <= 0)
    return void 0;
  return Math.trunc(numberValue);
}
function normalizeUsage(usage) {
  if (!usage) return void 0;
  const promptTokens = toPositiveInteger(
    usage.promptTokens ?? usage.inputTokens
  );
  const completionTokens = toPositiveInteger(
    usage.completionTokens ?? usage.outputTokens
  );
  const totalTokens = toPositiveInteger(usage.totalTokens);
  const normalized = {};
  if (promptTokens !== void 0) {
    normalized.prompt_tokens = promptTokens;
    normalized.input_tokens = promptTokens;
  }
  if (completionTokens !== void 0) {
    normalized.completion_tokens = completionTokens;
    normalized.output_tokens = completionTokens;
  }
  if (totalTokens !== void 0) normalized.total_tokens = totalTokens;
  return Object.keys(normalized).length > 0 ? normalized : void 0;
}
function buildLLMCompletionResponseBody(content, metadata = {}) {
  const body = parseJsonRecord(metadata.responseBody);
  if (!Array.isArray(body.choices)) {
    body.choices = [
      {
        message: { content }
      }
    ];
  }
  if (metadata.model && typeof body.model !== "string") {
    body.model = metadata.model;
  }
  const usage = normalizeUsage(metadata.usage);
  if (usage && Object.keys(objectRecord3(body.usage)).length === 0) {
    body.usage = usage;
  }
  return JSON.stringify(body);
}
function buildLLMCompletionSpan(input) {
  const now = Date.now();
  const source = input.span ?? {};
  const usage = normalizeUsage(input.usage);
  const inputTokens = toPositiveInteger(
    usage?.input_tokens ?? usage?.prompt_tokens
  );
  const outputTokens = toPositiveInteger(
    usage?.output_tokens ?? usage?.completion_tokens
  );
  const httpUrl = input.providerUrl ?? source.http_url ?? (typeof source.attributes?.["http.url"] === "string" ? source.attributes["http.url"] : "https://api.openai.com/v1/chat/completions");
  return {
    ...source,
    span_id: source.span_id ?? hex2(16),
    trace_id: source.trace_id ?? hex2(32),
    name: input.name ?? source.name ?? "llm.chat.completion",
    kind: input.kind ?? source.kind ?? "CLIENT",
    start_time: input.startTime ?? source.start_time ?? now,
    end_time: input.endTime ?? source.end_time ?? now,
    duration_ns: input.durationNs ?? source.duration_ns ?? 0,
    span_type: "function",
    stage: "completed",
    semantic_type: "llm_completion",
    attributes: {
      "gen_ai.system": input.system ?? "openbox-sdk",
      ...input.model ? { "gen_ai.request.model": input.model } : {},
      ...input.model ? { "gen_ai.response.model": input.model } : {},
      ...inputTokens !== void 0 ? { "gen_ai.usage.input_tokens": inputTokens } : {},
      ...outputTokens !== void 0 ? { "gen_ai.usage.output_tokens": outputTokens } : {},
      "http.method": "POST",
      "http.url": httpUrl,
      "openbox.semantic_type": "llm_completion",
      "openbox.span_type": "function",
      ...source.attributes ?? {},
      ...input.attributes ?? {}
    },
    ...input.model ? { model: input.model } : {},
    ...inputTokens !== void 0 ? { input_tokens: inputTokens } : {},
    ...outputTokens !== void 0 ? { output_tokens: outputTokens } : {},
    http_method: source.http_method ?? "POST",
    http_url: httpUrl,
    request_body: stringifyBody(input.requestBody) ?? source.request_body ?? void 0,
    data: input.data ?? source.data,
    response_body: buildLLMCompletionResponseBody(input.content, {
      model: input.model,
      usage: input.usage,
      responseBody: input.responseBody ?? source.response_body
    })
  };
}
function buildSpan(host, type, input) {
  const b = base();
  switch (type) {
    case "llm":
      const usage = normalizeUsage(input.usage);
      const inputTokens = toPositiveInteger(
        usage?.input_tokens ?? usage?.prompt_tokens
      );
      const outputTokens = toPositiveInteger(
        usage?.output_tokens ?? usage?.completion_tokens
      );
      return {
        ...b,
        name: "llm.chat.completion",
        span_type: "function",
        hook_type: "function_call",
        semantic_type: "llm_completion",
        attributes: {
          "gen_ai.system": host,
          ...input.model ? { "gen_ai.request.model": input.model } : {},
          ...input.model ? { "gen_ai.response.model": input.model } : {},
          ...inputTokens !== void 0 ? { "gen_ai.usage.input_tokens": inputTokens } : {},
          ...outputTokens !== void 0 ? { "gen_ai.usage.output_tokens": outputTokens } : {},
          "http.method": "POST",
          "http.url": "https://api.openai.com/v1/chat/completions",
          "openbox.semantic_type": "llm_completion",
          "openbox.span_type": "function"
        },
        ...input.model ? { model: input.model } : {},
        ...inputTokens !== void 0 ? { input_tokens: inputTokens } : {},
        ...outputTokens !== void 0 ? { output_tokens: outputTokens } : {},
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
        span_type: "file_io",
        hook_type: "file_operation",
        semantic_type: "file_read",
        attributes: {
          "file.path": input.file_path ?? "",
          "file.operation": "read",
          "openbox.semantic_type": "file_read",
          "openbox.span_type": "file_io"
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
        span_type: "file_io",
        hook_type: "file_operation",
        semantic_type: "file_write",
        attributes: {
          "file.path": input.file_path ?? "",
          "file.operation": "write",
          "openbox.semantic_type": "file_write",
          "openbox.span_type": "file_io"
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
        span_type: "file_io",
        hook_type: "file_operation",
        semantic_type: "file_delete",
        attributes: {
          "file.path": input.file_path ?? "",
          "file.operation": "delete",
          "openbox.semantic_type": "file_delete",
          "openbox.span_type": "file_io"
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
        span_type: "function",
        hook_type: "function_call",
        semantic_type: "internal",
        attributes: {
          "shell.command": input.command ?? "",
          "shell.cwd": input.cwd ?? "",
          "openbox.semantic_type": "internal",
          "openbox.span_type": "function"
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
        span_type: "mcp_tool_call",
        hook_type: "function_call",
        semantic_type: "llm_tool_call",
        attributes: {
          "gen_ai.system": "mcp",
          "http.method": "POST",
          "http.url": "https://api.openai.com/v1/chat/completions",
          "openbox.semantic_type": "llm_tool_call",
          "openbox.span_type": "mcp_tool_call",
          "openbox.tool.name": input.tool_name ?? "call",
          "tool.name": input.tool_name ?? "call",
          tool_name: input.tool_name ?? "call"
        },
        function: `mcp.${input.tool_name ?? "call"}`,
        module: host,
        args: input,
        result: input.tool_output ?? null
      };
    case "http":
      const method = (input.method ?? "GET").toUpperCase();
      const url = input.url ?? "";
      return {
        ...b,
        name: `${method} ${url}`,
        span_type: "http",
        hook_type: "http_request",
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
        response_body: null,
        request_headers: null,
        response_headers: null,
        http_status_code: null,
        function: "HTTPCall",
        module: host,
        args: input,
        result: null
      };
    case "db":
      const dbSystem = input.db_system ?? "postgresql";
      const dbOperation = (input.db_operation ?? "SELECT").toUpperCase();
      const dbStatement = input.db_statement ?? `${dbOperation} statement`;
      return {
        ...b,
        name: `${dbOperation} ${dbStatement.split(" ").slice(0, 3).join(" ")}`,
        span_type: "database",
        hook_type: "db_query",
        semantic_type: `database_${dbOperation.toLowerCase()}`,
        attributes: {
          "db.system": dbSystem,
          "db.operation": dbOperation,
          "db.statement": dbStatement,
          "openbox.semantic_type": `database_${dbOperation.toLowerCase()}`,
          "openbox.span_type": "database"
        },
        db_system: dbSystem,
        db_name: null,
        db_operation: dbOperation,
        db_statement: dbStatement,
        server_address: null,
        server_port: null,
        rowcount: null,
        function: "DatabaseQuery",
        module: host,
        args: input,
        result: null
      };
  }
}
var init_spans = __esm({
  "ts/src/governance/spans.ts"() {
    "use strict";
  }
});

// ts/src/runtime/claude-code/side-effects.ts
import * as fs7 from "fs";
var TRUNCATE_LIMIT, sideEffects;
var init_side_effects = __esm({
  "ts/src/runtime/claude-code/side-effects.ts"() {
    "use strict";
    init_skip_patterns();
    TRUNCATE_LIMIT = 5e3;
    sideEffects = {
      /** Read the file at the given path; returns '' on missing/unreadable
       *  files and on paths the SKIP_PATTERNS list flags as IDE/secret
       *  internals so PII scanning can't false-HALT on metadata reads. */
      readFile(input) {
        if (typeof input !== "string" || !input) return "";
        if (isSkipped(input)) return "";
        try {
          return fs7.existsSync(input) ? fs7.readFileSync(input, "utf-8") : "";
        } catch {
          return "";
        }
      },
      /** JSON-stringify and clip to TRUNCATE_LIMIT chars; used for the
       *  PostToolUse `output` field where Claude can return arbitrarily
       *  large tool responses. */
      stringifyTruncate(input) {
        const s = typeof input === "string" ? input : JSON.stringify(input ?? {});
        return s.length > TRUNCATE_LIMIT ? s.slice(0, TRUNCATE_LIMIT) : s;
      }
    };
  }
});

// ts/src/runtime/claude-code/tool-activity-store.ts
import { createHash as createHash2 } from "crypto";
import path11 from "path";
function storeFor(cfg) {
  let store = stores2.get(cfg);
  if (!store) {
    store = new SessionStore(path11.join(cfg.sessionDir, "tool-activities"));
    stores2.set(cfg, store);
  }
  return store;
}
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}
function toolActivityKey(env) {
  if (env.tool_use_id) {
    return `${env.session_id}:${env.tool_use_id}`;
  }
  const digest = createHash2("sha256").update(env.session_id).update("\0").update(env.tool_name ?? "").update("\0").update(stableStringify(env.tool_input ?? null)).digest("hex").slice(0, 32);
  return `${env.session_id}:${digest}`;
}
function rememberToolActivity(env, cfg, activity) {
  storeFor(cfg).save(toolActivityKey(env), { ...activity });
}
function takeToolActivity(env, cfg) {
  const key = toolActivityKey(env);
  const store = storeFor(cfg);
  const record = store.load(key);
  store.delete(key);
  if (!record || typeof record.activityId !== "string" || typeof record.activityType !== "string" || typeof record.startTime !== "number") {
    return null;
  }
  return {
    activityId: record.activityId,
    activityType: record.activityType,
    startTime: record.startTime
  };
}
var stores2;
var init_tool_activity_store = __esm({
  "ts/src/runtime/claude-code/tool-activity-store.ts"() {
    "use strict";
    init_store2();
    stores2 = /* @__PURE__ */ new WeakMap();
  }
});

// ts/src/runtime/claude-code/mappers/pre-tool-use.ts
function activityTypeFor(toolName) {
  const direct = PRE_TOOL_USE_ROUTING2[toolName];
  if (direct) return direct;
  if (toolName.startsWith("mcp__")) return ACTIVITY_TYPES.MCP_CALL;
  return ACTIVITY_TYPES.AGENT_ACTION;
}
function spanTypeFor(toolName) {
  if (toolName === "Read" || toolName === "NotebookRead" || toolName === "Glob" || toolName === "Grep") return "file_read";
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit" || toolName === "NotebookEdit") return "file_write";
  if (toolName === "Delete") return "file_delete";
  if (toolName === "Bash" || toolName === "PowerShell") return "shell";
  if (toolName === "WebFetch" || toolName === "WebSearch") return "http";
  if (toolName.startsWith("mcp__")) return "mcp";
  return null;
}
async function handlePreToolUse(env, session, cfg) {
  const toolName = env.tool_name ?? "";
  const toolInput = env.tool_input ?? {};
  if ((cfg.skipTools ?? []).includes(toolName)) return void 0;
  const activityType = activityTypeFor(toolName);
  if (!activityType) return void 0;
  if ((cfg.skipActivityTypes ?? []).includes(activityType)) return void 0;
  const filePath = toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? toolInput.notebook_path ?? "";
  if (filePath && isSkipped(filePath)) return void 0;
  const payload = buildPreToolUsePayload2(env, toolName, sideEffects);
  const spanType = spanTypeFor(toolName);
  const spans = spanType ? [
    buildSpan("claude-code", spanType, {
      file_path: filePath || void 0,
      command: toolInput.command || void 0,
      cwd: toolInput.cwd || void 0,
      tool_name: toolName,
      tool_input: toolInput,
      url: toolInput.url || toolInput.query || void 0,
      method: "GET"
    })
  ] : void 0;
  const startTime = Date.now();
  const opened = await session.openActivity(activityType, {
    input: [stampSource(payload, "claude-code")],
    startTime,
    spans
  });
  const verdict = opened.verdict;
  if (verdict.arm === "allow" || verdict.arm === "constrain" || verdict.arm === "require_approval") {
    rememberToolActivity(env, cfg, {
      activityId: opened.activityId,
      activityType,
      startTime
    });
  }
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
var init_pre_tool_use = __esm({
  "ts/src/runtime/claude-code/mappers/pre-tool-use.ts"() {
    "use strict";
    init_claude_code();
    init_session_resolver();
    init_activity_types();
    init_skip_patterns();
    init_spans();
    init_source();
    init_side_effects();
    init_tool_activity_store();
  }
});

// ts/src/runtime/claude-code/mappers/post-tool-use.ts
function activityTypeFor2(toolName) {
  const direct = POST_TOOL_USE_ROUTING[toolName];
  if (direct) return direct;
  if (toolName.startsWith("mcp__")) return ACTIVITY_TYPES.MCP_CALL;
  return ACTIVITY_TYPES.AGENT_ACTION;
}
function spanTypeFor2(toolName) {
  if (toolName === "Read" || toolName === "NotebookRead" || toolName === "Glob" || toolName === "Grep") return "file_read";
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit" || toolName === "NotebookEdit") return "file_write";
  if (toolName === "Delete") return "file_delete";
  if (toolName === "Bash" || toolName === "PowerShell") return "shell";
  if (toolName === "WebFetch" || toolName === "WebSearch") return "http";
  if (toolName.startsWith("mcp__")) return "mcp";
  return null;
}
function durationMsFor(env) {
  const durationMs = env.duration_ms;
  return typeof durationMs === "number" && Number.isFinite(durationMs) ? durationMs : void 0;
}
function outputFor(env, payload) {
  return env.tool_response ?? env.tool_output ?? payload.output;
}
async function handlePostToolUse(env, session, cfg) {
  const toolName = env.tool_name ?? "";
  const toolInput = env.tool_input ?? {};
  if ((cfg.skipTools ?? []).includes(toolName)) return void 0;
  const activityType = activityTypeFor2(toolName);
  if ((cfg.skipActivityTypes ?? []).includes(activityType)) return void 0;
  const filePath = toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? toolInput.notebook_path ?? "";
  if (filePath && isSkipped(filePath)) return void 0;
  const pending = takeToolActivity(env, cfg);
  const toolResponse = outputFor(env, {});
  const payload = buildPostToolUsePayload(env, sideEffects);
  const startedPayload = buildPreToolUsePayload2(env, toolName, sideEffects);
  const spanType = spanTypeFor2(toolName);
  const spans = spanType ? [
    buildSpan("claude-code", spanType, {
      file_path: toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? toolInput.notebook_path,
      command: toolInput.command,
      cwd: toolInput.cwd,
      tool_name: toolName,
      tool_output: toolResponse,
      url: toolInput.url || toolInput.query || void 0,
      method: "GET"
    })
  ] : void 0;
  const durationMs = durationMsFor(env);
  const verdict = await session.activity(EVENT.COMPLETE, activityType, {
    activityId: pending?.activityId,
    startTime: pending?.startTime,
    endTime: pending && durationMs !== void 0 ? pending.startTime + durationMs : void 0,
    durationMs,
    input: [stampSource(startedPayload, "claude-code")],
    output: outputFor(env, payload),
    spans
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
async function handlePostToolUseFailure(env, session, cfg) {
  const toolName = env.tool_name ?? "";
  const toolInput = env.tool_input ?? {};
  if ((cfg.skipTools ?? []).includes(toolName)) return void 0;
  const activityType = activityTypeFor2(toolName);
  if ((cfg.skipActivityTypes ?? []).includes(activityType)) return void 0;
  const filePath = toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? toolInput.notebook_path ?? "";
  if (filePath && isSkipped(filePath)) return void 0;
  const pending = takeToolActivity(env, cfg);
  const payload = buildPostToolUseFailurePayload(env);
  const startedPayload = buildPreToolUsePayload2(env, toolName, sideEffects);
  const durationMs = durationMsFor(env);
  const verdict = await session.activity(EVENT.COMPLETE, activityType, {
    activityId: pending?.activityId,
    startTime: pending?.startTime,
    endTime: pending && durationMs !== void 0 ? pending.startTime + durationMs : void 0,
    durationMs,
    input: [stampSource(startedPayload, "claude-code")],
    output: stampSource(payload, "claude-code")
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
async function handlePostToolBatch(env, session, cfg) {
  const payload = buildPostToolBatchPayload(env, sideEffects);
  const verdict = await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.AGENT_ACTION, {
    input: [stampSource(payload, "claude-code")],
    output: stampSource(payload, "claude-code")
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
var init_post_tool_use = __esm({
  "ts/src/runtime/claude-code/mappers/post-tool-use.ts"() {
    "use strict";
    init_claude_code();
    init_session_resolver();
    init_activity_types();
    init_spans();
    init_source();
    init_side_effects();
    init_skip_patterns();
    init_tool_activity_store();
  }
});

// ts/src/runtime/claude-code/mappers/user-prompt.ts
async function handleUserPromptSubmit(env, session, cfg) {
  const prompt = (env.prompt ?? "").trim();
  if (!prompt) return void 0;
  void session.activity(EVENT.SIGNAL, "user_prompt", {
    input: [stampSource({ prompt, event_category: "agent_goal" }, "claude-code")],
    signalName: "user_prompt",
    signalArgs: prompt,
    spans: [buildSpan("claude-code", "llm", { prompt })]
  }).catch(() => void 0);
  const payload = buildUserPromptSubmitPayload(env);
  const span = buildSpan("claude-code", "llm", { prompt });
  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.PROMPT, {
    input: [stampSource(payload, "claude-code")],
    spans: [span]
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
async function handleUserPromptExpansion(env, session, cfg) {
  const prompt = (env.expanded_prompt ?? env.prompt ?? "").trim();
  if (!prompt) return void 0;
  const payload = buildUserPromptExpansionPayload(env);
  const span = buildSpan("claude-code", "llm", { prompt });
  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.PROMPT, {
    input: [stampSource(payload, "claude-code")],
    spans: [span]
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
var init_user_prompt = __esm({
  "ts/src/runtime/claude-code/mappers/user-prompt.ts"() {
    "use strict";
    init_claude_code();
    init_session_resolver();
    init_activity_types();
    init_spans();
    init_source();
  }
});

// ts/src/runtime/claude-code/mappers/permission-request.ts
function activityTypeForTool(toolName) {
  const direct = PERMISSION_REQUEST_ROUTING[toolName];
  if (direct) return direct;
  if (toolName.startsWith("mcp__")) return ACTIVITY_TYPES.MCP_CALL;
  return ACTIVITY_TYPES.AGENT_ACTION;
}
function spanTypeFor3(toolName) {
  if (toolName === "Read" || toolName === "NotebookRead" || toolName === "Glob" || toolName === "Grep") return "file_read";
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit" || toolName === "NotebookEdit") return "file_write";
  if (toolName === "Delete") return "file_delete";
  if (toolName === "Bash" || toolName === "PowerShell") return "shell";
  if (toolName === "WebFetch" || toolName === "WebSearch") return "http";
  if (toolName.startsWith("mcp__")) return "mcp";
  return null;
}
async function handlePermissionRequest(env, session, cfg) {
  const toolName = env.tool_name ?? "";
  if ((cfg.skipTools ?? []).includes(toolName)) return void 0;
  const activityType = activityTypeForTool(toolName);
  if ((cfg.skipActivityTypes ?? []).includes(activityType)) return void 0;
  const toolInput = env.tool_input ?? {};
  const payload = buildPermissionRequestPayload(env, toolName);
  const spanType = spanTypeFor3(toolName);
  const spans = spanType ? [
    buildSpan("claude-code", spanType, {
      file_path: toolInput.file_path ?? toolInput.filePath ?? toolInput.path ?? toolInput.notebook_path,
      command: toolInput.command,
      cwd: toolInput.cwd,
      tool_name: toolName,
      tool_input: toolInput,
      url: toolInput.url || toolInput.query || void 0,
      method: "GET"
    })
  ] : void 0;
  const verdict = await session.activity(EVENT.START, activityType, {
    input: [stampSource(payload, "claude-code")],
    spans
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
async function handlePermissionDenied(env, session, cfg) {
  const toolName = env.tool_name ?? "";
  const activityType = activityTypeForTool(toolName);
  if ((cfg.skipActivityTypes ?? []).includes(activityType)) return void 0;
  const payload = buildPermissionDeniedPayload(env);
  const verdict = await session.activity(EVENT.START, activityType, {
    input: [stampSource(payload, "claude-code")]
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
var init_permission_request = __esm({
  "ts/src/runtime/claude-code/mappers/permission-request.ts"() {
    "use strict";
    init_claude_code();
    init_session_resolver();
    init_activity_types();
    init_spans();
    init_source();
  }
});

// ts/src/runtime/claude-code/transcript-usage.ts
import fs8 from "fs";
import path12 from "path";
function toPositiveInteger2(value) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : void 0;
  if (numberValue === void 0 || !Number.isFinite(numberValue) || numberValue <= 0)
    return void 0;
  return Math.trunc(numberValue);
}
function normalizeClaudeUsage(value) {
  if (value === null || typeof value !== "object") return void 0;
  const usage = value;
  const normalized = {
    inputTokens: toPositiveInteger2(usage.input_tokens),
    outputTokens: toPositiveInteger2(usage.output_tokens),
    totalTokens: toPositiveInteger2(usage.total_tokens)
  };
  return Object.values(normalized).some((entry) => entry !== void 0) ? normalized : void 0;
}
function sumTokenField(left, right) {
  if (left === void 0) return right;
  if (right === void 0) return left;
  return left + right;
}
function withDerivedTotal(usage) {
  const input = usage.inputTokens ?? usage.promptTokens;
  const output2 = usage.outputTokens ?? usage.completionTokens;
  if (input === void 0 && output2 === void 0) return usage;
  const calculatedTotal = (input ?? 0) + (output2 ?? 0);
  if (usage.totalTokens !== void 0 && usage.totalTokens >= calculatedTotal) {
    return usage;
  }
  return {
    ...usage,
    totalTokens: calculatedTotal
  };
}
function combineUsage(left, right) {
  if (!left) return right;
  if (!right) return left;
  return {
    promptTokens: sumTokenField(left.promptTokens, right.promptTokens),
    completionTokens: sumTokenField(
      left.completionTokens,
      right.completionTokens
    ),
    inputTokens: sumTokenField(left.inputTokens, right.inputTokens),
    outputTokens: sumTokenField(left.outputTokens, right.outputTokens),
    totalTokens: sumTokenField(left.totalTokens, right.totalTokens)
  };
}
function transcriptRecordId(record, index) {
  const messageId = record.message?.id;
  if (typeof messageId === "string" && messageId.trim()) {
    return `message:${messageId}`;
  }
  const uuid = record.uuid;
  if (typeof uuid === "string" && uuid.trim()) return `uuid:${uuid}`;
  return `line:${index}`;
}
function textFromClaudeContent(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || void 0;
  }
  if (Array.isArray(value)) {
    const text = value.map((item) => {
      if (typeof item === "string") return item;
      if (item === null || typeof item !== "object") return "";
      const record = item;
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      return "";
    }).filter(Boolean).join("");
    const trimmed = text.trim();
    return trimmed || void 0;
  }
  if (value !== null && typeof value === "object") {
    const record = value;
    return textFromClaudeContent(record.text ?? record.content);
  }
  return void 0;
}
function isSafeTranscriptPath(filePath) {
  return path12.isAbsolute(filePath) && filePath.endsWith(".jsonl") && !filePath.includes("\0");
}
function readTranscriptTail(filePath) {
  if (!isSafeTranscriptPath(filePath)) return void 0;
  let fd;
  try {
    const stat = fs8.statSync(filePath);
    if (!stat.isFile()) return void 0;
    const length = Math.min(stat.size, MAX_TRANSCRIPT_TAIL_BYTES);
    const offset = Math.max(0, stat.size - length);
    const buffer = Buffer.alloc(length);
    fd = fs8.openSync(filePath, "r");
    fs8.readSync(fd, buffer, 0, length, offset);
    return buffer.toString("utf-8");
  } catch {
    return void 0;
  } finally {
    if (fd !== void 0) {
      try {
        fs8.closeSync(fd);
      } catch {
      }
    }
  }
}
function readLatestAssistantTurn(env) {
  const transcriptPath = env.agent_transcript_path ?? env.transcript_path;
  if (!transcriptPath) return void 0;
  const text = readTranscriptTail(transcriptPath);
  if (!text) return void 0;
  const lines = text.split("\n").filter(Boolean);
  const assistantRecords = /* @__PURE__ */ new Map();
  let latestModel;
  let latestContent;
  for (const [index, line] of lines.entries()) {
    const jsonStart = line.indexOf("{");
    if (jsonStart < 0) continue;
    try {
      const record = JSON.parse(line.slice(jsonStart));
      if (record.type !== "assistant" && record.message?.role !== "assistant") {
        continue;
      }
      const usage = normalizeClaudeUsage(record.message?.usage);
      const content = textFromClaudeContent(record.message?.content);
      if (!usage && !content) continue;
      const id = transcriptRecordId(record, index);
      const previous = assistantRecords.get(id);
      const model = record.message?.model ?? previous?.model;
      assistantRecords.set(id, {
        model,
        usage: usage ?? previous?.usage,
        content: content ?? previous?.content
      });
      if (record.message?.model) latestModel = record.message.model;
      if (content) latestContent = content;
    } catch {
      continue;
    }
  }
  let aggregatedUsage;
  for (const record of assistantRecords.values()) {
    aggregatedUsage = combineUsage(aggregatedUsage, record.usage);
  }
  aggregatedUsage = aggregatedUsage ? withDerivedTotal(aggregatedUsage) : void 0;
  if (!aggregatedUsage && !latestContent) return void 0;
  return {
    model: latestModel,
    usage: aggregatedUsage,
    content: latestContent
  };
}
function readLatestAssistantUsage(env) {
  const turn = readLatestAssistantTurn(env);
  return turn?.usage ? { model: turn.model, usage: turn.usage, content: turn.content } : void 0;
}
var MAX_TRANSCRIPT_TAIL_BYTES;
var init_transcript_usage = __esm({
  "ts/src/runtime/claude-code/transcript-usage.ts"() {
    "use strict";
    MAX_TRANSCRIPT_TAIL_BYTES = 1024 * 1024;
  }
});

// ts/src/runtime/claude-code/mappers/assistant-output.ts
function firstText(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return void 0;
}
function buildClaudeAssistantOutputSpan(env, options) {
  const transcript = readLatestAssistantTurn(env);
  const content = options.preferTranscriptContent ? firstText(transcript?.content, options.fallbackText) : firstText(options.fallbackText, transcript?.content);
  if (!content && !transcript?.usage) return void 0;
  return [
    buildLLMCompletionSpan({
      content: content ?? "",
      span: { module: "claude-code" },
      name: "openbox.claude-code.assistant_output",
      kind: "llm",
      system: "claude-code",
      model: transcript?.model,
      usage: transcript?.usage,
      providerUrl: "https://api.anthropic.com/v1/messages",
      attributes: {
        "gen_ai.system": "claude-code",
        "openbox.claude_code.event": options.event
      },
      data: {
        source: "claude-code",
        event: options.event,
        session_id: env.session_id,
        hook_event_name: env.hook_event_name
      }
    })
  ];
}
var init_assistant_output = __esm({
  "ts/src/runtime/claude-code/mappers/assistant-output.ts"() {
    "use strict";
    init_spans();
    init_transcript_usage();
  }
});

// ts/src/runtime/claude-code/mappers/session.ts
function hasPendingClaudeWork(env) {
  return Array.isArray(env.background_tasks) && env.background_tasks.length > 0 || Array.isArray(env.session_crons) && env.session_crons.length > 0;
}
async function handleSessionStart(env, session, _cfg) {
  await session.workflowStarted();
  await session.activity(EVENT.START, ACTIVITY_TYPES.SESSION, {
    input: [stampSource(buildSessionStartPayload(env), "claude-code")]
  });
  return void 0;
}
async function handleStop(env, session, cfg) {
  let verdict;
  try {
    verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.SESSION, {
      input: [stampSource(buildStopPayload(env), "claude-code")],
      spans: buildClaudeAssistantOutputSpan(env, {
        event: "Stop",
        fallbackText: env.last_assistant_message
      })
    });
  } catch {
    if (cfg.governancePolicy === "fail_closed") {
      return {
        arm: "block",
        reason: "OpenBox Core was unavailable while governing Claude Code stop",
        riskScore: 1
      };
    }
    return void 0;
  }
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  if ((verdict.arm === "allow" || verdict.arm === "constrain") && !hasPendingClaudeWork(env)) {
    try {
      await session.workflowCompleted();
      clearSession(env.session_id, cfg);
    } catch {
      if (cfg.governancePolicy === "fail_closed") {
        return {
          arm: "block",
          reason: "OpenBox Core was unavailable while completing Claude Code workflow",
          riskScore: 1
        };
      }
    }
  }
  return verdict;
}
async function handleSetup(env, session, _cfg) {
  try {
    await session.activity(EVENT.START, ACTIVITY_TYPES.SESSION, {
      input: [stampSource(buildSetupPayload(env), "claude-code")]
    });
  } catch {
  }
  return void 0;
}
async function handlePreCompact(env, session, cfg) {
  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.SESSION, {
    input: [stampSource(buildPreCompactPayload(env), "claude-code")]
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
async function handlePostCompact(env, session, _cfg) {
  try {
    await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.SESSION, {
      input: [stampSource(buildPostCompactPayload(env), "claude-code")]
    });
  } catch {
  }
  return void 0;
}
async function handleStopFailure(env, session, cfg) {
  try {
    await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.SESSION, {
      input: [stampSource(buildStopFailurePayload(env), "claude-code")]
    });
  } catch {
  }
  try {
    await session.workflowFailed(
      new Error(String(env.error ?? env.reason ?? "Claude Code StopFailure"))
    );
    clearSession(env.session_id, cfg);
  } catch {
  }
  return void 0;
}
async function handleSessionEnd(env, session, cfg) {
  if (lastResolveCreatedFreshSession()) {
    clearSession(env.session_id, cfg);
    return void 0;
  }
  try {
    await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.SESSION, {
      input: [stampSource(buildSessionEndPayload(env), "claude-code")]
    });
  } catch {
  }
  try {
    await session.workflowCompleted();
  } catch {
  }
  clearSession(env.session_id, cfg);
  return void 0;
}
var init_session = __esm({
  "ts/src/runtime/claude-code/mappers/session.ts"() {
    "use strict";
    init_claude_code();
    init_session_resolver();
    init_activity_types();
    init_source();
    init_assistant_output();
  }
});

// ts/src/runtime/claude-code/mappers/subagent.ts
function subAgentActivityType(env) {
  return `SubAgent:${env.agent_type || env.agent_id || "unknown"}`;
}
async function handleSubagentStart(env, session, _cfg) {
  try {
    await session.activity(EVENT.START, subAgentActivityType(env), {
      input: [stampSource(buildSubagentStartPayload2(env), "claude-code")]
    });
  } catch {
  }
  return void 0;
}
async function handleSubagentStop(env, session, cfg) {
  const verdict = await session.activity(EVENT.COMPLETE, subAgentActivityType(env), {
    input: [stampSource(buildSubagentStopPayload(env), "claude-code")],
    spans: buildClaudeAssistantOutputSpan(env, {
      event: "SubagentStop",
      fallbackText: env.last_assistant_message
    })
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
async function handleTaskCreated(env, session, cfg) {
  const verdict = await session.activity(EVENT.START, ACTIVITY_TYPES.TASK, {
    input: [stampSource(buildTaskCreatedPayload(env), "claude-code")]
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
async function handleTaskCompleted(env, session, cfg) {
  const verdict = await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.TASK, {
    input: [stampSource(buildTaskCompletedPayload(env), "claude-code")]
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
async function handleTeammateIdle(env, session, cfg) {
  const verdict = await session.activity(EVENT.COMPLETE, ACTIVITY_TYPES.TASK, {
    input: [stampSource(buildTeammateIdlePayload(env), "claude-code")]
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return verdict;
}
var init_subagent = __esm({
  "ts/src/runtime/claude-code/mappers/subagent.ts"() {
    "use strict";
    init_claude_code();
    init_activity_types();
    init_source();
    init_session_resolver();
    init_assistant_output();
  }
});

// ts/src/runtime/claude-code/mappers/generic.ts
function compactPayload(env, eventCategory) {
  const source = env;
  const payload = {
    event_category: eventCategory
  };
  for (const field of IMPORTANT_FIELDS) {
    const value = source[field];
    if (value !== void 0) payload[field] = value;
  }
  return payload;
}
async function handleGenericClaudeEvent(env, session, cfg, options) {
  const verdict = await session.activity(options.eventKind ?? EVENT.START, options.activityType, {
    input: [stampSource(compactPayload(env, options.eventCategory), "claude-code")]
  });
  if (verdict.arm === "halt") markHalted(env.session_id, cfg);
  return options.decisionCapable ? verdict : void 0;
}
async function observeGenericClaudeEvent(env, session, cfg, options) {
  try {
    await handleGenericClaudeEvent(env, session, cfg, {
      ...options,
      decisionCapable: false
    });
  } catch {
  }
  return void 0;
}
async function handleMessageDisplay(env, session, cfg, options) {
  const usage = env.final === true ? readLatestAssistantUsage(env) : void 0;
  const text = env.delta ?? env.display_content ?? env.displayContent ?? env.message ?? "";
  try {
    await session.activity(options.eventKind ?? EVENT.COMPLETE, options.activityType, {
      input: [stampSource(compactPayload(env, options.eventCategory), "claude-code")],
      output: stampSource({ text, event_category: options.eventCategory }, "claude-code"),
      spans: env.final === true ? buildClaudeAssistantOutputSpan(env, {
        event: "MessageDisplay",
        fallbackText: text,
        preferTranscriptContent: true
      }) : void 0
    });
  } catch {
  }
  if (usage && env.final === true) {
    try {
      await session.activity(EVENT.SIGNAL, "claude_usage", {
        input: [
          stampSource({
            event_category: "llm_usage",
            model: usage.model,
            usage: usage.usage
          }, "claude-code")
        ]
      });
    } catch {
    }
  }
  return void 0;
}
var IMPORTANT_FIELDS;
var init_generic = __esm({
  "ts/src/runtime/claude-code/mappers/generic.ts"() {
    "use strict";
    init_session_resolver();
    init_activity_types();
    init_source();
    init_assistant_output();
    init_transcript_usage();
    IMPORTANT_FIELDS = [
      "hook_event_name",
      "session_id",
      "cwd",
      "trigger",
      "source",
      "file_path",
      "event",
      "old_cwd",
      "new_cwd",
      "name",
      "command_name",
      "command_args",
      "expanded_prompt",
      "prompt",
      "message",
      "display_content",
      "displayContent",
      "tool_name",
      "tool_input",
      "tool_output",
      "tool_response",
      "tool_calls",
      "error",
      "reason",
      "action",
      "content",
      "mcp_server_name",
      "mode",
      "url",
      "elicitation_id",
      "requested_schema",
      "response",
      "task_id",
      "task_subject",
      "task_description",
      "teammate_name",
      "team_name",
      "last_assistant_message",
      "background_tasks",
      "session_crons",
      "custom_instructions",
      "compact_summary"
    ];
  }
});

// ts/src/runtime/claude-code/hook-handler.ts
var hook_handler_exports = {};
__export(hook_handler_exports, {
  runClaudeHook: () => runClaudeHook
});
function logged(event, verdictKind, fn) {
  return async (env, s) => {
    const start = Date.now();
    try {
      const out = await fn(env, s);
      hookLog.record({
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        event,
        verdict_kind: verdictKind,
        took_ms: Date.now() - start
      });
      return out;
    } catch (err) {
      hookLog.record({
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        event,
        verdict_kind: verdictKind,
        took_ms: Date.now() - start,
        error: String(err?.message ?? err)
      });
      throw err;
    }
  };
}
function failClosedVerdict(reason) {
  return {
    arm: "block",
    reason,
    riskScore: 1
  };
}
function decisionSurface(eventName) {
  return CLAUDE_CODE_HOOK_MATRIX.find((entry) => entry.event === eventName)?.decisionSurface ?? "none";
}
function isDecisionCapable(eventName) {
  const surface = decisionSurface(eventName);
  return surface !== "none" && surface !== "worktree-path";
}
function reasonFromError(prefix, err) {
  const detail = err instanceof Error ? err.message : String(err ?? "");
  return detail ? `${prefix}: ${detail}` : prefix;
}
function guarded(cfg, event, verdictKind, fn) {
  return logged(event, verdictKind, async (env, session) => {
    try {
      return await fn(env, session);
    } catch (err) {
      const decisionCapable = isDecisionCapable(env.hook_event_name);
      const reason = reasonFromError("OpenBox governance failed while processing Claude Code hook", err);
      if (cfg.verbose) console.error(`[openbox claude-code] ${reason}`);
      if (decisionCapable && cfg.governancePolicy === "fail_closed") {
        return failClosedVerdict(reason);
      }
      return void 0;
    }
  });
}
function renderFailClosedHookOutput(env, reason) {
  const eventName = env.hook_event_name ?? "ClaudeCode";
  switch (decisionSurface(eventName)) {
    case "permission-decision":
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          permissionDecision: "deny",
          permissionDecisionReason: `[OpenBox] ${reason}`
        }
      };
    case "permission-request":
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          decision: {
            behavior: "deny",
            message: `[OpenBox] ${reason}`
          }
        }
      };
    case "permission-denied-retry":
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          retry: false
        }
      };
    case "elicitation-response":
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          action: "decline",
          content: {}
        }
      };
    case "continue-block":
      return {
        continue: false,
        stopReason: `[OpenBox] ${reason}`
      };
    case "additional-context":
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          additionalContext: `[OpenBox] ${reason}`
        }
      };
    case "decision-block":
      return {
        decision: "block",
        reason: `[OpenBox] ${reason}`
      };
    default:
      return void 0;
  }
}
function writeFailClosedIfPossible(env, reason) {
  if (!env || !isDecisionCapable(env.hook_event_name)) return;
  const output2 = renderFailClosedHookOutput(env, reason);
  if (output2 !== void 0) process.stdout.write(JSON.stringify(output2));
}
function parseEnvelope(raw) {
  const text = raw.trim();
  if (!text) return void 0;
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
async function readHookStdin() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buf = chunk;
    total += buf.length;
    if (total > MAX_STDIN_BYTES) {
      throw new Error(
        `hook stdin exceeded ${MAX_STDIN_BYTES.toLocaleString()} bytes; refusing to buffer further`
      );
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
async function runClaudeHook() {
  const cfg = loadConfig();
  if (!process.env.OPENBOX_HOME) {
    process.env.OPENBOX_HOME = getConfigDir();
  }
  createLogger("claude-code").initLogger(cfg);
  let raw = "";
  let env;
  try {
    raw = await readHookStdin();
    env = parseEnvelope(raw);
  } catch (err) {
    if (cfg.verbose) console.error(`[openbox claude-code] ${reasonFromError("failed to read hook stdin", err)}`);
    process.exit(0);
  }
  if (!cfg.openboxApiKey) {
    if (cfg.governancePolicy === "fail_closed") {
      writeFailClosedIfPossible(env, "missing OPENBOX_API_KEY");
    }
    if (cfg.verbose) console.error("[openbox claude-code] no OPENBOX_API_KEY set, passing through");
    process.exit(0);
  }
  if (!cfg.openboxEndpoint) {
    if (cfg.governancePolicy === "fail_closed") {
      writeFailClosedIfPossible(env, "missing OPENBOX_CORE_URL");
    }
    if (cfg.verbose) console.error("[openbox claude-code] no OPENBOX_CORE_URL set, passing through");
    process.exit(0);
  }
  const dryRun = cfg.dryRun;
  const core = new OpenBoxCoreClient({
    apiKey: cfg.openboxApiKey,
    apiUrl: cfg.openboxEndpoint,
    agentIdentity: cfg.agentIdentity,
    timeoutMs: cfg.governanceTimeout * 1e3
  });
  const approvalMaxWaitMs = Math.min(
    Math.max(1, cfg.hitlMaxWait) * 1e3,
    36e5
  );
  const handlers = {
    setup: guarded(
      cfg,
      "setup",
      "observe",
      async (env2, s) => dryRun ? void 0 : handleSetup(env2, s, cfg)
    ),
    sessionStart: guarded(
      cfg,
      "sessionStart",
      "none",
      async (env2, s) => dryRun ? void 0 : handleSessionStart(env2, s, cfg)
    ),
    instructionsLoaded: guarded(
      cfg,
      "instructionsLoaded",
      "observe",
      async (env2, s) => dryRun ? void 0 : observeGenericClaudeEvent(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.MESSAGE,
        eventKind: EVENT.START,
        eventCategory: "agent_observation"
      })
    ),
    userPromptSubmit: guarded(
      cfg,
      "userPromptSubmit",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleUserPromptSubmit(env2, s, cfg)
    ),
    userPromptExpansion: guarded(
      cfg,
      "userPromptExpansion",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleUserPromptExpansion(env2, s, cfg)
    ),
    messageDisplay: guarded(
      cfg,
      "messageDisplay",
      "observe",
      async (env2, s) => dryRun ? void 0 : handleMessageDisplay(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.MESSAGE,
        eventKind: EVENT.COMPLETE,
        eventCategory: "llm_output"
      })
    ),
    preToolUse: guarded(
      cfg,
      "preToolUse",
      "permission",
      async (env2, s) => dryRun ? void 0 : handlePreToolUse(env2, s, cfg)
    ),
    permissionRequest: guarded(
      cfg,
      "permissionRequest",
      "permission",
      async (env2, s) => dryRun ? void 0 : handlePermissionRequest(env2, s, cfg)
    ),
    permissionDenied: guarded(
      cfg,
      "permissionDenied",
      "permission",
      async (env2, s) => dryRun ? void 0 : handlePermissionDenied(env2, s, cfg)
    ),
    postToolUse: guarded(
      cfg,
      "postToolUse",
      "permission",
      async (env2, s) => dryRun ? void 0 : handlePostToolUse(env2, s, cfg)
    ),
    postToolUseFailure: guarded(
      cfg,
      "postToolUseFailure",
      "permission",
      async (env2, s) => dryRun ? void 0 : handlePostToolUseFailure(env2, s, cfg)
    ),
    postToolBatch: guarded(
      cfg,
      "postToolBatch",
      "permission",
      async (env2, s) => dryRun ? void 0 : handlePostToolBatch(env2, s, cfg)
    ),
    subagentStart: guarded(
      cfg,
      "subagentStart",
      "observe",
      async (env2, s) => dryRun ? void 0 : handleSubagentStart(env2, s, cfg)
    ),
    subagentStop: guarded(
      cfg,
      "subagentStop",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleSubagentStop(env2, s, cfg)
    ),
    taskCreated: guarded(
      cfg,
      "taskCreated",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleTaskCreated(env2, s, cfg)
    ),
    taskCompleted: guarded(
      cfg,
      "taskCompleted",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleTaskCompleted(env2, s, cfg)
    ),
    stop: guarded(
      cfg,
      "stop",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleStop(env2, s, cfg)
    ),
    stopFailure: guarded(
      cfg,
      "stopFailure",
      "observe",
      async (env2, s) => dryRun ? void 0 : handleStopFailure(env2, s, cfg)
    ),
    teammateIdle: guarded(
      cfg,
      "teammateIdle",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleTeammateIdle(env2, s, cfg)
    ),
    notification: guarded(
      cfg,
      "notification",
      "observe",
      async (env2, s) => dryRun ? void 0 : observeGenericClaudeEvent(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.MESSAGE,
        eventKind: EVENT.SIGNAL,
        eventCategory: "agent_notification"
      })
    ),
    configChange: guarded(
      cfg,
      "configChange",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleGenericClaudeEvent(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.CONFIG_CHANGE,
        eventKind: EVENT.START,
        eventCategory: "config_change",
        decisionCapable: true
      })
    ),
    cwdChanged: guarded(
      cfg,
      "cwdChanged",
      "observe",
      async (env2, s) => dryRun ? void 0 : observeGenericClaudeEvent(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.WORKSPACE_CHANGE,
        eventKind: EVENT.SIGNAL,
        eventCategory: "cwd_changed"
      })
    ),
    fileChanged: guarded(
      cfg,
      "fileChanged",
      "observe",
      async (env2, s) => dryRun ? void 0 : observeGenericClaudeEvent(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.WORKSPACE_CHANGE,
        eventKind: EVENT.SIGNAL,
        eventCategory: "file_changed"
      })
    ),
    worktreeRemove: guarded(
      cfg,
      "worktreeRemove",
      "observe",
      async (env2, s) => dryRun ? void 0 : observeGenericClaudeEvent(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.WORKSPACE_CHANGE,
        eventKind: EVENT.COMPLETE,
        eventCategory: "worktree_remove"
      })
    ),
    preCompact: guarded(
      cfg,
      "preCompact",
      "permission",
      async (env2, s) => dryRun ? void 0 : handlePreCompact(env2, s, cfg)
    ),
    postCompact: guarded(
      cfg,
      "postCompact",
      "observe",
      async (env2, s) => dryRun ? void 0 : handlePostCompact(env2, s, cfg)
    ),
    sessionEnd: guarded(
      cfg,
      "sessionEnd",
      "none",
      async (env2, s) => dryRun ? void 0 : handleSessionEnd(env2, s, cfg)
    ),
    elicitation: guarded(
      cfg,
      "elicitation",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleGenericClaudeEvent(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.MCP_ELICITATION,
        eventKind: EVENT.START,
        eventCategory: "mcp_elicitation",
        decisionCapable: true
      })
    ),
    elicitationResult: guarded(
      cfg,
      "elicitationResult",
      "permission",
      async (env2, s) => dryRun ? void 0 : handleGenericClaudeEvent(env2, s, cfg, {
        activityType: ACTIVITY_TYPES.MCP_ELICITATION,
        eventKind: EVENT.COMPLETE,
        eventCategory: "mcp_elicitation_result",
        decisionCapable: true
      })
    )
  };
  await createClaudeCodeAdapter({
    core,
    resolveSession: (env2) => resolveSession(env2, cfg),
    approvalMaxWaitMs,
    readStdin: async () => raw,
    // When APPROVAL_MODE=inline, the SDK skips its internal poll loop
    // and the adapter renders permissionDecision:'ask' so Claude
    // Code's native permission dialog pops in the TUI on every
    // require_approval. External approval clients such as the
    // dashboard, mobile app, or editor extension can still resolve
    // the backend row, but the hook does not wait for them.
    inlineApproval: cfg.approvalMode === "inline" || cfg.approvalMode === "defer",
    deferApproval: cfg.approvalMode === "defer",
    handlers
  }).run();
}
var hookLog, MAX_STDIN_BYTES;
var init_hook_handler = __esm({
  "ts/src/runtime/claude-code/hook-handler.ts"() {
    "use strict";
    init_claude_code();
    init_core_client2();
    init_config3();
    init_logger();
    init_session_resolver();
    init_hook_log();
    init_pre_tool_use();
    init_post_tool_use();
    init_user_prompt();
    init_permission_request();
    init_session();
    init_subagent();
    init_generic();
    init_activity_types();
    init_governance_matrix();
    hookLog = makeHookLog("claude-code");
    MAX_STDIN_BYTES = 10 * 1024 * 1024;
  }
});

// ts/src/runtime/claude-code/install.ts
function installClaudeCode(opts = {}) {
  installClaudeCodePlugin({ scope: opts.scope, cwd: opts.cwd });
}
function uninstallClaudeCode(opts = {}) {
  uninstallClaudeCodePlugin({ scope: opts.scope, cwd: opts.cwd });
}
var init_install2 = __esm({
  "ts/src/runtime/claude-code/install.ts"() {
    "use strict";
    init_plugin2();
  }
});

// ts/src/runtime/claude-code/index.ts
var claude_code_exports = {};
__export(claude_code_exports, {
  CLAUDE_CODE_GOVERNANCE_AUDIT: () => CLAUDE_CODE_GOVERNANCE_AUDIT,
  CLAUDE_CODE_HOOK_MATRIX: () => CLAUDE_CODE_HOOK_MATRIX,
  CLAUDE_CODE_SDK_CAPABILITY_MATRIX: () => CLAUDE_CODE_SDK_CAPABILITY_MATRIX,
  CLAUDE_CODE_SURFACE_MATRIX: () => CLAUDE_CODE_SURFACE_MATRIX,
  HOOK_LOG_PATH: () => HOOK_LOG_PATH,
  claudeCodeGovernanceSummary: () => claudeCodeGovernanceSummary,
  claudeCodePluginTargetDir: () => claudeCodePluginTargetDir,
  claudeCodeRuntimeConfigDir: () => claudeCodeRuntimeConfigDir,
  claudeCodeRuntimeDiagnostics: () => claudeCodeRuntimeDiagnostics,
  createClaudeCodeAdapter: () => createClaudeCodeAdapter,
  defaultClaudeCodeHookEvents: () => defaultClaudeCodeHookEvents,
  exportClaudeCodePlugin: () => exportClaudeCodePlugin,
  installClaudeCode: () => installClaudeCode,
  installClaudeCodePlugin: () => installClaudeCodePlugin,
  optInClaudeCodeHookEvents: () => optInClaudeCodeHookEvents,
  runClaudeHook: () => runClaudeHook,
  summarizeClaudeCodeChecks: () => summarizeClaudeCodeChecks,
  uninstallClaudeCode: () => uninstallClaudeCode,
  uninstallClaudeCodePlugin: () => uninstallClaudeCodePlugin,
  verifyClaudeCodeInstall: () => verifyClaudeCodeInstall,
  verifyClaudeCodePlugin: () => verifyClaudeCodePlugin
});
var HOOK_LOG_PATH;
var init_claude_code2 = __esm({
  "ts/src/runtime/claude-code/index.ts"() {
    "use strict";
    init_claude_code();
    init_hook_handler();
    init_install2();
    init_plugin2();
    init_governance_matrix();
    init_doctor();
    init_hook_log();
    HOOK_LOG_PATH = makeHookLog("claude-code").path;
  }
});

// ts/src/runtime/cursor/config.ts
import fs9 from "fs";
import path13 from "path";
function resolveConfigDir2(startDir = process.cwd()) {
  let cur = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path13.join(cur, ".cursor-hooks");
    if (fs9.existsSync(path13.join(candidate, "config.json"))) {
      return candidate;
    }
    const parent = path13.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path13.join(startDir, ".cursor-hooks");
}
function loadConfig2() {
  const fileConfig = loadConfigFile2();
  const envConfig = loadEnvFile2();
  const get = (key, fileFallback) => {
    if (process.env[key] !== void 0) return process.env[key];
    if (fileConfig[key] !== void 0) return fileConfig[key];
    if (envConfig[key] !== void 0) return envConfig[key];
    return fileFallback ?? "";
  };
  const skipRaw = get("SKIP_ACTIVITY_TYPES");
  const skipList = skipRaw ? skipRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const coreUrl = process.env.OPENBOX_CORE_URL ?? fileConfig.OPENBOX_CORE_URL ?? envConfig.OPENBOX_CORE_URL ?? "";
  return {
    openboxApiKey: get("OPENBOX_API_KEY"),
    openboxEndpoint: coreUrl,
    agentIdentity: resolveAgentIdentity({
      OPENBOX_AGENT_DID: get("OPENBOX_AGENT_DID") || void 0,
      OPENBOX_AGENT_PRIVATE_KEY: get("OPENBOX_AGENT_PRIVATE_KEY") || void 0
    }),
    governancePolicy: get("GOVERNANCE_POLICY", "fail_open"),
    governanceTimeout: parseInt(get("GOVERNANCE_TIMEOUT", "15"), 10) || 15,
    activityType: get("ACTIVITY_TYPE", "CursorIDE"),
    sessionDir: get("SESSION_DIR", path13.join(CONFIG_DIR2, "sessions")),
    logFile: get("LOG_FILE", path13.join(CONFIG_DIR2, "hook.log")) || null,
    verbose: get("VERBOSE") === "true" || get("VERBOSE") === "1",
    dryRun: get("DRY_RUN") === "true" || get("DRY_RUN") === "1",
    hitlEnabled: get("HITL_ENABLED", "true") !== "false",
    hitlPollInterval: parseInt(get("HITL_POLL_INTERVAL", "5"), 10) || 5,
    hitlMaxWait: parseInt(get("HITL_MAX_WAIT", "300"), 10) || 300,
    approvalMode: get("APPROVAL_MODE", "remote").toLowerCase() === "inline" ? "inline" : "remote",
    approvalSocketPath: get("OPENBOX_APPROVAL_SOCKET") || null,
    taskQueue: get("TASK_QUEUE", "cursor-hooks"),
    sendStartEvent: get("SEND_START_EVENT", "true") !== "false",
    sendActivityStartEvent: get("SEND_ACTIVITY_START_EVENT", "true") !== "false",
    maxBodySize: get("MAX_BODY_SIZE") ? parseInt(get("MAX_BODY_SIZE"), 10) || null : null,
    skipActivityTypes: skipList,
    testDriftResponse: get("TEST_DRIFT_RESPONSE") || null
  };
}
function getConfigDir2() {
  return CONFIG_DIR2;
}
var CONFIG_DIR2, CONFIG_FILE2, ENV_FILE2, loadConfigFile2, loadEnvFile2;
var init_config4 = __esm({
  "ts/src/runtime/cursor/config.ts"() {
    "use strict";
    init_host_config();
    init_agent_identity();
    CONFIG_DIR2 = resolveConfigDir2();
    CONFIG_FILE2 = path13.join(CONFIG_DIR2, "config.json");
    ENV_FILE2 = path13.join(CONFIG_DIR2, ".env");
    loadConfigFile2 = () => loadJsonConfig(CONFIG_FILE2);
    loadEnvFile2 = () => loadDotenv(ENV_FILE2);
  }
});

// ts/src/runtime/cursor/session-resolver.ts
async function resolveSession2(env, cfg) {
  return resolveSessionByKey(env.conversation_id, cfg);
}
function markHalted2(conversationId, cfg) {
  markHaltedByKey(conversationId, cfg);
}
function clearSession2(conversationId, cfg) {
  clearSessionByKey(conversationId, cfg);
}
var init_session_resolver2 = __esm({
  "ts/src/runtime/cursor/session-resolver.ts"() {
    "use strict";
    init_resolver();
  }
});

// ts/src/approvals/socket-client.ts
import * as net from "net";
import * as path14 from "path";
function defaultApprovalSocketPath() {
  return path14.join(openboxDataRoot(), "run", "openbox.sock");
}
function connectApprovalSocket(socketPath = defaultApprovalSocketPath()) {
  return new Promise((resolve3) => {
    const socket = net.createConnection({ path: socketPath });
    let settled = false;
    const onConnect = () => {
      if (settled) return;
      settled = true;
      resolve3(buildHandle(socket));
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
      }
      resolve3(null);
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
      resolve3(null);
    }, 200);
  });
}
function buildHandle(socket) {
  let buffer = "";
  const listenersByGeid = /* @__PURE__ */ new Map();
  const dispatch3 = (geid, r) => {
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
          dispatch3(msg.governance_event_id, {
            kind: "decision",
            decision: msg.decision
          });
        }
      } catch {
      }
    }
  });
  const drainAll = (r) => {
    for (const [geid] of [...listenersByGeid]) dispatch3(geid, r);
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
    awaitDecision: (geid, deadlineMs) => new Promise((resolve3) => {
      const list = listenersByGeid.get(geid) ?? [];
      list.push(resolve3);
      listenersByGeid.set(geid, list);
      if (deadlineMs > 0) {
        setTimeout(() => {
          const cur = listenersByGeid.get(geid);
          if (!cur) return;
          const idx = cur.indexOf(resolve3);
          if (idx === -1) return;
          cur.splice(idx, 1);
          if (cur.length === 0) listenersByGeid.delete(geid);
          resolve3({ kind: "timeout" });
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
var APPROVAL_SOCKET_PATH;
var init_socket_client = __esm({
  "ts/src/approvals/socket-client.ts"() {
    "use strict";
    init_os_paths();
    APPROVAL_SOCKET_PATH = defaultApprovalSocketPath();
  }
});

// ts/src/runtime/cursor/activity-types.ts
var init_activity_types2 = __esm({
  "ts/src/runtime/cursor/activity-types.ts"() {
    "use strict";
    init_events();
  }
});

// ts/src/runtime/cursor/mappers/prompt.ts
async function handleBeforeSubmitPrompt(env, session, cfg) {
  const prompt = (env.prompt ?? "").trim();
  if (!prompt) return void 0;
  void session.activity(EVENT.SIGNAL, "user_prompt", {
    input: [stampSource({ prompt, event_category: "agent_goal" }, "cursor")],
    signalName: "user_prompt",
    signalArgs: prompt,
    spans: [buildSpan("cursor", "llm", { prompt })]
  }).catch(() => void 0);
  const payload = buildBeforeSubmitPromptPayload(env);
  const span = buildSpan("cursor", "llm", { prompt });
  const verdict = await session.activity(
    EVENT.START,
    BEFORE_SUBMIT_PROMPT_ACTIVITY_TYPE,
    { input: [stampSource(payload, "cursor")], spans: [span] }
  );
  if (verdict.arm === "halt") markHalted2(env.conversation_id, cfg);
  return verdict;
}
var init_prompt = __esm({
  "ts/src/runtime/cursor/mappers/prompt.ts"() {
    "use strict";
    init_cursor();
    init_session_resolver2();
    init_activity_types2();
    init_spans();
    init_source();
  }
});

// ts/src/runtime/cursor/dedup.ts
import * as fs10 from "fs";
import * as path15 from "path";
import * as crypto2 from "crypto";
function dedupDir() {
  return path15.join(openboxDataRoot(), "run", "dedup");
}
function ensureDir2() {
  try {
    fs10.mkdirSync(dedupDir(), { recursive: true, mode: 448 });
  } catch {
  }
}
function reapStale() {
  let entries;
  try {
    entries = fs10.readdirSync(dedupDir());
  } catch {
    return;
  }
  const cutoff = Date.now() - TTL_MS;
  for (const name of entries) {
    const p = path15.join(dedupDir(), name);
    try {
      const st = fs10.statSync(p);
      if (st.mtimeMs < cutoff) fs10.unlinkSync(p);
    } catch {
    }
  }
}
function hashKey(raw) {
  return crypto2.createHash("sha1").update(raw).digest("hex").slice(0, 16);
}
function buildActionKey(parts) {
  const ns = parts.generation_id || parts.conversation_id || "no-ns";
  return hashKey(`${ns}:${parts.kind}:${parts.arg}`);
}
function claimAction(key) {
  ensureDir2();
  reapStale();
  const lockPath = path15.join(dedupDir(), key);
  try {
    const fd = fs10.openSync(lockPath, "wx", 384);
    try {
      fs10.writeSync(fd, String(Date.now()));
    } finally {
      fs10.closeSync(fd);
    }
    return { won: true, path: lockPath };
  } catch (err) {
    if (err?.code === "EEXIST") {
      try {
        const st = fs10.statSync(lockPath);
        if (Date.now() - st.mtimeMs > TTL_MS) {
          fs10.unlinkSync(lockPath);
          try {
            const fd = fs10.openSync(lockPath, "wx", 384);
            fs10.closeSync(fd);
            return { won: true, path: lockPath };
          } catch {
            return { won: false, path: lockPath };
          }
        }
      } catch {
      }
      return { won: false, path: lockPath };
    }
    return { won: true, path: lockPath };
  }
}
function publishClaimDecision(claim, decision) {
  if (!claim.won) return;
  const tmp = `${claim.path}.tmp.${process.pid}`;
  try {
    fs10.writeFileSync(
      tmp,
      JSON.stringify({ ts: Date.now(), arm: decision.arm, reason: decision.reason }),
      { mode: 384 }
    );
    fs10.renameSync(tmp, claim.path);
    setTimeout(() => {
      try {
        fs10.unlinkSync(claim.path);
      } catch {
      }
    }, PUBLISH_GRACE_MS);
  } catch {
    try {
      fs10.unlinkSync(tmp);
    } catch {
    }
  }
}
function sleep2(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function readDecisionOnce(lockPath) {
  let content;
  try {
    content = fs10.readFileSync(lockPath, "utf-8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed.arm !== "string") return null;
  return {
    arm: parsed.arm,
    reason: typeof parsed.reason === "string" ? parsed.reason : ""
  };
}
async function awaitClaimDecision(claim, deadlineMs = DEFAULT_AWAIT_TIMEOUT_MS) {
  if (claim.won) return null;
  const wait = Number.isFinite(deadlineMs) && deadlineMs > 0 ? Math.min(deadlineMs, DEFAULT_AWAIT_TIMEOUT_MS) : DEFAULT_AWAIT_TIMEOUT_MS;
  const deadline = Date.now() + wait;
  const first = readDecisionOnce(claim.path);
  if (first) return first;
  while (Date.now() < deadline) {
    await sleep2(POLL_INTERVAL_MS);
    const decision = readDecisionOnce(claim.path);
    if (decision) return decision;
  }
  return null;
}
function isFileDeleteCommand(command) {
  if (!command) return false;
  return RM_PATTERN.test(command);
}
var TTL_MS, POLL_INTERVAL_MS, DEFAULT_AWAIT_TIMEOUT_MS, PUBLISH_GRACE_MS, RM_PATTERN;
var init_dedup = __esm({
  "ts/src/runtime/cursor/dedup.ts"() {
    "use strict";
    init_os_paths();
    TTL_MS = 60 * 60 * 1e3;
    POLL_INTERVAL_MS = 100;
    DEFAULT_AWAIT_TIMEOUT_MS = 60 * 60 * 1e3;
    PUBLISH_GRACE_MS = 800;
    RM_PATTERN = /\b(rm|unlink|rmdir|shred)\b/;
  }
});

// ts/src/runtime/cursor/mappers/shell.ts
async function handleBeforeShellExecution(env, session, cfg) {
  const command = env.command ?? "";
  if (!command) return void 0;
  const key = buildActionKey({
    generation_id: env.generation_id,
    conversation_id: env.conversation_id,
    kind: "shell",
    arg: command
  });
  const claim = claimAction(key);
  if (!claim.won) {
    const decision = await awaitClaimDecision(claim, cfg.hitlMaxWait * 1e3);
    if (!decision) return void 0;
    if (decision.arm === "allow" || decision.arm === "constrain") return void 0;
    if (decision.arm === "halt") markHalted2(env.conversation_id, cfg);
    return { arm: decision.arm, reason: decision.reason, riskScore: 0 };
  }
  const payload = buildBeforeShellExecutionPayload(env);
  const isDelete = isFileDeleteCommand(command);
  const activityType = isDelete ? "FileDelete" : BEFORE_SHELL_EXECUTION_ACTIVITY_TYPE;
  const span = buildSpan("cursor", isDelete ? "file_delete" : "shell", {
    command,
    cwd: env.cwd
  });
  if (isDelete) payload.event_category = "file_delete";
  try {
    const verdict = await session.activity(EVENT.START, activityType, {
      input: [stampSource(payload, "cursor")],
      spans: [span]
    });
    publishClaimDecision(claim, { arm: verdict.arm, reason: verdict.reason ?? "" });
    if (verdict.arm === "halt") markHalted2(env.conversation_id, cfg);
    return verdict;
  } catch (err) {
    publishClaimDecision(claim, { arm: "block", reason: "[OpenBox] gate failed" });
    throw err;
  }
}
var init_shell = __esm({
  "ts/src/runtime/cursor/mappers/shell.ts"() {
    "use strict";
    init_cursor();
    init_session_resolver2();
    init_activity_types2();
    init_spans();
    init_dedup();
    init_source();
  }
});

// ts/src/runtime/cursor/side-effects.ts
import * as fs11 from "fs";
var sideEffects2;
var init_side_effects2 = __esm({
  "ts/src/runtime/cursor/side-effects.ts"() {
    "use strict";
    init_skip_patterns();
    sideEffects2 = {
      /** File read for cursor's preToolUse Read mapping. Same skip-pattern
       *  filter as claude-code; cursor's `beforeReadFile` already inlines
       *  content into the envelope so this is only used for preToolUse. */
      readFile(input) {
        if (typeof input !== "string" || !input) return "";
        if (isSkipped(input)) return "";
        try {
          return fs11.existsSync(input) ? fs11.readFileSync(input, "utf-8") : "";
        } catch {
          return "";
        }
      },
      /** JSON-stringify pass-through (no truncation; cursor's beforeMCPExecution
       *  payload is bounded by the originating tool call, not by
       *  agent-streamed output). */
      stringify(input) {
        return typeof input === "string" ? input : JSON.stringify(input ?? {});
      },
      /** Extract `text`-typed entries from an MCP `{ content: [{ type, text }] }`
       *  response. Falls back to JSON of the raw value on shape mismatch so
       *  output guardrails always have *something* to scan. */
      extractMcpText(input) {
        if (typeof input === "string") {
          try {
            const parsed = JSON.parse(input);
            if (Array.isArray(parsed.content)) {
              return parsed.content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n");
            }
            return JSON.stringify(parsed);
          } catch {
            return input;
          }
        }
        return JSON.stringify(input ?? {});
      }
    };
  }
});

// ts/src/runtime/cursor/mappers/mcp.ts
async function handleBeforeMCPExecution(env, session, cfg) {
  const toolName = env.tool_name ?? "";
  if (!toolName) return void 0;
  const payload = buildBeforeMCPExecutionPayload(env, sideEffects2);
  const span = buildSpan("cursor", "mcp", { tool_name: toolName, tool_input: env.tool_input });
  const verdict = await session.activity(
    EVENT.START,
    BEFORE_MCPEXECUTION_ACTIVITY_TYPE,
    { input: [stampSource(payload, "cursor")], spans: [span] }
  );
  if (verdict.arm === "halt") markHalted2(env.conversation_id, cfg);
  return verdict;
}
var init_mcp2 = __esm({
  "ts/src/runtime/cursor/mappers/mcp.ts"() {
    "use strict";
    init_cursor();
    init_session_resolver2();
    init_activity_types2();
    init_side_effects2();
    init_spans();
    init_source();
  }
});

// ts/src/runtime/cursor/mappers/file-read.ts
async function handleBeforeReadFile(env, session, cfg) {
  const filePath = env.file_path ?? "";
  if (!filePath) return void 0;
  if (isSkipped(filePath)) return void 0;
  if (isInsideAnyRoot(filePath, env.workspace_roots, env.cwd)) return void 0;
  const key = buildActionKey({
    generation_id: env.generation_id,
    conversation_id: env.conversation_id,
    kind: "read",
    arg: filePath
  });
  const claim = claimAction(key);
  if (!claim.won) {
    const decision = await awaitClaimDecision(claim, cfg.hitlMaxWait * 1e3);
    if (!decision) return void 0;
    if (decision.arm === "allow" || decision.arm === "constrain") return void 0;
    if (decision.arm === "halt") markHalted2(env.conversation_id, cfg);
    return { arm: decision.arm, reason: decision.reason, riskScore: 0 };
  }
  const payload = buildBeforeReadFilePayload(env);
  const span = buildSpan("cursor", "file_read", { file_path: filePath });
  try {
    const verdict = await session.activity(
      EVENT.START,
      BEFORE_READ_FILE_ACTIVITY_TYPE,
      { input: [stampSource(payload, "cursor")], spans: [span] }
    );
    publishClaimDecision(claim, { arm: verdict.arm, reason: verdict.reason ?? "" });
    if (verdict.arm === "halt") markHalted2(env.conversation_id, cfg);
    return verdict;
  } catch (err) {
    publishClaimDecision(claim, { arm: "block", reason: "[OpenBox] gate failed" });
    throw err;
  }
}
async function handleBeforeTabFileRead(env, session, cfg) {
  const filePath = env.file_path ?? "";
  if (!filePath) return void 0;
  if (isSkipped(filePath)) return void 0;
  if (isInsideAnyRoot(filePath, env.workspace_roots, env.cwd) && !isSensitivePath(filePath)) {
    return void 0;
  }
  const payload = buildBeforeTabFileReadPayload(env);
  const span = buildSpan("cursor", "file_read", { file_path: filePath });
  const verdict = await session.activity(
    EVENT.START,
    BEFORE_TAB_FILE_READ_ACTIVITY_TYPE,
    { input: [stampSource(payload, "cursor")], spans: [span] }
  );
  if (verdict.arm === "halt") markHalted2(env.conversation_id, cfg);
  return verdict;
}
var init_file_read = __esm({
  "ts/src/runtime/cursor/mappers/file-read.ts"() {
    "use strict";
    init_cursor();
    init_session_resolver2();
    init_activity_types2();
    init_spans();
    init_skip_patterns();
    init_dedup();
    init_source();
  }
});

// ts/src/runtime/cursor/mappers/pre-tool-use.ts
async function handlePreToolUse2(env, session, cfg) {
  const toolName = env.tool_name ?? "";
  const baseActivity = PRE_TOOL_USE_ROUTING[toolName];
  if (!baseActivity) return void 0;
  const toolInput = env.tool_input ?? {};
  const filePath = toolInput.file_path ?? toolInput.filePath ?? "";
  const command = toolInput.command ?? "";
  if (filePath && isSkipped(filePath)) return void 0;
  if (filePath && (toolName === "Read" || toolName === "Write") && isInsideAnyRoot(filePath, env.workspace_roots, env.cwd)) {
    return void 0;
  }
  const claimKind = toolName === "Shell" ? "shell" : toolName === "Read" ? "read" : toolName === "Write" ? "write" : null;
  const claim = claimKind ? claimAction(buildActionKey({
    generation_id: env.generation_id,
    conversation_id: env.conversation_id,
    kind: claimKind,
    arg: claimKind === "shell" ? command : filePath
  })) : null;
  if (claim && !claim.won) {
    const decision = await awaitClaimDecision(claim, cfg.hitlMaxWait * 1e3);
    if (!decision) return void 0;
    if (decision.arm === "allow" || decision.arm === "constrain") return void 0;
    if (decision.arm === "halt") markHalted2(env.conversation_id, cfg);
    return { arm: decision.arm, reason: decision.reason, riskScore: 0 };
  }
  const payload = buildPreToolUsePayload(env, toolName, sideEffects2);
  const override = applyActivityVariant(PRE_TOOL_USE_VARIANTS, toolName, env);
  const activityType = override?.activityType ?? baseActivity;
  if (override?.eventCategory) payload.event_category = override.eventCategory;
  const spanType = override?.activityType === "FileDelete" ? "file_delete" : toolName === "Read" ? "file_read" : toolName === "Write" ? "file_write" : "shell";
  const span = buildSpan("cursor", spanType, {
    file_path: filePath || void 0,
    command: toolInput.command || void 0,
    cwd: toolInput.cwd || env.cwd || void 0
  });
  try {
    const verdict = await session.activity(EVENT.START, activityType, {
      input: [stampSource(payload, "cursor")],
      spans: [span]
    });
    if (claim?.won) {
      publishClaimDecision(claim, { arm: verdict.arm, reason: verdict.reason ?? "" });
    }
    if (verdict.arm === "halt") markHalted2(env.conversation_id, cfg);
    return verdict;
  } catch (err) {
    if (claim?.won) {
      publishClaimDecision(claim, { arm: "block", reason: "[OpenBox] gate failed" });
    }
    throw err;
  }
}
var init_pre_tool_use2 = __esm({
  "ts/src/runtime/cursor/mappers/pre-tool-use.ts"() {
    "use strict";
    init_cursor();
    init_session_resolver2();
    init_activity_types2();
    init_skip_patterns();
    init_side_effects2();
    init_spans();
    init_dedup();
    init_source();
  }
});

// ts/src/runtime/cursor/mappers/mcp-response.ts
async function handleAfterMCPExecution(_env, _session, _cfg) {
  return void 0;
}
var init_mcp_response = __esm({
  "ts/src/runtime/cursor/mappers/mcp-response.ts"() {
    "use strict";
  }
});

// ts/src/runtime/cursor/mappers/subagent.ts
async function handleSubagentStart2(env, session, cfg) {
  const payload = buildSubagentStartPayload(env);
  const verdict = await session.activity(
    EVENT.START,
    SUBAGENT_START_ACTIVITY_TYPE,
    { input: [stampSource(payload, "cursor")] }
  );
  if (verdict.arm === "halt") markHalted2(env.conversation_id, cfg);
  return verdict;
}
var init_subagent2 = __esm({
  "ts/src/runtime/cursor/mappers/subagent.ts"() {
    "use strict";
    init_cursor();
    init_session_resolver2();
    init_activity_types2();
    init_source();
  }
});

// ts/src/runtime/cursor/mappers/observe.ts
function handleAfterAgentResponse(_env, _session, _cfg) {
  return Promise.resolve(void 0);
}
function handleAfterAgentThought(_env, _session, _cfg) {
  return Promise.resolve(void 0);
}
function handleAfterShellExecution(_env, _session, _cfg) {
  return Promise.resolve(void 0);
}
function handleAfterFileEdit(_env, _session, _cfg) {
  return Promise.resolve(void 0);
}
async function handleSessionStart2(_env, session, _cfg) {
  try {
    await session.workflowStarted();
  } catch {
  }
  return void 0;
}
async function handleStop2(env, session, cfg) {
  try {
    await session.workflowCompleted();
  } catch {
  }
  clearSession2(env.conversation_id, cfg);
  return void 0;
}
async function handleSessionEnd2(env, session, cfg) {
  try {
    await session.workflowCompleted();
  } catch {
  }
  clearSession2(env.conversation_id, cfg);
  return void 0;
}
function handleAfterTabFileEdit(_env, _session, _cfg) {
  return Promise.resolve(void 0);
}
function handlePreCompact2(_env, _session, _cfg) {
  return Promise.resolve(void 0);
}
function handleSubagentStop2(_env, _session, _cfg) {
  return Promise.resolve(void 0);
}
var init_observe = __esm({
  "ts/src/runtime/cursor/mappers/observe.ts"() {
    "use strict";
    init_session_resolver2();
  }
});

// ts/src/runtime/cursor/hook-handler.ts
var hook_handler_exports2 = {};
__export(hook_handler_exports2, {
  runCursorHook: () => runCursorHook
});
function logged2(event, verdictKind, fn) {
  return async (env, s) => {
    const start = Date.now();
    try {
      const out = await fn(env, s);
      hookLog2.record({
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        event,
        verdict_kind: verdictKind,
        took_ms: Date.now() - start
      });
      return out;
    } catch (err) {
      hookLog2.record({
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        event,
        verdict_kind: verdictKind,
        took_ms: Date.now() - start,
        error: String(err?.message ?? err)
      });
      throw err;
    }
  };
}
async function runCursorHook() {
  const cfg = loadConfig2();
  if (!process.env.OPENBOX_HOME) {
    process.env.OPENBOX_HOME = getConfigDir2();
  }
  createLogger("cursor").initLogger(cfg);
  if (!cfg.openboxApiKey) {
    if (cfg.verbose) console.error("[openbox cursor] no OPENBOX_API_KEY set, passing through");
    process.exit(0);
  }
  const dryRun = cfg.dryRun;
  const core = new OpenBoxCoreClient({
    apiKey: cfg.openboxApiKey,
    apiUrl: cfg.openboxEndpoint,
    agentIdentity: cfg.agentIdentity,
    timeoutMs: cfg.governanceTimeout * 1e3
  });
  const approvalMaxWaitMs = Math.min(
    Math.max(1, cfg.hitlMaxWait) * 1e3,
    36e5
  );
  let cachedAgentId;
  const resolveAgentId = async () => {
    if (cachedAgentId !== void 0) return cachedAgentId;
    try {
      const v = await core.validateApiKey();
      cachedAgentId = v?.agent_id;
    } catch {
      cachedAgentId = "";
    }
    return cachedAgentId || void 0;
  };
  let socketHandle;
  const ensureSocket = async () => {
    if (process.env.OPENBOX_DISABLE_APPROVAL_SOCKET === "1") return null;
    if (socketHandle !== void 0) return socketHandle;
    socketHandle = await connectApprovalSocket(cfg.approvalSocketPath ?? void 0);
    return socketHandle;
  };
  const OBSERVE_ONLY = /* @__PURE__ */ new Set([
    "afterAgentResponse",
    "afterAgentThought",
    "afterShellExecution",
    "afterFileEdit",
    "afterMCPExecution",
    "afterTabFileEdit",
    "postToolUse",
    "postToolUseFailure",
    "preCompact",
    "sessionStart",
    "sessionEnd",
    "stop",
    "subagentStop"
  ]);
  await createCursorAdapter({
    core,
    resolveSession: (env) => resolveSession2(env, cfg),
    approvalMaxWaitMs,
    // When APPROVAL_MODE=inline, the SDK skips its internal poll loop
    // and the adapter renders permission:'ask' so Cursor's native
    // permission dialog pops in the IDE on every require_approval.
    // External approval clients such as the dashboard, mobile app,
    // or editor extension can still resolve the backend row, but the
    // hook does not wait.
    inlineApproval: cfg.approvalMode === "inline",
    onPendingApproval: async (info2, env) => {
      if (OBSERVE_ONLY.has(String(env.hook_event_name ?? ""))) return;
      const conn = await ensureSocket();
      if (!conn) return;
      const agentId = await resolveAgentId();
      const toolSummary = env.tool_name ? `${env.tool_name}(${typeof env.tool_input === "string" ? env.tool_input : JSON.stringify(env.tool_input ?? {})})` : void 0;
      const summary2 = env.command ?? env.file_path ?? toolSummary ?? env.prompt ?? "";
      conn.notifyPending({
        governance_event_id: info2.governanceEventId ?? info2.approvalId,
        agent_id: agentId ?? "",
        hook_event_name: String(env.hook_event_name ?? ""),
        source: "cursor",
        summary: summary2.slice(0, 200),
        reason: info2.reason ?? "",
        expires_at: info2.expiresAt ?? new Date(Date.now() + 30 * 6e4).toISOString()
      });
    },
    // Out-of-band decision channel. Returning a decision here makes
    // the SDK's pollApproval loop wake immediately and run one
    // confirmatory backend poll, instead of waiting for its next
    // exponential-backoff tick (default 500ms-5s). Approving in the
    // extension toast resolves the hook subprocess in O(1 poll RTT)
    // instead of O(poll-cycle).
    awaitExternalDecision: async (info2, env) => {
      if (OBSERVE_ONLY.has(String(env.hook_event_name ?? ""))) return void 0;
      const conn = await ensureSocket();
      if (!conn) return void 0;
      const geid = info2.governanceEventId ?? info2.approvalId;
      const r = await conn.awaitDecision(geid, approvalMaxWaitMs);
      return r.kind === "decision" ? r.decision : void 0;
    },
    onApprovalResolved: () => {
      try {
        socketHandle?.close();
      } catch {
      }
    },
    handlers: {
      beforeSubmitPrompt: logged2(
        "beforeSubmitPrompt",
        "permission",
        async (env, s) => dryRun ? void 0 : handleBeforeSubmitPrompt(env, s, cfg)
      ),
      beforeShellExecution: logged2(
        "beforeShellExecution",
        "permission",
        async (env, s) => dryRun ? void 0 : handleBeforeShellExecution(env, s, cfg)
      ),
      beforeMCPExecution: logged2(
        "beforeMCPExecution",
        "permission",
        async (env, s) => dryRun ? void 0 : handleBeforeMCPExecution(env, s, cfg)
      ),
      beforeReadFile: logged2(
        "beforeReadFile",
        "permission",
        async (env, s) => dryRun ? void 0 : handleBeforeReadFile(env, s, cfg)
      ),
      preToolUse: logged2(
        "preToolUse",
        "permission",
        async (env, s) => dryRun ? void 0 : handlePreToolUse2(env, s, cfg)
      ),
      afterMCPExecution: logged2(
        "afterMCPExecution",
        "observe",
        async (env, s) => dryRun ? void 0 : handleAfterMCPExecution(env, s, cfg)
      ),
      afterAgentResponse: logged2(
        "afterAgentResponse",
        "observe",
        async (env, s) => dryRun ? void 0 : handleAfterAgentResponse(env, s, cfg)
      ),
      afterAgentThought: logged2(
        "afterAgentThought",
        "observe",
        async (env, s) => dryRun ? void 0 : handleAfterAgentThought(env, s, cfg)
      ),
      afterShellExecution: logged2(
        "afterShellExecution",
        "observe",
        async (env, s) => dryRun ? void 0 : handleAfterShellExecution(env, s, cfg)
      ),
      afterFileEdit: logged2(
        "afterFileEdit",
        "observe",
        async (env, s) => dryRun ? void 0 : handleAfterFileEdit(env, s, cfg)
      ),
      sessionStart: logged2(
        "sessionStart",
        "none",
        async (env, s) => dryRun ? void 0 : handleSessionStart2(env, s, cfg)
      ),
      stop: logged2(
        "stop",
        "none",
        async (env, s) => dryRun ? void 0 : handleStop2(env, s, cfg)
      ),
      // postToolUse / postToolUseFailure carry no payload per the
      // spec (@noPayload). We log them so the OutputChannel tail
      // shows the full lifecycle, but there's nothing to map.
      postToolUse: logged2("postToolUse", "observe", async () => void 0),
      postToolUseFailure: logged2("postToolUseFailure", "observe", async () => void 0),
      // Tab-driven + lifecycle + subagent coverage.
      beforeTabFileRead: logged2(
        "beforeTabFileRead",
        "permission",
        async (env, s) => dryRun ? void 0 : handleBeforeTabFileRead(env, s, cfg)
      ),
      afterTabFileEdit: logged2(
        "afterTabFileEdit",
        "observe",
        async (env, s) => dryRun ? void 0 : handleAfterTabFileEdit(env, s, cfg)
      ),
      sessionEnd: logged2(
        "sessionEnd",
        "none",
        async (env, s) => dryRun ? void 0 : handleSessionEnd2(env, s, cfg)
      ),
      preCompact: logged2(
        "preCompact",
        "observe",
        async (env, s) => dryRun ? void 0 : handlePreCompact2(env, s, cfg)
      ),
      subagentStart: logged2(
        "subagentStart",
        "permission",
        async (env, s) => dryRun ? void 0 : handleSubagentStart2(env, s, cfg)
      ),
      subagentStop: logged2(
        "subagentStop",
        "observe",
        async (env, s) => dryRun ? void 0 : handleSubagentStop2(env, s, cfg)
      )
    }
  }).run();
}
var hookLog2;
var init_hook_handler2 = __esm({
  "ts/src/runtime/cursor/hook-handler.ts"() {
    "use strict";
    init_cursor();
    init_core_client2();
    init_config4();
    init_logger();
    init_session_resolver2();
    init_hook_log();
    init_socket_client();
    init_prompt();
    init_shell();
    init_mcp2();
    init_file_read();
    init_pre_tool_use2();
    init_mcp_response();
    init_subagent2();
    init_observe();
    hookLog2 = makeHookLog("cursor");
  }
});

// ts/src/runtime/cursor/index.ts
var cursor_exports = {};
__export(cursor_exports, {
  HOOK_LOG_PATH: () => HOOK_LOG_PATH2,
  createCursorAdapter: () => createCursorAdapter,
  cursorPluginTargetDir: () => cursorPluginTargetDir,
  exportCursorPlugin: () => exportCursorPlugin,
  installCursorPlugin: () => installCursorPlugin,
  runCursorHook: () => runCursorHook,
  uninstallCursorPlugin: () => uninstallCursorPlugin,
  verifyCursorInstall: () => verifyCursorInstall,
  verifyCursorPlugin: () => verifyCursorPlugin
});
var HOOK_LOG_PATH2;
var init_cursor2 = __esm({
  "ts/src/runtime/cursor/index.ts"() {
    "use strict";
    init_cursor();
    init_hook_handler2();
    init_install();
    init_plugin();
    init_hook_log();
    HOOK_LOG_PATH2 = makeHookLog("cursor").path;
  }
});

// ts/src/cli/index.ts
import { readFileSync as readFileSync14, realpathSync } from "fs";
import { fileURLToPath as fileURLToPath3 } from "url";
import { Command } from "commander";

// ts/src/cli/config.ts
init_client2();
init_core_client2();
init_env();

// ts/src/cli/exit-codes.ts
var EXIT = {
  /** Success. */
  OK: 0,
  /** Generic / uncategorized failure. Last resort. */
  GENERIC: 1,
  /** Usage / argv validation error. Commander's default for missing
   *  required option, unknown flag, etc. We follow that convention. */
  USAGE: 2,
  /** Auth failure; 401, 403, missing tokens, expired session. */
  AUTH: 3,
  /** Required feature flag disabled for the active env. */
  FEATURE_DISABLED: 4,
  /** Resource not found; 404. */
  NOT_FOUND: 5,
  /** Conflict; 409 (already-exists, version mismatch, etc.). */
  CONFLICT: 6,
  /** Rate-limited; 429. Caller MAY retry with backoff. */
  RATE_LIMIT: 7,
  /** Server-side failure; 5xx. Caller MAY retry. */
  SERVER: 8,
  /** Network / transport failure (DNS, ECONNREFUSED, timeout). Retryable. */
  NETWORK: 9
};
function exitCodeForStatus(status) {
  if (status === 401) return EXIT.AUTH;
  if (status === 403) return EXIT.AUTH;
  if (status === 404) return EXIT.NOT_FOUND;
  if (status === 409) return EXIT.CONFLICT;
  if (status === 429) return EXIT.RATE_LIMIT;
  if (status >= 500) return EXIT.SERVER;
  return EXIT.GENERIC;
}
function bailWith(code) {
  process.exit(code);
}

// ts/src/cli/config.ts
init_output();
init_file_tokens();
function loadPermissions(activeApiKey) {
  const store = readTokenStore();
  if (activeApiKey && store.apiKey !== activeApiKey && (process.env.OPENBOX_BACKEND_API_KEY || process.env.OPENBOX_API_KEY)) {
    return [];
  }
  return store.permissions ?? [];
}
function resolveTimeoutMs() {
  const raw = process.env.OPENBOX_TIMEOUT_MS;
  if (!raw) return void 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return void 0;
  return n;
}
function getClient() {
  const { apiUrl } = resolveConnection();
  const apiKey = loadApiKey();
  if (!apiKey) {
    error("no X-API-Key configured", {
      help: "mint a key in the dashboard FE (Organization \u2192 API Keys), then:\n  openbox connect --api-url <url> --core-url <url> --api-key <key>\nor save a key for the active connection with:\n  openbox auth set-api-key\nor set OPENBOX_BACKEND_API_KEY=<key> in the environment"
    });
    bailWith(EXIT.AUTH);
  }
  const cachedPerms = loadPermissions(apiKey);
  return new OpenBoxClient({
    apiUrl,
    apiKey,
    permissions: cachedPerms.length > 0 ? cachedPerms : void 0,
    timeoutMs: resolveTimeoutMs()
  });
}
function validateAgentRuntimeKeyFormat(key) {
  const result = validateApiKeyFormat(key);
  if (result === true) return;
  const looksLikeAgentToken = /^[a-f0-9]{32,}$/i.test(key);
  const hint = looksLikeAgentToken ? "this looks like an agent attestation token, not a runtime API key. Mint or recover a runtime key from the dashboard/backend API." : "get a runtime key from the dashboard/backend API and set OPENBOX_API_KEY.";
  error(
    "invalid OPENBOX_API_KEY format: must start with 'obx_live_' or 'obx_test_'.",
    { hint }
  );
  bailWith(EXIT.AUTH);
}
function getCoreClient() {
  const apiKey = process.env.OPENBOX_API_KEY || "";
  if (!apiKey) {
    error("no OPENBOX_API_KEY found", {
      help: "set it in your environment"
    });
    bailWith(EXIT.AUTH);
  }
  validateAgentRuntimeKeyFormat(apiKey);
  const { coreUrl } = resolveConnection();
  return new OpenBoxCoreClient({
    apiUrl: coreUrl,
    apiKey,
    agentIdentity: resolveAgentIdentity(),
    timeoutMs: resolveTimeoutMs()
  });
}

// ts/src/cli/env-source.ts
init_config();
function applyEnvSource() {
  applyConfigToProcessEnv();
}

// ts/src/cli/permissions.ts
var COMMAND_PERMISSIONS = {};
function missingPermissions(required, have) {
  return required.filter((permission) => !have.includes(permission));
}

// ts/src/validators/index.ts
init_output();
var ValidationError = class extends Error {
  constructor(rule, message, fix, reference) {
    super(message);
    this.rule = rule;
    this.fix = fix;
    this.reference = reference;
    this.name = "ValidationError";
  }
  rule;
  fix;
  reference;
};
function reportAndExit(err) {
  if (err instanceof Error && err.name === "DestructiveConfirmRequiredError") {
    error(err.message);
    process.exit(EXIT.USAGE);
  }
  if (err instanceof ValidationError) {
    error(err.message, {
      help: err.fix,
      see: err.reference
    });
    process.exit(EXIT.USAGE);
  }
  const apiErr = err;
  if (apiErr && (apiErr.name === "OpenBoxApiError" || apiErr.name === "CoreApiError") && typeof apiErr.status === "number") {
    const detail = extractApiErrorDetail(apiErr.body);
    const hint = hintForDetail(detail) ?? hintForStatus(apiErr.status);
    error(apiErr.message ?? "request failed", {
      detail: detail ?? void 0,
      hint: hint ?? void 0
    });
    process.exit(exitCodeForStatus(apiErr.status));
  }
  const code = err.code;
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT" || code === "ECONNRESET" || code === "UND_ERR_SOCKET" || code === "UND_ERR_CONNECT_TIMEOUT") {
    error(`network: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(EXIT.NETWORK);
  }
  error(err instanceof Error ? err.message : String(err));
  process.exit(EXIT.GENERIC);
}
function extractApiErrorDetail(body) {
  if (!body || typeof body !== "object") return null;
  const b = body;
  if (typeof b.message === "string") return b.message;
  if (Array.isArray(b.message)) return b.message.join("; ");
  const data = b.data;
  if (data && typeof data === "object") {
    if (typeof data.message === "string") return data.message;
    if (Array.isArray(data.message)) return data.message.join("; ");
  }
  return null;
}
function hintForDetail(detail) {
  if (!detail) return null;
  if (detail.includes("failed to start workflow: context deadline exceeded")) {
    return "Core's GovernanceWorkflow is hanging on the post-OPA non-ALLOW path (staging-only bug, image 591f66f+). To confirm vs random Temporal flake, send an `evaluateGovernance` payload against the same agent; if the ALLOW path returns <1s but shell/file-write (or any path that triggers a non-ALLOW verdict) hangs 30s, this is the cccff05 cancellation deadlock. Pivot to prod for end-to-end approval testing until the staging fix lands.";
  }
  if (detail.includes("stream terminated by RST_STREAM")) {
    return "Temporal frontend RST_STREAM; cluster degradation rather than a workflow bug. Retry with backoff; if it persists, escalate to staging-infra with the agent_id + governance_event_id.";
  }
  if (detail.includes("OPA unavailable")) {
    return "OPA service was unreachable from core; the fail-closed security policy converted the verdict to BLOCK. The user's actual policy never ran; fix the OPA service and retry.";
  }
  return null;
}
function hintForStatus(status) {
  switch (status) {
    case 401:
      return "Auth failed; X-API-Key missing or revoked. Run `openbox auth set-api-key` (mint a key in the dashboard: Organization \u2192 API Keys) or `openbox doctor` to diagnose.";
    case 403:
      return "Denied by the backend. Either the resource ID doesn't belong to your org/team, or your role lacks the required permission. Check `openbox auth permissions` and `openbox auth profile`.";
    case 404:
      return "Resource not found. Check the ID (agent, team, org, etc.); list resources with the dashboard or `openbox api backend AgentController_getAgents`.";
    case 422:
      return "Validation failed server-side. Inspect the detail field above for the exact field(s) the backend rejected.";
    case 500:
      return "Backend error. If the detail message is opaque, check logs or escalate; this often indicates a bug or downstream service outage.";
    default:
      return null;
  }
}
var UUID_PATTERN_BODY = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
var UUID_RE = new RegExp(`^${UUID_PATTERN_BODY}$`, "i");
var ALL_PERMISSIONS = [
  "write:org",
  "read:org",
  "create:user",
  "read:user",
  "update:user",
  "delete:user",
  "create:agent",
  "read:agent",
  "update:agent",
  "delete:agent",
  "create:team",
  "read:team",
  "update:team",
  "delete:team",
  "create:webhook",
  "read:webhook",
  "update:webhook",
  "delete:webhook",
  "create:api_key",
  "read:api_key",
  "update:api_key",
  "delete:api_key",
  "manage:sso",
  "read:agent_session",
  "manage:agent_session",
  "read:agent_log",
  "create:agent_guardrail",
  "read:agent_guardrail",
  "update:agent_guardrail",
  "delete:agent_guardrail",
  "create:agent_policy",
  "read:agent_policy",
  "update:agent_policy",
  "delete:agent_policy",
  "create:agent_behavior_rule",
  "read:agent_behavior_rule",
  "update:agent_behavior_rule",
  "delete:agent_behavior_rule"
];
var API_KEY_EXCLUDED_PERMISSIONS = /* @__PURE__ */ new Set([
  "create:api_key",
  "read:api_key",
  "update:api_key",
  "delete:api_key",
  "manage:sso"
]);
var API_KEY_GRANTABLE_PERMISSIONS = ALL_PERMISSIONS.filter(
  (p) => !API_KEY_EXCLUDED_PERMISSIONS.has(p)
);

// ts/src/cli/commands/auth.ts
init_non_interactive();
init_output();
function registerAuthCommands(program2) {
  const auth = program2.command("auth").description("Manage the project-local X-API-Key store for backend auth");
  auth.command("set-api-key").description("Save an org-level X-API-Key for the active OpenBox connection").option("-k, --key <key>", "Pass the key directly instead of prompting").action(async (opts) => {
    try {
      let key = opts.key?.trim();
      if (!key) {
        if (isNonInteractive()) {
          error("auth set-api-key needs --key <value> in non-interactive mode.");
          bailWith(EXIT.USAGE);
        }
        const { createInterface } = await import("readline/promises");
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        try {
          key = (await rl.question("Paste org API key for the active OpenBox connection (obx_key_...): ")).trim();
        } finally {
          rl.close();
        }
      }
      if (!key) {
        error("no key provided.");
        bailWith(EXIT.USAGE);
      }
      if (!/^obx_key_[0-9a-f]{48}$/.test(key)) {
        error(
          `key does not match the org-key format (obx_key_<48 hex>); got prefix ${key.slice(0, 12)}...`,
          { help: "mint a key in the dashboard: Organization \u2192 API Keys \u2192 New key" }
        );
        bailWith(EXIT.AUTH);
      }
      saveApiKey(key);
      success("X-API-Key saved.");
    } catch (err) {
      reportAndExit(err);
    }
  });
  auth.command("clear-api-key").description("Remove the saved X-API-Key for the active OpenBox connection").action(() => {
    try {
      const cleared = clearApiKey();
      if (cleared) success("X-API-Key cleared.");
      else info("No X-API-Key was stored.");
    } catch (err) {
      reportAndExit(err);
    }
  });
  auth.command("status").description("Print whether an X-API-Key is saved").action(() => {
    try {
      const apiKey = loadApiKey();
      info(apiKey ? `api-key (${apiKey.slice(0, 12)}...)` : "none");
    } catch (err) {
      reportAndExit(err);
    }
  });
  auth.command("profile").description("Fetch /auth/profile for the active OpenBox connection (orgId, sub, permissions)").action(async () => {
    try {
      const profile = await getClient().getProfile();
      output(profile);
    } catch (err) {
      reportAndExit(err);
    }
  });
  auth.command("permissions").description("Print the authenticated principal's permission set").action(async () => {
    try {
      const profile = await getClient().getProfile();
      output(profile.permissions ?? []);
    } catch (err) {
      reportAndExit(err);
    }
  });
}

// ts/src/cli/commands/connect.ts
init_client2();
init_file_tokens();
init_config();
init_non_interactive();
init_output();
function registerConnectCommand(program2) {
  program2.command("connect").description("Connect this project to explicit OpenBox API and core endpoints").option("--api-key <key>", "Org API key for backend and extension access").option("--api-url <url>", "Backend API endpoint URL").option("--core-url <url>", "Core/runtime policy endpoint URL").option("--no-validate", "Save the connection without probing /auth/profile").action(async (opts) => {
    try {
      const connection = resolveConnectionProfile({
        apiUrl: opts.apiUrl,
        coreUrl: opts.coreUrl
      });
      setConfig("OPENBOX_API_URL", connection.apiUrl);
      setConfig("OPENBOX_CORE_URL", connection.coreUrl);
      let profile;
      if (opts.apiKey) {
        const key = opts.apiKey.trim();
        saveApiKey(key);
        if (opts.validate !== false) {
          profile = await new OpenBoxClient({
            apiUrl: connection.apiUrl,
            apiKey: key,
            clientName: "cli/connect",
            timeoutMs: 1e4
          }).getProfile();
        }
      } else if (!isMachineMode()) {
        warn("no API key saved; rerun openbox connect --api-url <url> --core-url <url> --api-key <key> in this project when you have one");
      }
      const result = {
        apiUrl: connection.apiUrl,
        coreUrl: connection.coreUrl,
        discovered: connection.discovered,
        apiKey: opts.apiKey ? "saved" : "missing",
        profile
      };
      if (isMachineMode()) output(result);
      else {
        success("connected to OpenBox endpoints");
        output(result);
      }
    } catch (err) {
      reportAndExit(err);
    }
  });
}
function resolveConnectionProfile(opts) {
  if (!opts.apiUrl || !opts.coreUrl) {
    throw new Error("connect requires explicit --api-url and --core-url.");
  }
  return {
    apiUrl: normalizeServiceUrl2("OPENBOX_API_URL", opts.apiUrl),
    coreUrl: normalizeServiceUrl2("OPENBOX_CORE_URL", opts.coreUrl),
    discovered: false
  };
}
function normalizeServiceUrl2(name, raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`${name} cannot be empty.`);
  const url = new URL(trimmed);
  if (url.protocol !== "https:" && !isLoopbackHost2(url.hostname)) {
    throw new Error(`${name} must use https:// unless it points at localhost.`);
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}
function isLoopbackHost2(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

// ts/src/cli/commands/config.ts
init_output();
init_config();
function registerConfigCommands(program2) {
  const config = program2.command("config").description("Persistent CLI config (URL overrides, default flags)");
  config.command("set <key> <value>").description("Persist a project-local config value, such as OPENBOX_API_URL or OPENBOX_CORE_URL").action((key, value) => {
    try {
      const { scope } = setConfig(key, value);
      output({ scope, key, value, file: configStorePath() });
    } catch (err) {
      reportAndExit(err);
    }
  });
  config.command("get <key>").description("Look up a previously-persisted project-local value").action((key) => {
    const value = getConfig(key);
    if (value === void 0) {
      error(`no config value for ${key}`, {
        detail: `file: ${configStorePath()}`,
        help: `openbox config set ${key} <value>`
      });
      bailWith(EXIT.NOT_FOUND);
    }
    output({ scope: "project", key, value });
  });
  config.command("unset <key>").description("Remove a config value (no-op if unset)").action((key) => {
    try {
      const { scope, removed } = unsetConfig(key);
      output({ scope, key, removed });
    } catch (err) {
      reportAndExit(err);
    }
  });
  config.command("list").description("Print persisted project-local values").action(() => {
    output({
      scope: "project",
      file: configStorePath(),
      values: listConfig()
    });
  });
}

// ts/src/cli/commands/api.ts
import { readFileSync as readFileSync5 } from "fs";

// ts/src/client/generated/endpoint-manifest.ts
var BACKEND_ENDPOINT_MANIFEST = [
  {
    "operationId": "AppController_getHello",
    "path": "/health",
    "verb": "get",
    "pathPattern": "/health"
  },
  {
    "operationId": "AuthController_getProfile",
    "path": "/auth/profile",
    "verb": "get",
    "pathPattern": "/auth/profile"
  },
  {
    "operationId": "AuthController_getCsrf",
    "path": "/auth/csrf",
    "verb": "get",
    "pathPattern": "/auth/csrf"
  },
  {
    "operationId": "AuthController_login",
    "path": "/auth/login",
    "verb": "post",
    "pathPattern": "/auth/login"
  },
  {
    "operationId": "AuthController_logout",
    "path": "/auth/logout",
    "verb": "post",
    "pathPattern": "/auth/logout"
  },
  {
    "operationId": "AuthController_forgotPassword",
    "path": "/auth/forgot-password",
    "verb": "post",
    "pathPattern": "/auth/forgot-password"
  },
  {
    "operationId": "AuthController_resetPassword",
    "path": "/auth/reset-password",
    "verb": "post",
    "pathPattern": "/auth/reset-password"
  },
  {
    "operationId": "AuthController_changePassword",
    "path": "/auth/change-password",
    "verb": "post",
    "pathPattern": "/auth/change-password"
  },
  {
    "operationId": "AuthController_refreshToken",
    "path": "/auth/refresh",
    "verb": "post",
    "pathPattern": "/auth/refresh"
  },
  {
    "operationId": "UserController_getRoles",
    "path": "/user/roles",
    "verb": "get",
    "pathPattern": "/user/roles"
  },
  {
    "operationId": "AgentController_getViolations",
    "path": "/agent/violations",
    "verb": "get",
    "pathPattern": "/agent/violations"
  },
  {
    "operationId": "AgentController_getAgentsMetrics",
    "path": "/agent/metrics",
    "verb": "get",
    "pathPattern": "/agent/metrics"
  },
  {
    "operationId": "AgentController_getAgents",
    "path": "/agent/list",
    "verb": "get",
    "pathPattern": "/agent/list"
  },
  {
    "operationId": "AgentController_getAivssScore",
    "path": "/agent/aivss",
    "verb": "post",
    "pathPattern": "/agent/aivss"
  },
  {
    "operationId": "AgentController_createAgent",
    "path": "/agent/create",
    "verb": "post",
    "pathPattern": "/agent/create"
  },
  {
    "operationId": "AgentController_deleteAgent",
    "path": "/agent/{agentId}",
    "verb": "delete",
    "pathPattern": "/agent/{x}"
  },
  {
    "operationId": "AgentController_getAgent",
    "path": "/agent/{agentId}",
    "verb": "get",
    "pathPattern": "/agent/{x}"
  },
  {
    "operationId": "AgentController_updateAgent",
    "path": "/agent/{agentId}",
    "verb": "put",
    "pathPattern": "/agent/{x}"
  },
  {
    "operationId": "AgentController_getAgentEvaluations",
    "path": "/agent/{agentId}/violations",
    "verb": "get",
    "pathPattern": "/agent/{x}/violations"
  },
  {
    "operationId": "AgentController_markAsFalsePositive",
    "path": "/agent/{agentId}/violations/{violationId}/false-positive",
    "verb": "patch",
    "pathPattern": "/agent/{x}/violations/{x}/false-positive"
  },
  {
    "operationId": "AgentController_getAgentLogs",
    "path": "/agent/{agentId}/logs",
    "verb": "get",
    "pathPattern": "/agent/{x}/logs"
  },
  {
    "operationId": "AgentController_getDriftEvents",
    "path": "/agent/{agentId}/logs/drift",
    "verb": "get",
    "pathPattern": "/agent/{x}/logs/drift"
  },
  {
    "operationId": "AgentController_getAssessments",
    "path": "/agent/{agentId}/assessments",
    "verb": "get",
    "pathPattern": "/agent/{x}/assessments"
  },
  {
    "operationId": "AgentController_updateAivssConfig",
    "path": "/agent/{agentId}/aivss",
    "verb": "put",
    "pathPattern": "/agent/{x}/aivss"
  },
  {
    "operationId": "AgentController_updateGoalAlignmentConfig",
    "path": "/agent/{agentId}/goal-alignment",
    "verb": "put",
    "pathPattern": "/agent/{x}/goal-alignment"
  },
  {
    "operationId": "AgentController_recalculateTrustScore",
    "path": "/agent/{agentId}/aivss/recalculate",
    "verb": "post",
    "pathPattern": "/agent/{x}/aivss/recalculate"
  },
  {
    "operationId": "AgentController_getGuardrails",
    "path": "/agent/{agentId}/guardrails",
    "verb": "get",
    "pathPattern": "/agent/{x}/guardrails"
  },
  {
    "operationId": "AgentController_createGuardrail",
    "path": "/agent/{agentId}/guardrails",
    "verb": "post",
    "pathPattern": "/agent/{x}/guardrails"
  },
  {
    "operationId": "AgentController_getGuardrailMetrics",
    "path": "/agent/{agentId}/guardrails/metrics",
    "verb": "get",
    "pathPattern": "/agent/{x}/guardrails/metrics"
  },
  {
    "operationId": "AgentController_getGuardrailViolationLogs",
    "path": "/agent/{agentId}/guardrails/violation-logs",
    "verb": "get",
    "pathPattern": "/agent/{x}/guardrails/violation-logs"
  },
  {
    "operationId": "AgentController_deleteGuardrails",
    "path": "/agent/{agentId}/guardrails/{guardrailId}",
    "verb": "delete",
    "pathPattern": "/agent/{x}/guardrails/{x}"
  },
  {
    "operationId": "AgentController_getGuardrail",
    "path": "/agent/{agentId}/guardrails/{guardrailId}",
    "verb": "get",
    "pathPattern": "/agent/{x}/guardrails/{x}"
  },
  {
    "operationId": "AgentController_updateGuardrails",
    "path": "/agent/{agentId}/guardrails/{guardrailId}",
    "verb": "put",
    "pathPattern": "/agent/{x}/guardrails/{x}"
  },
  {
    "operationId": "AgentController_reorderGuardrail",
    "path": "/agent/{agentId}/guardrails/{guardrailId}/reorder",
    "verb": "patch",
    "pathPattern": "/agent/{x}/guardrails/{x}/reorder"
  },
  {
    "operationId": "AgentController_getPolicies",
    "path": "/agent/{agentId}/policies",
    "verb": "get",
    "pathPattern": "/agent/{x}/policies"
  },
  {
    "operationId": "AgentController_createPolicy",
    "path": "/agent/{agentId}/policies",
    "verb": "post",
    "pathPattern": "/agent/{x}/policies"
  },
  {
    "operationId": "AgentController_getPolicesMetrics",
    "path": "/agent/{agentId}/policies/metrics",
    "verb": "get",
    "pathPattern": "/agent/{x}/policies/metrics"
  },
  {
    "operationId": "AgentController_getCurrentPolicy",
    "path": "/agent/{agentId}/policies/current",
    "verb": "get",
    "pathPattern": "/agent/{x}/policies/current"
  },
  {
    "operationId": "AgentController_getPolicy",
    "path": "/agent/{agentId}/policies/{policyId}",
    "verb": "get",
    "pathPattern": "/agent/{x}/policies/{x}"
  },
  {
    "operationId": "AgentController_updatePolicy",
    "path": "/agent/{agentId}/policies/{policyId}",
    "verb": "put",
    "pathPattern": "/agent/{x}/policies/{x}"
  },
  {
    "operationId": "AgentController_getPolicyEvaluations",
    "path": "/agent/{agentId}/policies/{policyId}/evaluations",
    "verb": "get",
    "pathPattern": "/agent/{x}/policies/{x}/evaluations"
  },
  {
    "operationId": "AgentController_getSessions",
    "path": "/agent/{agentId}/sessions",
    "verb": "get",
    "pathPattern": "/agent/{x}/sessions"
  },
  {
    "operationId": "AgentController_getActiveSessions",
    "path": "/agent/{agentId}/active-sessions",
    "verb": "get",
    "pathPattern": "/agent/{x}/active-sessions"
  },
  {
    "operationId": "AgentController_getSession",
    "path": "/agent/{agentId}/sessions/{sessionId}",
    "verb": "get",
    "pathPattern": "/agent/{x}/sessions/{x}"
  },
  {
    "operationId": "AgentController_getSessionLogs",
    "path": "/agent/{agentId}/sessions/{sessionId}/logs",
    "verb": "get",
    "pathPattern": "/agent/{x}/sessions/{x}/logs"
  },
  {
    "operationId": "AgentController_getSessionGoalAlignmentStats",
    "path": "/agent/{agentId}/sessions/{sessionId}/goal-alignment-stats",
    "verb": "get",
    "pathPattern": "/agent/{x}/sessions/{x}/goal-alignment-stats"
  },
  {
    "operationId": "AgentController_getSessionReasoningTrace",
    "path": "/agent/{agentId}/sessions/{sessionId}/reasoning-trace",
    "verb": "get",
    "pathPattern": "/agent/{x}/sessions/{x}/reasoning-trace"
  },
  {
    "operationId": "AgentController_terminateSession",
    "path": "/agent/{agentId}/sessions/{sessionId}/terminate",
    "verb": "patch",
    "pathPattern": "/agent/{x}/sessions/{x}/terminate"
  },
  {
    "operationId": "AgentController_getGoalAlignmentTrend",
    "path": "/agent/{agentId}/goal-alignment/trend",
    "verb": "get",
    "pathPattern": "/agent/{x}/goal-alignment/trend"
  },
  {
    "operationId": "AgentController_getRecentDriftEvents",
    "path": "/agent/{agentId}/goal-alignment/recent-drifts",
    "verb": "get",
    "pathPattern": "/agent/{x}/goal-alignment/recent-drifts"
  },
  {
    "operationId": "AgentController_rotateApiKey",
    "path": "/agent/{agentId}/rotate-api-key",
    "verb": "post",
    "pathPattern": "/agent/{x}/rotate-api-key"
  },
  {
    "operationId": "AgentController_revokeApiKey",
    "path": "/agent/{agentId}/revoke-api-key",
    "verb": "post",
    "pathPattern": "/agent/{x}/revoke-api-key"
  },
  {
    "operationId": "AgentController_getObservability",
    "path": "/agent/{agentId}/observability",
    "verb": "get",
    "pathPattern": "/agent/{x}/observability"
  },
  {
    "operationId": "AgentController_getIssues",
    "path": "/agent/{agentId}/issues",
    "verb": "get",
    "pathPattern": "/agent/{x}/issues"
  },
  {
    "operationId": "AgentController_getSemanticTypes",
    "path": "/agent/behavior-rule/semantic-types",
    "verb": "get",
    "pathPattern": "/agent/behavior-rule/semantic-types"
  },
  {
    "operationId": "AgentController_getBehaviorRuleList",
    "path": "/agent/{agentId}/behavior-rule",
    "verb": "get",
    "pathPattern": "/agent/{x}/behavior-rule"
  },
  {
    "operationId": "AgentController_createBehaviorRule",
    "path": "/agent/{agentId}/behavior-rule",
    "verb": "post",
    "pathPattern": "/agent/{x}/behavior-rule"
  },
  {
    "operationId": "AgentController_getCurrentBehaviorRule",
    "path": "/agent/{agentId}/behavior-rule/current",
    "verb": "get",
    "pathPattern": "/agent/{x}/behavior-rule/current"
  },
  {
    "operationId": "AgentController_deleteBehaviorRule",
    "path": "/agent/{agentId}/behavior-rule/{behaviorRuleId}",
    "verb": "delete",
    "pathPattern": "/agent/{x}/behavior-rule/{x}"
  },
  {
    "operationId": "AgentController_getBehaviorRule",
    "path": "/agent/{agentId}/behavior-rule/{behaviorRuleId}",
    "verb": "get",
    "pathPattern": "/agent/{x}/behavior-rule/{x}"
  },
  {
    "operationId": "AgentController_rollbackBehaviorRule",
    "path": "/agent/{agentId}/behavior-rule/{behaviorRuleId}",
    "verb": "post",
    "pathPattern": "/agent/{x}/behavior-rule/{x}"
  },
  {
    "operationId": "AgentController_updateBehaviorRule",
    "path": "/agent/{agentId}/behavior-rule/{behaviorRuleId}",
    "verb": "put",
    "pathPattern": "/agent/{x}/behavior-rule/{x}"
  },
  {
    "operationId": "AgentController_changeBehaviorRuleStatus",
    "path": "/agent/{agentId}/behavior-rule/{behaviorRuleId}/status",
    "verb": "put",
    "pathPattern": "/agent/{x}/behavior-rule/{x}/status"
  },
  {
    "operationId": "AgentController_getBehavioralRuleHistories",
    "path": "/agent/{agentId}/behavior-rule/{behaviorGroupdId}/versions",
    "verb": "get",
    "pathPattern": "/agent/{x}/behavior-rule/{x}/versions"
  },
  {
    "operationId": "AgentController_getBehaviorMetrics",
    "path": "/agent/{agentId}/behavior/metrics",
    "verb": "get",
    "pathPattern": "/agent/{x}/behavior/metrics"
  },
  {
    "operationId": "AgentController_getAgentTrustHistories",
    "path": "/agent/{agentId}/trust/histories",
    "verb": "get",
    "pathPattern": "/agent/{x}/trust/histories"
  },
  {
    "operationId": "AgentController_getAgentTrustScoreEvents",
    "path": "/agent/{agentId}/trust/events",
    "verb": "get",
    "pathPattern": "/agent/{x}/trust/events"
  },
  {
    "operationId": "AgentController_getAgentTrustRecoveryStatus",
    "path": "/agent/{agentId}/trust/recovery-status",
    "verb": "get",
    "pathPattern": "/agent/{x}/trust/recovery-status"
  },
  {
    "operationId": "AgentController_getAgentApprovalsMetrics",
    "path": "/agent/{agentId}/approvals/metrics",
    "verb": "get",
    "pathPattern": "/agent/{x}/approvals/metrics"
  },
  {
    "operationId": "AgentController_getPendingApprovals",
    "path": "/agent/{agentId}/approvals/pending",
    "verb": "get",
    "pathPattern": "/agent/{x}/approvals/pending"
  },
  {
    "operationId": "AgentController_getApprovalHistory",
    "path": "/agent/{agentId}/approvals/history",
    "verb": "get",
    "pathPattern": "/agent/{x}/approvals/history"
  },
  {
    "operationId": "AgentController_decideApproval",
    "path": "/agent/{agentId}/approvals/{eventId}/decide",
    "verb": "put",
    "pathPattern": "/agent/{x}/approvals/{x}/decide"
  },
  {
    "operationId": "AgentController_getInsightMetrics",
    "path": "/agent/{agentId}/insights/metrics",
    "verb": "get",
    "pathPattern": "/agent/{x}/insights/metrics"
  },
  {
    "operationId": "AgentController_getBehaviorViolations",
    "path": "/agent/{agentId}/behavior/violations",
    "verb": "get",
    "pathPattern": "/agent/{x}/behavior/violations"
  },
  {
    "operationId": "AgentController_getTrustTierChanges",
    "path": "/agent/{agentId}/trust-tier-changes",
    "verb": "get",
    "pathPattern": "/agent/{x}/trust-tier-changes"
  },
  {
    "operationId": "GuardrailController_runTest",
    "path": "/guardrails/run-test",
    "verb": "post",
    "pathPattern": "/guardrails/run-test"
  },
  {
    "operationId": "PolicyController_evaluate",
    "path": "/policy/evaluate",
    "verb": "post",
    "pathPattern": "/policy/evaluate"
  },
  {
    "operationId": "WebhookController_list",
    "path": "/webhook",
    "verb": "get",
    "pathPattern": "/webhook"
  },
  {
    "operationId": "WebhookController_create",
    "path": "/webhook",
    "verb": "post",
    "pathPattern": "/webhook"
  },
  {
    "operationId": "WebhookController_delete",
    "path": "/webhook/{id}",
    "verb": "delete",
    "pathPattern": "/webhook/{x}"
  },
  {
    "operationId": "WebhookController_get",
    "path": "/webhook/{id}",
    "verb": "get",
    "pathPattern": "/webhook/{x}"
  },
  {
    "operationId": "WebhookController_update",
    "path": "/webhook/{id}",
    "verb": "patch",
    "pathPattern": "/webhook/{x}"
  },
  {
    "operationId": "WebhookController_getDeliveryLogs",
    "path": "/webhook/{id}/deliveries",
    "verb": "get",
    "pathPattern": "/webhook/{x}/deliveries"
  },
  {
    "operationId": "WebhookController_test",
    "path": "/webhook/{id}/test",
    "verb": "post",
    "pathPattern": "/webhook/{x}/test"
  },
  {
    "operationId": "WebhookController_regenerateSecret",
    "path": "/webhook/{id}/regenerate-secret",
    "verb": "post",
    "pathPattern": "/webhook/{x}/regenerate-secret"
  },
  {
    "operationId": "OrganizationController_createOrganization",
    "path": "/organization/register",
    "verb": "post",
    "pathPattern": "/organization/register"
  },
  {
    "operationId": "OrganizationController_getDemoSetupStatus",
    "path": "/organization/demo-setup-status",
    "verb": "get",
    "pathPattern": "/organization/demo-setup-status"
  },
  {
    "operationId": "OrganizationController_getOrgSetting",
    "path": "/organization/{organizationId}/settings",
    "verb": "get",
    "pathPattern": "/organization/{x}/settings"
  },
  {
    "operationId": "OrganizationController_updateOrgSetting",
    "path": "/organization/{organizationId}/settings",
    "verb": "put",
    "pathPattern": "/organization/{x}/settings"
  },
  {
    "operationId": "OrganizationController_getFeatures",
    "path": "/organization/{organizationId}/features",
    "verb": "get",
    "pathPattern": "/organization/{x}/features"
  },
  {
    "operationId": "OrganizationController_removeMembers",
    "path": "/organization/{organizationId}/members",
    "verb": "delete",
    "pathPattern": "/organization/{x}/members"
  },
  {
    "operationId": "OrganizationController_getMembers",
    "path": "/organization/{organizationId}/members",
    "verb": "get",
    "pathPattern": "/organization/{x}/members"
  },
  {
    "operationId": "OrganizationController_createUser",
    "path": "/organization/{organizationId}/users",
    "verb": "post",
    "pathPattern": "/organization/{x}/users"
  },
  {
    "operationId": "OrganizationController_sendWelcomeEmail",
    "path": "/organization/{organizationId}/send-welcome-email",
    "verb": "post",
    "pathPattern": "/organization/{x}/send-welcome-email"
  },
  {
    "operationId": "OrganizationController_inviteUser",
    "path": "/organization/{organizationId}/invitations",
    "verb": "post",
    "pathPattern": "/organization/{x}/invitations"
  },
  {
    "operationId": "OrganizationController_removeRoles",
    "path": "/organization/{organizationId}/members/{userId}/roles",
    "verb": "delete",
    "pathPattern": "/organization/{x}/members/{x}/roles"
  },
  {
    "operationId": "OrganizationController_assignRoles",
    "path": "/organization/{organizationId}/members/{userId}/roles",
    "verb": "post",
    "pathPattern": "/organization/{x}/members/{x}/roles"
  },
  {
    "operationId": "OrganizationController_updateMember",
    "path": "/organization/{organizationId}/members/{userId}",
    "verb": "put",
    "pathPattern": "/organization/{x}/members/{x}"
  },
  {
    "operationId": "OrganizationController_deleteTeams",
    "path": "/organization/{organizationId}/teams",
    "verb": "delete",
    "pathPattern": "/organization/{x}/teams"
  },
  {
    "operationId": "OrganizationController_getTeams",
    "path": "/organization/{organizationId}/teams",
    "verb": "get",
    "pathPattern": "/organization/{x}/teams"
  },
  {
    "operationId": "OrganizationController_createTeam",
    "path": "/organization/{organizationId}/teams",
    "verb": "post",
    "pathPattern": "/organization/{x}/teams"
  },
  {
    "operationId": "OrganizationController_getTeamStats",
    "path": "/organization/{organizationId}/teams/stats",
    "verb": "get",
    "pathPattern": "/organization/{x}/teams/stats"
  },
  {
    "operationId": "OrganizationController_getTeam",
    "path": "/organization/{organizationId}/teams/{teamId}",
    "verb": "get",
    "pathPattern": "/organization/{x}/teams/{x}"
  },
  {
    "operationId": "OrganizationController_updateTeam",
    "path": "/organization/{organizationId}/teams/{teamId}",
    "verb": "put",
    "pathPattern": "/organization/{x}/teams/{x}"
  },
  {
    "operationId": "OrganizationController_removeTeamMembers",
    "path": "/organization/{organizationId}/teams/{teamId}/members",
    "verb": "delete",
    "pathPattern": "/organization/{x}/teams/{x}/members"
  },
  {
    "operationId": "OrganizationController_getTeamMembers",
    "path": "/organization/{organizationId}/teams/{teamId}/members",
    "verb": "get",
    "pathPattern": "/organization/{x}/teams/{x}/members"
  },
  {
    "operationId": "OrganizationController_addMembers",
    "path": "/organization/{organizationId}/teams/{teamId}/members",
    "verb": "post",
    "pathPattern": "/organization/{x}/teams/{x}/members"
  },
  {
    "operationId": "OrganizationController_getAuditLogs",
    "path": "/organization/audit-logs",
    "verb": "get",
    "pathPattern": "/organization/audit-logs"
  },
  {
    "operationId": "OrganizationController_previewExport",
    "path": "/organization/audit-logs/export/preview",
    "verb": "post",
    "pathPattern": "/organization/audit-logs/export/preview"
  },
  {
    "operationId": "OrganizationController_exportAuditLogs",
    "path": "/organization/audit-logs/export",
    "verb": "post",
    "pathPattern": "/organization/audit-logs/export"
  },
  {
    "operationId": "OrganizationController_getExportHistory",
    "path": "/organization/audit-logs/exports",
    "verb": "get",
    "pathPattern": "/organization/audit-logs/exports"
  },
  {
    "operationId": "OrganizationController_deleteExport",
    "path": "/organization/audit-logs/export/{exportId}",
    "verb": "delete",
    "pathPattern": "/organization/audit-logs/export/{x}"
  },
  {
    "operationId": "OrganizationController_getExportStatus",
    "path": "/organization/audit-logs/export/{exportId}",
    "verb": "get",
    "pathPattern": "/organization/audit-logs/export/{x}"
  },
  {
    "operationId": "OrganizationController_downloadExport",
    "path": "/organization/audit-logs/export/{exportId}/download",
    "verb": "get",
    "pathPattern": "/organization/audit-logs/export/{x}/download"
  },
  {
    "operationId": "OrganizationController_getAuditLogById",
    "path": "/organization/audit-logs/{logId}",
    "verb": "get",
    "pathPattern": "/organization/audit-logs/{x}"
  },
  {
    "operationId": "OrganizationController_getObservability",
    "path": "/organization/{organizationId}/dashboard",
    "verb": "get",
    "pathPattern": "/organization/{x}/dashboard"
  },
  {
    "operationId": "OrganizationController_getApprovalsMetrics",
    "path": "/organization/{organizationId}/approvals/metrics",
    "verb": "get",
    "pathPattern": "/organization/{x}/approvals/metrics"
  },
  {
    "operationId": "OrganizationController_getSlaPerformance",
    "path": "/organization/{organizationId}/approvals/sla",
    "verb": "get",
    "pathPattern": "/organization/{x}/approvals/sla"
  },
  {
    "operationId": "OrganizationController_getApprovals",
    "path": "/organization/{organizationId}/approvals",
    "verb": "get",
    "pathPattern": "/organization/{x}/approvals"
  },
  {
    "operationId": "OrganizationController_getRecentDecisions",
    "path": "/organization/{organizationId}/approvals/history",
    "verb": "get",
    "pathPattern": "/organization/{x}/approvals/history"
  },
  {
    "operationId": "OrganizationController_getTrustTierTrends",
    "path": "/organization/{organizationId}/dashboard/tier-trends",
    "verb": "get",
    "pathPattern": "/organization/{x}/dashboard/tier-trends"
  },
  {
    "operationId": "OrganizationController_getGovernanceFeed",
    "path": "/organization/{organizationId}/dashboard/governance-feed",
    "verb": "get",
    "pathPattern": "/organization/{x}/dashboard/governance-feed"
  },
  {
    "operationId": "OrganizationController_getTrustDriftLanes",
    "path": "/organization/{organizationId}/dashboard/trust-drift-lanes",
    "verb": "get",
    "pathPattern": "/organization/{x}/dashboard/trust-drift-lanes"
  },
  {
    "operationId": "OrganizationController_getGovernanceSlo",
    "path": "/organization/{organizationId}/dashboard/governance-slo",
    "verb": "get",
    "pathPattern": "/organization/{x}/dashboard/governance-slo"
  },
  {
    "operationId": "OrganizationController_getViolationHeatcal",
    "path": "/organization/{organizationId}/dashboard/violation-heatcal",
    "verb": "get",
    "pathPattern": "/organization/{x}/dashboard/violation-heatcal"
  },
  {
    "operationId": "OrganizationController_getSessions",
    "path": "/organization/{organizationId}/sessions",
    "verb": "get",
    "pathPattern": "/organization/{x}/sessions"
  },
  {
    "operationId": "OrganizationController_getOrganization",
    "path": "/organization/{organizationId}",
    "verb": "get",
    "pathPattern": "/organization/{x}"
  },
  {
    "operationId": "ApiKeyController_list",
    "path": "/api-key",
    "verb": "get",
    "pathPattern": "/api-key"
  },
  {
    "operationId": "ApiKeyController_create",
    "path": "/api-key",
    "verb": "post",
    "pathPattern": "/api-key"
  },
  {
    "operationId": "ApiKeyController_delete",
    "path": "/api-key/{id}",
    "verb": "delete",
    "pathPattern": "/api-key/{x}"
  },
  {
    "operationId": "ApiKeyController_get",
    "path": "/api-key/{id}",
    "verb": "get",
    "pathPattern": "/api-key/{x}"
  },
  {
    "operationId": "ApiKeyController_update",
    "path": "/api-key/{id}",
    "verb": "patch",
    "pathPattern": "/api-key/{x}"
  },
  {
    "operationId": "SsoController_removeConfig",
    "path": "/sso",
    "verb": "delete",
    "pathPattern": "/sso"
  },
  {
    "operationId": "SsoController_getConfig",
    "path": "/sso",
    "verb": "get",
    "pathPattern": "/sso"
  },
  {
    "operationId": "SsoController_configureSaml",
    "path": "/sso/saml",
    "verb": "post",
    "pathPattern": "/sso/saml"
  },
  {
    "operationId": "SsoController_configureOidc",
    "path": "/sso/oidc",
    "verb": "post",
    "pathPattern": "/sso/oidc"
  },
  {
    "operationId": "SsoController_setEnforcement",
    "path": "/sso/enforce",
    "verb": "put",
    "pathPattern": "/sso/enforce"
  },
  {
    "operationId": "SsoController_getSpMetadata",
    "path": "/sso/metadata",
    "verb": "get",
    "pathPattern": "/sso/metadata"
  },
  {
    "operationId": "SsoController_verifyConfiguration",
    "path": "/sso/verify",
    "verb": "post",
    "pathPattern": "/sso/verify"
  },
  {
    "operationId": "SsoController_getPublicStatus",
    "path": "/sso/status",
    "verb": "get",
    "pathPattern": "/sso/status"
  }
];

// ts/src/core-client/generated/endpoint-manifest.ts
var CORE_ENDPOINT_MANIFEST = [
  {
    "operationId": "healthCheck",
    "path": "/",
    "verb": "get",
    "pathPattern": "/"
  },
  {
    "operationId": "validateApiKey",
    "path": "/api/v1/auth/validate",
    "verb": "get",
    "pathPattern": "/api/v1/auth/validate"
  },
  {
    "operationId": "evaluateGovernance",
    "path": "/api/v1/governance/evaluate",
    "verb": "post",
    "pathPattern": "/api/v1/governance/evaluate"
  },
  {
    "operationId": "pollApproval",
    "path": "/api/v1/governance/approval",
    "verb": "post",
    "pathPattern": "/api/v1/governance/approval"
  }
];

// ts/src/cli/commands/api.ts
init_output();
function manifestFor(service) {
  return service === "backend" ? BACKEND_ENDPOINT_MANIFEST : CORE_ENDPOINT_MANIFEST;
}
function resolveOperation(service, operationId) {
  const operation = manifestFor(service).find((entry) => entry.operationId === operationId);
  if (!operation) {
    throw new Error(`unknown ${service} operationId: ${operationId}`);
  }
  return operation;
}
function parseJsonOption(raw, label) {
  if (!raw) return void 0;
  const input = raw.startsWith("@") ? readFileSync5(raw.slice(1), "utf-8") : raw;
  try {
    return JSON.parse(input);
  } catch (err) {
    throw new Error(`${label} must be valid JSON: ${String(err.message ?? err)}`);
  }
}
function renderOperationPath(template, params) {
  return template.replace(/\{([^}]+)\}/g, (_, rawName) => {
    const name = rawName.trim();
    const value = params?.[name];
    if (value === void 0 || value === null || value === "") {
      throw new Error(`missing path param '${name}'`);
    }
    return encodeURIComponent(String(value));
  });
}
function parseObjectOption(raw, label) {
  const parsed = parseJsonOption(raw, label);
  if (parsed === void 0) return void 0;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}
async function callOperation(service, operationId, options, client) {
  let operation;
  let params;
  let query;
  let body;
  try {
    operation = resolveOperation(service, operationId);
    params = parseObjectOption(options.params, "--params");
    query = parseObjectOption(options.query, "--query");
    body = parseJsonOption(options.body, "--body");
  } catch (err) {
    error(String(err.message ?? err));
    bailWith(EXIT.USAGE);
  }
  try {
    const path16 = renderOperationPath(operation.path, params);
    const data = await client.requestOperation(operation.verb.toUpperCase(), path16, {
      params: query,
      data: body
    });
    output(data ?? null);
  } catch (err) {
    const status = typeof err.status === "number" ? err.status : void 0;
    const bodyDetail = err.body;
    error(String(err.message ?? err), {
      detail: bodyDetail === void 0 ? void 0 : JSON.stringify(bodyDetail)
    });
    bailWith(status ? exitCodeForStatus(status) : EXIT.NETWORK);
  }
}
function listOperations(service) {
  const entries = manifestFor(service).map((entry) => ({
    operationId: entry.operationId,
    verb: entry.verb,
    path: entry.path
  }));
  outputList(entries, `${service} operations`);
}
function registerApiCommands(program2) {
  const api = program2.command("api").description("Call generated OpenBox Backend/Core operations by operationId");
  api.command("list").description("List generated operation IDs").argument("<service>", "backend | core").action((rawService) => {
    const service = rawService;
    if (service !== "backend" && service !== "core") {
      error(`unknown service '${rawService}'`, { help: "expected backend or core" });
      bailWith(EXIT.USAGE);
    }
    listOperations(service);
  });
  api.command("backend").description("Call a generated Backend operation by operationId").argument("<operationId>").option("--params <json>", "Path params JSON object, or @file").option("--query <json>", "Query params JSON object, or @file").option("--body <json>", "JSON request body, or @file").action(
    (operationId, options) => callOperation("backend", operationId, options, getClient())
  );
  api.command("core").description("Call a generated Core operation by operationId").argument("<operationId>").option("--params <json>", "Path params JSON object, or @file").option("--query <json>", "Query params JSON object, or @file").option("--body <json>", "JSON request body, or @file").action(
    (operationId, options) => callOperation("core", operationId, options, getCoreClient())
  );
}

// ts/src/cli/commands/health.ts
init_output();
function registerHealthCommands(program2) {
  program2.command("health").description("Check API health").action(async () => {
    try {
      const data = await getClient().health();
      output(data);
    } catch (err) {
      reportAndExit(err);
    }
  });
}

// ts/src/cli/commands/mcp.ts
function registerMcpCommands(program2) {
  const mcp = program2.command("mcp").description("OpenBox MCP server");
  mcp.command("serve").description("Run the OpenBox MCP server over stdio (invoked by the LLM host, not the user directly)").action(async () => {
    const { runMcpServer: runMcpServer2 } = await Promise.resolve().then(() => (init_mcp(), mcp_exports));
    await runMcpServer2();
  });
}

// ts/src/cli/commands/claude-code.ts
init_non_interactive();
init_output();
function collectPair(value, prior) {
  return [...prior, value];
}
function parseMatcherPairs(pairs) {
  const matchers = {};
  for (const pair of pairs ?? []) {
    const idx = pair.indexOf("=");
    if (idx <= 0) {
      error(`--matcher: invalid pair '${pair}', expected <event>=<regex>`);
      bailWith(EXIT.USAGE);
    }
    matchers[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
  }
  return Object.keys(matchers).length > 0 ? matchers : void 0;
}
function parsePluginScope(value) {
  const scope = (value ?? "project").toLowerCase();
  if (scope !== "project") {
    error(`--scope: invalid value '${value}'; expected project`);
    bailWith(EXIT.USAGE);
  }
  return "project";
}
function registerClaudeCodeCommands(program2) {
  const claude = program2.command("claude-code").description("Claude Code integration");
  claude.command("hook").description("Run the OpenBox hook handler (invoked by Claude Code per hook event)").action(async () => {
    const { runClaudeHook: runClaudeHook2 } = await Promise.resolve().then(() => (init_hook_handler(), hook_handler_exports));
    try {
      await runClaudeHook2();
    } catch (err) {
      error(`claude-code hook: ${err.message}`);
      bailWith(EXIT.OK);
    }
  });
  const plugin = claude.command("plugin").description("Export or install the project-local OpenBox Claude Code plugin");
  plugin.command("export").description("Write a complete marketplace-ready Claude Code plugin folder").requiredOption("--out <dir>", "Output directory").option(
    "--matcher <pair>",
    "Hook matcher pair `<event>=<regex>` copied into hooks/hooks.json. Repeatable.",
    collectPair,
    []
  ).option("--include-opt-in-hooks", "Also install opt-in hook events such as SessionEnd; WorktreeCreate remains diagnostic-only").action(async (opts) => {
    const { exportClaudeCodePlugin: exportClaudeCodePlugin2, verifyClaudeCodePlugin: verifyClaudeCodePlugin2 } = await Promise.resolve().then(() => (init_claude_code2(), claude_code_exports));
    const out = exportClaudeCodePlugin2({
      out: opts.out,
      matchers: parseMatcherPairs(opts.matcher),
      includeOptInHooks: opts.includeOptInHooks
    });
    const checks = verifyClaudeCodePlugin2({
      target: out,
      includeOptInHooks: opts.includeOptInHooks
    });
    const failed = checks.filter((check) => check.status === "fail");
    if (failed.length > 0) {
      output({ out, checks });
      bailWith(EXIT.GENERIC);
    }
    success(`exported Claude Code plugin to ${out}`);
  });
  plugin.command("install").description("Install the project-local OpenBox Claude Code plugin only").option("--scope <scope>", "project only", "project").option("--cwd <dir>", "Project root for --scope project").option("--target <dir>", "Explicit Claude Code plugin target directory").option("--symlink <dir>", "Symlink an already-exported plugin folder into Claude Code").option(
    "--matcher <pair>",
    "Hook matcher pair `<event>=<regex>` copied into hooks/hooks.json. Repeatable.",
    collectPair,
    []
  ).option("--include-opt-in-hooks", "Also install opt-in hook events such as SessionEnd; WorktreeCreate remains diagnostic-only").action(
    async (opts) => {
      const { installClaudeCodePlugin: installClaudeCodePlugin2 } = await Promise.resolve().then(() => (init_claude_code2(), claude_code_exports));
      const target = installClaudeCodePlugin2({
        scope: parsePluginScope(opts.scope),
        cwd: opts.cwd,
        target: opts.target,
        symlink: opts.symlink,
        matchers: parseMatcherPairs(opts.matcher),
        includeOptInHooks: opts.includeOptInHooks
      });
      success(`installed Claude Code plugin at ${target}`);
    }
  );
  plugin.command("uninstall").description("Remove the project-local OpenBox Claude Code plugin only").option("--scope <scope>", "project only", "project").option("--cwd <dir>", "Project root for --scope project").option("--target <dir>", "Explicit Claude Code plugin target directory").action(async (opts) => {
    const { uninstallClaudeCodePlugin: uninstallClaudeCodePlugin2 } = await Promise.resolve().then(() => (init_claude_code2(), claude_code_exports));
    uninstallClaudeCodePlugin2({
      scope: parsePluginScope(opts.scope),
      cwd: opts.cwd,
      target: opts.target
    });
    success("removed Claude Code plugin");
  });
  claude.command("doctor").description("Verify the installed Claude Code surface and hook runtime readiness").option("--cwd <dir>", "Project root for project-local install").option("--plugin-target <dir>", "Claude Code project-local plugin target directory").option("--surface-only", "Check installed files only; skip runtime key/core validation", false).option("--no-core-validate", "Check runtime config and key format without calling core").option("--include-opt-in-hooks", "Validate an installation that intentionally includes opt-in hooks").option("--json", "Emit machine-readable JSON", false).action(async (opts) => {
    const {
      claudeCodeGovernanceSummary: claudeCodeGovernanceSummary2,
      claudeCodeRuntimeDiagnostics: claudeCodeRuntimeDiagnostics2,
      summarizeClaudeCodeChecks: summarizeClaudeCodeChecks2,
      verifyClaudeCodeInstall: verifyClaudeCodeInstall2
    } = await Promise.resolve().then(() => (init_claude_code2(), claude_code_exports));
    const checks = await Promise.resolve(
      opts.surfaceOnly ? verifyClaudeCodeInstall2({
        cwd: opts.cwd,
        pluginTarget: opts.pluginTarget,
        includeOptInHooks: opts.includeOptInHooks
      }) : verifyClaudeCodeInstall2({
        cwd: opts.cwd,
        pluginTarget: opts.pluginTarget,
        includeOptInHooks: opts.includeOptInHooks,
        includeRuntime: true,
        validateRuntime: opts.coreValidate !== false
      })
    );
    const counts = summarizeClaudeCodeChecks2(checks);
    const payload = {
      checks,
      summary: counts,
      runtimeReadiness: claudeCodeRuntimeDiagnostics2(opts.cwd),
      claudeCodeGovernance: claudeCodeGovernanceSummary2()
    };
    if (opts.json || isMachineMode()) {
      output(payload);
    } else {
      for (const c of checks) {
        row(c.name, c.status, c.detail ? `${c.detail}${c.path ? ` (${c.path})` : ""}` : c.path);
      }
      summary(counts);
    }
    if (counts.fail > 0) bailWith(EXIT.GENERIC);
  });
}

// ts/src/cli/commands/cursor.ts
init_output();
init_non_interactive();
function collectPair2(value, prior) {
  return [...prior, value];
}
function parseMatcherPairs2(pairs) {
  const matchers = {};
  for (const pair of pairs ?? []) {
    const idx = pair.indexOf("=");
    if (idx <= 0) {
      error(`--matcher: invalid pair '${pair}', expected <event>=<regex>`);
      bailWith(EXIT.USAGE);
    }
    matchers[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
  }
  return Object.keys(matchers).length > 0 ? matchers : void 0;
}
function registerCursorCommands(program2) {
  const cursor = program2.command("cursor").description("Cursor IDE integration");
  cursor.command("hook").description("Run the OpenBox hook handler (invoked by Cursor per hook event)").action(async () => {
    const { runCursorHook: runCursorHook2 } = await Promise.resolve().then(() => (init_hook_handler2(), hook_handler_exports2));
    try {
      await runCursorHook2();
    } catch (err) {
      error(`cursor hook: ${err.message}`);
      bailWith(EXIT.OK);
    }
  });
  const plugin = cursor.command("plugin").description("Export or install the local OpenBox Cursor plugin");
  plugin.command("export").description("Write a complete marketplace-ready Cursor plugin folder").requiredOption("--out <dir>", "Output directory").option(
    "--matcher <pair>",
    "Hook matcher pair `<event>=<regex>` copied into hooks/hooks.json. Repeatable.",
    collectPair2,
    []
  ).action(async (opts) => {
    const { exportCursorPlugin: exportCursorPlugin2, verifyCursorPlugin: verifyCursorPlugin2 } = await Promise.resolve().then(() => (init_cursor2(), cursor_exports));
    const out = exportCursorPlugin2({
      out: opts.out,
      matchers: parseMatcherPairs2(opts.matcher)
    });
    const checks = verifyCursorPlugin2({ target: out });
    const failed = checks.filter((check) => check.status === "fail");
    if (failed.length > 0) {
      output({ out, checks });
      bailWith(EXIT.GENERIC);
    }
    success(`exported Cursor plugin to ${out}`);
  });
  plugin.command("install").description("Install the project-local OpenBox Cursor plugin only").option("--cwd <dir>", "Project root for project-local install").option("--target <dir>", "Cursor project-local plugin target directory").option("--symlink <dir>", "Symlink an already-exported plugin folder into Cursor").option(
    "--matcher <pair>",
    "Hook matcher pair `<event>=<regex>` copied into hooks/hooks.json. Repeatable.",
    collectPair2,
    []
  ).action(
    async (opts) => {
      const { installCursorPlugin: installCursorPlugin2 } = await Promise.resolve().then(() => (init_cursor2(), cursor_exports));
      const target = installCursorPlugin2({
        cwd: opts.cwd,
        target: opts.target,
        symlink: opts.symlink,
        matchers: parseMatcherPairs2(opts.matcher)
      });
      success(`installed Cursor plugin at ${target}`);
    }
  );
  plugin.command("uninstall").description("Remove the project-local OpenBox Cursor plugin only").option("--cwd <dir>", "Project root for project-local install").option("--target <dir>", "Cursor project-local plugin target directory").action(async (opts) => {
    const { uninstallCursorPlugin: uninstallCursorPlugin2 } = await Promise.resolve().then(() => (init_cursor2(), cursor_exports));
    uninstallCursorPlugin2({ cwd: opts.cwd, target: opts.target });
    success("removed Cursor plugin");
  });
  cursor.command("doctor").description(
    "Verify the installed Cursor surface and hook runtime readiness."
  ).option("--cwd <dir>", "Project root for project-local install").option("--plugin-target <dir>", "Cursor project-local plugin target directory").option("--surface-only", "Check installed files only; skip runtime key/core validation", false).option("--no-core-validate", "Check runtime config and key format without calling core").option("--json", "Emit machine-readable JSON", false).action(async (opts) => {
    const { verifyCursorInstall: verifyCursorInstall2 } = await Promise.resolve().then(() => (init_install(), install_exports));
    const base2 = {
      cwd: opts.cwd,
      pluginTarget: opts.pluginTarget
    };
    const checks = opts.surfaceOnly ? verifyCursorInstall2(base2) : await verifyCursorInstall2({
      ...base2,
      includeRuntime: true,
      validateRuntime: opts.coreValidate !== false
    });
    const failed = checks.filter((c) => c.status === "fail");
    const skipped = checks.filter((c) => c.status === "skip");
    const counts = {
      pass: checks.length - failed.length - skipped.length,
      skip: skipped.length,
      fail: failed.length
    };
    if (opts.json || isMachineMode()) {
      output({ checks, summary: counts });
    } else {
      for (const c of checks) row(c.name, c.status, c.detail ? `${c.detail}${c.path ? ` (${c.path})` : ""}` : c.path);
      summary(counts);
    }
    if (failed.length > 0) bailWith(EXIT.GENERIC);
  });
}

// ts/src/cli/commands/install.ts
init_output();
function parseHostScope(raw, _host) {
  const value = (raw ?? "project").toLowerCase();
  if (value !== "project") {
    error(`--scope: invalid value '${raw}'; expected project`);
    bailWith(EXIT.USAGE);
  }
  return "project";
}
function collect(value, prev) {
  return prev.concat([value]);
}
function parseMatchers(pairs) {
  const matchers = {};
  for (const pair of pairs ?? []) {
    const idx = pair.indexOf("=");
    if (idx <= 0) {
      error(`--matcher: invalid pair '${pair}', expected <event>=<regex>`);
      bailWith(EXIT.USAGE);
    }
    matchers[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
  }
  return Object.keys(matchers).length > 0 ? matchers : void 0;
}
function printChecks(checks, help) {
  const failed = checks.filter((check) => check.status === "fail");
  for (const check of checks) {
    row(check.name, check.status, check.detail ?? check.path);
  }
  if (failed.length > 0) {
    error("Install verification failed", { help });
    bailWith(EXIT.GENERIC);
  }
}
function registerInstallCommands(program2) {
  const install = program2.command("install").description("Install OpenBox client surfaces").action(() => install.help());
  install.command("cursor").description("Install the project-local Cursor plugin").option("--cwd <dir>", "Project root for project-local install").option("--plugin-target <dir>", "Cursor project-local plugin target directory").option("--symlink <dir>", "Symlink an already-exported plugin folder into Cursor").option(
    "--matcher <pair>",
    "Hook matcher pair `<event>=<regex>` copied into the plugin's hooks/hooks.json. Repeatable.",
    collect,
    []
  ).action(
    async (opts) => {
      const { installCursorPlugin: installCursorPlugin2, verifyCursorInstall: verifyCursorInstall2 } = await Promise.resolve().then(() => (init_cursor2(), cursor_exports));
      const cwd = opts.cwd ?? process.cwd();
      const target = installCursorPlugin2({
        cwd,
        target: opts.pluginTarget,
        symlink: opts.symlink,
        matchers: parseMatchers(opts.matcher)
      });
      success(`Cursor plugin installed at ${target}`);
      info("");
      const checks = verifyCursorInstall2({ cwd, pluginTarget: opts.pluginTarget });
      printChecks(checks, "run `openbox cursor doctor --json` for details");
    }
  );
  install.command("claude-code").description(
    "Install the project-local Claude Code plugin: hooks, MCP server entry, slash commands, agent, and OpenBox skill."
  ).option(
    "--scope <scope>",
    "project only",
    "project"
  ).option("--cwd <dir>", "Project root for --scope project").option("--plugin-target <dir>", "Explicit Claude Code plugin target directory").option("--symlink <dir>", "Symlink an already-exported plugin folder into Claude Code").option(
    "--matcher <pair>",
    "Hook matcher pair `<event>=<regex>` copied into the plugin's hooks/hooks.json. Repeatable.",
    collect,
    []
  ).option("--include-opt-in-hooks", "Also install opt-in hook events such as SessionEnd; WorktreeCreate remains diagnostic-only").action(async (opts) => {
    const scope = parseHostScope(opts.scope, "claude-code");
    const cwd = opts.cwd ?? process.cwd();
    const { installClaudeCodePlugin: installClaudeCodePlugin2, verifyClaudeCodePlugin: verifyClaudeCodePlugin2 } = await Promise.resolve().then(() => (init_claude_code2(), claude_code_exports));
    const target = installClaudeCodePlugin2({
      scope,
      cwd,
      target: opts.pluginTarget,
      symlink: opts.symlink,
      matchers: parseMatchers(opts.matcher),
      includeOptInHooks: opts.includeOptInHooks
    });
    success(`Claude Code plugin installed at ${target}`);
    info("");
    const checks = verifyClaudeCodePlugin2({ scope, cwd, target: opts.pluginTarget });
    printChecks(checks, "run `openbox claude-code plugin export --out <dir>` for manual inspection");
  });
  const uninstall = program2.command("uninstall").description("Remove OpenBox client surfaces").action(() => uninstall.help());
  uninstall.command("cursor").description("Remove the project-local Cursor plugin").option("--cwd <dir>", "Project root for project-local install").option("--plugin-target <dir>", "Cursor project-local plugin target directory").action(
    async (opts) => {
      const { uninstallCursorPlugin: uninstallCursorPlugin2 } = await Promise.resolve().then(() => (init_cursor2(), cursor_exports));
      uninstallCursorPlugin2({ cwd: opts.cwd, target: opts.pluginTarget });
      success("Cursor plugin removed");
    }
  );
  uninstall.command("claude-code").description("Remove the project-local Claude Code plugin").option("--scope <scope>", "project only", "project").option("--cwd <dir>", "Project root for --scope project").option("--plugin-target <dir>", "Explicit Claude Code plugin target directory").action(async (opts) => {
    const scope = parseHostScope(opts.scope, "claude-code");
    const cwd = opts.cwd ?? process.cwd();
    const { uninstallClaudeCodePlugin: uninstallClaudeCodePlugin2 } = await Promise.resolve().then(() => (init_claude_code2(), claude_code_exports));
    uninstallClaudeCodePlugin2({ scope, cwd, target: opts.pluginTarget });
    success("Claude Code plugin removed");
  });
}

// ts/src/cli/commands/doctor.ts
init_core_client2();
import { existsSync as existsSync12, readFileSync as readFileSync12 } from "fs";
init_env();
init_output();
init_non_interactive();
function registerDoctorCommand(program2) {
  program2.command("doctor").description("Diagnose CLI install: api-key store, backend/core reachability").action(async () => {
    const connection = resolveConnection();
    const urls = { apiUrl: connection.apiUrl, coreUrl: connection.coreUrl };
    const checks = [];
    const tokenPath = getTokenPath();
    checks.push({
      name: "token file",
      status: existsSync12(tokenPath) ? "pass" : "skip",
      detail: existsSync12(tokenPath) ? tokenPath : `(none; first run sets up via auth set-api-key)`
    });
    const apiKey = loadApiKey();
    const haveKey = !!apiKey;
    checks.push({
      name: "api-key",
      status: haveKey ? "pass" : "fail",
      detail: haveKey ? `${apiKey.slice(0, 12)}\u2026` : "missing; run: openbox auth set-api-key"
    });
    checks.push({
      name: "backend URL",
      status: "skip",
      detail: urls.apiUrl
    });
    if (haveKey) {
      try {
        await getClient().health();
        checks.push({ name: "backend /health", status: "pass", detail: "200 OK" });
      } catch (err) {
        const msg = err.message || String(err);
        const isNetwork = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(msg);
        const detail = isNetwork ? `${msg}; backend URL unreachable from this machine - check OPENBOX_API_URL or your network` : `${msg}; run: openbox auth set-api-key (key may be invalid)`;
        checks.push({ name: "backend /health", status: "fail", detail });
      }
    }
    checks.push({ name: "core URL", status: "skip", detail: urls.coreUrl });
    const coreApiKey = process.env.OPENBOX_API_KEY;
    const agentIdentity = resolveAgentIdentity();
    try {
      const core = new OpenBoxCoreClient({ apiUrl: urls.coreUrl, apiKey: coreApiKey ?? "", agentIdentity });
      await core.health();
      checks.push({ name: "core /health", status: "pass", detail: "200 OK" });
    } catch (err) {
      const msg = err.message || String(err);
      const isNetwork = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(msg);
      const detail = isNetwork ? `${msg}; core URL unreachable from this machine - check OPENBOX_CORE_URL or your network` : msg;
      checks.push({ name: "core /health", status: "fail", detail });
    }
    if (!coreApiKey) {
      checks.push({
        name: "core API key",
        status: "skip",
        detail: "set OPENBOX_API_KEY to validate core credentials"
      });
    } else {
      try {
        const core = new OpenBoxCoreClient({ apiUrl: urls.coreUrl, apiKey: coreApiKey, agentIdentity });
        await core.validateApiKey();
        checks.push({ name: "core API key", status: "pass", detail: "valid" });
      } catch (err) {
        checks.push({ name: "core API key", status: "fail", detail: err.message || String(err) });
      }
    }
    try {
      readFileSync12(tokenPath, "utf-8");
      checks.push({ name: "token file", status: "pass", detail: "readable" });
    } catch {
    }
    const failed = checks.filter((c) => c.status === "fail");
    const warned = checks.filter((c) => c.status === "warn");
    const counts = {
      pass: checks.length - failed.length - warned.length,
      warn: warned.length,
      fail: failed.length
    };
    if (isMachineMode()) {
      output({ checks, summary: counts });
      if (failed.length > 0) bailWith(EXIT.GENERIC);
      return;
    }
    for (const c of checks) {
      const status = c.status === "skip" ? "unchanged" : c.status;
      row(c.name, status, c.detail);
    }
    summary(counts);
    if (failed.length > 0) bailWith(EXIT.GENERIC);
  });
}

// ts/src/cli/commands/verify.ts
init_govern();
import { readFileSync as readFileSync13, readdirSync as readdirSync4, statSync as statSync3, existsSync as existsSync13 } from "fs";
import { join as join6, extname, relative } from "path";
init_output();
var SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", "coverage", "__pycache__", ".venv", "venv", ".pnpm-store"]);
var SCAN_EXTS = /* @__PURE__ */ new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".java", ".kt", ".rs"]);
function walk(root, out = []) {
  const entries = readdirSync4(root);
  for (const e of entries) {
    if (SKIP_DIRS.has(e) || e.startsWith(".") && e !== ".env.example") continue;
    const full = join6(root, e);
    let st;
    try {
      st = statSync3(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile() && SCAN_EXTS.has(extname(e))) out.push(full);
  }
  return out;
}
function matchLines(origLines, re, opts = {}) {
  const out = [];
  const scanLines = opts.raw ? origLines : stripComments(origLines.join("\n")).split("\n");
  for (let i = 0; i < scanLines.length; i++) {
    if (re.test(scanLines[i])) out.push({ line: i + 1, snippet: origLines[i].trim().slice(0, 160) });
  }
  return out;
}
function stripComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    const nl = (match.match(/\n/g) || []).length;
    return "\n".repeat(nl);
  }).replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/^\s*#[^\n]*/gm, "");
}
var rules = [
  {
    name: "activity_input-must-be-array",
    severity: "error",
    message: "`activity_input` must be an ARRAY, not an object. Sending a bare object returns 422 at core (or 500 downstream from AGE).",
    fix: 'Wrap as [{...}]. Single payloads: `"activity_input": [{ "prompt": "..." }]`.',
    appliesTo: () => true,
    detect: (_content, lines) => {
      const all = matchLines(lines, /["']?activity_input["']?\s*[:=]\s*\{/);
      return all.filter((hit) => !/\[\s*\{/.test(hit.snippet));
    }
  },
  {
    name: "invented-verdict",
    severity: "error",
    message: "Invented verdict string. The production verdicts are `allow`, `constrain`, `require_approval`, `block`, `halt`. `deny` and `ask` are not OpenBox verdicts.",
    fix: "Use one of the five production verdicts. For `constrain`, continue only with the transformed/redacted payload returned by OpenBox.",
    appliesTo: () => true,
    detect: (_content, lines) => {
      const re = /(verdict|decision|action)\s*[:=]\s*["'](deny|ask)["']|case\s+["'](deny|ask)["']|(===|==)\s*["'](deny|ask)["']/;
      return matchLines(lines, re);
    }
  },
  {
    name: "stage-both-silent-noop",
    severity: "error",
    message: "`--stage both` (or any non-0/1 value) is silently ignored by the guardrails service; the guardrail never fires.",
    fix: "Use `--stage 0` (input/ActivityStarted) or `--stage 1` (output/ActivityCompleted). For both coverage, create two separate guardrails.",
    appliesTo: () => true,
    detect: (content, lines) => matchLines(lines, /--stage\s+both\b|processing_stage["']?\s*[:=]\s*["']both["']/)
  },
  {
    name: "invented-activity-type",
    severity: "warn",
    message: "Non-canonical `activity_type` string. First-party SDKs use past-tense PascalCase (`LLMCompleted`, `ToolCompleted`, `PromptSubmission`, `FileRead`, `ShellExecution`, `MCPToolCall`). Non-canonical strings silently miss guardrail config.",
    fix: 'Use the canonical names from references/governance-flow.md \xA7 "Canonical activity_type Names" so guardrail bindings match.',
    appliesTo: () => true,
    detect: (content, lines) => {
      const invented = /(["']?activity[_-]?type["']?\s*[:=]\s*["']|["']?activityType["']?\s*[:=]\s*["']|--type\s+["']?)(LLMCompletion|LLMInvocation|ToolInvocation|FileReading|FileWriting|ShellCommand|MCPInvocation|PromptSubmitted)/;
      return matchLines(lines, invented);
    }
  },
  {
    name: "raw-approval-response-verdict",
    severity: "warn",
    message: "`/api/v1/governance/approval` wire response is `{ id, action, reason, approval_expiration_time }`; `action`, not `verdict`. The TS SDK normalizes; raw-HTTP callers must read `.action`.",
    fix: "Read `response.action` for raw HTTP polling, or `response.verdict || response.action` to work with both shapes.",
    appliesTo: () => true,
    detect: (content, origLines) => {
      const out = [];
      const stripped = stripComments(content);
      if (!/\/governance\/approval/.test(stripped)) return out;
      const lines = stripped.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (/\.verdict\b/.test(lines[i]) && !/\.verdict\s*\|\|\s*.*\.action/.test(lines[i])) {
          const start = Math.max(0, i - 20);
          if (lines.slice(start, i + 1).some((l) => /approval/i.test(l))) {
            out.push({ line: i + 1, snippet: origLines[i].trim().slice(0, 160) });
          }
        }
      }
      return out;
    }
  },
  {
    name: "missing-x-openbox-client-header",
    severity: "error",
    message: "`X-Openbox-Client` header is required on every backend call (enforced at the edge on hosted deploys, and by middleware on self-hosted deploys that run feat/x-openbox-client-middleware). Missing it \u2192 401 even with a valid bearer.",
    fix: "Add `X-Openbox-Client: <your-client-name>` alongside `Authorization: Bearer`.",
    appliesTo: () => true,
    detect: (content) => {
      const out = [];
      const stripped = stripComments(content);
      const backendPath = /\/(auth\/(profile|refresh|login|set-token|roles|change-password|permissions|features)|agent(\/|s\?|s$)|guardrail|policy|behavior-rule|session|team|org|member|trust|violation|observability|aivss|goal|approval|audit|api-key|health\?|health$)/;
      if (!backendPath.test(stripped)) return out;
      if (!/X-Openbox-Client/i.test(stripped)) {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (backendPath.test(lines[i])) {
            out.push({ line: i + 1, snippet: lines[i].trim().slice(0, 160) });
            break;
          }
        }
      }
      return out;
    }
  },
  {
    name: "hardcoded-uuid",
    severity: "warn",
    message: "UUID literal that looks like an agent/team/org ID. These are user-specific and must be resolved at runtime.",
    fix: "Derive from `openbox auth profile`, generated backend API calls, or the dashboard; pass via env var / config.",
    appliesTo: (path16) => !/test|spec|\.md$|fixture|seed|examples?\//i.test(path16),
    detect: (_content, origLines) => {
      const strippedLines = stripComments(origLines.join("\n")).split("\n");
      const out = [];
      const uuidRe = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
      const contextRe = /(agent|team|org|organization|policy|guardrail).{0,20}(id|_id|Id)/i;
      for (let i = 0; i < strippedLines.length; i++) {
        if (uuidRe.test(strippedLines[i]) && contextRe.test(strippedLines[i])) {
          out.push({ line: i + 1, snippet: origLines[i].trim().slice(0, 160) });
        }
      }
      return out;
    }
  },
  {
    name: "missing-finally-workflow-complete",
    severity: "info",
    message: "A `WorkflowStarted` event appears without an obvious `finally`/`defer`/`try/catch` structure nearby guaranteeing `WorkflowCompleted` / `WorkflowFailed` on failure paths.",
    fix: 'Wrap the lifecycle: emit start inside try, emit completed/failed in finally (JS/Python) or defer (Go). See references/governance-flow.md \xA7 "Nothing dangles".',
    appliesTo: (path16) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/.test(path16),
    detect: (content, lines) => {
      const out = [];
      const strippedLines = stripComments(content).split("\n");
      const startRe = /WorkflowStarted|workflow_?started|workflowStarted/;
      const closerRe = /\b(finally|defer|except|__exit__|ensure)\b/;
      for (let i = 0; i < lines.length; i++) {
        if (startRe.test(lines[i])) {
          const window = strippedLines.slice(Math.max(0, i - 20), Math.min(strippedLines.length, i + 40)).join("\n");
          if (!closerRe.test(window)) {
            out.push({ line: i + 1, snippet: lines[i].trim().slice(0, 160) });
          }
        }
      }
      return out;
    }
  },
  {
    name: "activity-started-without-completed",
    severity: "info",
    message: "A path emits `ActivityStarted` without an obvious paired `ActivityCompleted` in the same scope. Orphan activities break output-stage guardrails and trust scoring.",
    fix: 'Every Started must be Completed; on success AND failure. See references/governance-flow.md \xA7 "Nothing dangles".',
    appliesTo: (path16) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/.test(path16),
    detect: (content, origLines) => {
      const stripped = stripComments(content);
      const strippedLines = stripped.split("\n");
      const out = [];
      const startRe = /\bActivityStarted\b|activity_?started\b/;
      const completedRe = /\bActivityCompleted\b|activity_?completed\b/;
      if (!startRe.test(stripped)) return out;
      for (let i = 0; i < strippedLines.length; i++) {
        if (startRe.test(strippedLines[i])) {
          const start = Math.max(0, i - 40);
          const end = Math.min(strippedLines.length, i + 40);
          const window = strippedLines.slice(start, end).join("\n");
          if (!completedRe.test(window)) {
            out.push({ line: i + 1, snippet: origLines[i].trim().slice(0, 160) });
          }
        }
      }
      return out;
    }
  },
  {
    name: "non-canonical-event-type",
    severity: "error",
    message: "Non-canonical `event_type` string. Core accepts exactly six: WorkflowStarted, SignalReceived, ActivityStarted, ActivityCompleted, WorkflowCompleted, WorkflowFailed.",
    fix: "Use one of the six canonical event types. Unknown strings silently no-op downstream classifiers (no guardrail / AGE / trust evaluation).",
    appliesTo: () => true,
    detect: (_content, origLines) => {
      const strippedLines = stripComments(origLines.join("\n")).split("\n");
      const out = [];
      const re = /["']?event_type["']?\s*[:=]\s*["']([A-Za-z_]+)["']/g;
      for (let i = 0; i < strippedLines.length; i++) {
        for (const m of strippedLines[i].matchAll(re)) {
          if (!CANONICAL_EVENT_TYPES.has(m[1])) {
            out.push({ line: i + 1, snippet: origLines[i].trim().slice(0, 160) });
          }
        }
      }
      return out;
    }
  },
  {
    name: "span-missing-gate-attribute",
    severity: "warn",
    message: "Span construction missing the gate attribute its classifier needs; core will fall through to `internal` semantic type and behavior rules won't fire.",
    fix: "HTTP spans need `http.method`; DB spans need `db.system`; file spans need `file.path`; LLM spans need http.method=POST + http.url matching a known LLM domain (gen_ai.system alone is NOT sufficient).",
    appliesTo: () => true,
    detect: (content, lines) => {
      const out = [];
      const stripped = stripComments(content);
      const hookTypes = [
        ["http_request", /http\.method/, "http.method"],
        ["db_query", /db\.system/, "db.system"],
        ["file_read", /file\.path/, "file.path"],
        ["file_write", /file\.path/, "file.path"]
      ];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const [hook, attrRe, attrName] of hookTypes) {
          if (new RegExp(`hook_type["']?\\s*[:=]\\s*["']${hook}["']`).test(line)) {
            const window = stripped.split("\n").slice(Math.max(0, i - 8), Math.min(lines.length, i + 12)).join("\n");
            if (!attrRe.test(window)) {
              out.push({ line: i + 1, snippet: `${line.trim().slice(0, 120)}; missing gate attr \`${attrName}\` nearby` });
            }
          }
        }
      }
      return out;
    }
  },
  {
    name: "id-generated-per-event-not-reused",
    severity: "warn",
    message: "`workflow_id` or `run_id` appears to be generated inline per event instead of generated once and reused. IDs must stay constant across every event in a session, otherwise core creates orphan workflows and trust scoring never finalizes.",
    fix: "Generate workflow_id + run_id once at session start, store them, reuse on every subsequent event. activity_id is per-action.",
    appliesTo: () => true,
    detect: (_content, lines) => {
      const re = /(["']?)(workflow_id|run_id)\1\s*[:=]\s*(uuid4\(\)|uuid\.uuid4\(\)|uuid\(\)|randomUUID\(\)|crypto\.randomUUID\(\)|nanoid\(\))/;
      return matchLines(lines, re);
    }
  },
  {
    name: "approval-poll-unbounded",
    severity: "warn",
    message: "Approval polling loop with no obvious timeout/max-wait bound. An indefinite poll on `/governance/approval` can hang forever if the human decision is never made.",
    fix: "Bound the loop: use the SDK's `hitlMaxWait` (default 300s), or check `approval_expiration_time` against now(), or track elapsed time and give up after N seconds and treat as block.",
    appliesTo: () => true,
    detect: (content) => {
      const out = [];
      if (!/\/governance\/approval/.test(content)) return out;
      const strippedLines = stripComments(content).split("\n");
      const lines = content.split("\n");
      const boundRe = /(maxWait|max_wait|hitlMaxWait|approval_expiration_time|elapsed|\btimeout\b|AbortSignal|deadline|Date\.now\(\)\s*[-+])/i;
      for (let i = 0; i < lines.length; i++) {
        if (/\/governance\/approval/.test(lines[i])) {
          const start = Math.max(0, i - 15);
          const end = Math.min(strippedLines.length, i + 30);
          const window = strippedLines.slice(start, end).join("\n");
          if (!boundRe.test(window)) {
            out.push({ line: i + 1, snippet: lines[i].trim().slice(0, 160) });
            break;
          }
        }
      }
      return out;
    }
  },
  {
    name: "require-approval-no-hitl-enabled",
    severity: "warn",
    message: "Code branches on the `require_approval` verdict but doesn't set `hitlEnabled: true` on the SDK config; the SDK will throw `ApprovalDisabledError` instead of polling.",
    fix: 'Set `hitlEnabled: true` in the SDK config, or if using raw HTTP, make sure the approval-polling loop is wired (see references/governance-flow.md \xA7 "Approval Polling").',
    appliesTo: () => true,
    detect: (content) => {
      const out = [];
      const stripped = stripComments(content);
      const branchesOnApproval = /["']require_approval["']/.test(stripped);
      if (!branchesOnApproval) return out;
      const usesSdk = /from ['"]openbox-sdk['"]|govern\s*\(/.test(stripped);
      const hasHitlEnabled = /hitlEnabled\s*:\s*true/.test(stripped);
      const hasPollingLoop = /\/governance\/approval/.test(stripped);
      const lines = content.split("\n");
      if (usesSdk && !hasHitlEnabled) {
        for (let i = 0; i < lines.length; i++) {
          if (/["']require_approval["']/.test(lines[i])) {
            out.push({ line: i + 1, snippet: lines[i].trim().slice(0, 160) });
            return out;
          }
        }
      } else if (!usesSdk && !hasPollingLoop) {
        for (let i = 0; i < lines.length; i++) {
          if (/["']require_approval["']/.test(lines[i])) {
            out.push({ line: i + 1, snippet: `${lines[i].trim().slice(0, 120)}; no approval-poll loop visible` });
            return out;
          }
        }
      }
      return out;
    }
  }
];
function scanFile(file, root) {
  let content;
  try {
    content = readFileSync13(file, "utf-8");
  } catch {
    return [];
  }
  const lines = content.split("\n");
  const rel = relative(root, file);
  const findings = [];
  for (const rule of rules) {
    if (!rule.appliesTo(file)) continue;
    const hits = rule.detect(content, lines);
    for (const h of hits) {
      findings.push({
        severity: rule.severity,
        rule: rule.name,
        file: rel,
        line: h.line,
        snippet: h.snippet,
        message: rule.message,
        fix: rule.fix
      });
    }
  }
  return findings;
}
function printReport(findings, totalFiles, rootLabel) {
  const errs = findings.filter((f) => f.severity === "error");
  const warns = findings.filter((f) => f.severity === "warn");
  const infos = findings.filter((f) => f.severity === "info");
  const byRule = /* @__PURE__ */ new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }
  info(`openbox verify; scanned ${totalFiles} file(s) under ${rootLabel}`);
  info("");
  if (findings.length === 0) {
    success("no drift patterns detected.");
    info("  (This is a static scan. Use OpenBox dashboard/API session reads to validate live protocol behavior.)");
    summary({ pass: 1, fail: 0, warn: 0 });
    return { errors: 0, warns: 0, infos: 0 };
  }
  for (const [rule, hits] of byRule) {
    const sev = hits[0].severity;
    const status = sev === "error" ? "fail" : sev === "warn" ? "warn" : "info";
    info(`${status === "fail" ? "[fail]" : status === "warn" ? "[warn]" : "[info]"} ${rule}; ${hits.length} finding${hits.length === 1 ? "" : "s"}`);
    info(`  ${hits[0].message}`);
    if (hits[0].fix) info(`  fix: ${hits[0].fix}`);
    for (const h of hits.slice(0, 10)) {
      info(`    ${h.file}:${h.line}  ${h.snippet}`);
    }
    if (hits.length > 10) info(`    \u2026 and ${hits.length - 10} more`);
    info("");
  }
  summary({ fail: errs.length, warn: warns.length, pass: 0 });
  if (infos.length > 0) info(`(${infos.length} info-level finding${infos.length === 1 ? "" : "s"} not counted in summary)`);
  return { errors: errs.length, warns: warns.length, infos: infos.length };
}
function registerVerifyCommand(program2) {
  program2.command("verify [path]").description("Static lint: scan integration code for OpenBox protocol drift").option("--fail-on <severity>", "Exit non-zero on this severity or worse (error|warn|info)", "error").option("--json", "Emit findings as JSON instead of human-readable", false).action(async (path16, opts) => {
    const root = path16 ? path16.startsWith("/") ? path16 : join6(process.cwd(), path16) : process.cwd();
    if (!existsSync13(root)) {
      error(`path not found: ${root}`);
      bailWith(EXIT.USAGE);
    }
    const st = statSync3(root);
    const files = st.isDirectory() ? walk(root) : [root];
    const findings = [];
    for (const f of files) {
      findings.push(...scanFile(f, st.isDirectory() ? root : process.cwd()));
    }
    if (opts.json) {
      output({ root, scanned: files.length, findings });
    } else {
      printReport(findings, files.length, root);
    }
    const bySev = { error: 3, warn: 2, info: 1 };
    const threshold = bySev[opts.failOn] ?? 3;
    const worst = Math.max(
      0,
      ...findings.map((f) => bySev[f.severity] ?? 0)
    );
    if (worst >= threshold) bailWith(EXIT.GENERIC);
  });
}

// ts/src/cli/index.ts
init_output();
var program = new Command();
var commandTreeConfigured = false;
var activeArgv = process.argv;
function packageVersion3() {
  for (const rel of ["../../package.json", "../../../package.json"]) {
    try {
      const pkg = JSON.parse(
        readFileSync14(new URL(rel, import.meta.url), "utf8")
      );
      if (typeof pkg.version === "string" && pkg.version.length > 0)
        return pkg.version;
    } catch {
    }
  }
  return "0.0.0";
}
function deepestRegisteredPath() {
  const argv2 = activeArgv.slice(2);
  const positionals = [];
  for (let i = 0; i < argv2.length; i++) {
    const a = argv2[i];
    if (a.startsWith("-")) break;
    positionals.push(a);
  }
  let cmd = program;
  const path16 = [];
  for (const tok of positionals) {
    const sub = cmd.commands.find((c) => c.name() === tok);
    if (!sub) break;
    path16.push(tok);
    cmd = sub;
  }
  return path16.length > 0 ? path16.join(" ") : null;
}
function helpRef(cmd) {
  const c = cmd ?? deepestRegisteredPath();
  return c ? `see \`openbox ${c} --help\`` : "see `openbox --help`";
}
function emitCommanderError(err) {
  const m = err.message;
  switch (err.code) {
    case "commander.excessArguments": {
      const cmd = m.match(/for '([^']+)'/)?.[1];
      const positionals = [];
      for (const arg of activeArgv.slice(2)) {
        if (arg.startsWith("-")) break;
        positionals.push(arg);
      }
      const extra = positionals[positionals.length - 1];
      if (cmd && extra && extra !== cmd) {
        error(`'${extra}' is not a subcommand of '${cmd}'`, {
          help: `${helpRef(cmd)} for valid subcommands and options`
        });
      } else if (cmd) {
        error(`'${cmd}' got unexpected positional argument(s)`, {
          help: helpRef(cmd)
        });
      } else {
        error("unexpected positional argument(s)", { help: helpRef() });
      }
      return;
    }
    case "commander.unknownOption": {
      const opt = m.match(/'([^']+)'/)?.[1] ?? "<flag>";
      error(`unknown option \`${opt}\``, { help: helpRef() });
      return;
    }
    case "commander.unknownCommand": {
      const cmd = m.match(/'([^']+)'/)?.[1];
      error(cmd ? `unknown command \`${cmd}\`` : "unknown command", {
        help: "see `openbox --help` for the full command list"
      });
      return;
    }
    case "commander.missingArgument": {
      const arg = m.match(/'([^']+)'/)?.[1] ?? "<arg>";
      error(`missing required argument <${arg}>`, { help: helpRef() });
      return;
    }
    case "commander.optionMissingArgument": {
      const opt = m.match(/'([^']+)'/)?.[1] ?? "<flag>";
      error(`option \`${opt}\` is missing its value`, { help: helpRef() });
      return;
    }
    case "commander.missingMandatoryOptionValue": {
      const opt = m.match(/'([^']+)'/)?.[1] ?? "<flag>";
      error(`missing required option \`${opt}\``, { help: helpRef() });
      return;
    }
    case "commander.invalidArgument":
    case "commander.invalidOptionArgument":
    case "commander.conflictingOption": {
      error(m.replace(/^error:\s*/, "").replace(/\.\s*$/, ""));
      return;
    }
    default:
      error(m.replace(/^error:\s*/, "").replace(/\.\s*$/, ""));
  }
}
function exitForCommanderError(err) {
  if (err.code === "commander.help" || err.code === "commander.helpDisplayed" || err.code === "commander.version") {
    bailWith(EXIT.OK);
  }
  emitCommanderError(err);
  bailWith(EXIT.USAGE);
}
function applyUniformErrorHandling(cmd) {
  cmd.configureOutput({ outputError: () => {
  } });
  cmd.exitOverride(exitForCommanderError);
  for (const sub of cmd.commands) applyUniformErrorHandling(sub);
}
program.name("openbox").description("openbox-sdk").version(packageVersion3()).option(
  "-y, --yes",
  "Assume yes on confirmation prompts. Implied by CI=1, OPENBOX_NONINTERACTIVE=1, or non-TTY stdin."
).option(
  "--non-interactive",
  "Hard-fail instead of prompting on missing input. Implied by CI=1 or OPENBOX_NONINTERACTIVE=1."
).option(
  "--no-color",
  "Disable ANSI color output. Implied by NO_COLOR=1, OPENBOX_NO_COLOR=1, or CI=1"
).option(
  "-q, --quiet",
  "Suppress non-essential progress lines on stderr (errors still print)"
).option(
  "--json",
  "Emit machine-readable JSON instead of human-rendered output"
).hook("preAction", (thisCommand, actionCommand) => {
  const commandPath = buildCommandKey(actionCommand);
  const projectScopedHook = commandPath === "claude-code hook";
  if (!projectScopedHook) {
    applyEnvSource();
  }
  const required = COMMAND_PERMISSIONS[commandPath];
  if (!required || required.length === 0) return;
  const have = loadPermissions();
  if (have.length === 0) return;
  const missing = missingPermissions(required, have);
  if (missing.length === 0) return;
  error(
    `missing permission for \`openbox ${commandPath}\`: ${missing.join(", ")}`,
    {
      detail: `api-key has ${have.length} permission(s); server returns 403 if any required ones are missing`,
      help: `ask your admin to grant the missing permission(s) for the active OpenBox connection`
    }
  );
  bailWith(EXIT.AUTH);
});
function buildCommandKey(cmd) {
  const parts = [];
  let c = cmd;
  while (c && c.parent) {
    parts.unshift(c.name());
    c = c.parent;
  }
  return parts.join(" ");
}
registerAuthCommands(program);
registerConnectCommand(program);
registerConfigCommands(program);
registerApiCommands(program);
registerHealthCommands(program);
registerMcpCommands(program);
registerClaudeCodeCommands(program);
registerCursorCommands(program);
registerInstallCommands(program);
registerDoctorCommand(program);
registerVerifyCommand(program);
function isCliEntrypoint() {
  const entrypoint = process.argv[1];
  if (!entrypoint) return false;
  const modulePath = fileURLToPath3(import.meta.url);
  try {
    return realpathSync(modulePath) === realpathSync(entrypoint);
  } catch {
    return modulePath === entrypoint;
  }
}
function configureCommandTree(argv2) {
  if (commandTreeConfigured) return;
  void argv2;
  applyUniformErrorHandling(program);
  commandTreeConfigured = true;
}
function rejectRemovedGlobalFlags(argv2) {
  const removed = argv2.slice(2).find(
    (arg) => arg === "--experimental" || arg.startsWith("--experimental=") || arg === "--feature" || arg.startsWith("--feature=")
  );
  if (!removed) return;
  error(`unknown option \`${removed}\``, { help: "see `openbox --help`" });
  bailWith(EXIT.USAGE);
}
async function runOpenBoxCli(argv2 = process.argv) {
  activeArgv = argv2;
  rejectRemovedGlobalFlags(argv2);
  configureCommandTree(argv2);
  if (argv2.length === 2) {
    program.outputHelp();
    bailWith(EXIT.OK);
  }
  await program.parseAsync(argv2).catch((err) => {
    reportAndExit(err);
  });
}
if (isCliEntrypoint()) {
  await runOpenBoxCli();
}
export {
  program,
  runOpenBoxCli
};
