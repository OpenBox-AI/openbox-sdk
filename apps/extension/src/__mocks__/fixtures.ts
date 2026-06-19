// Slim fixtures for the extension's mock-auth mode. Same Approval
// shape mobile uses (canonical SDK type), trimmed to a handful of
// realistic rows so the panel + status bar render without a backend.
//
// When the user wants richer data (decided history, multi-page
// pagination, the full state machine), promote mobile's
// src/api/__mocks__/fixtures.ts into @openbox-ai/openbox-sdk/test-utils so both
// surfaces share one source. For now this is enough to demo the UI,
// validate local gate rendering, and unblock contributors who don't have a key
// minted.

import type { Approval } from '@openbox-ai/openbox-sdk/types';

const NOW = new Date();
function isoOffset(minutes: number): string {
  return new Date(NOW.getTime() + minutes * 60_000).toISOString();
}

const seed: Approval[] = [
  {
    id: 'mock-appr-001',
    agent_id: 'mock-agent-claude-staging',
    status: 'pending',
    activity_type: 'ShellExecution',
    verdict: 2,
    reason: 'Shell command matches behavior_rule "no-rm"',
    created_at: isoOffset(-2),
    approval_expired_at: isoOffset(28),
    agent: { agent_id: 'mock-agent-claude-staging', agent_name: 'claude-code-staging-dogfood', tier: 1 } as any,
    input: [{ command: 'rm -rf node_modules', cwd: '/Users/demo/repo' }] as any,
    metadata: {} as any,
  },
  {
    id: 'mock-appr-002',
    agent_id: 'mock-agent-cursor',
    status: 'pending',
    activity_type: 'FileEdit',
    verdict: 2,
    reason: 'File path matches policy "no-secrets-in-env"',
    created_at: isoOffset(-5),
    approval_expired_at: isoOffset(25),
    agent: { agent_id: 'mock-agent-cursor', agent_name: 'cursor-tab-observer', tier: 2 } as any,
    input: [{ file_path: '/Users/demo/repo/.env', content: 'OPENAI_API_KEY=sk-…' }] as any,
    metadata: {} as any,
  },
  {
    id: 'mock-appr-003',
    agent_id: 'mock-agent-finance',
    status: 'pending',
    activity_type: 'HTTPRequest',
    verdict: 4,
    reason: 'Outbound HTTP to non-allowlisted host',
    created_at: isoOffset(-12),
    approval_expired_at: isoOffset(18),
    agent: { agent_id: 'mock-agent-finance', agent_name: 'demo-finance-agent', tier: 0 } as any,
    input: [{ method: 'POST', url: 'https://api.unknown-vendor.example' }] as any,
    metadata: {} as any,
  },
  {
    id: 'mock-appr-004',
    agent_id: 'mock-agent-claude-staging',
    status: 'pending',
    activity_type: 'PromptSubmission',
    verdict: 2,
    reason: 'Prompt contains PII pattern',
    created_at: isoOffset(-18),
    approval_expired_at: isoOffset(12),
    agent: { agent_id: 'mock-agent-claude-staging', agent_name: 'claude-code-staging-dogfood', tier: 1 } as any,
    input: [{ prompt: 'analyze this customer record: name=Jane Doe ssn=123-45-6789' }] as any,
    metadata: {} as any,
  },
  {
    id: 'mock-appr-005',
    agent_id: 'mock-agent-data',
    status: 'pending',
    activity_type: 'DatabaseQuery',
    verdict: 2,
    reason: 'DELETE without WHERE clause',
    created_at: isoOffset(-25),
    approval_expired_at: isoOffset(5),
    agent: { agent_id: 'mock-agent-data', agent_name: 'demo-data-agent', tier: 1 } as any,
    input: [{ system: 'postgresql', operation: 'DELETE', statement: 'DELETE FROM users' }] as any,
    metadata: {} as any,
  },
  {
    id: 'mock-appr-006',
    agent_id: 'mock-agent-cursor',
    status: 'pending',
    activity_type: 'MCPToolCall',
    verdict: 2,
    reason: 'MCP tool not in agent allowlist',
    created_at: isoOffset(-32),
    approval_expired_at: isoOffset(-2), // expired path; UI should handle
    agent: { agent_id: 'mock-agent-cursor', agent_name: 'cursor-tab-observer', tier: 2 } as any,
    input: [{ tool: 'github.create_pull_request' }] as any,
    metadata: {} as any,
  },
];

let pending: Approval[] = [...seed];

export function getMockApprovals(): Approval[] {
  return pending;
}

export function decideMockApproval(approvalId: string): boolean {
  const before = pending.length;
  pending = pending.filter((a) => a.id !== approvalId);
  return pending.length < before;
}

export function resetMockApprovals(): void {
  pending = [...seed];
}

export const mockProfile = {
  sub: 'mock:user:tester',
  orgId: 'mock-org-001',
  email: 'tester@openbox.local',
  picture: null,
  permissions: ['read:agent', 'read:agent_session', 'read:agent_log'],
  isApiKeyAuth: false,
  require_password_change: false,
  setup: { pending: false },
};
