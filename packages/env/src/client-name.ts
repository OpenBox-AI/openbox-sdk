// Identity advertised on every backend request via the X-Openbox-Client
// header. Backend treats it as presence-only - value is purely a telemetry
// dimension, but the more it tells, the more useful it is in logs.
//
// The base name says which component is calling (openbox-cli, runtime/mcp,
// apps/extension, ...). The optional variant says who/what is driving it
// (claude-code, codex, cursor, etc.). Combined: 'openbox-cli/claude-code'.
//
// We don't auto-detect the caller - env vars set by tools change without
// notice and detection drift is its own analytics problem. Callers (or the
// skill they're following) opt in by setting OPENBOX_CLIENT_VARIANT.

const VARIANT_PATTERN = /^[A-Za-z0-9._+-]+$/;

/**
 * Compose the X-Openbox-Client value from a base and an optional variant.
 *
 * @param base    Component identifier - `'openbox-cli'`, `'runtime/mcp'`, etc.
 * @param variant Explicit override; falls back to `OPENBOX_CLIENT_VARIANT`.
 *                Invalid characters cause the variant to be silently dropped
 *                (with a stderr warning) so a typo can't poison the header.
 */
export function resolveClientName(base: string, variant?: string): string {
  const raw = variant ?? process.env.OPENBOX_CLIENT_VARIANT;
  if (!raw) return base;
  const trimmed = raw.trim();
  if (!trimmed) return base;
  if (!VARIANT_PATTERN.test(trimmed)) {
    console.error(
      `[openbox] OPENBOX_CLIENT_VARIANT='${trimmed}' contains invalid characters; ignoring. ` +
        `Allowed: letters, digits, '.', '_', '+', '-'.`,
    );
    return base;
  }
  return `${base}/${trimmed}`;
}
