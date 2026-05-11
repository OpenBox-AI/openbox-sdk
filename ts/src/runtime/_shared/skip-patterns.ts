// Paths that should never be governed: IDE / agent metadata that
// gets read on every turn, where evaluation is pure noise. Sensitive
// files (.env, ssh keys, aws creds) used to be in this list to avoid
// PII halts — but that silently bypassed governance on the very
// files most worth gating. Removed; rely on rules + workspace-root
// scoping instead.
export const SKIP_PATTERNS: readonly RegExp[] = [
  /\.cursor\//,
  /\.claude\//,
  /\/mcps\//,
  /\/node_modules\//,
  /\.git\//,
  /INSTRUCTIONS\.md$/,
  /SERVER_METADATA\.json$/,
  /SKILL\.md$/,
];

export function isSkipped(filePath: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(filePath));
}

/**
 * True when `filePath` lives inside any of the IDE's open workspace
 * folders. Used by the cursor runtime to decide whether a file
 * action is "in-project" (skip governance — most reads of source
 * files / configs / package.json are routine) vs "external" (the
 * agent reaching for /etc/passwd, /home/.../.aws/credentials, etc.).
 *
 * Empty / missing roots → returns false: no scope information, treat
 * everything as external (safer default — gates more, doesn't silently
 * pass anything).
 */
export function isInsideAnyRoot(
  filePath: string | undefined,
  roots: string[] | undefined,
): boolean {
  if (!filePath || !roots || roots.length === 0) return false;
  const norm = (p: string) => p.replace(/\/+$/, "");
  const f = norm(filePath);
  return roots.some((r) => {
    const root = norm(r);
    return f === root || f.startsWith(root + "/");
  });
}
