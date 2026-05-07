// Coverage for the ApprovalsTreeProvider — the data adapter that
// shapes the Approval rows into VS Code TreeItem nodes for both
// the pending view (flat list) and the history view (status-grouped).
//
// Why test it: the wdio-mocked layer used to assert "history view
// has at least 5 rows" and "decide moves a row out of pending"
// through a real workbench. The actual logic lives here and can
// be unit-tested without booting a workbench.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => {
  class TreeItem {
    id?: string;
    description?: string;
    iconPath?: unknown;
    contextValue?: string;
    tooltip?: string;
    command?: unknown;
    constructor(public label: string, public collapsibleState?: number) {}
  }
  class ThemeIcon {
    constructor(public id: string, public color?: unknown) {}
  }
  class ThemeColor {
    constructor(public id: string) {}
  }
  class EventEmitter<T> {
    private listeners: Array<(v: T) => void> = [];
    event = (l: (v: T) => void) => {
      this.listeners.push(l);
      return { dispose: () => undefined };
    };
    fire(v: T) { for (const l of this.listeners) l(v); }
  }
  class MarkdownString {
    isTrusted = false;
    supportThemeIcons = false;
    value = '';
    constructor(public initial?: string, supportTheme?: boolean) {
      if (initial) this.value = initial;
      if (supportTheme) this.supportThemeIcons = true;
    }
    appendText(s: string) { this.value += s; return this; }
    appendMarkdown(s: string) { this.value += s; return this; }
    appendCodeblock(s: string) { this.value += s; return this; }
  }
  return {
    TreeItem,
    ThemeIcon,
    ThemeColor,
    EventEmitter,
    MarkdownString,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  };
});

import { ApprovalsTreeProvider } from './approvalsView';
import type { Approval } from './types';
import { mockStore } from './mockStore';

function pending(id: string, overrides: Partial<Approval> = {}): Approval {
  return {
    id,
    agent_id: 'agent-x',
    status: 'pending',
    activity_type: 'ShellExecution',
    verdict: 2,
    reason: 'test reason',
    created_at: new Date().toISOString(),
    decided_at: undefined,
    approval_expired_at: new Date(Date.now() + 60_000).toISOString(),
    input: [{ command: 'ls' }],
    metadata: { trust_tier: 2 },
    agent: { agent_name: 'Test Agent' },
    ...overrides,
  };
}

describe('ApprovalsTreeProvider - flat (pending) list', () => {
  let provider: ApprovalsTreeProvider;

  beforeEach(() => {
    provider = new ApprovalsTreeProvider();
  });

  it('empty state: getChildren returns [] (lets viewsWelcome render)', () => {
    expect(provider.getChildren()).toEqual([]);
  });

  it('after update with rows: getChildren returns one approval node per row', () => {
    provider.update([pending('a'), pending('b')]);
    const children = provider.getChildren();
    expect(children).toHaveLength(2);
    expect(children[0]).toMatchObject({ kind: 'approval' });
  });

  it('hasMore=true with a load-more cmd appends a load-more node', () => {
    provider.setLoadMoreCommand('openbox.approvals.loadMore');
    provider.update([pending('a')], true);
    const children = provider.getChildren();
    expect(children).toHaveLength(2);
    expect(children[1]).toEqual({ kind: 'load-more' });
  });

  it('hasMore=true with no command: no load-more node appended', () => {
    provider.update([pending('a')], true);
    expect(provider.getChildren()).toHaveLength(1);
  });
});

describe('ApprovalsTreeProvider - history (groupByStatus)', () => {
  let provider: ApprovalsTreeProvider;

  beforeEach(() => {
    provider = new ApprovalsTreeProvider({ groupByStatus: true });
  });

  it('renders 3 section nodes (approved/rejected/expired) when populated', () => {
    provider.update([
      pending('a', { status: 'approved', verdict: 0, decided_at: new Date().toISOString() }),
      pending('b', { status: 'rejected', verdict: 3, decided_at: new Date().toISOString() }),
    ]);
    const children = provider.getChildren();
    expect(children).toHaveLength(3);
    expect(children.map((n) => (n as { status?: string }).status)).toEqual(['approved', 'rejected', 'expired']);
  });

  it('approvals expanded under section nodes are filtered by status', () => {
    const approved = pending('a', { status: 'approved', verdict: 0, decided_at: new Date().toISOString() });
    const rejected = pending('b', { status: 'rejected', verdict: 3, decided_at: new Date().toISOString() });
    provider.update([approved, rejected]);
    const sections = provider.getChildren();
    const approvedSection = sections.find((n) => (n as { status?: string }).status === 'approved');
    const rejectedSection = sections.find((n) => (n as { status?: string }).status === 'rejected');
    const approvedRows = provider.getChildren(approvedSection);
    const rejectedRows = provider.getChildren(rejectedSection);
    expect(approvedRows).toHaveLength(1);
    expect((approvedRows[0] as { approval: { id: string } }).approval.id).toBe('a');
    expect(rejectedRows).toHaveLength(1);
    expect((rejectedRows[0] as { approval: { id: string } }).approval.id).toBe('b');
  });

  it('history view never renders an empty section as 0 rows being shown', () => {
    // Empty list + groupByStatus: still returns [] (no approvals at all).
    expect(provider.getChildren()).toEqual([]);
  });
});

describe('ApprovalsTreeProvider - getTreeItem shapes', () => {
  let provider: ApprovalsTreeProvider;

  beforeEach(() => {
    provider = new ApprovalsTreeProvider();
  });

  it('approval node renders with agent name as label, openDetail command wired', () => {
    const a = pending('x');
    const item = provider.getTreeItem({ kind: 'approval', approval: a });
    expect(item.label).toBe('Test Agent');
    expect((item.command as { command: string })?.command).toBe('openbox.openDetail');
  });

  it('approval pending: contextValue=approval; decided: contextValue=approval-decided', () => {
    const pen = provider.getTreeItem({ kind: 'approval', approval: pending('p') });
    expect((pen as { contextValue?: string }).contextValue).toBe('approval');
    const dec = provider.getTreeItem({
      kind: 'approval',
      approval: pending('d', {
        status: 'approved',
        decided_at: new Date().toISOString(),
        verdict: 0,
        approval_expired_at: undefined,
      }),
    });
    expect((dec as { contextValue?: string }).contextValue).toBe('approval-decided');
  });

  it('section node renders with the count in description', () => {
    provider.setLoadMoreCommand('cmd');
    provider.update([
      pending('a', { status: 'approved', verdict: 0, decided_at: new Date().toISOString() }),
      pending('b', { status: 'approved', verdict: 0, decided_at: new Date().toISOString() }),
    ]);
    const item = provider.getTreeItem({ kind: 'section', status: 'approved' });
    expect(item.label).toBe('Approved');
    expect((item as { description?: string }).description).toBe('2');
  });

  it('load-more node renders with the configured command', () => {
    provider.setLoadMoreCommand('openbox.approvals.loadMore');
    const item = provider.getTreeItem({ kind: 'load-more' });
    expect(item.label).toBe('Load more…');
    expect((item.command as { command: string })?.command).toBe('openbox.approvals.loadMore');
  });
});

describe('ApprovalsTreeProvider - integrates with mockStore fixtures', () => {
  it('the seeded mockStore pending rows render as 6 approval nodes', () => {
    mockStore().reset();
    const provider = new ApprovalsTreeProvider();
    provider.update(mockStore().list('pending'));
    expect(provider.getChildren()).toHaveLength(6);
  });

  it('the seeded mockStore decided rows render as 5 rows under 3 sections', () => {
    mockStore().reset();
    const provider = new ApprovalsTreeProvider({ groupByStatus: true });
    const decided = mockStore().list(undefined).filter((a) => a.status !== 'pending');
    provider.update(decided);
    const sections = provider.getChildren();
    expect(sections).toHaveLength(3);
    let total = 0;
    for (const s of sections) {
      const rows = provider.getChildren(s);
      total += rows.length;
    }
    expect(total).toBe(5);
  });
});
