// Non-interactive context detection; the single source of truth used by
// every place that would otherwise prompt, spin, or color.
//
// A "non-interactive" run is one where:
//   - stdin is not a TTY (piped/redirected; no human to answer prompts)
//   - or CI=1 / OPENBOX_NONINTERACTIVE=1 is set
//   - or --yes / --non-interactive was passed on argv
//
// Design rule: prompts MUST consult this helper and bail with a clear
// "missing required input" error instead of blocking on stdin. Spinners
// and colors degrade silently; their absence is invisible to scripts.

let argvOverride: string[] | null = null;

export function setArgvForTesting(argv: string[] | null): void {
  argvOverride = argv;
}

function argv(): string[] {
  return argvOverride ?? process.argv;
}

export function isNonInteractive(): boolean {
  if (process.env.OPENBOX_NONINTERACTIVE && process.env.OPENBOX_NONINTERACTIVE !== '0') {
    return true;
  }
  if (process.env.CI && process.env.CI !== '0' && process.env.CI !== 'false') {
    return true;
  }
  const a = argv();
  if (a.includes('--yes') || a.includes('-y') || a.includes('--non-interactive')) {
    return true;
  }
  if (process.stdin && process.stdin.isTTY === false) {
    return true;
  }
  return false;
}

export function assumeYes(): boolean {
  if (process.env.OPENBOX_ASSUME_YES && process.env.OPENBOX_ASSUME_YES !== '0') {
    return true;
  }
  const a = argv();
  return a.includes('--yes') || a.includes('-y');
}

export function useColor(): boolean {
  if (process.env.NO_COLOR && process.env.NO_COLOR !== '') return false;
  if (process.env.OPENBOX_NO_COLOR && process.env.OPENBOX_NO_COLOR !== '0') return false;
  const a = argv();
  if (a.includes('--no-color')) return false;
  if (process.env.CI && process.env.CI !== '0' && process.env.CI !== 'false') return false;
  return process.stdout.isTTY === true;
}

export function isQuiet(): boolean {
  if (process.env.OPENBOX_QUIET && process.env.OPENBOX_QUIET !== '0') return true;
  const a = argv();
  return a.includes('--quiet') || a.includes('-q');
}

export function isJsonMode(): boolean {
  const a = argv();
  return a.includes('--json');
}

/**
 * Runtime gate for destructive ops (`@cli_destructive` in spec, plus a
 * handful of hand-coded sites). Refuses to run without `--yes` / `-y`
 * (or OPENBOX_ASSUME_YES=1). Fails closed in every context; we never
 * block on stdin, and an accidental destroy is hard to undo.
 *
 * Intentionally throws an Error rather than calling process.exit so the
 * caller's reportAndExit/bailWith path stays the single funnel.
 */
export class DestructiveConfirmRequiredError extends Error {
  constructor(public commandPath: string) {
    super(
      `\`openbox ${commandPath}\` is destructive; re-run with --yes (or set OPENBOX_ASSUME_YES=1).`,
    );
    this.name = 'DestructiveConfirmRequiredError';
  }
}

export function requireYesForDestructive(commandPath: string): void {
  if (assumeYes()) return;
  throw new DestructiveConfirmRequiredError(commandPath);
}
