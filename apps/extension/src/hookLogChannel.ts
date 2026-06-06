// VS Code `OutputChannel` wrapper that surfaces hook activity in
// real time. All tail, parse, and rotation logic lives in
// `openbox-sdk/logging`; this file only formats each line and
// pipes it into the channel.

import * as vscode from 'vscode';
import { HOOK_LOG_PATH as LOG_PATH } from 'openbox-sdk/runtime/cursor';
import { tailHookLog, type HookLogLine, type TailHandle } from 'openbox-sdk/logging';

function format(line: HookLogLine, raw: string): string {
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
  private tail: TailHandle | undefined;

  constructor() {
    this.channel = vscode.window.createOutputChannel('OpenBox · Cursor Hook');
  }

  start(context: vscode.ExtensionContext): void {
    this.tail = tailHookLog(
      LOG_PATH,
      (line, raw) => this.channel.appendLine(format(line, raw)),
      { onRotated: () => this.channel.appendLine('--- log rotated ---') },
    );
    context.subscriptions.push({ dispose: () => this.dispose() });
  }

  dispose(): void {
    this.tail?.stop();
    this.tail = undefined;
    this.channel.dispose();
  }
}
