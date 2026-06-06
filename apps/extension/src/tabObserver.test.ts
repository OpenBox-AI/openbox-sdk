// Unit test for the Tab/Composer observer. The vscode module is mocked
// at the test level; we don't need a real editor host, just enough
// of the API surface for the observer to register and fire.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type ChangeListener = (event: {
  document: { uri: { toString: () => string } };
  contentChanges: Array<{
    text: string;
    range: { start: { line: number; character: number } };
  }>;
}) => void;

let registeredListener: ChangeListener | undefined;
const channelLines: string[] = [];

vi.mock('vscode', () => {
  return {
    workspace: {
      onDidChangeTextDocument: (listener: ChangeListener) => {
        registeredListener = listener;
        return { dispose: () => { registeredListener = undefined; } };
      },
    },
    window: {
      createOutputChannel: (_name: string) => ({
        appendLine: (line: string) => channelLines.push(line),
        dispose: () => undefined,
      }),
    },
  };
});

beforeEach(() => {
  channelLines.length = 0;
  registeredListener = undefined;
});

function fireChange(text: string, opts: { line?: number; character?: number } = {}) {
  registeredListener?.({
    document: { uri: { toString: () => 'file:///workspace/foo.ts' } },
    contentChanges: [{
      text,
      range: { start: { line: opts.line ?? 0, character: opts.character ?? 0 } },
    }],
  });
}

describe('createTabObserver', () => {
  it('classifies single-character inserts as keystroke (not logged by default)', async () => {
    const { createTabObserver } = await import('./tabObserver');
    const obs = createTabObserver();
    fireChange('a');
    expect(channelLines).toEqual([]);
    obs.dispose();
  });

  it('classifies multi-line paste as non-keystroke', async () => {
    const { createTabObserver } = await import('./tabObserver');
    const obs = createTabObserver();
    fireChange('function foo() {\n  return 42;\n}');
    expect(channelLines.length).toBe(1);
    expect(channelLines[0]).toContain('[ai-or-paste]');
    expect(channelLines[0]).toContain('foo.ts');
    obs.dispose();
  });

  it('classifies long single-line insert as non-keystroke', async () => {
    const { createTabObserver } = await import('./tabObserver');
    const obs = createTabObserver();
    fireChange('thisisaverylongnonkeystrokeinsertionthatshouldtripthethreshold');
    expect(channelLines.length).toBe(1);
    expect(channelLines[0]).toContain('[ai-or-paste]');
    obs.dispose();
  });

  it('skips pure deletions', async () => {
    const { createTabObserver } = await import('./tabObserver');
    const obs = createTabObserver();
    fireChange('');
    expect(channelLines).toEqual([]);
    obs.dispose();
  });

  it('invokes onChange callback for non-keystroke inserts', async () => {
    const { createTabObserver } = await import('./tabObserver');
    const events: Array<{ source: string; insertedChars: number }> = [];
    const obs = createTabObserver({
      onChange: (e) => events.push({ source: e.source, insertedChars: e.insertedChars }),
    });
    fireChange('abc\ndef\nghi');
    expect(events.length).toBe(1);
    expect(events[0].source).toBe('non-keystroke');
    expect(events[0].insertedChars).toBe(11);
    obs.dispose();
  });

  it('with includeKeystrokes, also logs single-char keystrokes', async () => {
    const { createTabObserver } = await import('./tabObserver');
    const obs = createTabObserver({ includeKeystrokes: true });
    fireChange('a');
    expect(channelLines.length).toBe(1);
    expect(channelLines[0]).toContain('[keystroke]');
    obs.dispose();
  });

  it('dispose tears down the listener subscription', async () => {
    const { createTabObserver } = await import('./tabObserver');
    const obs = createTabObserver();
    expect(registeredListener).toBeDefined();
    obs.dispose();
    expect(registeredListener).toBeUndefined();
  });

  it('suppressOutputChannel skips channel writes but still fires onChange', async () => {
    const { createTabObserver } = await import('./tabObserver');
    const events: number[] = [];
    const obs = createTabObserver({
      suppressOutputChannel: true,
      onChange: (e) => events.push(e.insertedChars),
    });
    fireChange('function foo() {\n  return 42;\n}');
    expect(channelLines.length).toBe(0);
    expect(events.length).toBe(1);
    obs.dispose();
  });
});
