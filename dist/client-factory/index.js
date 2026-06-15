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

// ts/src/client-factory/index.ts
var DEFAULT_CLIENT_NAME = "@openbox-ai/openbox-sdk/client-factory";
async function createConsumerClient(opts) {
  const connection = resolveConnection({
    apiUrl: opts.apiUrl,
    coreUrl: opts.coreUrl,
    authUrl: opts.authUrl,
    platformUrl: opts.platformUrl,
    stackUrl: opts.stackUrl
  });
  const apiBase = connection.apiUrl;
  const apiKey = await opts.getApiKey();
  if (!apiKey) {
    throw new Error(
      `OpenBox: no API key configured for the active connection. Run openbox connect <stack-url> --api-key <key> or use your consumer's auth flow.`
    );
  }
  const client = new OpenBoxClient({
    apiUrl: apiBase,
    apiKey,
    clientName: opts.clientName ?? DEFAULT_CLIENT_NAME,
    ...opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}
  });
  return { client, apiBase };
}
export {
  createConsumerClient
};
