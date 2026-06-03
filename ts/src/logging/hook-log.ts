// Append-only JSONL log of every hook event the runtime adapter
// processes. Read by the OpenBox extension's "OpenBox · <Host>
// Hook" output channel so the user can see hook activity in real
// time without tailing extension-host logs.
//
// One line per event: `{ ts, event, verdict_kind, took_ms,
// error? }`. The schema is deliberately light; the channel is for
// human glance, not audit. The full audit surface lives in the
// backend via the `X-Openbox-Client` header.
//
// The writer is parameterized by host name (for example `cursor`
// or `claude-code`) so each adapter writes to its own file under
// `~/.openbox/log/<host>-hook.jsonl`.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { openboxDataRoot } from '../env/os-paths.js';

/** Per-host log dir. Resolved lazily so tests can override
 *  `OPENBOX_HOME` between cases and have each writer hit its own
 *  data root. Caching the value at module-load would freeze it to
 *  whatever `OPENBOX_HOME` was when the first test ran. */
function logDir(): string {
  return path.join(openboxDataRoot(), 'log');
}
// Hard cap so a runaway hook cannot fill the disk. Five megabytes
// holds about a month of moderate use. When the cap is reached the
// file rotates to `.jsonl.1` and a fresh file starts. Only one
// rotation generation is retained.
export const MAX_BYTES = 5 * 1024 * 1024;

export interface HookLogLine {
  ts: string;
  event: string;
  verdict_kind?: 'permission' | 'observe' | 'none' | 'fallback';
  took_ms?: number;
  error?: string;
}

export interface HookLogger {
  record(line: HookLogLine): void;
  readonly path: string;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function rotateIfNeeded(file: string): void {
  try {
    const st = fs.statSync(file);
    if (st.size < MAX_BYTES) return;
  } catch {
    return; // doesn't exist yet
  }
  try {
    fs.renameSync(file, `${file}.1`);
  } catch {
    /* best-effort */
  }
}

/**
 * Creates a host-scoped hook-log writer. The `host` argument is
 * the adapter name and appears in the filename
 * (`<host>-hook.jsonl`). Use a stable, filesystem-safe slug such
 * as `cursor` or `claude-code`.
 */
export function makeHookLog(host: string): HookLogger {
  // Resolve the dir + path each time so OPENBOX_HOME overrides take
  // effect for tests that run in the same process. The `path`
  // property captures the value at construction so callers that
  // cached it before changing OPENBOX_HOME still get a sensible
  // (if stale) absolute path.
  const initialDir = logDir();
  const initialFile = path.join(initialDir, `${host}-hook.jsonl`);
  return {
    path: initialFile,
    record(line: HookLogLine): void {
      try {
        const dir = logDir();
        const file = path.join(dir, `${host}-hook.jsonl`);
        ensureDir(dir);
        rotateIfNeeded(file);
        fs.appendFileSync(file, JSON.stringify(line) + '\n', { mode: 0o600 });
      } catch {
        // Logging must never break the hook. Errors are swallowed.
      }
    },
  };
}

export interface TailHandle {
  stop(): void;
}

export interface TailOptions {
  /** Poll interval in milliseconds. Defaults to 1000. */
  intervalMs?: number;
  /** Invoked on the next tick after the file is renamed by
   *  rotation, so the consumer can emit a separator line. */
  onRotated?: () => void;
}

/**
 * Tails a `<host>-hook.jsonl` file, invoking `onLine` once per
 * new JSONL entry. Seeks to the current end of file on start so
 * consumers do not replay history. Polling-based (1 second by
 * default) because `fs.watch` behaves inconsistently across
 * macOS, Linux, and Windows; the channel is for human glance and
 * does not need millisecond resolution.
 *
 * `onLine` receives both the parsed object and the raw text, so
 * malformed entries can still render with whatever the consumer
 * decides to do with the raw line.
 */
export function tailHookLog(
  file: string,
  onLine: (line: HookLogLine, raw: string) => void,
  options: TailOptions = {},
): TailHandle {
  const intervalMs = options.intervalMs ?? 1000;
  let cursor = 0;
  try {
    cursor = fs.statSync(file).size;
  } catch {
    cursor = 0;
  }
  const tick = (): void => {
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      return; // file doesn't exist yet
    }
    if (size === cursor) return;
    if (size < cursor) {
      cursor = 0;
      options.onRotated?.();
    }
    let chunk: Buffer;
    try {
      const fd = fs.openSync(file, 'r');
      const len = size - cursor;
      chunk = Buffer.alloc(len);
      fs.readSync(fd, chunk, 0, len, cursor);
      fs.closeSync(fd);
    } catch {
      return;
    }
    cursor = size;
    const text = chunk.toString('utf-8');
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      let parsed: HookLogLine = {} as HookLogLine;
      try {
        parsed = JSON.parse(line) as HookLogLine;
      } catch {
        /* consumer still receives the raw line below */
      }
      onLine(parsed, line);
    }
  };
  const timer = setInterval(tick, intervalMs);
  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}
