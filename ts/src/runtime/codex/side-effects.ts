import * as fs from 'node:fs';
import { shouldRedactPathContent } from '../../governance/skip-patterns.js';
import type { CodexSideEffects } from '../../core-client/generated/runtime/codex.js';

export const sideEffects: CodexSideEffects = {
  readFile(input: unknown): string {
    if (typeof input !== 'string' || !input) return '';
    if (shouldRedactPathContent(input)) return '[OpenBox redacted file content]';
    try {
      return fs.existsSync(input) ? fs.readFileSync(input, 'utf-8') : '';
    } catch {
      return '';
    }
  },
};
