// Tails ~/.openbox/log/cursor-hook.jsonl into an OutputChannel so
// hook activity is visible inside Cursor in real time. The hook
// handler (a separate subprocess Cursor spawns per event) writes
// JSONL lines via runtime/cursor/event-log.ts; this side just
// formats and prints them.
//
// Polling-based tail (1s) - simpler and more portable than fs.watch
// on macOS/Linux/Windows, and the channel is read by humans
// occasionally, not as a hot path.

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import { HOOK_LOG_PATH as LOG_PATH } from 'openbox-sdk/runtime/cursor';

const POLL_MS = 1000;

interface HookLine {
  ts?: string;
  event?: string;
  verdict_kind?: string;
  took_ms?: number;
  error?: string;
}

function format(line: HookLine, raw: string): string {
  if (!line.event) return raw;
  const ts = line.ts ? line.ts.replace(/\.\d+Z$/, 'Z') : '';
  const tag = line.error
    ? '[error]'
    : line.verdict_kind === 'permission'
      ? '[gate]'
      : line.verdict_kind === 'observe'
        ? '[obs] '
        : '[life]';
  const took = line.took_ms !== undefined ? ` ${line.took_ms}ms` : '';
  const err = line.error ? `  ${line.error}` : '';
  return `${ts} ${tag} ${line.event}${took}${err}`;
}

export class HookLogTail {
  private channel: vscode.OutputChannel;
  private timer: ReturnType<typeof setInterval> | undefined;
  private cursor = 0;

  constructor() {
    this.channel = vscode.window.createOutputChannel('OpenBox · Cursor Hook');
  }

  start(context: vscode.ExtensionContext): void {
    // Skip-ahead to current EOF so we only show NEW events from the
    // moment the extension activates, not the full log history.
    try {
      this.cursor = fs.statSync(LOG_PATH).size;
    } catch {
      this.cursor = 0;
    }
    this.timer = setInterval(() => this.tick(), POLL_MS);
    context.subscriptions.push({ dispose: () => this.dispose() });
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.channel.dispose();
  }

  private tick(): void {
    let size = 0;
    try {
      size = fs.statSync(LOG_PATH).size;
    } catch {
      return; // file doesn't exist yet
    }
    if (size === this.cursor) return;
    if (size < this.cursor) {
      // Rotation happened (event-log.ts caps at 5MB and renames).
      // Reset and read from the start of the new file.
      this.cursor = 0;
      this.channel.appendLine('--- log rotated ---');
    }
    let chunk: Buffer;
    try {
      const fd = fs.openSync(LOG_PATH, 'r');
      const len = size - this.cursor;
      chunk = Buffer.alloc(len);
      fs.readSync(fd, chunk, 0, len, this.cursor);
      fs.closeSync(fd);
    } catch {
      return;
    }
    this.cursor = size;
    const text = chunk.toString('utf-8');
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      let parsed: HookLine = {};
      try {
        parsed = JSON.parse(line);
      } catch {
        /* ignore malformed */
      }
      this.channel.appendLine(format(parsed, line));
    }
  }
}
