// Runtime impls of every `sideEffect:` callback declared in the cursor
// adapter's @payloadShape entries. The generated payload builders call
// these by name; missing impls surface as type errors at consumer sites.

import * as fs from 'node:fs';
import { shouldRedactPathContent } from '../../governance/skip-patterns.js';
import type { CursorSideEffects } from '../../core-client/generated/runtime/cursor.js';

export const sideEffects: CursorSideEffects = {
  /** File read for cursor's preToolUse Read mapping. Metadata and
   *  secret-like content is redacted while the path/span remains governed. */
  readFile(input: unknown): string {
    if (typeof input !== 'string' || !input) return '';
    if (shouldRedactPathContent(input)) return '[OpenBox redacted file content]';
    try {
      return fs.existsSync(input) ? fs.readFileSync(input, 'utf-8') : '';
    } catch {
      return '';
    }
  },

  /** JSON-stringify helper (no truncation; cursor's beforeMCPExecution
   *  payload is bounded by the originating tool call, not by
   *  agent-streamed output). */
  stringify(input: unknown): string {
    return typeof input === 'string' ? input : JSON.stringify(input ?? {});
  },

  /** Extract `text`-typed entries from an MCP `{ content: [{ type, text }] }`
   *  response. Falls back to JSON of the raw value on shape mismatch so
   *  output guardrails always have *something* to scan. */
  extractMcpText(input: unknown): string {
    if (typeof input === 'string') {
      try {
        const parsed = JSON.parse(input) as { content?: Array<{ type: string; text: string }> };
        if (Array.isArray(parsed.content)) {
          return parsed.content
            .filter((c) => c.type === 'text' && c.text)
            .map((c) => c.text)
            .join('\n');
        }
        return JSON.stringify(parsed);
      } catch {
        return input;
      }
    }
    return JSON.stringify(input ?? {});
  },
};
