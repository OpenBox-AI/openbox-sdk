// Single source of truth for CLI output formatting. The format follows
// the cargo / git / rustc convention so output reads natural to anyone
// who has used a modern CLI:
//
//   error: <terse one-liner, no trailing period>
//   <blank>
//   help: <one short hint, lowercase>
//         <continuation lines hanging-indented under the first>
//
// Every command in `ts/src/cli/commands/**` MUST route human output
// through these helpers (a drift test forbids raw `console.*` in the
// CLI tree). The format spec:
//
//   stream      stderr: error / warn / note / banner / prompts.
//                 stdout: info / action / success / row / summary /
//                 kv / table / output.
//   prefix      `error: <msg>`  red, lowercase, no period
//                 `warn:  <msg>` yellow, lowercase
//                 `ok:    <msg>` green, lowercase (success)
//                 info / action: no prefix; sentence-case msg.
//   trailers    error() takes optional help / detail / hint / see.
//                 each renders on its own line under a blank-line
//                 separator. multi-line trailers (caller passes a
//                 string with `\n`) hang-indent under the label.
//   verbs       action() takes a present-progressive verb ("Installing",
//                 "Removing"). Non-progressive ("Install", "Remove")
//                 are caller bugs.
//   rows        target<14> status<14> detail. Status drawn from a fixed
//                 vocabulary; unknown statuses are rendered plain.
//   summary     "done. installed=N skipped=M failed=K". Always last.
//   tables      padded columns; first arg is the header row.
//
// Color is structural, not decorative: green = success / ok, red =
// fail / error, yellow = warn / skip, dim = scaffolding. Tests assert
// against plain text by stripping ANSI; `useColor()` returns false in
// tests anyway.

import { color } from './colors.js';

// JSON envelope — preserved from the prior version of this file. Used
// by list/show commands that opt into machine-readable output.
export function output(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function outputList(data: unknown, label = 'items'): void {
  const obj = data as Record<string, unknown>;
  if (obj?.data && Array.isArray(obj.data)) {
    console.error(`${(obj.total as number) ?? obj.data.length} ${label}`);
    console.log(JSON.stringify(obj.data, null, 2));
  } else if (Array.isArray(data)) {
    console.error(`${data.length} ${label}`);
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

const TRAILER_INDENT = '      '; // 6 spaces — `help: ` / `hint: ` etc are 6 cols.

/** Render a labelled trailer line, hang-indenting any continuation
 *  lines so they line up under the value rather than the label. */
function emitTrailer(label: string, value: string): void {
  const lines = value.split('\n');
  const head = `${label}: ${lines[0]}`;
  console.error(head);
  for (let i = 1; i < lines.length; i++) {
    console.error(`${TRAILER_INDENT}${lines[i]}`);
  }
}

/** Fatal error to stderr. Caller pairs with `bailWith` (clean
 *  intentional exit) or `reportAndExit` (error funnel that maps
 *  exception types to exit codes). The first line is a terse
 *  one-liner with NO trailing period; trailers go under a blank
 *  separator line (cargo / git / rustc convention). */
export function error(message: string, opts: ErrorOpts = {}): void {
  // Strip a trailing period if the caller forgot — keeps `error:` lines
  // visually consistent regardless of where the message came from
  // (validators, exception messages, etc.).
  const msg = message.replace(/\.\s*$/, '');
  console.error(`${color.red('error:')} ${msg}`);
  if (opts.detail || opts.help || opts.hint || opts.see) {
    console.error('');
  }
  if (opts.detail) emitTrailer('detail', opts.detail);
  if (opts.help) emitTrailer('help', opts.help);
  if (opts.hint) emitTrailer('hint', opts.hint);
  if (opts.see) emitTrailer('see', opts.see);
}

/** Non-fatal cautionary message to stderr. */
export function warn(message: string, reference?: string): void {
  const msg = message.replace(/\.\s*$/, '');
  console.error(`${color.yellow('warn:')} ${msg}`);
  if (reference) console.error(`see: ${reference}`);
}

/** Informational message routed to stderr. Use for context that
 *  shouldn't pollute stdout (so JSON / piped output stays clean) but
 *  isn't a warning either: `metrics: {...}`, `note: <auxiliary fact>`. */
export function note(message: string): void {
  console.error(message);
}

/** One-time boxed display on stderr. Use when you need to make sure a
 *  value (a secret, a recovery hint) catches the user's eye even when
 *  stdout is being piped. Title goes on the first inner line; body
 *  lines render below in order, including any blank-line spacers the
 *  caller wants. */
export function banner(title: string, body: ReadonlyArray<string>): void {
  const rule = '────────────────────────────────────────────────────────────';
  console.error('');
  console.error(rule);
  console.error(`  ${title}`);
  for (const line of body) console.error(line === '' ? '' : `  ${line}`);
  console.error(rule);
}

// ---------------------------------------------------------------------------
// Plain stdout output.

/** Sentence-case message to stdout. No prefix, no color. The default
 *  surface for command-level info ("Using bundle at /path", "Skipping
 *  hardening profile."). */
export function info(message: string): void {
  console.log(message);
}

/** Long-running action banner. Use to announce work that's about to
 *  start; pair with `success`/`error` once it finishes.
 *
 *    action('Installing', 'extension')   // → Installing extension…
 *    action('Building bundle')           // → Building bundle…
 */
export function action(verb: string, target?: string): void {
  const tail = target ? ` ${target}` : '';
  console.log(color.dim('→') + ` ${verb}${tail}…`);
}

/** Successful completion line. Use after an `action` finishes, or when
 *  a command's primary side effect is done. */
export function success(message: string): void {
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

const TARGET_COL = 14;
const STATUS_COL = 14;

/** Per-target line in a plan / progress table.
 *
 *    row('extension', 'installed', 'host: cursor')
 *    → "extension     installed      host: cursor"
 */
export function row(target: string, status: string, detail?: string): void {
  const colorize =
    (STATUS_COLORS as Record<string, (s: string) => string>)[status] ??
    ((s) => s);
  const left = target.padEnd(TARGET_COL);
  const mid = colorize(status.padEnd(STATUS_COL));
  console.log(detail ? `${left}${mid}${detail}` : `${left}${mid}`.trimEnd());
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

/** Closing summary line. Format: `done. key1=N key2=M …`. Keys appear
 *  in the order: installed, removed, unchanged, pass, skipped, warn,
 *  fail, failed (severity ascending so the eye lands on failure last). */
export function summary(counts: SummaryCounts): void {
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
// Padded structures.

/** Padded key/value block. Keys are right-aligned; values plain. Use
 *  for `openbox auth profile`, `openbox config show`, etc. */
export function kv(pairs: Record<string, string | number | boolean | null | undefined>): void {
  const entries = Object.entries(pairs).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const width = Math.max(...entries.map(([k]) => k.length));
  for (const [k, v] of entries) {
    console.log(`${k.padEnd(width)}  ${v ?? ''}`);
  }
}

/** Padded table. First arg is the header row; remaining are body rows.
 *  Column widths fit the widest cell in each column. Header rendered in
 *  bold; a dim separator line is drawn under it. */
export function table(headers: string[], rows: ReadonlyArray<ReadonlyArray<string>>): void {
  if (headers.length === 0) return;
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const fmt = (cells: ReadonlyArray<string>, decorate: (s: string) => string = (s) => s) =>
    cells.map((c, i) => decorate((c ?? '').padEnd(widths[i]))).join('  ');
  console.log(fmt(headers, color.bold));
  console.log(color.dim(widths.map((w) => '-'.repeat(w)).join('  ')));
  for (const r of rows) console.log(fmt(r));
}
