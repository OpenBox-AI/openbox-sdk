// Paths that should never be governed (IDE internals, skills, config
// dirs, secret stores). Coding agents read .claude/ metadata, skills,
// etc. before the user's actual file; PII scanning those causes false
// HALTs.
export const SKIP_PATTERNS: readonly RegExp[] = [
  /\.cursor\//,
  /\.claude\//,
  /\/mcps\//,
  /\/node_modules\//,
  /\.git\//,
  /INSTRUCTIONS\.md$/,
  /SERVER_METADATA\.json$/,
  /SKILL\.md$/,
  /\.env(\..*)?$/,
  /\.aws\//,
  /\.ssh\//,
  /\.kube\//,
  /\.gnupg\//,
];

export function isSkipped(filePath: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(filePath));
}
