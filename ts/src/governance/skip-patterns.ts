// Paths that should never be governed: IDE / agent metadata that
// gets read on every turn, where evaluation is pure noise.
// Sensitive files (.env, ssh keys, aws creds) used to live in this
// list to avoid PII halts, but doing so silently bypassed
// governance on the very files most worth gating. They are removed
// now; rely on rules and workspace-root scoping instead.
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
 * True when `filePath` lives inside any of the IDE's open
 * workspace folders. Used by the cursor runtime to decide whether
 * a file action is "in-project" (skip governance; most reads of
 * source files, configs, or `package.json` are routine) versus
 * "external" (the agent reaching for `/etc/passwd`,
 * `/home/.../.aws/credentials`, and the like).
 *
 * Empty or missing roots return `false`. Without scope
 * information, treat every path as external. The result gates more
 * activity rather than less, which is the safer default.
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
