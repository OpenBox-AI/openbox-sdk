import { readFileSync } from 'fs';

/**
 * Parse a JSON input value that can be:
 * - A raw JSON string: '{"key": "value"}'
 * - A file path prefixed with @: @payload.json
 * - A dash for stdin: -
 */
export function parseJsonInput<T = unknown>(value: string): T {
  if (value === '-') {
    // Read all of stdin (fd 0) to EOF. (Previously used `require('fs')`, which
    // throws in an ESM runtime, plus a reused-buffer loop that corrupted payloads
    // over 4 KB — both broke the documented `-` stdin input mode.)
    return JSON.parse(readFileSync(0, 'utf-8'));
  }

  if (value.startsWith('@')) {
    const filePath = value.slice(1);
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  }

  return JSON.parse(value);
}
