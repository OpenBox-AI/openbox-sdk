// In-memory fixtures used when openbox.mockAuth is on. Smaller than
// mobile's __mocks__/fixtures.ts (921 lines) but covers the
// representative activity types the detail panel + summarizeInput
// branches on (Shell, File, HTTPRequest, MCPToolCall, plus a generic
// LLMCompleted). Decided rows persist into a separate bucket so the
// History view has content too.
//
// State is per-extension-host process; rebooting Cursor resets to the
// initial seed. The user can extend the live set via the "Seed Mock
// Data" command which appends N more pending rows.

import type { Approval, Member, Team } from "./types";

const NOW = () => Date.now();
const ISO = (offsetMs: number) => new Date(NOW() + offsetMs).toISOString();

// Mirrors the real backend's X-API-Key UserEntity shape (see
// the backend api-key service:validateApiKey).
// email = undefined, sub = "api-key:<id>", permissions[] carries the
// key's own scopes, isApiKeyAuth: true. Mock mode simulating JWT
// (with email + human sub) would mislead the Profile view's gating
// logic; this shape matches what the real X-API-Key flow returns.
const PROFILE = {
  sub: "api-key:mock-key-001",
  orgId: "mock-org-001",
  email: undefined,
  picture: null,
  permissions: [
    "read:agent",
    "create:agent",
    "update:agent",
    "delete:agent",
    "read:org",
    "update:org",
    "read:team",
    "read:user",
    "read:agent_session",
    "manage:agent_session",
    "read:agent_log",
  ],
  teamIds: [],
  isApiKeyAuth: true,
};

const MEMBERS: Member[] = [
  { id: "mock-user-001", username: "tester", email: "tester@openbox.local", firstName: "Demo", lastName: "Tester" },
  { id: "mock-user-002", username: "janedoe", email: "jane.doe@openbox.local", firstName: "Jane", lastName: "Doe" },
  { id: "mock-user-003", username: "rkumar", email: "r.kumar@openbox.local", firstName: "Rohit", lastName: "Kumar" },
];

const TEAMS: Team[] = [
  { id: "team-platform", name: "Platform" },
  { id: "team-secops", name: "SecOps" },
];

const AGENTS: Record<string, { agent_name: string; owner_id: string; teams: Team[] }> = {
  "agent-sre": { agent_name: "SRE Copilot", owner_id: "mock-user-003", teams: [TEAMS[0]] },
  "agent-secops": { agent_name: "SecOps Sentinel", owner_id: "mock-user-002", teams: [TEAMS[1]] },
  "agent-deploy": { agent_name: "Deploy Bot", owner_id: "mock-user-001", teams: [TEAMS[0]] },
};

interface SeedTemplate {
  agentId: string;
  activity_type: string;
  // Backend returns input as either an object or an array; the spec
  // currently types it narrowly. Mocks mirror real wire shapes so we
  // accept both and cast on assignment below.
  input: { [key: string]: unknown } | unknown[];
  reason: string;
  tier: number;
  createdMinutesAgo: number;
  expiresMinutes: number;
}

const SEED: SeedTemplate[] = [
  {
    agentId: "agent-sre",
    activity_type: "ShellExecution",
    input: [{ command: "kubectl rollout restart deployment/api-service -n production", cwd: "/srv/ops" }],
    reason: "Memory >85% post-3.2.0; rolling restart per RB-042.",
    tier: 1,
    createdMinutesAgo: 1,
    expiresMinutes: 5,
  },
  {
    agentId: "agent-deploy",
    activity_type: "FileEdit",
    input: [{ file_path: "/srv/api/config/feature-flags.yaml" }],
    reason: "Enable new tax calc rollout per FF-2026-Q2-007. Canary green.",
    tier: 2,
    createdMinutesAgo: 6,
    expiresMinutes: 15,
  },
  {
    agentId: "agent-secops",
    activity_type: "HTTPRequest",
    input: [{ method: "POST", url: "https://api.partner.com/v2/incidents/INC-3091/escalate", body: '{"severity":"P1"}' }],
    reason: "Partner on-call escalation for joint INC-3091; pre-approved via joint-IR playbook.",
    tier: 1,
    createdMinutesAgo: 12,
    expiresMinutes: 30,
  },
  {
    agentId: "agent-deploy",
    activity_type: "MCPToolCall",
    input: [{ server: "github", tool_name: "create_pull_request", repository: "owner/repo", title: "fix: edge case in checkout flow" }],
    reason: "Auto-PR for bug fix detected by static analysis; full test pass attached.",
    tier: 3,
    createdMinutesAgo: 25,
    expiresMinutes: 90,
  },
  {
    agentId: "agent-sre",
    activity_type: "PromptSubmission",
    input: [{ prompt: "Summarize the last 4 hours of error logs from prod-api and group by stack trace.", model: "claude-sonnet-4-6" }],
    reason: "Investigation of elevated 5xx rate from prod-api dashboard alert.",
    tier: 2,
    createdMinutesAgo: 45,
    expiresMinutes: 120,
  },
  {
    agentId: "agent-secops",
    activity_type: "FileDelete",
    input: [{ file_path: "/var/log/audit/legacy-2024-q3.log" }],
    reason: "Retention policy SEC-RET-003 reached; archived to glacier last week.",
    tier: 2,
    createdMinutesAgo: 90,
    expiresMinutes: 240,
  },
];

function buildApproval(t: SeedTemplate, id: string, status: "pending" | "approved" | "rejected" | "expired"): Approval {
  const agent = AGENTS[t.agentId];
  const created = ISO(-t.createdMinutesAgo * 60_000);
  // Expired rows mirror mobile's pattern: decided_at stays null,
  // verdict stays 2, approval_expired_at sits in the past. The
  // tree's statusOf falls back to "expired" via the timestamp check.
  const isExpired = status === "expired";
  const expires = status === "pending"
    ? ISO(t.expiresMinutes * 60_000)
    : isExpired
      ? ISO(-Math.max(1, t.createdMinutesAgo - 5) * 60_000)
      : undefined;
  const decided = status === "approved" || status === "rejected"
    ? ISO(-Math.max(0, t.createdMinutesAgo - 1) * 60_000)
    : undefined;
  const verdict = status === "approved" ? 0 : status === "rejected" ? 3 : 2;
  return {
    id,
    agent_id: t.agentId,
    status,
    action_type: t.activity_type,
    activity_type: t.activity_type,
    verdict,
    reason: t.reason,
    created_at: created,
    decided_at: decided,
    approval_expired_at: expires,
    input: t.input as { [key: string]: unknown } | undefined,
    metadata: { trust_tier: t.tier },
    agent: { agent_name: agent.agent_name },
  };
}

class MockStore {
  private pending: Approval[] = [];
  private decided: Approval[] = [];
  private nextId = 1;

  constructor() {
    this.reset();
  }

  reset() {
    // IDs are zero-padded ordinals (`mock-appr-001`..`mock-appr-006`)
    // because the e2e-extension mock-decide suite hits them by ordinal.
    this.pending = SEED.map((t, i) =>
      buildApproval(t, `mock-appr-${String(i + 1).padStart(3, '0')}`, "pending"),
    );
    // Decided rows seeded across all three History buckets so the
    // section split is exercised on mock-auth first run. Without
    // expired examples, tier 1 / 2 expired-by-timeout flow stays
    // invisible and the user can't tell whether the bucket renders.
    this.decided = [
      buildApproval(SEED[1], "mock-decided-001", "approved"),
      buildApproval(SEED[2], "mock-decided-002", "rejected"),
      buildApproval(SEED[3], "mock-decided-003", "expired"),
      buildApproval(SEED[4], "mock-decided-004", "expired"),
      buildApproval(SEED[0], "mock-decided-005", "approved"),
    ];
    this.nextId = SEED.length + 1;
  }

  seed(count = 3) {
    for (let i = 0; i < count; i++) {
      const t = SEED[Math.floor(Math.random() * SEED.length)];
      const id = `mock-appr-${String(this.nextId++).padStart(3, '0')}`;
      const fresh: SeedTemplate = { ...t, createdMinutesAgo: 0, expiresMinutes: 5 + Math.floor(Math.random() * 60) };
      this.pending.unshift(buildApproval(fresh, id, "pending"));
    }
  }

  list(status: "pending" | "approved" | "rejected" | "expired" | undefined): Approval[] {
    if (!status) return [...this.pending, ...this.decided];
    if (status === "pending") return [...this.pending];
    return this.decided.filter((a) => a.status === status);
  }

  counts(): { pending: number; approved: number; rejected: number; expired: number } {
    return {
      pending: this.pending.length,
      approved: this.decided.filter((a) => a.status === "approved").length,
      rejected: this.decided.filter((a) => a.status === "rejected").length,
      expired: this.decided.filter((a) => a.status === "expired").length,
    };
  }

  decide(id: string, action: "approve" | "reject"): boolean {
    const idx = this.pending.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    const [row] = this.pending.splice(idx, 1);
    const next: Approval = {
      ...row,
      status: action === "approve" ? "approved" : "rejected",
      verdict: action === "approve" ? 0 : 3,
      decided_at: ISO(0),
      approval_expired_at: undefined,
    };
    this.decided.unshift(next);
    return true;
  }

  members(): Member[] { return MEMBERS; }
  teams(): Team[] { return TEAMS; }
  agents(): Record<string, { agent_name: string; owner_id: string; teams: Team[] }> { return AGENTS; }
  profile() { return { ...PROFILE }; }
}

let singleton: MockStore | undefined;

export function mockStore(): MockStore {
  if (!singleton) singleton = new MockStore();
  return singleton;
}
