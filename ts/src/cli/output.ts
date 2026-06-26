// Single source of truth for CLI output. Two operating modes:
//
//   TTY mode (humans):
//     stdout = prose / progress / formatted JSON
//     stderr = errors / warnings / banners (multi-line cargo style)
//
//   Machine mode (`--json` flag, OR stdout is not a TTY):
//     stdout = exactly one JSON document, nothing else
//     stderr = empty on success; single-line `{"error":{...}}` on failure
//     exit code = source of truth
//     colors / progress / banners / `[recipe]` tags are silenced
//
// `isMachineMode()` is the single switch. Every helper consults it so
// tools / MCP / agents reading piped output get a clean JSON contract
// without having to remember a flag.
//
// Format spec for TTY mode follows cargo / git / rustc:
//
//   error: <terse one-liner, no trailing period>
//   <blank>
//   help: <one short hint, lowercase>
//         <continuation lines hanging-indented under the first>
//
// Helpers and their TTY-vs-machine behavior:
//
//   stream      stderr: error / warn / note / banner / prompts.
//                 stdout: info / action / success / row / summary /
//                 kv / table / output.
//   error       TTY: red `error:` + trailers.  Machine: `{"error":{...}}` line on stderr.
//   warn        TTY: yellow `warn:` line.       Machine: silent (or routed to a future warning channel).
//   info / action / success / note / banner / row / summary
//                 TTY: prose / progress.        Machine: silent.
//   kv / table  TTY: padded human layout.       Machine: JSON object / array on stdout.
//   output      TTY + machine: pretty JSON to stdout.
//   outputList  TTY: count to stderr + JSON to stdout.
//                 Machine: bare JSON; no count.
//
// Drift test (cli-output-drift.test.ts) bans raw `console.*` in
// `ts/src/cli/**` (except this file) so this module is the only place
// the contract lives.

import { color } from './colors.js';
import { isMachineMode } from './non-interactive.js';

// ---------------------------------------------------------------------------
// JSON-shaped output (always emit, both modes).

/** Emit a value as pretty JSON on stdout. The fundamental unit; every
 *  recipe and every spec op with `@cli_output_kind("json")` ends here. */
export function output(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/** List output. In TTY mode, emit a `<count> <label>` line on stderr
 *  before the JSON on stdout (the count is human scaffolding). In
 *  machine mode, suppress the count so stdout is pure JSON. */
export function outputList(data: unknown, label = 'items'): void {
  const obj = data as Record<string, unknown>;
  const machine = isMachineMode();
  if (obj?.data && Array.isArray(obj.data)) {
    if (!machine) {
      console.error(`${(obj.total as number) ?? obj.data.length} ${label}`);
    }
    console.log(JSON.stringify(obj.data, null, 2));
  } else if (Array.isArray(data)) {
    if (!machine) {
      console.error(`${data.length} ${label}`);
    }
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

// ---------------------------------------------------------------------------
// Severity prefixes (stderr).

export interface ErrorOpts {
  /** Short actionable suggestion. Multi-line strings hang-indent
   *  under the `help:` label. Same convention as `cargo` / `rustc`. */
  help?: string;
  /** Mechanical detail (server response body, exception payload). */
  detail?: string;
  /** Free-form pointer when neither `help` nor `detail` fit. */
  hint?: string;
  /** Doc URL / runbook / ticket. */
  see?: string;
}

const TRAILER_INDENT = '      '; // 6 spaces; `help: ` / `hint: ` etc are 6 cols.

function emitTrailer(label: string, value: string): void {
  const lines = value.split('\n');
  const head = `${label}: ${lines[0]}`;
  console.error(head);
  for (let i = 1; i < lines.length; i++) {
    console.error(`${TRAILER_INDENT}${lines[i]}`);
  }
}

/** Fatal error. TTY mode: cargo-style multi-line stderr. Machine
 *  mode: single-line `{"error":{...}}` JSON to stderr. Either way,
 *  caller pairs with `bailWith` / `reportAndExit` so the exit code
 *  is the source of truth. */
export function error(message: string, opts: ErrorOpts = {}): void {
  const msg = message.replace(/\.\s*$/, '');
  if (isMachineMode()) {
    const payload: Record<string, unknown> = { message: msg };
    if (opts.detail) payload.detail = opts.detail;
    if (opts.help) payload.help = opts.help;
    if (opts.hint) payload.hint = opts.hint;
    if (opts.see) payload.see = opts.see;
    console.error(JSON.stringify({ error: payload }));
    return;
  }
  console.error(`${color.red('error:')} ${msg}`);
  if (opts.detail || opts.help || opts.hint || opts.see) {
    console.error('');
  }
  if (opts.detail) emitTrailer('detail', opts.detail);
  if (opts.help) emitTrailer('help', opts.help);
  if (opts.hint) emitTrailer('hint', opts.hint);
  if (opts.see) emitTrailer('see', opts.see);
}

/** Non-fatal cautionary message. TTY: `warn:` line on stderr.
 *  Machine: silent; warnings are advisory, and the contract is "stderr
 *  is empty on success". A future enhancement could route to a separate
 *  warning channel; today, silenced is honest. */
export function warn(message: string, reference?: string): void {
  if (isMachineMode()) return;
  const msg = message.replace(/\.\s*$/, '');
  console.error(`${color.yellow('warn:')} ${msg}`);
  if (reference) console.error(`see: ${reference}`);
}

/** Stderr informational line in TTY mode. Used for "auxiliary fact"
 *  context (`metrics: {...}` after a list output). Silent in machine
 *  mode for the same reason as `warn`. */
export function note(message: string): void {
  if (isMachineMode()) return;
  console.error(message);
}

/** One-time boxed display on stderr. Silent in machine mode; the
 *  banner is human-only scaffolding (one-time secret reveal); the
 *  underlying value already lives in the JSON envelope of the op
 *  that generated it. */
export function banner(title: string, body: ReadonlyArray<string>): void {
  if (isMachineMode()) return;
  const rule = '────────────────────────────────────────────────────────────';
  console.error('');
  console.error(rule);
  console.error(`  ${title}`);
  for (const line of body) console.error(line === '' ? '' : `  ${line}`);
  console.error(rule);
}

// ---------------------------------------------------------------------------
// Plain stdout output (TTY only; silent in machine mode so stdout
// stays exactly one JSON document).

/** Sentence-case message to stdout. */
export function info(message: string): void {
  if (isMachineMode()) return;
  console.log(message);
}

/** Long-running action banner: `→ Installing extension…`. */
export function action(verb: string, target?: string): void {
  if (isMachineMode()) return;
  const tail = target ? ` ${target}` : '';
  console.log(color.dim('→') + ` ${verb}${tail}…`);
}

/** Successful completion line: `ok: <msg>`. */
export function success(message: string): void {
  if (isMachineMode()) return;
  console.log(`${color.green('ok:')} ${message}`);
}

// ---------------------------------------------------------------------------
// Per-target rows + summary block.
//
// Status vocabulary. Plan/install commands draw from this list so the
// summary line and per-target rows agree. Other statuses render plain.
export type RowStatus =
  | 'ok'
  | 'installed'
  | 'skipped'
  | 'failed'
  | 'would-install'
  | 'would-remove'
  | 'unchanged'
  | 'pass'
  | 'warn'
  | 'fail'
  | 'removed';

const STATUS_COLORS: Record<RowStatus, (s: string) => string> = {
  ok: color.green,
  installed: color.green,
  skipped: color.yellow,
  failed: color.red,
  'would-install': color.cyan,
  'would-remove': color.cyan,
  unchanged: color.dim,
  pass: color.green,
  warn: color.yellow,
  fail: color.red,
  removed: color.green,
};

const TARGET_COL = 32;
const STATUS_COL = 14;
const OVERFLOW_GAP = 2;

function padColumn(value: string, width: number): string {
  return value.length >= width
    ? value + ' '.repeat(OVERFLOW_GAP)
    : value.padEnd(width);
}

function colorizedStatus(status: string, colorize: (s: string) => string): string {
  return colorize(status) + ' '.repeat(Math.max(OVERFLOW_GAP, STATUS_COL - status.length));
}

/** Per-target line in a plan / progress table. Silent in machine
 *  mode; callers (runPlan etc.) emit a structured envelope instead. */
export function row(target: string, status: string, detail?: string): void {
  if (isMachineMode()) return;
  const colorize =
    (STATUS_COLORS as Record<string, (s: string) => string>)[status] ??
    ((s) => s);
  const left = padColumn(target, TARGET_COL);
  // When detail is present, pad status to STATUS_COL so the detail
  // column aligns. Without detail, drop the padding so the line has
  // no trailing whitespace (the prior `.trimEnd()` couldn't strip
  // padding that lived inside ANSI color escapes).
  if (detail) {
    const statusCol = colorizedStatus(status, colorize);
    const [first, ...rest] = detail.split('\n');
    console.log(`${left}${statusCol}${first}`);
    const indent = ' '.repeat(left.length + STATUS_COL);
    for (const line of rest) console.log(`${indent}${line}`);
  } else {
    console.log(`${left}${colorize(status)}`);
  }
}

export interface SummaryCounts {
  installed?: number;
  removed?: number;
  skipped?: number;
  failed?: number;
  unchanged?: number;
  pass?: number;
  warn?: number;
  fail?: number;
}

/** Closing summary line. Silent in machine mode; the structured
 *  envelope from the caller (e.g., runPlan) carries the counts. */
export function summary(counts: SummaryCounts): void {
  if (isMachineMode()) return;
  const order: (keyof SummaryCounts)[] = [
    'installed',
    'removed',
    'unchanged',
    'pass',
    'skipped',
    'warn',
    'fail',
    'failed',
  ];
  const parts: string[] = [];
  for (const k of order) {
    const v = counts[k];
    if (typeof v === 'number') parts.push(`${k}=${v}`);
  }
  const tail = parts.length > 0 ? ' ' + parts.join(' ') : '';
  console.log(`done.${tail}`);
}

// ---------------------------------------------------------------------------
// Padded structures. In machine mode, emit as JSON on stdout; the
// padding is purely a TTY-rendering artifact.

/** Padded key/value block (TTY) or JSON object (machine). */
export function kv(pairs: Record<string, string | number | boolean | null | undefined>): void {
  const entries = Object.entries(pairs).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  if (isMachineMode()) {
    console.log(JSON.stringify(Object.fromEntries(entries), null, 2));
    return;
  }
  const width = Math.max(...entries.map(([k]) => k.length));
  for (const [k, v] of entries) {
    console.log(`${k.padEnd(width)}  ${v ?? ''}`);
  }
}

/** Padded table (TTY) or JSON array of header-keyed objects (machine). */
export function table(headers: string[], rows: ReadonlyArray<ReadonlyArray<string>>): void {
  if (headers.length === 0) return;
  if (isMachineMode()) {
    const out = rows.map((r) => {
      const o: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) o[headers[i]] = r[i] ?? '';
      return o;
    });
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const fmt = (cells: ReadonlyArray<string>, decorate: (s: string) => string = (s) => s) =>
    cells.map((c, i) => decorate((c ?? '').padEnd(widths[i]))).join('  ');
  console.log(fmt(headers, color.bold));
  console.log(color.dim(widths.map((w) => '-'.repeat(w)).join('  ')));
  for (const r of rows) console.log(fmt(r));
}
