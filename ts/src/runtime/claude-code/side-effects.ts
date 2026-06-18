// Runtime impls of every `sideEffect:` callback declared in the
// claude-code adapter's @payloadShape entries. The generated payload
// builders (buildPreToolUsePayload, buildPostToolUsePayload, etc.) call
// these by name; adding a new sideEffect kind in the spec surfaces here
// as a missing key and the type system flags it.

import * as fs from 'node:fs';
import { shouldRedactPathContent } from '../../governance/skip-patterns.js';
import type { ClaudeCodeSideEffects } from '../../core-client/generated/runtime/claude-code.js';

const TRUNCATE_LIMIT = 5000;

export const sideEffects: ClaudeCodeSideEffects = {
  /** Read the file at the given path unless the path is metadata or
   *  secret-like. Redacted files are still governed by path/span data. */
  readFile(input: unknown): string {
    if (typeof input !== 'string' || !input) return '';
    if (shouldRedactPathContent(input)) return '[OpenBox redacted file content]';
    try {
      return fs.existsSync(input) ? fs.readFileSync(input, 'utf-8') : '';
    } catch {
      return '';
    }
  },

  /** JSON-stringify and clip to TRUNCATE_LIMIT chars; used for the
   *  PostToolUse `output` field where Claude can return arbitrarily
   *  large tool responses. */
  stringifyTruncate(input: unknown): string {
    const s = typeof input === 'string' ? input : JSON.stringify(input ?? {});
    return s.length > TRUNCATE_LIMIT ? s.slice(0, TRUNCATE_LIMIT) : s;
  },
};
