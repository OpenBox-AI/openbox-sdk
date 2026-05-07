// End-to-end wiring tests for the activate() flow. We mock the vscode
// API surface and the SDK polling/client modules, then drive the
// approvals feed with synthetic events to verify:
//   - halt-verdict approvals on open URIs land in the PreWriteGate
//   - halts that drop out of pending get cleared
//   - the tabObserver onChange fires when enabled and stays silent when off
//
// We deliberately don't import preWriteGate directly here; we observe
// its effect via what `recordDeny` / `clearDeny` see through a spy
// installed on the prototype. That keeps the tests honest about the
// integration boundary instead of re-testing the gate's internal state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PollingService } from './polling';

// ─── vscode mock ───────────────────────────────────────────────────────────
type CmdHandler = (...args: unknown[]) => unknown;
type ConfigListener = (e: { affectsConfiguration: (k: string) => boolean }) => void;
type ChangeListener = (event: {
  document: { uri: { toString: () => string } };
  contentChanges: Array<{ text: string; range: { start: { line: number; character: number } } }>;
}) => void;

let openTabUris: string[] = [];
let registeredCommands: Map<string, CmdHandler> = new Map();
const channelLines: string[] = [];
let configMap: Record<string, unknown> = {};
let configListeners: ConfigListener[] = [];
let onDidChangeTextDocumentListener: ChangeListener | undefined;

function makeUri(s: string) {
  return { toString: () => s, fsPath: s };
}

vi.mock('vscode', () => {
  return {
    ExtensionMode: { Development: 2, Production: 1, Test: 3 },
    StatusBarAlignment: { Right: 2, Left: 1 },
    ConfigurationTarget: { Global: 1 },
    EventEmitter: class {
      private listeners: Array<(v: unknown) => void> = [];
      event = (l: (v: unknown) => void) => {
        this.listeners.push(l);
        return { dispose: () => undefined };
      };
      fire(v: unknown) {
        for (const l of this.listeners) l(v);
      }
    },
    ThemeIcon: class {
      constructor(public id: string) {}
    },
    TreeItem: class {
      constructor(
        public label: string,
        public collapsibleState?: number,
      ) {}
    },
    Uri: { file: (p: string) => makeUri(`file://${p}`) },
    workspace: {
      getConfiguration: (_section?: string) => ({
        get: <T>(key: string, def?: T): T =>
          (configMap[key] !== undefined ? (configMap[key] as T) : (def as T)),
        update: vi.fn(async () => undefined),
      }),
      onDidChangeConfiguration: (listener: ConfigListener) => {
        configListeners.push(listener);
        return { dispose: () => undefined };
      },
      onDidChangeTextDocument: (listener: ChangeListener) => {
        onDidChangeTextDocumentListener = listener;
        return { dispose: () => (onDidChangeTextDocumentListener = undefined) };
      },
      onWillSaveTextDocument: (_listener: unknown) => ({ dispose: () => undefined }),
      onWillCreateFiles: (_listener: unknown) => ({ dispose: () => undefined }),
      onWillDeleteFiles: (_listener: unknown) => ({ dispose: () => undefined }),
      onWillRenameFiles: (_listener: unknown) => ({ dispose: () => undefined }),
    },
    window: {
      tabGroups: {
        get all() {
          return [
            {
              tabs: openTabUris.map((u) => ({ input: { uri: makeUri(u) } })),
            },
          ];
        },
      },
      createStatusBarItem: () => ({
        text: '',
        tooltip: '',
        command: '',
        show: vi.fn(),
        dispose: vi.fn(),
      }),
      createTreeView: () => ({
        badge: undefined,
        dispose: vi.fn(),
        onDidChangeVisibility: () => ({ dispose: vi.fn() }),
      }),
      createOutputChannel: () => ({
        appendLine: (line: string) => channelLines.push(line),
        dispose: () => undefined,
      }),
      showWarningMessage: vi.fn(async () => undefined),
      showErrorMessage: vi.fn(async () => undefined),
      showInformationMessage: vi.fn(async () => undefined),
      showQuickPick: vi.fn(async () => undefined),
    },
    commands: {
      executeCommand: vi.fn(async () => undefined),
      registerCommand: (id: string, handler: CmdHandler) => {
        registeredCommands.set(id, handler);
        return { dispose: () => registeredCommands.delete(id) };
      },
    },
    env: { clipboard: { writeText: vi.fn() } },
  };
});

// ─── SDK mocks ─────────────────────────────────────────────────────────────
type ApprovalShape = {
  id: string;
  verdict?: number;
  status?: string;
  reason?: string;
  activity_type?: string;
  agent_id?: string;
  input?: unknown;
  agent?: { agent_name?: string };
};

type ChangedListener = (approvals: ApprovalShape[]) => void;
type NewApprovalsListener = (approvals: ApprovalShape[]) => void;
type ErrorListener = (err: Error) => void;

class FakePolling {
  private changedListeners: ChangedListener[] = [];
  private newListeners: NewApprovalsListener[] = [];
  private errorListeners: ErrorListener[] = [];

  on(event: string, l: ChangedListener | NewApprovalsListener | ErrorListener) {
    if (event === 'changed') this.changedListeners.push(l as ChangedListener);
    else if (event === 'newApprovals') this.newListeners.push(l as NewApprovalsListener);
    else if (event === 'error') this.errorListeners.push(l as ErrorListener);
    return this;
  }

  start() {
    /* no-op; tests drive emit() directly */
  }

  stop() {
    /* no-op */
  }

  refresh = vi.fn(async () => undefined);

  // Test driver
  emit(event: string, payload: unknown) {
    if (event === 'changed') for (const l of this.changedListeners) l(payload as ApprovalShape[]);
    if (event === 'newApprovals') for (const l of this.newListeners) l(payload as ApprovalShape[]);
    if (event === 'error') for (const l of this.errorListeners) l(payload as Error);
  }
}

let lastFakePolling: FakePolling | undefined;

// Local polling module (ViewSession constructs PollingService from
// `./polling`). Drives the recovered ViewSession-based extension; the
// halt-verdict pipeline now flows polling → ViewSession → onApprovalsRefreshed
// → syncHaltedApprovals → preWrite.recordDeny. The fake's emit() entry
// point still drives the chain end-to-end.
vi.mock('./polling', () => ({
  PollingService: class {
    public approvals: unknown[] = [];
    public hasMore = false;
    public lastPollAt: number | undefined;
    public lastErrorAt: number | undefined;
    public lastErrorMessage: string | undefined;
    public errorCount = 0;
    constructor(_client: unknown, _orgId: string) {
      lastFakePolling = new FakePolling();
      // Mirror the FakePolling surface back onto the constructed
      // instance so ViewSession's wiring sees the same emitter.
      // The constructor return-as-PollingService cross-cast is the
      // mock-class trick; TS sees the wider PollingService shape.
      return lastFakePolling as unknown as PollingService;
    }
  },
}));

vi.mock('./api', () => ({
  createApi: vi.fn(),
  createApiContext: vi.fn(async () => ({
    client: {
      getProfile: async () => ({
        orgId: 'org_test',
        email: 'tester@example.com',
        sub: 'tester',
      }),
      decideApproval: vi.fn(async () => undefined),
      listAgents: vi.fn(async () => ({ data: [] })),
      listApiKeys: vi.fn(async () => ({ data: [] })),
      listTeams: vi.fn(async () => ({ data: [] })),
      listMembers: vi.fn(async () => ({ members: [] })),
      getAgent: vi.fn(async () => ({})),
    },
    apiBase: 'https://api.test',
  })),
  // Token store helpers - the recovered extension reads these on boot.
  apiKeyPrefix: vi.fn(() => 'obx_key_test1234…'),
  clearApiKey: vi.fn(),
  hasApiKey: vi.fn(() => true),
  readStore: vi.fn(() => ({ production: { apiKey: 'obx_key_test', updatedAt: '2026-05-06' } })),
  validateApiKey: vi.fn(() => true),
  writeApiKey: vi.fn(),
}));

vi.mock('./approvalsView', () => ({
  ApprovalsTreeProvider: class {
    update = vi.fn();
    dispose = vi.fn();
    setLoadMoreCommand = vi.fn();
    onDidChangeTreeData = () => ({ dispose: () => undefined });
    getTreeItem = () => ({});
    getChildren = () => [];
  },
}));

// Recovered UI surfaces - minimal shims so activate() can wire them
// without exploding. The tests don't drive these surfaces; the
// PreWriteGate / TabObserver assertions don't depend on them.
vi.mock('./detailPanel', () => ({
  ApprovalDetailPanel: { show: vi.fn(), disposeCurrent: vi.fn() },
}));
vi.mock('./viewSession', () => ({
  ViewSession: class {
    public count = 0;
    public lastPollAt: number | undefined;
    public lastErrorAt: number | undefined;
    public lastErrorMessage: string | undefined;
    public errorCount = 0;
    constructor(cfg: { scope: string }, deps: { onApprovalsRefreshed?: (a: unknown[]) => void }) {
      // Only the pending session subscribes to the halt-verdict
      // pipeline; history doesn't carry actionable verdict-4 rows.
      // Construct a FakePolling for the pending scope and bridge its
      // 'changed' events into the deps callback so the existing tests
      // (which emit on lastFakePolling) drive the halt-tracking
      // pipeline end-to-end.
      if (cfg.scope === 'pending') {
        lastFakePolling = new FakePolling();
        lastFakePolling.on('changed', (approvals: unknown[]) => {
          deps.onApprovalsRefreshed?.(approvals);
        });
      }
    }
    refresh = vi.fn();
    dispose = vi.fn();
  },
  inlineDecide: vi.fn(),
}));
vi.mock('./dashboardUrl', () => ({ apiKeysUrl: vi.fn(() => undefined) }));
vi.mock('./debugInfoPanel', () => ({ showDebugInfoPanel: vi.fn() }));
vi.mock('./mockClient', () => ({ MockClient: class { constructor() {} } }));
vi.mock('./mockStore', () => ({
  mockStore: () => ({ seed: vi.fn(), reset: vi.fn(), counts: () => ({ pending: 0, approved: 0, rejected: 0, expired: 0 }) }),
}));
vi.mock('./debugView', () => ({
  DebugControlsProvider: class {
    refresh = vi.fn();
    dispose = vi.fn();
    onDidChangeTreeData = () => ({ dispose: () => undefined });
    getTreeItem = () => ({});
    getChildren = () => [];
  },
}));
vi.mock('./profileView', () => ({
  ProfileProvider: class {
    refresh = vi.fn();
    onDidChangeTreeData = () => ({ dispose: () => undefined });
    getTreeItem = () => ({});
    getChildren = () => [];
  },
}));
vi.mock('./onboardView', () => ({
  OnboardProvider: class {
    onDidChangeTreeData = () => ({ dispose: () => undefined });
    getTreeItem = () => ({});
    getChildren = () => [];
  },
}));
vi.mock('./hookLogChannel', () => ({
  HookLogTail: class {
    start = vi.fn();
    dispose = vi.fn();
  },
}));

// Spy installed on PreWriteGate.prototype so we can observe what the
// activate() code records / clears, regardless of internal map state.
vi.mock('./preWriteGate', async () => {
  const actual = await vi.importActual<typeof import('./preWriteGate')>('./preWriteGate');
  return actual;
});

// ─── helpers ───────────────────────────────────────────────────────────────
async function bootExtension() {
  // Reset module cache so each test gets a fresh `feed` module-local.
  vi.resetModules();
  const { activate } = await import('./extension');
  const subscriptions: Array<{ dispose: () => void }> = [];
  const ctx = {
    subscriptions,
    extensionMode: 1, // Production
    globalState: {
      get: vi.fn(<T>(_k: string, def?: T) => def),
      update: vi.fn(async () => undefined),
    },
  } as unknown as Parameters<typeof activate>[0];
  await activate(ctx);
  return { ctx, subscriptions };
}

function fileUri(p: string): string {
  return `file://${p}`;
}

function approval(partial: Partial<ApprovalShape> & { id: string }): ApprovalShape {
  return { ...partial };
}

beforeEach(() => {
  openTabUris = [];
  registeredCommands = new Map();
  channelLines.length = 0;
  configMap = {};
  configListeners = [];
  onDidChangeTextDocumentListener = undefined;
  lastFakePolling = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── tests ─────────────────────────────────────────────────────────────────
describe('extension wiring: preWriteGate', () => {
  it('records a deny when an approval has verdict=4 and the URI is open', async () => {
    const target = '/workspace/dirty.ts';
    openTabUris = [fileUri(target)];

    const { PreWriteGate } = await import('./preWriteGate');
    const recordSpy = vi.spyOn(PreWriteGate.prototype, 'recordDeny');

    await bootExtension();
    expect(lastFakePolling).toBeDefined();

    lastFakePolling!.emit('changed', [
      approval({
        id: 'apr_1',
        verdict: 4,
        reason: 'guardrail flagged PII',
        activity_type: 'FileEdit',
        input: [{ file_path: target }],
      }),
    ]);

    expect(recordSpy).toHaveBeenCalledTimes(1);
    const arg = recordSpy.mock.calls[0][0];
    expect(arg.uri).toBe(fileUri(target));
    expect(arg.approvalId).toBe('apr_1');
    expect(arg.reason).toContain('PII');

    recordSpy.mockRestore();
  });

  it('skips approvals whose target URI is not open in any tab', async () => {
    openTabUris = []; // nothing open

    const { PreWriteGate } = await import('./preWriteGate');
    const recordSpy = vi.spyOn(PreWriteGate.prototype, 'recordDeny');

    await bootExtension();
    lastFakePolling!.emit('changed', [
      approval({
        id: 'apr_2',
        verdict: 4,
        reason: 'flagged',
        input: [{ file_path: '/workspace/other.ts' }],
      }),
    ]);

    expect(recordSpy).not.toHaveBeenCalled();
    recordSpy.mockRestore();
  });

  it('skips approvals at non-halt verdicts (require-approval, allow, etc.)', async () => {
    const target = '/workspace/x.ts';
    openTabUris = [fileUri(target)];

    const { PreWriteGate } = await import('./preWriteGate');
    const recordSpy = vi.spyOn(PreWriteGate.prototype, 'recordDeny');

    await bootExtension();
    lastFakePolling!.emit('changed', [
      approval({ id: 'apr_3', verdict: 2, input: [{ file_path: target }] }), // require_approval
      approval({ id: 'apr_4', verdict: 0, input: [{ file_path: target }] }), // allow
    ]);

    expect(recordSpy).not.toHaveBeenCalled();
    recordSpy.mockRestore();
  });

  it('clears the deny when a previously-halted approval drops out of the pending set', async () => {
    const target = '/workspace/dirty.ts';
    openTabUris = [fileUri(target)];

    const { PreWriteGate } = await import('./preWriteGate');
    const recordSpy = vi.spyOn(PreWriteGate.prototype, 'recordDeny');
    const clearSpy = vi.spyOn(PreWriteGate.prototype, 'clearDeny');

    await bootExtension();

    // First emit: halt lands.
    lastFakePolling!.emit('changed', [
      approval({ id: 'apr_5', verdict: 4, reason: 'flagged', input: [{ file_path: target }] }),
    ]);
    expect(recordSpy).toHaveBeenCalledTimes(1);

    // Second emit: pending set is empty (approver decided / it expired).
    lastFakePolling!.emit('changed', []);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(clearSpy.mock.calls[0][0]).toBe(fileUri(target));

    recordSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it('does not double-record on repeated changed emits for the same halt', async () => {
    const target = '/workspace/dirty.ts';
    openTabUris = [fileUri(target)];

    const { PreWriteGate } = await import('./preWriteGate');
    const recordSpy = vi.spyOn(PreWriteGate.prototype, 'recordDeny');

    await bootExtension();
    const halt = approval({
      id: 'apr_6',
      verdict: 4,
      reason: 'flagged',
      input: [{ file_path: target }],
    });
    lastFakePolling!.emit('changed', [halt]);
    lastFakePolling!.emit('changed', [halt]);
    lastFakePolling!.emit('changed', [halt]);

    expect(recordSpy).toHaveBeenCalledTimes(1);
    recordSpy.mockRestore();
  });
});

describe('extension wiring: tabObserver', () => {
  it('registers no listener when openbox.tabObserver.enabled is false', async () => {
    configMap['tabObserver.enabled'] = false;
    await bootExtension();
    expect(onDidChangeTextDocumentListener).toBeUndefined();
  });

  it('registers a listener and writes to the OutputChannel when outputLog is on', async () => {
    configMap['tabObserver.enabled'] = true;
    configMap['tabObserver.outputLog'] = true;
    await bootExtension();
    expect(onDidChangeTextDocumentListener).toBeDefined();

    onDidChangeTextDocumentListener!({
      document: { uri: { toString: () => 'file:///x.ts' } },
      contentChanges: [
        {
          text: 'function foo() {\n  return 42;\n}',
          range: { start: { line: 0, character: 0 } },
        },
      ],
    });
    expect(channelLines.length).toBe(1);
    expect(channelLines[0]).toContain('[ai-or-paste]');
  });

  it('suppresses OutputChannel writes when outputLog is false', async () => {
    configMap['tabObserver.enabled'] = true;
    configMap['tabObserver.outputLog'] = false;
    await bootExtension();
    expect(onDidChangeTextDocumentListener).toBeDefined();

    onDidChangeTextDocumentListener!({
      document: { uri: { toString: () => 'file:///x.ts' } },
      contentChanges: [
        {
          text: 'function foo() {\n  return 42;\n}',
          range: { start: { line: 0, character: 0 } },
        },
      ],
    });
    expect(channelLines.length).toBe(0);
  });
});
