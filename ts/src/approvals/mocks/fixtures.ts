// Mock approval / agent / member fixtures for development surfaces.
// Shape matches the backend wire types from `../../types`. Consumers
// (mobile mock-auth, extension dev mode, web demo) all read from the
// same data so a Shell card looks identical everywhere.

import type {
  Agent,
  Approval,
  Member,
  OrgApprovalsResponse,
  PaginatedResponse,
  UserProfile,
} from '../../types/index.js';

export type ApprovalListStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export const mockProfile: UserProfile = {
  orgId: 'mock-org-001',
  email: 'tester@openbox.local',
  sub: 'mock-user-001',
};

// A handful of colleagues so the Owner picker + sheet's Owner row
// reflect a realistic team. `mock-user-001` matches mockProfile.sub so
// the picker labels you as "Me" and the sheet's Owner row resolves to
// "Demo Tester (Me)" for your own agents.
export const mockMembers: Member[] = [
  {
    id: 'mock-user-001',
    username: 'tester',
    email: 'tester@openbox.local',
    firstName: 'Demo',
    lastName: 'Tester',
    role: 'admin',
  },
  {
    id: 'mock-user-002',
    username: 'janedoe',
    email: 'jane.doe@openbox.local',
    firstName: 'Jane',
    lastName: 'Doe',
    role: 'admin',
  },
  {
    id: 'mock-user-003',
    username: 'rkumar',
    email: 'r.kumar@openbox.local',
    firstName: 'Rohit',
    lastName: 'Kumar',
    role: 'member',
  },
  {
    id: 'mock-user-004',
    username: 'achen',
    email: 'a.chen@openbox.local',
    firstName: 'Aria',
    lastName: 'Chen',
    role: 'member',
  },
  {
    id: 'mock-user-005',
    username: 'mschmidt',
    email: 'm.schmidt@openbox.local',
    firstName: 'Marcus',
    lastName: 'Schmidt',
    role: 'member',
  },
];

// Domain-flavored teams so the sheet's Team row + the team picker
// look like a real org rather than placeholder names.
const mockTeams = [
  { id: 'team-platform', name: 'Platform' },
  { id: 'team-finance', name: 'Finance Ops' },
  { id: 'team-secops', name: 'SecOps' },
  { id: 'team-procurement', name: 'Procurement' },
];

// Per-domain agents distributed across the colleague set so the Owner
// row + picker show real variety. Deploy Bot is intentionally team-less
// so the sheet's "Unassigned" Team row renders.
export const mockAgents: Agent[] = [
  {
    id: 'agent-procurement',
    agent_name: 'Procurement Agent',
    organization_id: 'mock-org-001',
    owner_id: 'mock-user-001', // me
    teams: [mockTeams[3]],
  },
  {
    id: 'agent-finance',
    agent_name: 'Finance Bot',
    organization_id: 'mock-org-001',
    owner_id: 'mock-user-002', // Jane Doe
    teams: [mockTeams[1]],
  },
  {
    id: 'agent-sre',
    agent_name: 'SRE Copilot',
    organization_id: 'mock-org-001',
    owner_id: 'mock-user-003', // Rohit Kumar
    teams: [mockTeams[0], mockTeams[2]], // multi-team → comma-joined
  },
  {
    id: 'agent-secops',
    agent_name: 'SecOps Sentinel',
    organization_id: 'mock-org-001',
    owner_id: 'mock-user-004', // Aria Chen
    teams: [mockTeams[2]],
  },
  {
    id: 'agent-deploy',
    agent_name: 'Deploy Bot',
    organization_id: 'mock-org-001',
    owner_id: 'mock-user-005', // Marcus Schmidt
    teams: [], // exercises the "Unassigned" Team row in the sheet
  },
];

// Mock RBAC mirrors the real backend's single permission model:
// PermissionEnum.ReadAgent gates ALL approval-related routes
// (list + decide). So in mock, an agent is either fully visible to
// the user (cards shown, Approve/Reject usable) or hidden entirely
// (cards filtered out; same as a 403 server-side).
//
// agent-procurement is the test case for "no access"; its cards
// don't render at all. Everything else is fully visible.
const MOCK_AGENT_NO_READ: ReadonlySet<string> = new Set([
  'agent-procurement',
]);

export function canMockReadAgent(agentId: string | undefined | null): boolean {
  if (!agentId) return true;
  return !MOCK_AGENT_NO_READ.has(agentId);
}

export function fromNow(mins: number): string {
  return new Date(Date.now() + mins * 60_000).toISOString();
}
export function agoMin(mins: number): string {
  return new Date(Date.now() - mins * 60_000).toISOString();
}

// Local narrower shape used by the fixtures. The generated wire type
// for `Approval` carries:
//   * `input` as a string-keyed dictionary (`{ [key: string]: unknown }`)
//     — but consumers see the wire array-of-payloads shape on every
//     real response (`[{ command, cwd }]`, `[{ prompt, model }]`).
//   * a top-level `& { [key: string]: unknown }` index signature that
//     widens every dot-access to `unknown`, so even `a.metadata` types
//     poorly inside the fixtures.
// The narrower shape below covers the fields the fixtures touch and
// drops both wrinkles. Cast at the public boundary back to `Approval`.
interface MockApprovalAgent {
  agent_name: string;
}
interface MockApprovalMetadata {
  trust_tier?: number;
}
interface MockApproval {
  id: string;
  agent_id?: string;
  status?: string;
  action_type?: string;
  activity_type?: string;
  verdict?: number;
  reason?: string;
  created_at?: string;
  decided_at?: string;
  approval_expired_at?: string;
  agent?: MockApprovalAgent;
  metadata?: MockApprovalMetadata;
  input?: unknown;
  spans?: unknown[];
}

type PendingTemplate = Omit<MockApproval, 'created_at' | 'approval_expired_at'> & {
  createdAgoMin: number;
  expiresInMin: number;
};

// Realistic agentic actions across timeout horizons. Each template
// splits the three governance fields the backend supports:
//   - activity_type   → machine label of the operation kind
//   - input  → technical params actually being intercepted
//                       (URL+body / file_path / SQL / command / etc.).
//                       Wire shape is unknown[]; convention is a single
//                       object representing the call's args.
//   - reason          → agent's narrative WHY: the upstream task,
//                       ticket, runbook, or goal that motivates this
//                       specific operation. NOT a restatement of the
//                       technical action.
//
// The sheet renders all three as separate rows so a reviewer can read:
// "what kind of op" → "what specifically does it do" → "why does the
// agent want it"; each from its own field, no overlap.
//
// Backend approval_timeout is @Min(1) with no @Max, so timeouts vary
// per action's nature: infra restarts get minutes, deploys get ~30m,
// finance transfers / procurement / role grants get hours, and
// scheduled bulk jobs get up to a day.
// Reasons alternate SHORT (single sentence, fits in 1-2 lines, no
// "Show more" toggle on the sheet) and LONG (multi-sentence, wraps
// past 3 lines, toggle visible). Tester sees both states in one pass.
const pendingTemplates: PendingTemplate[] = [
  {
    // Seconds-precision card; exercises the per-second tick.
    id: 'pend-restart', agent_id: 'agent-sre', activity_type: 'system_restart', verdict: 2,
    input: [{
      service: 'prod-api-3', mode: 'rolling', batch: '1 of 4', uptime_hours: 142,
    }],
    // SHORT
    reason: 'Memory >85% post-3.2.0; rolling restart per RB-042.',
    createdAgoMin: 1, expiresInMin: 0.5,
    metadata: { trust_tier: 1 }, agent: { agent_name: 'SRE Copilot' },
  },
  {
    id: 'pend-failover', agent_id: 'agent-sre', activity_type: 'database_failover', verdict: 2,
    input: [{
      cluster: 'orders-db', from_region: 'us-east-1', to_region: 'us-west-2', replica_lag_seconds: 0.4,
    }],
    // LONG
    reason: 'us-east-1 RDS instance reporting elevated I/O wait + p99 query latency 4× baseline for last 6 minutes; failover before customers see degradation. Replica lag is 0.4s so no data loss expected.',
    createdAgoMin: 2, expiresInMin: 13,
    metadata: { trust_tier: 1 }, agent: { agent_name: 'SRE Copilot' },
  },
  {
    id: 'pend-deploy', agent_id: 'agent-deploy', activity_type: 'service_deploy', verdict: 2,
    input: [{
      service: 'api-service', version: 'v3.2.1', target: 'production', replicas: 4, strategy: 'rolling',
    }],
    // SHORT
    reason: 'Hotfix for OPENBOX-1842; CI green, 18m canary clean.',
    createdAgoMin: 5, expiresInMin: 28,
    metadata: { trust_tier: 2 }, agent: { agent_name: 'Deploy Bot' },
  },
  {
    id: 'pend-firewall', agent_id: 'agent-secops', activity_type: 'firewall_rule_change', verdict: 2,
    input: [{
      action: 'allow_ingress', port: 5432, protocol: 'tcp', source_cidr: '10.42.0.0/16', target: 'orders-db.production',
    }],
    // LONG
    reason: 'New analytics service (analytics-jobs) was deployed to VPC 10.42 and needs read access to orders-db. Approved per ARCH-RFC-088. Source CIDR is internal only; no public exposure.',
    createdAgoMin: 12, expiresInMin: 47,
    metadata: { trust_tier: 1 }, agent: { agent_name: 'SecOps Sentinel' },
  },
  {
    id: 'pend-refund', agent_id: 'agent-finance', activity_type: 'fin_refund', verdict: 2,
    input: [{
      customer_id: 'C-9923', amount_usd: 450.00, payment_method: 'visa_ending_4421', reference: 'charge_3MqzbA2eZvKYlo2C',
    }],
    // SHORT
    reason: 'Duplicate billing per ticket SUP-1247; auto-refund.',
    createdAgoMin: 18, expiresInMin: 78,
    metadata: { trust_tier: 3 }, agent: { agent_name: 'Finance Bot' },
  },
  {
    id: 'pend-role', agent_id: 'agent-secops', activity_type: 'iam_role_grant', verdict: 2,
    input: [{
      principal: 'oncall-rotation@partner.com', role: 'ProductionAdmin', scope: 'aws:account:prod-1', expires_at: '2026-04-28T18:00:00Z',
    }],
    // LONG
    reason: 'Partner on-call rotation needs production access for joint incident response (P1 INC-3091). Time-boxed to one shift; expires at 18:00 UTC. Pre-approved per the joint-IR playbook signed last quarter.',
    createdAgoMin: 25, expiresInMin: 95,
    metadata: { trust_tier: 1 }, agent: { agent_name: 'SecOps Sentinel' },
  },
  {
    id: 'pend-procurement', agent_id: 'agent-procurement', activity_type: 'procurement_po_approval', verdict: 2,
    input: [{
      po_number: 'PO-2847', vendor: 'Acme Cloud Services', amount_usd: 12500, term: 'annual',
      line_items: 'Compute (8 nodes), Storage (40TB), Support (P1)', cost_center: 'eng-platform',
    }],
    // SHORT
    reason: 'Annual compute renewal; 23% YoY growth forecast.',
    createdAgoMin: 45, expiresInMin: 720,
    metadata: { trust_tier: 3 }, agent: { agent_name: 'Procurement Agent' },
  },
  {
    id: 'pend-wire', agent_id: 'agent-finance', activity_type: 'fin_wire_transfer', verdict: 2,
    input: [{
      to_account: 'CHASE-****-7842', beneficiary: 'Lockstep Legal LLP', amount_usd: 25000, currency: 'USD',
      memo: 'Invoice INV-9912; Q3 outside counsel',
    }],
    // LONG
    reason: 'Outside counsel invoice for Q3 contract review work. Pre-approved engagement letter on file (LEGAL-ENG-007); invoice matches SOW within tolerance. Vendor previously paid 4 invoices, all reconciled clean.',
    createdAgoMin: 90, expiresInMin: 1380,
    metadata: { trust_tier: 4 }, agent: { agent_name: 'Finance Bot' },
  },
  {
    id: 'pend-bulk', agent_id: 'agent-deploy', activity_type: 'data_bulk_delete', verdict: 2,
    input: [{
      table: 'users', predicate: 'last_active < NOW() - INTERVAL \'730 days\' AND deletion_requested_at IS NOT NULL',
      estimated_rows: 1_204_882, backup_snapshot: 'snap-2026-04-27-pre-gdpr-purge',
    }],
    // SHORT
    reason: 'GDPR Art. 17 retention sweep; legal signed (LEGAL-2026-Q2-008).',
    createdAgoMin: 4, expiresInMin: 134,
    metadata: { trust_tier: 2 }, agent: { agent_name: 'Deploy Bot' },
  },
  {
    id: 'pend-rotate', agent_id: 'agent-secops', activity_type: 'secret_rotation', verdict: 2,
    input: [{
      secret_id: 'aws-root-access-key', previous_rotation: '2026-01-26T00:00:00Z', rotation_policy: '90d', affected_principals: 12,
    }],
    // LONG
    reason: 'AWS root credential is 91 days old; SOC2 control AC-7 requires rotation at 90d. No active session usage in last 7 days; safe window. Coordinated with platform team; affected services already pre-warmed against the new key.',
    createdAgoMin: 8, expiresInMin: 240,
    metadata: { trust_tier: 1 }, agent: { agent_name: 'SecOps Sentinel' },
  },
  {
    id: 'pend-data-export', agent_id: 'agent-finance', activity_type: 'data_export', verdict: 2,
    input: [{
      dataset: 'transactions_q2_2026', destination: 's3://exports-prod/audit/q2-2026.csv',
      row_count: 482_915, contains_pii: true, encryption: 'aes-256-sse-kms',
    }],
    // SHORT
    reason: 'Quarterly auditor handoff; SOC2 evidence package per AUDIT-2026-Q2.',
    createdAgoMin: 22, expiresInMin: 320,
    metadata: { trust_tier: 2 }, agent: { agent_name: 'Finance Bot' },
  },
  {
    id: 'pend-merge', agent_id: 'agent-deploy', activity_type: 'merge_to_main', verdict: 2,
    input: [{
      repo: 'service-api', pr_number: 4271, branch: 'feat/wire-rate-limit',
      commits: 7, additions: 184, deletions: 22, reviewers_approved: 2,
    }],
    // SHORT
    reason: '2 reviews + green CI; clears merge queue.',
    createdAgoMin: 6, expiresInMin: 60,
    metadata: { trust_tier: 3 }, agent: { agent_name: 'Deploy Bot' },
  },
  {
    id: 'pend-revoke', agent_id: 'agent-secops', activity_type: 'role_revocation', verdict: 2,
    input: [{
      principal: 'jordan.lee@openbox.local', role: 'BillingAdmin', scope: 'stripe:account:acct_1MqA',
      reason_code: 'role_change', new_team: 'Engineering',
    }],
    // SHORT
    reason: 'Internal transfer; BillingAdmin no longer in scope (HR-XFER-1142).',
    createdAgoMin: 35, expiresInMin: 480,
    metadata: { trust_tier: 2 }, agent: { agent_name: 'SecOps Sentinel' },
  },
  {
    id: 'pend-schema', agent_id: 'agent-deploy', activity_type: 'schema_migration', verdict: 2,
    input: [{
      database: 'orders-db', migration: '20260427_add_currency_column',
      tables_affected: ['orders', 'invoices'], estimated_lock_ms: 480, reversible: true,
    }],
    // LONG
    reason: 'Adds currency column to support upcoming multi-currency billing rollout. Reversible migration tested in staging this morning; expected lock window <1s on each table at current write throughput. Rolling deploy will pick up the new column on next backend release.',
    createdAgoMin: 10, expiresInMin: 90,
    metadata: { trust_tier: 2 }, agent: { agent_name: 'Deploy Bot' },
  },
  {
    id: 'pend-dns', agent_id: 'agent-secops', activity_type: 'dns_change', verdict: 2,
    input: [{
      record: 'api.openbox.ai', type: 'A', from: '198.51.100.42', to: '198.51.100.78', ttl: 300,
    }],
    // SHORT
    reason: 'Cutover to new ALB after blue/green swap (CHANGE-2218).',
    createdAgoMin: 3, expiresInMin: 20,
    metadata: { trust_tier: 1 }, agent: { agent_name: 'SecOps Sentinel' },
  },
  {
    id: 'pend-cert', agent_id: 'agent-secops', activity_type: 'certificate_renewal', verdict: 2,
    input: [{
      domain: '*.openbox.ai', issuer: "Let's Encrypt", expires_at: '2026-05-12T00:00:00Z',
      auto_renew_failed_attempts: 1,
    }],
    // SHORT
    reason: 'ACME challenge bounced once on stale TXT; manual approve to retry.',
    createdAgoMin: 14, expiresInMin: 200,
    metadata: { trust_tier: 2 }, agent: { agent_name: 'SecOps Sentinel' },
  },
  {
    id: 'pend-payment', agent_id: 'agent-finance', activity_type: 'payment_initiated', verdict: 2,
    input: [{
      vendor: 'AWS', invoice_number: 'INV-AWS-2026-04', amount_usd: 87432.18,
      cost_center: 'eng-infra', payment_method: 'ach_business',
    }],
    // SHORT
    reason: 'Monthly cloud spend; matches forecast within 2.3% tolerance.',
    createdAgoMin: 60, expiresInMin: 600,
    metadata: { trust_tier: 3 }, agent: { agent_name: 'Finance Bot' },
  },
  {
    id: 'pend-marketing-blast', agent_id: 'agent-deploy', activity_type: 'marketing_email_blast', verdict: 2,
    input: [{
      list: 'all-active-customers', recipients: 18421, template: 'product-update-2026-q2',
      sender: 'product@openbox.ai', tracking_pixel: false,
    }],
    // LONG
    reason: 'Quarterly product update covering rate-limit changes + new SSO providers. Copy reviewed by legal (LEGAL-MARK-114) and PR (PR-2026-Q2-08); CAN-SPAM disclaimers verified; unsubscribe links validated end-to-end. Send window aligns with the launch press embargo lifting at 14:00 PT.',
    createdAgoMin: 75, expiresInMin: 480,
    metadata: { trust_tier: 4 }, agent: { agent_name: 'Deploy Bot' },
  },
  {
    id: 'pend-chat-publish', agent_id: 'agent-sre', activity_type: 'chat_response_publish', verdict: 2,
    input: [{
      channel: '#status', surface: 'public_status_page', summary: 'Increased latency on /api/v1/agents - investigating',
      severity: 'minor', incident_id: 'INC-3104',
    }],
    // SHORT
    reason: 'Customer report on Twitter; publish before noise spreads (RUNBOOK-COMM-02).',
    createdAgoMin: 1, expiresInMin: 8,
    metadata: { trust_tier: 1 }, agent: { agent_name: 'SRE Copilot' },
  },
];

function hydrateTemplate(t: PendingTemplate): MockApproval {
  const { createdAgoMin, expiresInMin, ...rest } = t;
  return { ...rest, created_at: agoMin(createdAgoMin), approval_expired_at: fromNow(expiresInMin) };
}

let seed = 42;
function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
export function randInt(min: number, max: number) { return Math.floor(rand() * (max - min + 1)) + min; }

function makeResolved(): MockApproval[] {
  // History reads as a real audit trail. Same activity_type / input
  // / reason split as the pending templates above; see those for the
  // convention.
  return [
    {
      id: 'hist-deploy-ok', agent_id: 'agent-deploy', activity_type: 'service_deploy', verdict: 0,
      input: [{
        service: 'api-service', version: 'v3.2.0', target: 'production', replicas: 4, strategy: 'rolling',
      }],
      reason: 'Scheduled biweekly release. Passed CI + 30-min canary; release notes posted to #releases.',
      created_at: agoMin(randInt(90, 150)),
      decided_at: agoMin(randInt(60, 89)),
      metadata: { trust_tier: 2 }, agent: { agent_name: 'Deploy Bot' },
    },
    {
      id: 'hist-refund-ok', agent_id: 'agent-finance', activity_type: 'fin_refund', verdict: 0,
      input: [{
        customer_id: 'C-7711', amount_usd: 89.99, payment_method: 'mc_ending_2014',
        reference: 'charge_3MqAaB5fYxLZmp3D',
      }],
      reason: 'Customer cancelled subscription within 14-day window per ToS §4.2; auto-refund qualifying.',
      created_at: agoMin(randInt(160, 220)),
      decided_at: agoMin(randInt(120, 159)),
      metadata: { trust_tier: 3 }, agent: { agent_name: 'Finance Bot' },
    },
    {
      id: 'hist-iam-rej', agent_id: 'agent-secops', activity_type: 'iam_role_grant', verdict: 3,
      input: [{
        principal: 'intern@partner.com', role: 'ProductionAdmin', scope: 'aws:account:prod-1',
      }],
      reason: 'Intern requested production access for a debugging task; rejected because partner-side interns are not on the pre-approved principals list (POLICY-IAM-12).',
      created_at: agoMin(randInt(180, 260)),
      decided_at: agoMin(randInt(140, 179)),
      metadata: { trust_tier: 1 }, agent: { agent_name: 'SecOps Sentinel' },
    },
    {
      id: 'hist-firewall-rej', agent_id: 'agent-secops', activity_type: 'firewall_rule_change', verdict: 3,
      input: [{
        action: 'allow_ingress', port: 22, protocol: 'tcp', source_cidr: '0.0.0.0/0', target: 'bastion-host',
      }],
      reason: 'Bastion troubleshooting request; rejected because public SSH (0.0.0.0/0) is disallowed by SECURITY-NET-03; use VPN or session manager instead.',
      created_at: agoMin(randInt(280, 380)),
      decided_at: agoMin(randInt(220, 279)),
      metadata: { trust_tier: 1 }, agent: { agent_name: 'SecOps Sentinel' },
    },
    {
      id: 'hist-procure-ok', agent_id: 'agent-procurement', activity_type: 'procurement_po_approval', verdict: 0,
      input: [{
        po_number: 'PO-2731', vendor: 'Datadog', amount_usd: 4200,
        term: 'annual', line_items: 'Seat top-up (12 users)', cost_center: 'eng-platform',
      }],
      reason: 'New hires onboarding to platform team need observability seats. Within quarterly budget (BUDG-Q2-eng).',
      created_at: agoMin(randInt(420, 600)),
      decided_at: agoMin(randInt(360, 419)),
      metadata: { trust_tier: 3 }, agent: { agent_name: 'Procurement Agent' },
    },
    {
      // Aged-out pending → no decided_at, just an expiry in the past.
      id: 'hist-deploy-exp', agent_id: 'agent-deploy', activity_type: 'service_deploy', verdict: 2,
      input: [{
        service: 'api-service', version: 'v3.1.7', target: 'production', replicas: 4,
      }],
      reason: 'Routine release; on-call rotation gap during 02:00-04:00 UTC meant no human reviewed in time. Auto-rollback queued.',
      created_at: agoMin(randInt(900, 1080)),
      approval_expired_at: agoMin(randInt(840, 890)),
      decided_at: undefined,
      metadata: { trust_tier: 2 }, agent: { agent_name: 'Deploy Bot' },
    },
    {
      id: 'hist-bulk-exp', agent_id: 'agent-deploy', activity_type: 'data_bulk_delete', verdict: 2,
      input: [{
        table: 'sessions', predicate: 'expires_at < NOW() - INTERVAL \'30 days\'',
        estimated_rows: 802_415, backup_snapshot: 'snap-2026-04-26-pre-session-purge',
      }],
      reason: 'Stale session row cleanup (read-only side effects); request expired during quarterly compliance review pause.',
      created_at: agoMin(randInt(1500, 1800)),
      approval_expired_at: agoMin(randInt(60, 200)),
      decided_at: undefined,
      metadata: { trust_tier: 3 }, agent: { agent_name: 'Deploy Bot' },
    },
    {
      id: 'hist-wire-ok', agent_id: 'agent-finance', activity_type: 'fin_wire_transfer', verdict: 0,
      input: [{
        to_account: 'CHASE-****-7842', beneficiary: 'Lockstep Legal LLP',
        amount_usd: 18000, currency: 'USD', memo: 'Invoice INV-9821; Q3 outside counsel',
      }],
      reason: 'Quarterly outside-counsel invoice; pre-approved engagement letter on file (LEGAL-ENG-007).',
      created_at: agoMin(randInt(2400, 2880)),
      decided_at: agoMin(randInt(1500, 1800)),
      metadata: { trust_tier: 4 }, agent: { agent_name: 'Finance Bot' },
    },
    {
      id: 'hist-restart-ok', agent_id: 'agent-sre', activity_type: 'system_restart', verdict: 0,
      input: [{
        service: 'auth-service-2', mode: 'graceful', uptime_hours: 287,
      }],
      reason: 'Memory leak in token cache (issue #4218); rolling restart per runbook RB-019 to free heap.',
      created_at: agoMin(randInt(45, 75)),
      decided_at: agoMin(randInt(30, 44)),
      metadata: { trust_tier: 1 }, agent: { agent_name: 'SRE Copilot' },
    },
    {
      id: 'hist-merge-ok', agent_id: 'agent-deploy', activity_type: 'merge_to_main', verdict: 0,
      input: [{
        repo: 'service-api', pr_number: 4263, branch: 'fix/wire-rate-limit-edge',
        commits: 3, additions: 41, deletions: 8, reviewers_approved: 2,
      }],
      reason: 'Two reviewers approved; CI green; clears merge queue at top.',
      created_at: agoMin(randInt(620, 720)),
      decided_at: agoMin(randInt(540, 619)),
      metadata: { trust_tier: 3 }, agent: { agent_name: 'Deploy Bot' },
    },
    {
      id: 'hist-schema-ok', agent_id: 'agent-deploy', activity_type: 'schema_migration', verdict: 0,
      input: [{
        database: 'orders-db', migration: '20260420_add_idempotency_key',
        tables_affected: ['orders'], estimated_lock_ms: 320, reversible: true,
      }],
      reason: 'Adds idempotency_key column for the new write retry path; lock window fits inside p99 latency budget.',
      created_at: agoMin(randInt(2880, 3300)),
      decided_at: agoMin(randInt(2400, 2879)),
      metadata: { trust_tier: 2 }, agent: { agent_name: 'Deploy Bot' },
    },
    {
      id: 'hist-payment-ok', agent_id: 'agent-finance', activity_type: 'payment_initiated', verdict: 0,
      input: [{
        vendor: 'GitHub', invoice_number: 'INV-GH-2026-04', amount_usd: 8400,
        cost_center: 'eng-platform', payment_method: 'corp_card',
      }],
      reason: 'Monthly Enterprise plan; auto-pay matches PO-2698 within 0.5% tolerance.',
      created_at: agoMin(randInt(4200, 4800)),
      decided_at: agoMin(randInt(3600, 4199)),
      metadata: { trust_tier: 2 }, agent: { agent_name: 'Finance Bot' },
    },
    {
      id: 'hist-data-export-rej', agent_id: 'agent-finance', activity_type: 'data_export', verdict: 3,
      input: [{
        dataset: 'customer_pii_full', destination: 'gdrive://shared-with-marketing/q1',
        row_count: 18421, contains_pii: true, encryption: null,
      }],
      reason: 'Marketing requested unencrypted PII export for campaign segmentation; rejected per DATA-PRIV-04 (PII must be processed in the warehouse, not exported to external drives).',
      created_at: agoMin(randInt(7200, 8400)),
      decided_at: agoMin(randInt(6600, 7199)),
      metadata: { trust_tier: 1 }, agent: { agent_name: 'Finance Bot' },
    },
    {
      id: 'hist-revoke-ok', agent_id: 'agent-secops', activity_type: 'role_revocation', verdict: 0,
      input: [{
        principal: 'sam.taylor@openbox.local', role: 'ProductionAdmin', scope: 'aws:account:prod-1',
        reason_code: 'offboarding', last_active: '2026-04-15T17:00:00Z',
      }],
      reason: 'HR ticket HR-OFF-882; standard offboarding sweep within 24h SLA.',
      created_at: agoMin(randInt(900, 1100)),
      decided_at: agoMin(randInt(840, 899)),
      metadata: { trust_tier: 2 }, agent: { agent_name: 'SecOps Sentinel' },
    },
    {
      id: 'hist-cert-ok', agent_id: 'agent-secops', activity_type: 'certificate_renewal', verdict: 0,
      input: [{
        domain: '*.openbox.ai', issuer: "Let's Encrypt", expires_at: '2026-04-30T00:00:00Z',
        auto_renew_failed_attempts: 0,
      }],
      reason: 'Auto-renew run; ACME challenge passed first attempt.',
      created_at: agoMin(randInt(11000, 12000)),
      decided_at: agoMin(randInt(10500, 10999)),
      metadata: { trust_tier: 2 }, agent: { agent_name: 'SecOps Sentinel' },
    },
    {
      id: 'hist-dns-ok', agent_id: 'agent-secops', activity_type: 'dns_change', verdict: 0,
      input: [{
        record: 'status.openbox.ai', type: 'CNAME', from: 'old-cdn.cloudfront.net', to: 'new-cdn.cloudfront.net', ttl: 300,
      }],
      reason: 'Cutover to new CDN distribution after green/blue validation; 300s TTL keeps rollback fast.',
      created_at: agoMin(randInt(15000, 16500)),
      decided_at: agoMin(randInt(14500, 14999)),
      metadata: { trust_tier: 1 }, agent: { agent_name: 'SecOps Sentinel' },
    },
    {
      id: 'hist-bulk-ok', agent_id: 'agent-deploy', activity_type: 'data_bulk_delete', verdict: 0,
      input: [{
        table: 'audit_logs_archive', predicate: "created_at < NOW() - INTERVAL '730 days'",
        estimated_rows: 4_802_117, backup_snapshot: 'snap-2026-04-08-pre-archive-purge',
      }],
      reason: '2-year retention sweep; legal signed (LEGAL-2026-Q1-014); backup verified before delete.',
      created_at: agoMin(randInt(20000, 21500)),
      decided_at: agoMin(randInt(19000, 19999)),
      metadata: { trust_tier: 3 }, agent: { agent_name: 'Deploy Bot' },
    },
    {
      id: 'hist-marketing-rej', agent_id: 'agent-deploy', activity_type: 'marketing_email_blast', verdict: 3,
      input: [{
        list: 'all-trial-users', recipients: 9421, template: 'upgrade-now-discount',
        sender: 'sales@openbox.ai', tracking_pixel: true,
      }],
      reason: 'Tracking pixel disabled by current GDPR posture (POLICY-PRIV-09); reject until tracking is removed or list is filtered to consenting recipients.',
      created_at: agoMin(randInt(8200, 9000)),
      decided_at: agoMin(randInt(7800, 8199)),
      metadata: { trust_tier: 4 }, agent: { agent_name: 'Deploy Bot' },
    },
    {
      id: 'hist-procurement-rej', agent_id: 'agent-procurement', activity_type: 'procurement_po_approval', verdict: 3,
      input: [{
        po_number: 'PO-2812', vendor: 'New Vendor LLC', amount_usd: 28000,
        term: 'annual', line_items: 'Premium support tier', cost_center: 'eng-platform',
      }],
      reason: 'New vendor without onboarding paperwork (W-9, security questionnaire); procurement policy PROC-VEND-02 requires both before any PO over $10k.',
      created_at: agoMin(randInt(13000, 14000)),
      decided_at: agoMin(randInt(12500, 12999)),
      metadata: { trust_tier: 4 }, agent: { agent_name: 'Procurement Agent' },
    },
    {
      id: 'hist-rotate-ok', agent_id: 'agent-secops', activity_type: 'secret_rotation', verdict: 0,
      input: [{
        secret_id: 'stripe-restricted-key', previous_rotation: '2026-01-15T00:00:00Z', rotation_policy: '90d', affected_principals: 4,
      }],
      reason: 'Quarterly rotation per SOC2 control AC-7; pre-warmed against new key during business-hours window.',
      created_at: agoMin(randInt(2100, 2400)),
      decided_at: agoMin(randInt(1900, 2099)),
      metadata: { trust_tier: 1 }, agent: { agent_name: 'SecOps Sentinel' },
    },
    {
      id: 'hist-failover-ok', agent_id: 'agent-sre', activity_type: 'database_failover', verdict: 0,
      input: [{
        cluster: 'orders-db', from_region: 'us-east-1', to_region: 'us-west-2', replica_lag_seconds: 0.6,
      }],
      reason: 'Pre-emptive failover during us-east-1 EBS event (AWS PHD-2026-04-22); zero data loss.',
      created_at: agoMin(randInt(6500, 7100)),
      decided_at: agoMin(randInt(6300, 6499)),
      metadata: { trust_tier: 1 }, agent: { agent_name: 'SRE Copilot' },
    },
    {
      id: 'hist-firewall-ok', agent_id: 'agent-secops', activity_type: 'firewall_rule_change', verdict: 0,
      input: [{
        action: 'allow_egress', port: 443, protocol: 'tcp', source: 'analytics-jobs',
        target: 'segment.io', rule_id: 'fw-2026-441',
      }],
      reason: 'Analytics service needs Segment write access for new event pipeline (RFC-091).',
      created_at: agoMin(randInt(9100, 9800)),
      decided_at: agoMin(randInt(8900, 9099)),
      metadata: { trust_tier: 2 }, agent: { agent_name: 'SecOps Sentinel' },
    },
    {
      id: 'hist-deploy-rej', agent_id: 'agent-deploy', activity_type: 'service_deploy', verdict: 3,
      input: [{
        service: 'billing-service', version: 'v2.4.0-beta.3', target: 'production', replicas: 6, strategy: 'all-at-once',
      }],
      reason: 'Beta tag + all-at-once strategy on a customer-facing service; reject pending strategy change to canary or 25% rolling per DEPLOY-POLICY-01.',
      created_at: agoMin(randInt(3500, 4000)),
      decided_at: agoMin(randInt(3300, 3499)),
      metadata: { trust_tier: 2 }, agent: { agent_name: 'Deploy Bot' },
    },
    {
      id: 'hist-wire-rej', agent_id: 'agent-finance', activity_type: 'fin_wire_transfer', verdict: 3,
      input: [{
        to_account: 'WELLS-****-3320', beneficiary: 'Mason Consulting', amount_usd: 47500, currency: 'USD',
        memo: 'Engagement INV-9988',
      }],
      reason: 'Vendor not on the approved-payee list (PAYEE-MASTER-2026); SOW + W-9 required before wire issuance over $25k.',
      created_at: agoMin(randInt(5400, 6000)),
      decided_at: agoMin(randInt(5100, 5399)),
      metadata: { trust_tier: 4 }, agent: { agent_name: 'Finance Bot' },
    },
    {
      id: 'hist-cert-exp', agent_id: 'agent-secops', activity_type: 'certificate_renewal', verdict: 2,
      input: [{
        domain: 'api-staging.openbox.ai', issuer: "Let's Encrypt", expires_at: '2026-04-19T00:00:00Z',
        auto_renew_failed_attempts: 3,
      }],
      reason: 'Auto-renew failed 3x on stale TXT challenge; approval window expired during the long Easter weekend on-call rotation.',
      created_at: agoMin(randInt(17000, 18000)),
      approval_expired_at: agoMin(randInt(16400, 16800)),
      decided_at: undefined,
      metadata: { trust_tier: 3 }, agent: { agent_name: 'SecOps Sentinel' },
    },
    {
      id: 'hist-payment-exp', agent_id: 'agent-finance', activity_type: 'payment_initiated', verdict: 2,
      input: [{
        vendor: 'Datadog', invoice_number: 'INV-DD-2026-03', amount_usd: 14820,
        cost_center: 'eng-platform', payment_method: 'ach_business',
      }],
      reason: 'CFO out-of-office during the 24h decision window; finance auto-rolled to next-cycle billing without late fee per the vendor SLA.',
      created_at: agoMin(randInt(10000, 11000)),
      approval_expired_at: agoMin(randInt(9700, 9999)),
      decided_at: undefined,
      metadata: { trust_tier: 3 }, agent: { agent_name: 'Finance Bot' },
    },
    {
      id: 'hist-merge-rej', agent_id: 'agent-deploy', activity_type: 'merge_to_main', verdict: 3,
      input: [{
        repo: 'service-api', pr_number: 4198, branch: 'feat/strip-rate-limit',
        commits: 1, additions: 4, deletions: 218, reviewers_approved: 1,
      }],
      reason: 'Single reviewer + a -218 line diff stripping the rate-limit middleware; sec-impacting change requires 2 reviewers + security team sign-off (REVIEW-POLICY-04).',
      created_at: agoMin(randInt(11500, 12500)),
      decided_at: agoMin(randInt(11200, 11499)),
      metadata: { trust_tier: 3 }, agent: { agent_name: 'Deploy Bot' },
    },
    {
      id: 'hist-revoke-rej', agent_id: 'agent-secops', activity_type: 'role_revocation', verdict: 3,
      input: [{
        principal: 'pat.morgan@openbox.local', role: 'AnalyticsViewer', scope: 'snowflake:db:warehouse',
        reason_code: 'inactivity_30d', last_active: '2026-03-25T09:00:00Z',
      }],
      reason: 'Inactivity-based revocation; rejected because user is on approved parental leave per HR-LEAVE-114; restore on return.',
      created_at: agoMin(randInt(14500, 15500)),
      decided_at: agoMin(randInt(14200, 14499)),
      metadata: { trust_tier: 3 }, agent: { agent_name: 'SecOps Sentinel' },
    },
    ...makeRoutineResolved(),
  ];
}

/** Procedurally-generated routine entries to give the History tabs
 *  a lived-in feel without bloating the file with hand-crafted JSON.
 *  Each entry is a deterministic permutation of (agent, activity, verdict,
 *  age band) so the list looks varied across reload but stays stable
 *  within a session.
 */
function makeRoutineResolved(): MockApproval[] {
  const out: MockApproval[] = [];
  const routineRefunds = [
    { customer: 'C-3318', amount: 24.99 }, { customer: 'C-4471', amount: 149.00 },
    { customer: 'C-5582', amount: 12.50 }, { customer: 'C-6693', amount: 89.99 },
    { customer: 'C-7710', amount: 199.00 }, { customer: 'C-8821', amount: 49.99 },
    { customer: 'C-9931', amount: 299.00 }, { customer: 'C-1042', amount: 9.99 },
  ];
  routineRefunds.forEach((r, i) => {
    const ageMin = 1500 + i * 800 + randInt(0, 120);
    out.push({
      id: `hist-refund-routine-${i}`, agent_id: 'agent-finance',
      activity_type: 'fin_refund', verdict: i % 7 === 0 ? 3 : 0,
      input: [{
        customer_id: r.customer, amount_usd: r.amount,
        payment_method: i % 2 === 0 ? 'visa_ending_4421' : 'mc_ending_2014',
      }],
      reason: i % 7 === 0
        ? `Customer outside the 30-day refund window (TICKET-${4000 + i}).`
        : `Standard refund per ToS; ticket SUP-${5000 + i}.`,
      created_at: agoMin(ageMin),
      decided_at: agoMin(ageMin - randInt(15, 60)),
      metadata: { trust_tier: 3 },
      agent: { agent_name: 'Finance Bot' },
    });
  });

  const routineRestarts = [
    'auth-service-1', 'auth-service-3', 'orders-api-1', 'orders-api-2',
    'web-edge-3', 'analytics-worker-2', 'billing-worker-1',
  ];
  routineRestarts.forEach((svc, i) => {
    const ageMin = 200 + i * 600 + randInt(0, 200);
    out.push({
      id: `hist-restart-routine-${i}`, agent_id: 'agent-sre',
      activity_type: 'system_restart', verdict: 0,
      input: [{ service: svc, mode: 'graceful', uptime_hours: 120 + i * 18 }],
      reason: `Routine memory-pressure restart per RB-019.`,
      created_at: agoMin(ageMin),
      decided_at: agoMin(ageMin - randInt(5, 30)),
      metadata: { trust_tier: 1 },
      agent: { agent_name: 'SRE Copilot' },
    });
  });

  const routineDeploys = [
    { svc: 'web-app', ver: 'v8.4.1' }, { svc: 'web-app', ver: 'v8.4.2' },
    { svc: 'orders-api', ver: 'v2.1.0' }, { svc: 'auth-service', ver: 'v4.2.0' },
    { svc: 'analytics-worker', ver: 'v1.7.3' },
  ];
  routineDeploys.forEach((d, i) => {
    const ageMin = 2400 + i * 1500 + randInt(0, 200);
    out.push({
      id: `hist-deploy-routine-${i}`, agent_id: 'agent-deploy',
      activity_type: 'service_deploy', verdict: 0,
      input: [{ service: d.svc, version: d.ver, target: 'production', replicas: 4, strategy: 'rolling' }],
      reason: `Scheduled biweekly release; CI green, canary clean.`,
      created_at: agoMin(ageMin),
      decided_at: agoMin(ageMin - randInt(20, 80)),
      metadata: { trust_tier: 2 },
      agent: { agent_name: 'Deploy Bot' },
    });
  });

  return out;
}

const resolvedBase: MockApproval[] = makeResolved();

const pending = new Map<string, MockApproval>(
  pendingTemplates.map((t): [string, MockApproval] => [t.id, hydrateTemplate(t)]),
);

// One-shot 10s expiry card for verifying the pending-list expiry sweep
// + toast handler. Anchored on first access so a refresh during the
// 10s window still shows the same row; once the deadline passes, the
// row is moved into resolvedBase so it appears under History → Expired
// (mirrors real-backend behavior: an expired approval is the SAME row,
// just past its deadline; no separate state, just a wall-clock-vs-
// expired_at filter at query time). Lives outside the persistent
// `pending` Map on purpose; the auto-promote-expired sweep at the top
// of getMockApprovals would otherwise lift it before the consumer's
// tick sweep runs, hiding the toast path. resetMockData() re-arms it
// on sign-out → sign-in.
let toastTestExpiresAt: number | null = null;
let toastTestCard: MockApproval | null = null;
let toastTestArchived = false;
function buildToastTestCard(): MockApproval | null {
  const now = Date.now();
  if (toastTestExpiresAt === null) {
    toastTestExpiresAt = now + 10_000;
    toastTestCard = {
      id: 'mock-toast-test',
      agent_id: 'agent-toast-test',
      activity_type: 'ShellExecution',
      verdict: 2,
      input: [{ command: 'echo "10s expiry; watch it pop"', cwd: '/tmp' }],
      reason: '10-second expiry to verify pending auto-remove + toast on transition.',
      // created_at is anchored 1 minute behind sign-in so the row
      // displays a stable "1m ago" instead of ticking up from "just
      // now" while the reviewer is watching the countdown; matches
      // the other fixtures (createdAgoMin: 1+ minute) and what real
      // backend cards look like (created at agent-call time, viewed
      // some time later). The 10-second window applies to the
      // EXPIRATION side: approval_timeout = (expired_at - created_at)
      // ≈ 70s, of which the viewer catches the last 10s.
      created_at: new Date(now - 60_000).toISOString(),
      approval_expired_at: new Date(toastTestExpiresAt).toISOString(),
      metadata: { trust_tier: 2 },
      agent: { agent_name: 'Toast Test' },
    };
  }
  if (toastTestExpiresAt <= now) {
    // Promote-once into resolvedBase so the History → Expired tab
    // picks it up. Subsequent reads return null (gone from pending)
    // but the archived copy stays visible in history until reset.
    if (toastTestCard && !toastTestArchived) {
      resolvedBase.unshift(toastTestCard);
      toastTestArchived = true;
    }
    return null;
  }
  return toastTestCard;
}

function statusForApproval(a: MockApproval): ApprovalListStatus {
  if (a.verdict === 0 || a.verdict === 1) return 'approved';
  if (a.verdict === 3) return 'rejected';
  if (
    a.verdict === 2 &&
    a.approval_expired_at &&
    new Date(a.approval_expired_at).getTime() < Date.now()
  ) {
    return 'expired';
  }
  if (a.verdict === 2) return 'pending';
  return 'pending';
}

export function getMockApprovals(
  status: ApprovalListStatus | undefined,
  filters: { search?: string; tier?: string } = {},
): Approval[] {
  // Cast at the boundary; see `MockApproval` above for why the
  // internal shape uses a widened `input` type.
  return getMockApprovalsInternal(status, filters) as unknown as Approval[];
}

function getMockApprovalsInternal(
  status: ApprovalListStatus | undefined,
  filters: { search?: string; tier?: string } = {},
): MockApproval[] {
  // Sweep aged-out pending → resolved (verdict=2 + expired). Done up
  // front so every status branch sees the post-sweep state, not just
  // the 'pending' branch.
  const now = Date.now();
  const stillPending: MockApproval[] = [];
  for (const [id, a] of pending) {
    if (a.approval_expired_at && new Date(a.approval_expired_at).getTime() < now) {
      pending.delete(id);
      resolvedBase.unshift({ ...a });
    } else {
      stillPending.push(a);
    }
  }
  const toastTest = buildToastTestCard();
  const source: MockApproval[] = (() => {
    // status === undefined → "All" (history "all" segment). Backend
    // returns every approval the org ever created with no status
    // filter; mirror that here. The consumer then drops live-pending
    // client-side, leaving decided + expired-pending visible.
    if (status === undefined) {
      return [...(toastTest ? [toastTest] : []), ...stillPending, ...resolvedBase];
    }
    if (status === 'pending') {
      return [...(toastTest ? [toastTest] : []), ...stillPending];
    }
    return resolvedBase.filter((a) => statusForApproval(a) === status);
  })();
  const q = filters.search?.toLowerCase().trim();
  return source.filter((a) => {
    // Mock RBAC: drop approvals whose agent the user can't read.
    // Same shape as a real backend 403 from PermissionEnum.ReadAgent .
    // user simply doesn't see the card.
    if (!canMockReadAgent(a.agent_id)) return false;
    if (filters.tier && String(a.metadata?.trust_tier) !== filters.tier) return false;
    if (q) {
      const hay = [a.agent?.agent_name, a.reason, a.activity_type].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function decideMockApproval(
  approvalId: string,
  action: 'approve' | 'reject',
): void {
  const item = pending.get(approvalId);
  if (!item) return;
  pending.delete(approvalId);
  resolvedBase.unshift({
    ...item,
    verdict: action === 'approve' ? 0 : 3,
  });
}

export function getMockOrgApprovals(status: ApprovalListStatus): OrgApprovalsResponse {
  return {
    approvals: { data: getMockApprovals(status) },
    metrics: {} as unknown as OrgApprovalsResponse['metrics'],
  };
}

export function getMockAgents(): PaginatedResponse<Agent> {
  return { data: mockAgents };
}

export function getMockAgentById(id: string): Agent | null {
  return mockAgents.find((a) => a.id === id) ?? null;
}

export function getMockMembers(): Member[] {
  return mockMembers;
}

export function resetMockData(): void {
  pending.clear();
  for (const [id, a] of pendingTemplates.map((t): [string, MockApproval] => [t.id, hydrateTemplate(t)])) {
    pending.set(id, a);
  }
  resolvedBase.length = 0;
  resolvedBase.push(...makeResolved());
  // Re-arm the toast-test card on sign-out → sign-in so the user can
  // verify the expiry path multiple times without a Metro reload.
  toastTestExpiresAt = null;
  toastTestCard = null;
  toastTestArchived = false;
}
