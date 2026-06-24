import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyClientFilters,
  dateRangeBounds,
  hasActiveFilters,
  summarizeFilters,
} from '../../ts/src/approvals/filters.ts';
import {
  approvalSource,
  SOURCE_INPUT_KEY,
  stampSource,
} from '../../ts/src/approvals/source.ts';
import { formatLabel, verdictLabel } from '../../ts/src/approvals/format.ts';
import { statusOf } from '../../ts/src/approvals/status.ts';
import { summarizeInput } from '../../ts/src/approvals/summarize.ts';
import { tierBg, tierColor } from '../../ts/src/approvals/tier.ts';
import { timeAgo, timeRemaining } from '../../ts/src/approvals/time.ts';
import {
  agoMin,
  canMockReadAgent,
  getMockOrgApprovals,
  mockAgents,
  mockMembers,
  mockProfile,
  resetMockData,
  fromNow,
} from '../../ts/src/approvals/mocks/fixtures.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('approval shared formatters', () => {
  it('formats verdicts, canonical labels, and acronym-aware custom labels', () => {
    expect(verdictLabel(0)).toBe('Allow');
    expect(verdictLabel(4)).toBe('Halt');
    expect(verdictLabel(null)).toBeUndefined();

    expect(formatLabel('MCPToolCall')).toBe('MCP Tool Call');
    expect(formatLabel('customHTTPURLParser')).toBe('Custom HTTPURL Parser');
    expect(formatLabel('')).toBe('');
  });

  it('derives status from explicit status, decided rows, expiry, and pending default', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T12:00:00Z'));

    expect(statusOf({ status: 'approved' })).toBe('approved');
    expect(statusOf({ status: 'REJECTED' })).toBe('rejected');
    expect(statusOf({ status: 'expired' })).toBe('expired');
    expect(statusOf({ decided_at: '2026-05-25T11:00:00Z', verdict: 1 })).toBe('approved');
    expect(statusOf({ decided_at: '2026-05-25T11:00:00Z', verdict: 4 })).toBe('rejected');
    expect(statusOf({ approval_expired_at: '2026-05-25T11:59:00Z' })).toBe('expired');
    expect(statusOf({ approval_expired_at: 'not-a-date' })).toBe('pending');
  });

  it('summarizes common activity inputs and falls back to compact JSON', () => {
    expect(summarizeInput('ShellExecution', [{ command: 'echo ok' }])).toBe('echo ok');
    expect(summarizeInput('PromptSubmission', [{ content: 'hello' }])).toBe('hello');
    expect(summarizeInput('FileEdit', [{ path: '/tmp/a.txt' }])).toBe('/tmp/a.txt');
    expect(summarizeInput('HTTPRequest', [{ method: 'POST', url: 'https://example.test' }])).toBe('POST https://example.test');
    expect(summarizeInput('MCPToolCall', [{ server: 'fs', tool_name: 'read' }])).toBe('fs.read');
    expect(summarizeInput('ToolStarted', [{ description: 'run tool' }])).toBe('run tool');
    expect(summarizeInput('AgentSpawn', [{ task: 'review' }])).toBe('review');
    expect(summarizeInput('Unknown', [{ a: 'x'.repeat(250) }])?.endsWith('…')).toBe(true);
    expect(summarizeInput('Unknown', [])).toBeNull();
    expect(summarizeInput('Unknown', ['raw'])).toBe('raw');
  });

  it('computes tier colors/backgrounds and human time strings', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T12:00:00Z'));

    expect(tierColor(undefined)).toBe('#8E8E93');
    expect(tierColor(4)).toBe('#30D158');
    expect(tierColor(3)).toBe('#3b9eff');
    expect(tierColor(2)).toBe('#FF9F0A');
    expect(tierColor(1)).toBe('#FF453A');
    expect(tierBg(3)).toBe('rgba(59,158,255,0.15)');

    expect(timeAgo('2026-05-25T12:00:00Z')).toBe('just now');
    expect(timeAgo('2026-05-25T11:59:50Z')).toBe('10s ago');
    expect(timeAgo('2026-05-25T11:50:00Z')).toBe('10m ago');
    expect(timeAgo('2026-05-25T09:00:00Z')).toBe('3h ago');
    expect(timeAgo('2026-05-23T12:00:00Z')).toBe('2d ago');
    expect(timeAgo('bad')).toBe('');

    expect(timeRemaining('2026-05-25T12:00:10Z')).toBe('10s');
    expect(timeRemaining('2026-05-25T12:10:00Z')).toBe('10m');
    expect(timeRemaining('2026-05-25T14:30:00Z')).toBe('2h 30m');
    expect(timeRemaining('2026-05-25T14:00:00Z')).toBe('2h');
    expect(timeRemaining('2026-05-25T11:59:00Z')).toBe('expired');
    expect(timeRemaining(null)).toBe('');
  });
});

describe('approval filters', () => {
  it('summarizes active filters with lookup labels', () => {
    expect(hasActiveFilters({ sort: 'newest', dateRange: 'all' })).toBe(false);
    const filters = {
      search: 'deploy',
      tier: '2',
      activityType: 'ShellExecution',
      teamId: 'team-1',
      ownerId: 'owner-1',
      sort: 'newest' as const,
      dateRange: 'week' as const,
    };
    expect(hasActiveFilters(filters)).toBe(true);
    expect(
      summarizeFilters(filters, {
        teamName: () => 'Platform',
        ownerName: () => 'Ada',
      }),
    ).toBe('Filters: "deploy" · Tier 2 · ShellExecution · Team: Platform · Owner: Ada · Last 7 days');
  });

  it('derives date range bounds and applies client-only filters without mutating input', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T12:00:00Z'));
    const localTodayStart = new Date('2026-05-25T12:00:00Z');
    localTodayStart.setHours(0, 0, 0, 0);

    expect(dateRangeBounds('all')).toEqual({});
    expect(dateRangeBounds('today').fromTime).toBe(localTodayStart.toISOString());
    expect(dateRangeBounds('week').fromTime).toBe('2026-05-18T12:00:00.000Z');
    expect(dateRangeBounds('month').fromTime).toBe('2026-04-25T12:00:00.000Z');

    const approvals = [
      { id: 'new', agent_id: 'agent-1', action_type: 'FileEdit', created_at: '2026-05-25T12:00:00Z' },
      { id: 'old', agent_id: 'agent-2', activity_type: 'ShellExecution', created_at: '2026-05-24T12:00:00Z' },
    ] as any[];
    const oldest = applyClientFilters(
      approvals,
      { ownerId: 'owner-2', activityType: 'ShellExecution', sort: 'oldest', dateRange: 'all' },
      (agentId) => (agentId === 'agent-2' ? 'owner-2' : 'owner-1'),
    );
    expect(oldest.map((a) => a.id)).toEqual(['old']);
    expect(approvals.map((a) => a.id)).toEqual(['new', 'old']);
  });

  it('covers permissive filter and summary defaults', () => {
    expect(summarizeFilters({ sort: 'newest', dateRange: 'all' })).toBeUndefined();
    expect(
      summarizeFilters(
        {
          teamId: 'team-missing',
          ownerId: 'owner-missing',
          sort: 'newest',
          dateRange: 'today',
        },
        {},
      ),
    ).toBe('Filters: Team: team-missing · Owner: owner-missing · Today');
    expect(dateRangeBounds(undefined)).toEqual({});

    const approvals = [
      { id: 'a', agent_id: undefined, created_at: 'bad' },
      { id: 'b', agent_id: 'agent-b', action_type: 'ShellExecution', created_at: '' },
      { id: 'c', agent_id: 'agent-c', activity_type: 'ShellExecution', created_at: '2026-05-25T01:00:00Z' },
    ] as any[];

    expect(
      applyClientFilters(
        approvals,
        { ownerId: 'owner-b', sort: 'newest', dateRange: 'all' },
        (agentId) => (agentId === 'agent-b' ? 'owner-b' : undefined),
      ).map((a) => a.id),
    ).toEqual(['b']);
    expect(
      applyClientFilters(
        approvals,
        { activityType: 'ShellExecution', sort: 'newest', dateRange: 'all' },
        () => undefined,
      ).map((a) => a.id),
    ).toEqual(['b', 'c']);
  });

  it('reads approval source from each supported path without mutating payloads', () => {
    expect(approvalSource({ metadata: { source: 'cursor' } } as any)).toBe('cursor');
    expect(approvalSource({ input: [{ [SOURCE_INPUT_KEY]: 'claude-code' }] } as any)).toBe(
      'claude-code',
    );
    expect(approvalSource({ spans: [{ module: 'mcp' }] } as any)).toBe('mcp');
    expect(
      approvalSource({
        spans: [{ attributes: { 'gen_ai.system': 'openai' } }],
      } as any),
    ).toBe('openai');
    expect(approvalSource({ metadata: { source: '' }, input: [], spans: [] } as any)).toBeUndefined();

    const input = { command: 'ls' };
    const stamped = stampSource(input, 'cursor');
    expect(stamped).toEqual({ command: 'ls', [SOURCE_INPUT_KEY]: 'cursor' });
    expect(input).toEqual({ command: 'ls' });
  });
});

describe('mock approvals fixture surface', () => {
  it('exports coherent demo data and access checks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T12:00:00Z'));

    expect(mockProfile.orgId).toBe('mock-org-001');
    expect(mockMembers.map((m) => m.id)).toContain(mockProfile.sub);
    expect(mockAgents.some((agent) => Array.isArray(agent.teams) && agent.teams.length === 0)).toBe(true);
    expect(canMockReadAgent(undefined)).toBe(true);
    expect(canMockReadAgent('agent-procurement')).toBe(false);
    expect(canMockReadAgent('agent-sre')).toBe(true);
    expect(fromNow(1)).toBe('2026-05-25T12:01:00.000Z');
    expect(agoMin(2)).toBe('2026-05-25T11:58:00.000Z');
    resetMockData();
    expect(getMockOrgApprovals('pending').approvals.data.length).toBeGreaterThan(0);
    expect(getMockOrgApprovals('approved').approvals.data.length).toBeGreaterThan(0);
    expect(getMockOrgApprovals('rejected').approvals.data.length).toBeGreaterThan(0);
    expect(getMockOrgApprovals('expired').approvals.data.length).toBeGreaterThan(0);
  });
});
