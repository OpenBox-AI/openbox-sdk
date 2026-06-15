// Host metadata paths skipped by runtime governance.
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

export const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.env($|[./-])/,
  /(^|\/)\.env\.[^/]+$/,
  /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.pub)?$/,
  /(^|\/)(credentials|secrets?|token|tokens)\.(json|ya?ml|toml|ini|env|txt)$/,
  /(^|\/)(credentials|config)$/,
  /\.(pem|key|p12|pfx|crt)$/i,
  /(^|\/)\.aws\/credentials$/,
  /(^|\/)\.openbox\/tokens$/,
];

export function isSensitivePath(filePath: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some((p) => p.test(filePath));
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
  cwd?: string,
): boolean {
  if (!filePath || !roots || roots.length === 0) return false;
  const norm = (p: string) => p.replace(/\/+$/, "");
  const f = norm(path.resolve(cwd ?? roots[0] ?? process.cwd(), filePath));
  return roots.some((r) => {
    const root = norm(path.resolve(r));
    return f === root || f.startsWith(root + "/");
  });
}
import path from 'node:path';
