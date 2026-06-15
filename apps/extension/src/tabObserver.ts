// Tab / Composer / Cmd-K observer.
//
// Cursor doesn't expose hooks for inline ghost-text accept, Cmd-K
// edits, or Composer multi-file edits; by the time `afterFileEdit`
// fires (or doesn't, in the inline case), the change is already on
// disk. The closest reachable surface is VS Code's plain
// `onDidChangeTextDocument`, which fires on every buffer mutation
// regardless of whether Cursor or the user produced it.
//
// Classifying AI-inserted vs user-typed text is heuristic; VS Code
// doesn't tell us the source. The classifier here uses two cheap
// signals: change size (multi-line or multi-char inserts are very
// rarely keystroke origin) and idle timing (a 100+ char insert with
// no recent keystroke activity is almost certainly an AI insert or a
// paste). False positives include paste-from-clipboard; those still
// represent "non-keystroke" code entering the buffer, which is the
// signal we want for trust scoring.
//
// Emission is intentionally just an OutputChannel + an extension-
// pluggable callback; piping to the OpenBox API is a follow-up. The
// observer's value here is the classification and the foundation it
// gives later wiring.
import * as vscode from 'vscode';
import { GovernanceClient } from './governanceClient';
import { buildRecord, writeTraceRecord, type ContributorType } from '@openbox-ai/openbox-sdk/agent-trace';

const KEYSTROKE_IDLE_THRESHOLD_MS = 250;
const MIN_NON_KEYSTROKE_CHARS = 20;
const MIN_NON_KEYSTROKE_NEWLINES = 1;

export type InsertSource = 'keystroke' | 'non-keystroke';

export interface TabObservedEvent {
  uri: string;
  source: InsertSource;
  /** Inserted text (truncated for the channel; full length below). */
  preview: string;
  insertedChars: number;
  insertedNewlines: number;
  /** Position the change started at (0-indexed). */
  line: number;
  character: number;
  timestamp: number;
}

export interface TabObserver {
  dispose(): void;
}

export interface TabObserverOptions {
  /** OutputChannel name; created if absent. */
  channelName?: string;
  /** Called for every classified change. */
  onChange?: (event: TabObservedEvent) => void;
  /** Set true to emit keystroke events too (noisy; default off). */
  includeKeystrokes?: boolean;
  /** Set true to skip the OutputChannel writes (the `onChange`
   *  callback still fires). Used by callers piping events to a
   *  remote sink while keeping the panel quiet. Default false. */
  suppressOutputChannel?: boolean;
  /** Active mode: when true, classified non-keystroke inserts call
   *  check_governance(file_write) and reverted on deny. Requires the
   *  governance client to have an agent ID configured. */
  active?: boolean;
  /** Injected governance client; defaults to a fresh instance. */
  governance?: GovernanceClient;
  /** When true, every classified non-keystroke insert appends an
   *  Agent Trace record to ~/.openbox/log/agent-trace.jsonl (per
   *  cursor/agent-trace v0.1.0). Off by default; opt in via
   *  openbox.tabObserver.emitAgentTrace. */
  emitAgentTrace?: boolean;
}

export function createTabObserver(opts: TabObserverOptions = {}): TabObserver {
  const channel = vscode.window.createOutputChannel(
    opts.channelName ?? 'OpenBox · Tab Observer',
  );

  const governance = opts.governance ?? new GovernanceClient();
  // Single in-flight per URI; coalesce rapid AI inserts so we don't
  // pile up governance calls or revert mid-edit.
  const inFlight = new Set<string>();
  let lastKeystrokeAt = 0;

  async function evaluateActive(
    doc: vscode.TextDocument,
    change: vscode.TextDocumentContentChangeEvent,
  ): Promise<void> {
    const uri = doc.uri.toString();
    if (inFlight.has(uri)) return;
    if (!governance.agentId()) return;
    inFlight.add(uri);
    try {
      const filePath = doc.uri.scheme === 'file' ? doc.uri.fsPath : uri;
      const raw = await governance.check({
        spanType: 'file_write',
        activityInput: {
          file_path: filePath,
          content: change.text,
          event_category: 'agent_action',
        },
      });
      const result = governance.applyFailMode(raw);
      if (result.outcome === 'allow') return;

      // Compute the range that contains the new insert. The original
      // change range was the pre-insert anchor; after VS Code applied
      // the change, the new content occupies the same start, plus the
      // length of the inserted text.
      const start = change.range.start;
      const end = computeEndPosition(start, change.text);
      const edit = new vscode.WorkspaceEdit();
      edit.delete(doc.uri, new vscode.Range(start, end));
      const ok = await vscode.workspace.applyEdit(edit);
      if (!ok) {
        vscode.window.showWarningMessage(
          `OpenBox flagged an AI insert in ${doc.fileName} but the revert failed.`,
        );
        return;
      }
      const summary = result.outcome === 'deny' ? 'blocked' : 'pending approval';
      vscode.window.showWarningMessage(
        `OpenBox ${summary} an AI insert in ${doc.fileName}: ${result.reason ?? 'policy match'}`,
      );
    } finally {
      inFlight.delete(uri);
    }
  }

  function isKeystrokeChange(change: vscode.TextDocumentContentChangeEvent): boolean {
    // A keystroke is one or two chars (autoindent expands a Tab to
    // multiple chars), inserted on a single line, with no newline.
    if (change.text.length > 2) return false;
    if (change.text.includes('\n')) return false;
    return true;
  }

  function classify(change: vscode.TextDocumentContentChangeEvent, now: number): InsertSource {
    const sinceLastKeystroke = now - lastKeystrokeAt;
    if (isKeystrokeChange(change) && sinceLastKeystroke < KEYSTROKE_IDLE_THRESHOLD_MS) {
      return 'keystroke';
    }
    const newlines = (change.text.match(/\n/g) ?? []).length;
    if (
      change.text.length >= MIN_NON_KEYSTROKE_CHARS ||
      newlines >= MIN_NON_KEYSTROKE_NEWLINES
    ) {
      return 'non-keystroke';
    }
    // Borderline: small insert but more than a single keystroke. Treat
    // as keystroke so we don't drown in IDE-noise (autoindent, brace
    // matching).
    return 'keystroke';
  }

  const sub = vscode.workspace.onDidChangeTextDocument((event) => {
    const now = Date.now();
    for (const change of event.contentChanges) {
      // Pure deletions get skipped: the value here is in tracking what
      // *entered* the buffer.
      if (change.text.length === 0) continue;

      const source = classify(change, now);
      if (source === 'keystroke') {
        lastKeystrokeAt = now;
        if (!opts.includeKeystrokes) continue;
      }

      const newlines = (change.text.match(/\n/g) ?? []).length;
      const observed: TabObservedEvent = {
        uri: event.document.uri.toString(),
        source,
        preview: change.text.slice(0, 80).replace(/\n/g, '⏎'),
        insertedChars: change.text.length,
        insertedNewlines: newlines,
        line: change.range.start.line,
        character: change.range.start.character,
        timestamp: now,
      };

      if (!opts.suppressOutputChannel) {
        const tag = source === 'non-keystroke' ? '[ai-or-paste]' : '[keystroke]';
        channel.appendLine(
          `${tag} ${observed.uri}:${observed.line + 1}:${observed.character + 1} ` +
            `+${observed.insertedChars}c/${observed.insertedNewlines}nl  "${observed.preview}"`,
        );
      }

      opts.onChange?.(observed);

      if (opts.emitAgentTrace) {
        // Cursor/agent-trace records are an open format for AI
        // attribution; downstream tools (canvas, blame integrations)
        // ingest the same shape any compliant emitter produces.
        // Mapping: keystroke → human; non-keystroke → ai (since the
        // classifier already filtered out small idle-typing IDE
        // noise; a multi-line / 20+ char idle insert is far more
        // likely AI than a paste of human-authored code, but we
        // don't claim certainty - use 'unknown' for keystroke
        // non-keystrokes that are sub-threshold).
        const contributorType: ContributorType =
          source === 'non-keystroke' ? 'ai' : 'human';
        const startLine = change.range.start.line + 1;
        const inserted = change.text;
        const endLine = startLine + (inserted.match(/\n/g)?.length ?? 0);
        const filePath =
          event.document.uri.scheme === 'file'
            ? event.document.uri.fsPath
            : event.document.uri.toString();
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        try {
          const record = buildRecord({
            filePath,
            startLine,
            endLine,
            content: inserted,
            contributorType,
            workspaceRoot,
            tool: { name: 'openbox', version: '0.1.0' },
            metadata: { classifier: source, inserted_chars: inserted.length },
          });
          writeTraceRecord(record);
        } catch {
          /* writeTraceRecord swallows IO errors; this guards build errors */
        }
      }

      if (opts.active && source === 'non-keystroke') {
        // Fire-and-forget; the revert (if any) lands in a follow-up tick.
        void evaluateActive(event.document, change);
      }
    }
  });

  return {
    dispose: () => {
      sub.dispose();
      channel.dispose();
    },
  };
}

/** Walk through `text` to find where the cursor lands after applying
 *  it as a single insert at `start`. Newlines reset the column. */
function computeEndPosition(start: vscode.Position, text: string): vscode.Position {
  let line = start.line;
  let character = start.character;
  for (const ch of text) {
    if (ch === '\n') {
      line += 1;
      character = 0;
    } else {
      character += 1;
    }
  }
  return new vscode.Position(line, character);
}
