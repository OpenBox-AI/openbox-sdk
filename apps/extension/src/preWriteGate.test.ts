import { describe, it, expect, vi, beforeEach } from 'vitest';

type WillSaveListener = (event: {
  document: { uri: { toString: () => string } };
  waitUntil: (p: Promise<unknown>) => void;
}) => void;

let willSaveListener: WillSaveListener | undefined;
let warningChoice: string | undefined;
const subscriptions: Array<{ dispose: () => void }> = [];
const showWarningCalls: Array<{ message: string }> = [];
const executedCommands: Array<{ id: string; arg: unknown }> = [];

vi.mock('vscode', () => ({
  workspace: {
    onWillSaveTextDocument: (listener: WillSaveListener) => {
      willSaveListener = listener;
      return { dispose: () => { willSaveListener = undefined; } };
    },
  },
  window: {
    showWarningMessage: vi.fn((message: string) => {
      showWarningCalls.push({ message });
      return Promise.resolve(warningChoice);
    }),
  },
  commands: {
    executeCommand: vi.fn((id: string, arg?: unknown) => {
      executedCommands.push({ id, arg });
      return Promise.resolve();
    }),
  },
}));

beforeEach(() => {
  willSaveListener = undefined;
  warningChoice = undefined;
  subscriptions.length = 0;
  showWarningCalls.length = 0;
  executedCommands.length = 0;
});

function fakeContext() {
  return { subscriptions } as unknown as Parameters<
    typeof import('./preWriteGate').PreWriteGate.prototype.attach
  >[0];
}

async function fireSave(uri: string): Promise<{ resolved: unknown; rejected: unknown }> {
  let captured: Promise<unknown> | undefined;
  willSaveListener?.({
    document: { uri: { toString: () => uri } },
    waitUntil: (p) => { captured = p; },
  });
  if (!captured) return { resolved: undefined, rejected: undefined };
  try {
    const v = await captured;
    return { resolved: v, rejected: undefined };
  } catch (err) {
    return { resolved: undefined, rejected: err };
  }
}

describe('PreWriteGate', () => {
  it('does not gate files without a recorded deny', async () => {
    const { PreWriteGate } = await import('./preWriteGate');
    const gate = new PreWriteGate();
    gate.attach(fakeContext());

    await fireSave('file:///workspace/clean.ts');
    expect(showWarningCalls.length).toBe(0);
  });

  it('gates files with a pending deny, allows override via "Save anyway"', async () => {
    const { PreWriteGate } = await import('./preWriteGate');
    const gate = new PreWriteGate();
    gate.attach(fakeContext());

    gate.recordDeny({
      uri: 'file:///workspace/dirty.ts',
      reason: 'flagged by guardrail PII',
      at: Date.now(),
    });
    warningChoice = 'Save anyway';

    const r = await fireSave('file:///workspace/dirty.ts');
    expect(showWarningCalls.length).toBe(1);
    expect(showWarningCalls[0].message).toContain('PII');
    expect(r.rejected).toBeUndefined();

    // After override the deny is cleared so a re-save isn't re-prompted.
    await fireSave('file:///workspace/dirty.ts');
    expect(showWarningCalls.length).toBe(1);
  });

  it('cancels the save when user dismisses the dialog', async () => {
    const { PreWriteGate } = await import('./preWriteGate');
    const gate = new PreWriteGate();
    gate.attach(fakeContext());

    gate.recordDeny({
      uri: 'file:///workspace/dirty.ts',
      reason: 'denied',
      at: Date.now(),
    });
    warningChoice = undefined; // user dismissed

    const r = await fireSave('file:///workspace/dirty.ts');
    expect(r.rejected).toBeInstanceOf(Error);
    expect((r.rejected as Error).message).toContain('save cancelled');
  });

  it('"Open in OpenBox" routes to the detail command with the approval id', async () => {
    const { PreWriteGate } = await import('./preWriteGate');
    const gate = new PreWriteGate();
    gate.attach(fakeContext());

    gate.recordDeny({
      uri: 'file:///workspace/dirty.ts',
      reason: 'denied',
      approvalId: 'apr_42',
      at: Date.now(),
    });
    warningChoice = 'Open in OpenBox';

    await fireSave('file:///workspace/dirty.ts');
    expect(executedCommands.length).toBe(1);
    expect(executedCommands[0].id).toBe('openbox.openDetail');
    expect(executedCommands[0].arg).toBe('apr_42');
  });

  it('clearDeny removes the pending entry so the gate stops firing', async () => {
    const { PreWriteGate } = await import('./preWriteGate');
    const gate = new PreWriteGate();
    gate.attach(fakeContext());

    gate.recordDeny({ uri: 'file:///x.ts', reason: 'r', at: Date.now() });
    gate.clearDeny('file:///x.ts');

    await fireSave('file:///x.ts');
    expect(showWarningCalls.length).toBe(0);
  });

  it('GCs entries older than the staleness window', async () => {
    const { PreWriteGate } = await import('./preWriteGate');
    const gate = new PreWriteGate();
    gate.attach(fakeContext());

    // 2 hours ago, past the 1h staleness window.
    gate.recordDeny({ uri: 'file:///old.ts', reason: 'r', at: Date.now() - 2 * 60 * 60 * 1000 });

    await fireSave('file:///old.ts');
    expect(showWarningCalls.length).toBe(0);
  });
});
