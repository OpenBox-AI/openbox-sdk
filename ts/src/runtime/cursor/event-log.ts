// Append-only JSONL log of every cursor hook event the handler
// processes. Read by the OpenBox VS Code / Cursor extension's
// "OpenBox · Cursor Hook" output channel so the user can see hook
// activity in real time without tailing extension-host logs.
//
// One line per event: `{ts, event, verdict_kind, took_ms, error?}`.
// Intentionally schema-light (no envelope dump): the OutputChannel
// is for human glance, not audit. The full audit surface lives in
// the backend via the X-Openbox-Client header.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { openboxDataRoot } from '../../env/os-paths.js';

const DIR = path.join(openboxDataRoot(), 'log');
const FILE = path.join(DIR, 'cursor-hook.jsonl');
// Hard cap so a runaway hook can't fill the disk. ~5 MB keeps a
// month of moderate use. When tripped, we rotate to .jsonl.1 and
// start fresh; only one rotation kept.
const MAX_BYTES = 5 * 1024 * 1024;

function ensureDir(): void {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
}

function rotateIfNeeded(): void {
  try {
    const st = fs.statSync(FILE);
    if (st.size < MAX_BYTES) return;
  } catch {
    return; // doesn't exist yet
  }
  try {
    fs.renameSync(FILE, `${FILE}.1`);
  } catch {
    /* best-effort */
  }
}

export interface HookLogLine {
  ts: string;
  event: string;
  verdict_kind?: 'permission' | 'observe' | 'none' | 'fallback';
  took_ms?: number;
  error?: string;
}

export function recordHookEvent(line: HookLogLine): void {
  try {
    ensureDir();
    rotateIfNeeded();
    fs.appendFileSync(FILE, JSON.stringify(line) + '\n', { mode: 0o600 });
  } catch {
    // Logging must never break the hook; swallow.
  }
}

export const HOOK_LOG_PATH = FILE;
