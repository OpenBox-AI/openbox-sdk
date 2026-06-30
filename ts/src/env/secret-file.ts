import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The SINGLE writer for secret-bearing files (token stores, agent-key caches,
 * config). `writeFileSync`'s `mode` only applies when the file is CREATED and is
 * subject to umask, so overwriting a pre-existing, loosely-permissioned file would
 * keep its old perms — leaking secrets at rest. The trailing `chmodSync(0o600)`
 * re-tightens unconditionally. Every secret writer routes here so the 0600
 * guarantee is enforced in exactly one place and cannot drift.
 */
export function writeSecretFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { mode: 0o600, encoding: 'utf-8' });
  chmodSync(path, 0o600);
}
